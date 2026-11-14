import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../auth/AuthProvider'
import { Badge, Button, ErrorBox, Field, Modal, Spinner, Textarea } from '../../components/ui'
import { useToast } from '../../components/Toast'
import { supabase } from '../../lib/supabase'
import { errorMessage } from '../../lib/errors'
import { formatRs } from '../../lib/money'
import { formatDateTime } from '../../lib/time'
import { buildReceipt } from '../receipts/receiptModel'
import { ReceiptView } from '../receipts/ReceiptView'
import { usePrinterConfig } from '../receipts/printer'
import { runPrint, type PrintStatus } from '../sales/PaymentDialog'
import { useSettings } from '../settings/useSettings'
import { useSale } from './useSales'

export function SaleDetailDialog({ saleId, onClose }: { saleId: string | null; onClose: () => void }) {
  const { isAdmin } = useAuth()
  const { data: sale, isLoading, error } = useSale(saleId)
  const { data: settings } = useSettings()
  const paper = usePrinterConfig((s) => s.paper)
  const qc = useQueryClient()
  const toast = useToast()
  const [print, setPrint] = useState<PrintStatus>({ state: 'idle' })
  const [voiding, setVoiding] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [voidError, setVoidError] = useState<string | null>(null)

  function close() { setVoiding(false); setReason(''); setVoidError(null); setPrint({ state: 'idle' }); onClose() }

  async function doVoid() {
    if (!sale) return
    setBusy(true)
    setVoidError(null)
    const { error } = await supabase.rpc('void_sale', { p_sale_id: sale.id, p_reason: reason })
    setBusy(false)
    if (error) return setVoidError(errorMessage(error))
    toast(`Invoice #${sale.invoice_no} voided — stock restored`)
    setVoiding(false)
    await qc.invalidateQueries({ queryKey: ['sales'] })
  }

  if (!saleId) return null
  return (
    <Modal open onClose={close} size="lg" title={sale ? `Invoice #${sale.invoice_no}` : 'Sale'}
      footer={sale && !voiding ? <>
        {isAdmin && sale.status === 'completed' && (
          <Button variant="ghost" className="mr-auto text-rose-600" onClick={() => setVoiding(true)}>Void / refund…</Button>
        )}
        <Button variant="secondary" onClick={close}>Close</Button>
        <Button busy={print.state === 'printing'} onClick={() => void runPrint(sale, true, setPrint)}>Reprint receipt</Button>
      </> : undefined}>
      {isLoading ? <Spinner /> : error ? <ErrorBox>{errorMessage(error)}</ErrorBox> : sale && (
        <div className="grid gap-6 md:grid-cols-[1fr_auto]">
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {sale.status === 'voided' ? <Badge tone="red">Voided</Badge> : <Badge tone="green">Completed</Badge>}
              <Badge tone="slate" className="capitalize">{sale.payment_method === 'split' ? 'Cash + Card' : sale.payment_method}</Badge>
              {sale.synced_from_offline && <Badge tone="amber">Synced from offline</Badge>}
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <dt className="text-slate-500">Date</dt><dd>{formatDateTime(sale.created_at)}</dd>
              <dt className="text-slate-500">Cashier</dt><dd>{sale.cashier_name}</dd>
              <dt className="text-slate-500">Items</dt><dd>{sale.items_count}</dd>
              <dt className="text-slate-500">Total</dt><dd className="font-bold">{formatRs(sale.total)}</dd>
              {sale.device_id && <><dt className="text-slate-500">Device</dt><dd>{sale.device_id}</dd></>}
            </dl>
            {sale.status === 'voided' && (
              <div className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800">
                Voided by <b>{sale.voided_by_name}</b> on {sale.voided_at && formatDateTime(sale.voided_at)}<br />
                Reason: {sale.void_reason}
              </div>
            )}
            {voiding && (
              <div className="space-y-3 rounded-xl border-2 border-rose-200 p-4">
                <p className="font-semibold text-rose-800">
                  Void invoice #{sale.invoice_no} ({formatRs(sale.total)})? All {sale.items_count} item(s) go back into stock.
                  Refund the customer {sale.payment_method === 'card' ? 'on the card machine' : sale.payment_method === 'split' ? `${formatRs(sale.cash_amount)} cash + ${formatRs(sale.card_amount)} on the card machine` : `${formatRs(sale.cash_amount)} in cash`}.
                </p>
                {voidError && <ErrorBox>{voidError}</ErrorBox>}
                <Field label="Reason *"><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Customer returned items" /></Field>
                <div className="flex justify-end gap-2">
                  <Button variant="secondary" onClick={() => setVoiding(false)}>Cancel</Button>
                  <Button variant="danger" busy={busy} disabled={!reason.trim()} onClick={() => void doVoid()}>Void sale</Button>
                </div>
              </div>
            )}
            {print.state === 'done' && <p className={print.warning ? 'text-sm text-amber-700' : 'text-sm text-emerald-700'}>{print.warning ?? 'Receipt reprinted.'}</p>}
          </div>
          <div className="rounded-xl bg-slate-200 p-3">
            <div className="mx-auto w-fit bg-white px-[2mm] shadow"><ReceiptView doc={buildReceipt(sale, settings, { reprint: true })} paper={paper} /></div>
          </div>
        </div>
      )}
    </Modal>
  )
}
