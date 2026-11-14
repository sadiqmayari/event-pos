import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useToast } from '../../components/Toast'
import { getLastSale, rememberLastSale, submitSale } from '../sales/submitSale'
import { markSynced, setNetworkDown, updateItem, useOutbox } from './outbox'

let running: Promise<SyncResult> | null = null

export interface SyncResult { synced: { temp_no: string; invoice_no: number }[]; failed: number; stoppedForNetwork: boolean }

/** Sends queued sales one by one, oldest first. Safe to call any time — concurrent calls share one run. */
export function syncOutbox(): Promise<SyncResult> {
  if (!running) running = run().finally(() => { running = null })
  return running
}

async function run(): Promise<SyncResult> {
  const result: SyncResult = { synced: [], failed: 0, stoppedForNetwork: false }
  const queue = useOutbox.getState().items.filter((i) => i.status === 'pending')
    .sort((a, b) => a.queued_at.localeCompare(b.queued_at))

  for (const item of queue) {
    const res = await submitSale(item.payload, 15_000)
    if (res.ok) {
      markSynced(item, res.sale.invoice_no)
      if (getLastSale()?.id === item.id) rememberLastSale(res.sale) // "Reprint last" now shows the real invoice number
      result.synced.push({ temp_no: item.temp_no, invoice_no: res.sale.invoice_no })
      continue
    }
    const { code, message } = res.error
    if (code === 'NETWORK') {
      updateItem(item.id, { attempts: item.attempts + 1, last_error: message })
      result.stoppedForNetwork = true
      break
    }
    if (code === '42501' || code === 'PGRST301' || code === 'NOT_AUTHORIZED' || /jwt/i.test(message)) {
      // logged out / session expired: keep it pending, it will sync after logging in again
      updateItem(item.id, { attempts: item.attempts + 1, last_error: 'Waiting for a staff login to sync.' })
      break
    }
    // the server refused it (e.g. stock ran out on another till) — an admin has to decide
    updateItem(item.id, { attempts: item.attempts + 1, status: 'failed', last_error: message })
    result.failed++
  }
  return result
}

/** Mounted once in the layout: syncs on start-up, when the connection returns, and every 20 s while sales are waiting. */
export function useOutboxSync() {
  const toast = useToast()
  const qc = useQueryClient()
  const pending = useOutbox((s) => s.items.filter((i) => i.status === 'pending').length)
  // the effect re-runs whenever the queue changes; results must still be reported, so use refs
  const ctx = useRef({ toast, qc })
  ctx.current = { toast, qc }

  useEffect(() => {
    async function go() {
      if (!navigator.onLine || !useOutbox.getState().items.some((i) => i.status === 'pending')) return
      const r = await syncOutbox()
      const { toast, qc } = ctx.current
      if (r.synced.length) {
        toast(r.synced.length === 1
          ? `Offline sale ${r.synced[0].temp_no} synced as invoice #${r.synced[0].invoice_no}`
          : `${r.synced.length} offline sales synced`)
        void qc.invalidateQueries({ queryKey: ['products'] })
        void qc.invalidateQueries({ queryKey: ['sales'] })
      }
      if (r.failed) toast(`${r.failed} offline sale(s) could not be saved — tap the red badge at the top`, 'error')
    }
    const onOnline = () => { setNetworkDown(false); void go() }
    window.addEventListener('online', onOnline)
    void go()
    const t = pending > 0 ? window.setInterval(() => void go(), 20_000) : undefined
    return () => { window.removeEventListener('online', onOnline); if (t) clearInterval(t) }
  }, [pending])
}
