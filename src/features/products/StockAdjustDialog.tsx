import { useEffect, useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import type { Product, StockMovementType } from '../../lib/types'
import { errorMessage } from '../../lib/errors'
import { formatDateTime } from '../../lib/time'
import { Badge, Button, cx, ErrorBox, Field, Input, Modal, Select, Spinner } from '../../components/ui'
import { useToast } from '../../components/Toast'
import { useStockMovements, useUpsertProductInCache } from './useProducts'

type Mode = 'add' | 'remove' | 'set'
const REASONS: Record<Mode, string[]> = {
  add: ['New delivery received', 'Returned by customer', 'Found during recount', 'Other'],
  remove: ['Damaged', 'Lost / missing', 'Sample / display', 'Returned to supplier', 'Other'],
  set: ['Stock count', 'Start of day count', 'End of day count', 'Other'],
}
const TYPE_TONE: Record<StockMovementType, 'teal' | 'blue' | 'amber' | 'slate' | 'red'> = {
  initial: 'teal', import: 'blue', adjustment: 'amber', sale: 'slate', void: 'red',
}

export function StockAdjustDialog({ product, onClose }: { product: Product | null; onClose: () => void }) {
  const toast = useToast()
  const qc = useQueryClient()
  const upsertCache = useUpsertProductInCache()
  const history = useStockMovements(product?.id ?? null)
  const [mode, setMode] = useState<Mode>('add')
  const [qty, setQty] = useState('')
  const [reason, setReason] = useState(REASONS.add[0])
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setMode('add'); setQty(''); setReason(REASONS.add[0]); setNote(''); setError(null)
  }, [product?.id])

  if (!product) return null
  const n = Number(qty)
  const valid = qty !== '' && Number.isInteger(n) && n >= 0 && (mode === 'set' || n > 0)
  const newQty = !valid ? null : mode === 'add' ? product.stock_qty + n : mode === 'remove' ? product.stock_qty - n : n

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!product || !valid) return
    const fullReason = reason === 'Other' ? note.trim() : note.trim() ? `${reason} — ${note.trim()}` : reason
    if (!fullReason) return setError('Please type a reason.')
    if (newQty !== null && newQty < 0) return setError(`Only ${product.stock_qty} in stock.`)
    setBusy(true)
    setError(null)
    const { data, error } = await supabase.rpc('adjust_stock', {
      p_product_id: product.id,
      p_reason: fullReason,
      ...(mode === 'set' ? { p_new_qty: n } : { p_delta: mode === 'add' ? n : -n }),
    })
    setBusy(false)
    if (error) return setError(errorMessage(error))
    upsertCache(data as Product)
    void qc.invalidateQueries({ queryKey: ['stock_movements', product.id] })
    toast(`Stock for ${product.name} is now ${(data as Product).stock_qty}`)
    onClose()
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Adjust stock — ${product.name}`}
      size="lg"
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button type="submit" form="adjust-form" busy={busy} disabled={!valid}>Save adjustment</Button>
      </>}
    >
      <form id="adjust-form" onSubmit={onSubmit} className="space-y-4">
        {error && <ErrorBox>{error}</ErrorBox>}
        <div className="grid grid-cols-3 gap-2">
          {(['add', 'remove', 'set'] as Mode[]).map((m) => (
            <button key={m} type="button" onClick={() => { setMode(m); setReason(REASONS[m][0]) }}
              className={cx('h-14 rounded-xl border-2 text-base font-semibold',
                mode === m ? 'border-teal-700 bg-teal-50 text-teal-800' : 'border-slate-200 bg-white text-slate-600')}>
              {m === 'add' ? '+ Add' : m === 'remove' ? '− Remove' : '= Set count'}
            </button>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={mode === 'set' ? 'Counted quantity' : 'Quantity'}>
            <Input autoFocus inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ''))} />
          </Field>
          <div className="rounded-xl bg-slate-50 p-3 text-center">
            <div className="text-sm text-slate-500">Current → New</div>
            <div className="text-2xl font-bold">
              {product.stock_qty} → <span className={cx(newQty !== null && newQty < 0 && 'text-rose-600')}>{newQty ?? '…'}</span>
            </div>
          </div>
          <Field label="Reason">
            <Select value={reason} onChange={(e) => setReason(e.target.value)}>
              {REASONS[mode].map((r) => <option key={r}>{r}</option>)}
            </Select>
          </Field>
          <Field label={reason === 'Other' ? 'Describe the reason *' : 'Note (optional)'}>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
      </form>

      <h3 className="mt-6 mb-2 font-semibold text-slate-700">Recent stock movements</h3>
      {history.isLoading ? <Spinner /> : (
        <div className="overflow-hidden rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <tbody>
              {(history.data ?? []).map((m) => (
                <tr key={m.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-3 py-2 text-slate-500">{formatDateTime(m.created_at)}</td>
                  <td className="px-3 py-2"><Badge tone={TYPE_TONE[m.type]}>{m.type}</Badge></td>
                  <td className={cx('px-3 py-2 text-right font-semibold', m.delta > 0 ? 'text-emerald-700' : 'text-rose-700')}>
                    {m.delta > 0 ? '+' : ''}{m.delta}
                  </td>
                  <td className="px-3 py-2 text-right">→ {m.qty_after}</td>
                  <td className="px-3 py-2 text-slate-600">{m.reason}</td>
                </tr>
              ))}
              {history.data?.length === 0 && <tr><td className="px-3 py-3 text-slate-500">No movements yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  )
}
