import { useEffect, useMemo, useState } from 'react'
import { Button, cx, ErrorBox, Input, Modal, Spinner } from '../../components/ui'
import { NumPad } from '../../components/NumPad'
import { formatRs } from '../../lib/money'
import type { Totals } from '../../lib/pricing'
import type { PaymentMethod, Sale } from '../../lib/types'
import type { AppError } from '../../lib/errors'
import { useCart } from './cartStore'
import { buildPayload, rememberLastSale, submitSale, type PriceChange, type StockShortage } from './submitSale'
import { printReceipt, usePrinterConfig } from '../receipts/printer'

export type PrintStatus = { state: 'idle' | 'printing' | 'done'; via?: 'direct' | 'browser'; warning?: string }

export async function runPrint(sale: Sale, reprint: boolean, set: (s: PrintStatus) => void) {
  set({ state: 'printing' })
  try {
    const r = await printReceipt(sale, { reprint })
    set({ state: 'done', via: r.via, warning: r.warning })
  } catch (err) {
    set({ state: 'done', warning: (err as Error).message })
  }
}

type Phase =
  | { kind: 'form' }
  | { kind: 'saving' }
  | { kind: 'done'; sale: Sale }
  | { kind: 'error'; error: AppError; shortages?: StockShortage[]; priceChanges?: PriceChange[] }

type Field = 'received' | 'card'

function quickCash(total: number): number[] {
  const out = new Set<number>([total])
  for (const step of [100, 500, 1000, 5000]) out.add(Math.ceil(total / step) * step)
  return [...out].filter((v) => v > 0).sort((a, b) => a - b).slice(0, 5)
}

