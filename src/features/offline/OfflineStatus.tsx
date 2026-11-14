import { useState, useSyncExternalStore } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { Badge, Button, cx, ErrorBox, Modal } from '../../components/ui'
import { useToast } from '../../components/Toast'
import { downloadFile } from '../../lib/csv'
import { formatRs } from '../../lib/money'
import { formatDateTime } from '../../lib/time'
import { getDeviceId } from '../../lib/device'
import { runPrint } from '../sales/PaymentDialog'
import { removeItem, updateItem, useOutbox, type OutboxItem } from './outbox'
import { syncOutbox, useOutboxSync } from './sync'

function subscribeOnline(cb: () => void) {
  window.addEventListener('online', cb)
  window.addEventListener('offline', cb)
  return () => { window.removeEventListener('online', cb); window.removeEventListener('offline', cb) }
}

/** Online = the browser has a network AND the last server call didn't fail for network reasons. */
export function useIsOnline() {
  const browserOnline = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true)
  const networkDown = useOutbox((s) => s.networkDown)
  return browserOnline && !networkDown
}

/** Full-width strip shown under the header while offline. */
export function OfflineBanner() {
  const online = useIsOnline()
  if (online) return null
  return (
    <div className="bg-rose-600 px-4 py-1 text-center text-sm font-semibold text-white">
      Offline — sales are saved on this device and will sync automatically when the connection returns.
    </div>
  )
}

/** Header badge: Online / Offline + queued sales. Also runs the background sync. */
export function OfflineStatus() {
  useOutboxSync()
  const online = useIsOnline()
  const items = useOutbox((s) => s.items)
  const [open, setOpen] = useState(false)
  const pending = items.filter((i) => i.status === 'pending').length
  const failed = items.filter((i) => i.status === 'failed').length

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="flex items-center gap-1" title="Connection & offline sales">
        {online ? <Badge tone="green">● Online</Badge> : <Badge tone="red">● Offline</Badge>}
        {pending > 0 && <Badge tone="amber">{pending} to sync</Badge>}
        {failed > 0 && <Badge tone="red" className="animate-pulse">{failed} need attention</Badge>}
      </button>
      <OutboxDialog open={open} onClose={() => setOpen(false)} />
    </>
  )
}

function OutboxDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { isAdmin } = useAuth()
  const toast = useToast()
  const online = useIsOnline()
  const { items, synced } = useOutbox()
  const [busy, setBusy] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState<string | null>(null)

  async function syncNow() {
    setBusy(true)
    const r = await syncOutbox()
    setBusy(false)
    toast(r.stoppedForNetwork ? 'Still no connection to the server' : `${r.synced.length} synced${r.failed ? `, ${r.failed} need attention` : ''}`,
      r.stoppedForNetwork || r.failed ? 'error' : 'success')
  }

  function downloadDeviceData() {
    downloadFile(`event-pos-device-${getDeviceId()}_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`,
      JSON.stringify({ device: getDeviceId(), exported_at: new Date().toISOString(), outbox: items, recently_synced: synced }, null, 1), 'application/json')
  }

  function discard(item: OutboxItem) {
    downloadFile(`discarded-sale-${item.temp_no}.json`, JSON.stringify(item, null, 1), 'application/json') // keep a copy, just in case
    removeItem(item.id)
    setConfirmDiscard(null)
    toast(`${item.temp_no} discarded (a copy was downloaded)`, 'info')
  }

  return (
    <Modal open={open} onClose={onClose} title="Connection & offline sales" size="lg"
      footer={<>
        <Button variant="ghost" className="mr-auto" onClick={downloadDeviceData}>Download this device's data</Button>
        <Button variant="secondary" onClick={onClose}>Close</Button>
        <Button busy={busy} disabled={!items.some((i) => i.status === 'pending')} onClick={() => void syncNow()}>Sync now</Button>
      </>}>
      <div className="space-y-4">
        <p className={cx('rounded-xl px-4 py-3 font-semibold', online ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800')}>
          {online ? 'Connected to the server.' : 'No connection to the server. Keep selling — sales are stored on this device.'}
        </p>
        {items.length === 0 ? <p className="text-slate-600">No sales waiting on this device. 👍</p> : (
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {items.map((it) => (
              <li key={it.id} className={cx('space-y-2 p-3', it.status === 'failed' && 'bg-rose-50')}>
                <div className="flex flex-wrap items-center gap-2">
                  <b>{it.temp_no}</b>
                  <span className="text-sm text-slate-500">{formatDateTime(it.queued_at)} · {it.preview.cashier_name}</span>
                  <span className="ml-auto font-bold">{formatRs(it.preview.total)}</span>
                  {it.status === 'failed' ? <Badge tone="red">Needs attention</Badge> : <Badge tone="amber">Waiting to sync</Badge>}
                </div>
                <div className="text-sm text-slate-600">{it.preview.items?.map((l) => `${l.qty}× ${l.name}`).join(', ')}</div>
                {it.last_error && <div className={cx('text-sm', it.status === 'failed' ? 'text-rose-700' : 'text-slate-500')}>{it.last_error}</div>}
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onClick={() => void runPrint(it.preview, true, () => {})}>Reprint</Button>
                  {it.status === 'failed' && (
                    <Button size="sm" onClick={() => { updateItem(it.id, { status: 'pending', last_error: null }); void syncNow() }}>Retry</Button>
                  )}
                  {it.status === 'failed' && isAdmin && (confirmDiscard === it.id ? (
                    <>
                      <span className="self-center text-sm text-rose-700">Discard this sale for good?</span>
                      <Button size="sm" variant="danger" onClick={() => discard(it)}>Yes, discard</Button>
                      <Button size="sm" variant="secondary" onClick={() => setConfirmDiscard(null)}>No</Button>
                    </>
                  ) : <Button size="sm" variant="ghost" className="text-rose-600" onClick={() => setConfirmDiscard(it.id)}>Discard…</Button>)}
                </div>
              </li>
            ))}
          </ul>
        )}
        {items.some((i) => i.status === 'failed') && (
          <ErrorBox>
            A sale “needs attention” when the server refused it — usually because another till sold the last units while this one was offline.
            Admin: fix the stock on the Stock page (if the goods really were there), then press <b>Retry</b>. Only discard a sale if it truly did not happen.
          </ErrorBox>
        )}
        {synced.length > 0 && (
          <div>
            <h3 className="mb-1 font-semibold">Recently synced from this device</h3>
            <ul className="max-h-40 overflow-y-auto text-sm text-slate-600">
              {synced.slice(0, 20).map((s) => <li key={s.temp_no}>{s.temp_no} → invoice <b>#{s.invoice_no}</b> · {formatDateTime(s.synced_at)}</li>)}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  )
}
