import { useState } from 'react'
import { Badge, Button, cx } from '../../components/ui'
import { formatRs } from '../../lib/money'
import { describeDiscount, type Totals } from '../../lib/pricing'
import type { Product } from '../../lib/types'
import { useCart } from './cartStore'

export function CartPanel({ totals, productsById, onEditLine, onBillDiscount, onCharge }: {
  totals: Totals
  productsById: Map<string, Product>
  onEditLine: (productId: string) => void
  onBillDiscount: () => void
  onCharge: () => void
}) {
  const { setQty, clear, billDiscount } = useCart()
  const [confirmClear, setConfirmClear] = useState(false)
  const problems = totals.lines.filter((l) => {
    const p = productsById.get(l.product_id)
    return !p || !p.active || p.stock_qty < l.qty
  })

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <h2 className="text-lg font-bold">Cart {totals.itemsCount > 0 && <span className="text-slate-500">· {totals.itemsCount} item{totals.itemsCount === 1 ? '' : 's'}</span>}</h2>
        {totals.lines.length > 0 && (confirmClear ? (
          <div className="flex gap-1">
            <Button size="sm" variant="danger" onClick={() => { clear(); setConfirmClear(false) }}>Clear all</Button>
            <Button size="sm" variant="secondary" onClick={() => setConfirmClear(false)}>Keep</Button>
          </div>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setConfirmClear(true)}>Clear</Button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {totals.lines.length === 0 ? (
          <div className="grid h-full place-items-center p-6 text-center text-slate-400">
            <div><div className="text-5xl">🛒</div><p className="mt-2">Tap a product to add it</p></div>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {totals.lines.map((l) => {
              const p = productsById.get(l.product_id)
              const stock = p?.stock_qty ?? 0
              const short = !p || !p.active || stock < l.qty
              return (
                <li key={l.product_id} className={cx('flex items-center gap-2 px-3 py-2', short && 'bg-rose-50')}>
                  <button type="button" onClick={() => onEditLine(l.product_id)} className="min-w-0 flex-1 text-left">
                    <div className="truncate font-semibold">{l.name}</div>
                    <div className="text-sm text-slate-500">
                      {formatRs(l.unit_price)} × {l.qty}
                      {l.discount?.value ? <Badge tone="teal" className="ml-2">{describeDiscount(l.discount)}</Badge> : null}
                    </div>
                    {short && <div className="text-xs font-semibold text-rose-700">{!p || !p.active ? 'No longer for sale' : `Only ${stock} left in stock`}</div>}
                  </button>
                  <div className="flex items-center">
                    <button type="button" aria-label="Decrease" onClick={() => setQty(l.product_id, l.qty - 1)}
                      className="grid size-11 place-items-center rounded-lg border border-slate-200 text-xl font-bold active:bg-slate-200">−</button>
                    <span className="w-9 text-center text-lg font-bold tabular-nums">{l.qty}</span>
                    <button type="button" aria-label="Increase" disabled={l.qty >= stock} onClick={() => setQty(l.product_id, l.qty + 1)}
                      className="grid size-11 place-items-center rounded-lg border border-slate-200 text-xl font-bold active:bg-slate-200 disabled:opacity-30">+</button>
                  </div>
                  <div className="w-24 text-right">
                    {l.discountAmount > 0 && <div className="text-xs text-slate-400 line-through">{formatRs(l.gross)}</div>}
                    <div className="font-bold tabular-nums">{formatRs(l.lineTotal)}</div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div className="space-y-1 border-t border-slate-200 p-4">
        <SumRow label="Subtotal" value={formatRs(totals.gross)} />
        {totals.lineDiscountTotal > 0 && <SumRow label="Item discounts" value={`− ${formatRs(totals.lineDiscountTotal)}`} />}
        <div className="flex items-center justify-between">
          <button type="button" onClick={onBillDiscount} disabled={!totals.lines.length}
            className="h-10 rounded-lg px-2 -ml-2 font-semibold text-teal-700 hover:bg-teal-50 disabled:text-slate-400">
            {billDiscount ? `Bill discount (${describeDiscount(billDiscount)})` : '+ Bill discount'}
          </button>
          {totals.billDiscountAmount > 0 && <span className="tabular-nums">− {formatRs(totals.billDiscountAmount)}</span>}
        </div>
        <div className="flex items-end justify-between pt-1">
          <span className="text-lg font-semibold">Total</span>
          <span className="text-3xl font-black tabular-nums">{formatRs(totals.total)}</span>
        </div>
        {problems.length > 0 && <p className="text-sm font-semibold text-rose-700">Fix the items marked in red before charging.</p>}
        <Button variant="success" size="lg" className="mt-2 h-16 w-full text-xl" disabled={!totals.lines.length || problems.length > 0} onClick={onCharge}>
          Charge {formatRs(totals.total)}
        </Button>
      </div>
    </div>
  )
}

function SumRow({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between text-slate-600"><span>{label}</span><span className="tabular-nums">{value}</span></div>
}