export function PaymentDialog({ open, totals, onClose, onFixStock, onFixPrices }: {
  open: boolean
  totals: Totals
  onClose: () => void
  onFixStock: (s: StockShortage[]) => void
  onFixPrices: (c: PriceChange[]) => void
}) {
  const { lines, billDiscount, ensureSaleId, clear } = useCart()
  const [phase, setPhase] = useState<Phase>({ kind: 'form' })
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [received, setReceived] = useState('')
  const [card, setCard] = useState('')
  const [cardRef, setCardRef] = useState('')
  const [field, setField] = useState<Field>('received')
  const [print, setPrint] = useState<PrintStatus>({ state: 'idle' })

  useEffect(() => {
    if (open) { setPhase({ kind: 'form' }); setReceived(''); setCard(''); setCardRef(''); setField('received'); setPrint({ state: 'idle' }) }
  }, [open])

  const total = totals.total
  const cardN = Number(card || 0)
  const cashDue = method === 'cash' ? total : method === 'split' ? Math.max(0, total - cardN) : 0
  const receivedN = received === '' ? cashDue : Number(received)
  const change = Math.max(0, receivedN - cashDue)

  const problem = useMemo(() => {
    if (method === 'split' && (cardN <= 0 || cardN >= total)) return `Card part must be between Rs 1 and ${formatRs(Math.max(total - 1, 0))}.`
    if (method !== 'card' && receivedN < cashDue) return `Cash received is less than ${formatRs(cashDue)}.`
    return null
  }, [method, cardN, total, receivedN, cashDue])

  async function complete() {
    if (problem) return
    setPhase({ kind: 'saving' })
    const payload = buildPayload(ensureSaleId(), lines, billDiscount, {
      method, cashReceived: method === 'card' ? null : receivedN, cardAmount: method === 'split' ? cardN : null, cardRef,
    })
    const res = await submitSale(payload)
    if (res.ok) {
      rememberLastSale(res.sale)
      clear() // the sale is safely in the database — the cart can go
      setPhase({ kind: 'done', sale: res.sale })
      if (usePrinterConfig.getState().autoPrint) void runPrint(res.sale, false, setPrint)
    } else {
      setPhase({ kind: 'error', error: res.error, shortages: res.shortages, priceChanges: res.priceChanges })
    }
  }

  const saving = phase.kind === 'saving'
  const close = saving ? () => {} : onClose

  if (phase.kind === 'done') return open ? <DoneView sale={phase.sale} onNext={onClose} print={print}
    onPrint={() => void runPrint(phase.sale, print.state === 'done', setPrint)} /> : null

  return (
    <Modal open={open} onClose={close} title={`Payment · ${formatRs(total)}`} size="xl"
      footer={phase.kind === 'error' ? null : <>
        <Button variant="secondary" size="lg" onClick={close} disabled={saving}>Back</Button>
        <Button variant="success" size="lg" className="min-w-56" busy={saving} disabled={Boolean(problem)} onClick={() => void complete()}>
          {saving ? 'Saving…' : `Complete sale · ${formatRs(total)}`}
        </Button>
      </>}>
      {phase.kind === 'error' ? (
        <ErrorView phase={phase} onRetry={() => void complete()} onBack={() => setPhase({ kind: 'form' })}
          onFixStock={(s) => { onFixStock(s); onClose() }}
          onFixPrices={(c) => { onFixPrices(c); onClose() }} />
      ) : (
        <div className={cx('grid gap-6 md:grid-cols-[1fr_320px]', saving && 'pointer-events-none opacity-60')}>
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              {(['cash', 'card', 'split'] as PaymentMethod[]).map((m) => (
                <button key={m} type="button" onClick={() => { setMethod(m); setField(m === 'split' ? 'card' : 'received') }}
                  className={cx('h-16 rounded-xl border-2 text-lg font-bold capitalize',
                    method === m ? 'border-teal-700 bg-teal-700 text-white' : 'border-slate-200 bg-white text-slate-700')}>
                  {m === 'split' ? 'Cash + Card' : m}
                </button>
              ))}
            </div>

            {method === 'split' && (
              <AmountBox label="Card amount" value={card ? formatRs(cardN) : 'Tap & enter'} active={field === 'card'} onClick={() => setField('card')} />
            )}
            {method !== 'card' && (
              <>
                {method === 'split' && <Row label="Cash part" value={formatRs(cashDue)} />}
                <AmountBox label="Cash received" value={received === '' ? `${formatRs(cashDue)} (exact)` : formatRs(receivedN)}
                  active={field === 'received'} onClick={() => setField('received')} />
                <div className="flex flex-wrap gap-2">
                  {quickCash(cashDue).map((v) => (
                    <button key={v} type="button" onClick={() => { setReceived(String(v)); setField('received') }}
                      className="h-12 min-w-24 rounded-xl border border-slate-300 bg-white px-3 font-semibold active:bg-slate-200">
                      {v === cashDue ? 'Exact' : formatRs(v)}
                    </button>
                  ))}
                </div>
                <div className={cx('rounded-2xl p-4 text-center', change > 0 ? 'bg-amber-100' : 'bg-slate-100')}>
                  <div className="text-sm font-medium text-slate-600">Change to give</div>
                  <div className="text-4xl font-black tabular-nums">{formatRs(change)}</div>
                </div>
              </>
            )}
            {method !== 'cash' && (
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-slate-700">Card last 4 digits or reference (optional)</span>
                <Input value={cardRef} maxLength={30} onChange={(e) => setCardRef(e.target.value)} placeholder="e.g. 4821" />
                <span className="mt-1 block text-xs text-slate-500">
                  Charge {formatRs(method === 'split' ? cardN : total)} on the bank card machine first, then complete the sale here.
                </span>
              </label>
            )}
            {problem && (received !== '' || method === 'split') && <p className="text-rose-600">{problem}</p>}
          </div>

          {method !== 'card' ? (
            <NumPad value={field === 'card' ? card : received} onChange={field === 'card' ? setCard : setReceived} />
          ) : (
            <div className="hidden rounded-2xl bg-slate-50 p-6 text-center text-slate-500 md:block">
              <div className="text-5xl">💳</div>
              <p className="mt-2">Card amount</p>
              <p className="text-3xl font-bold text-slate-800">{formatRs(total)}</p>
            </div>
          )}
        </div>
      )}
      {saving && (
        <div className="mt-4 flex items-center justify-center gap-2 text-teal-800"><Spinner /> Saving sale — please wait, do not close…</div>
      )}
    </Modal>
  )
}

function AmountBox({ label, value, active, onClick }: { label: string; value: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className={cx('flex w-full items-center justify-between rounded-xl border-2 bg-white px-4 py-3 text-left',
        active ? 'border-teal-600 ring-4 ring-teal-600/15' : 'border-slate-200')}>
      <span className="text-sm font-medium text-slate-600">{label}</span>
      <span className="text-2xl font-bold tabular-nums">{value}</span>
    </button>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between px-1 text-slate-600"><span>{label}</span><span className="font-semibold">{value}</span></div>
}

function ErrorView({ phase, onRetry, onBack, onFixStock, onFixPrices }: {
  phase: Extract<Phase, { kind: 'error' }>
  onRetry: () => void
  onBack: () => void
  onFixStock: (s: StockShortage[]) => void
  onFixPrices: (c: PriceChange[]) => void
}) {
  const { error, shortages, priceChanges } = phase
  const network = error.code === 'NETWORK'
  return (
    <div className="space-y-4">
      <ErrorBox>
        <p className="text-lg font-bold">{network ? 'Sale NOT confirmed' : 'Sale not saved'}</p>
        <p>{error.message}</p>
        {network && <p className="mt-1 text-sm">Do not hand over goods yet. Press “Try again” — if the sale actually went through, it will not be recorded twice.</p>}
      </ErrorBox>
      {shortages && shortages.length > 0 && (
        <ul className="divide-y rounded-xl border border-slate-200">
          {shortages.map((s) => (
            <li key={s.product_id} className="flex justify-between px-4 py-2">
              <span className="font-medium">{s.name}</span>
              <span>wanted {s.requested}, <b className="text-rose-700">only {s.available} left</b></span>
            </li>
          ))}
        </ul>
      )}
      {priceChanges && priceChanges.length > 0 && (
        <ul className="divide-y rounded-xl border border-slate-200">
          {priceChanges.map((c) => (
            <li key={c.product_id} className="flex justify-between px-4 py-2">
              <span className="font-medium">{c.name}</span>
              <span>{formatRs(c.old_price)} → <b>{formatRs(c.new_price)}</b></span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" size="lg" onClick={onBack}>Back to payment</Button>
        {shortages && <Button size="lg" onClick={() => onFixStock(shortages)}>Fix cart to available stock</Button>}
        {priceChanges && <Button size="lg" onClick={() => onFixPrices(priceChanges)}>Use new prices</Button>}
        {network && <Button size="lg" onClick={onRetry}>Try again</Button>}
      </div>
    </div>
  )
}

function DoneView({ sale, onNext, print, onPrint }: { sale: Sale; onNext: () => void; print: PrintStatus; onPrint: () => void }) {
  return (
    <Modal open onClose={onNext} title="Sale complete" size="md"
      footer={<div className="flex w-full gap-2">
        <Button variant="secondary" size="lg" className="flex-1" busy={print.state === 'printing'} onClick={onPrint}>
          {print.state === 'done' ? 'Reprint' : 'Print receipt'}
        </Button>
        <Button variant="success" size="lg" className="flex-[2]" autoFocus onClick={onNext}>New sale</Button>
      </div>}>
      <div className="space-y-4 text-center">
        <div className="mx-auto grid size-16 place-items-center rounded-full bg-emerald-100 text-4xl text-emerald-700">✓</div>
        <div>
          <div className="text-slate-500">Saved · Invoice</div>
          <div className="text-3xl font-black">#{sale.invoice_no}</div>
        </div>
        <div className="grid grid-cols-2 gap-3 text-left">
          <Info label="Total" value={formatRs(sale.total)} />
          <Info label="Paid by" value={sale.payment_method === 'split' ? 'Cash + Card' : sale.payment_method} />
          {sale.cash_received != null && <Info label="Cash received" value={formatRs(sale.cash_received)} />}
          {sale.card_amount > 0 && <Info label="Card" value={formatRs(sale.card_amount)} />}
        </div>
        {sale.payment_method !== 'card' && (
          <div className="rounded-2xl bg-amber-100 p-4">
            <div className="text-sm font-medium text-amber-900">Give change</div>
            <div className="text-5xl font-black tabular-nums">{formatRs(sale.change_due)}</div>
          </div>
        )}
        {print.state === 'printing' && <p className="text-sm text-slate-500">Printing receipt…</p>}
        {print.state === 'done' && !print.warning && <p className="text-sm text-emerald-700">{print.via === 'direct' ? 'Receipt sent to printer.' : 'Receipt sent to browser printing.'}</p>}
        {print.warning && <p className="text-sm text-amber-700">{print.warning}</p>}
      </div>
    </Modal>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="font-bold capitalize">{value}</div>
    </div>
  )
}
