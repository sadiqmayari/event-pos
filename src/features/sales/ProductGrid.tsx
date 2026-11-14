import { cx } from '../../components/ui'
import { formatRs } from '../../lib/money'
import { stockLevel, type Product } from '../../lib/types'

export function ProductGrid({ products, inCart, onAdd }: {
  products: Product[]
  inCart: Map<string, number>
  onAdd: (p: Product) => void
}) {
  if (!products.length) {
    return <div className="p-10 text-center text-slate-500">No products match.</div>
  }
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2 p-3">
      {products.map((p) => {
        const qty = inCart.get(p.id) ?? 0
        const level = stockLevel(p)
        const left = p.stock_qty - qty
        const disabled = left <= 0
        return (
          <button key={p.id} type="button" onClick={() => onAdd(p)} disabled={disabled}
            className={cx(
              'relative flex min-h-28 flex-col justify-between rounded-2xl border-2 bg-white p-3 text-left shadow-sm transition active:scale-[0.97]',
              qty > 0 ? 'border-teal-600' : 'border-transparent',
              disabled && 'cursor-not-allowed opacity-45',
            )}>
            {qty > 0 && (
              <span className="absolute -top-2 -right-2 grid size-8 place-items-center rounded-full bg-teal-600 text-sm font-bold text-white shadow">{qty}</span>
            )}
            <span className="line-clamp-2 font-semibold leading-snug">{p.name}</span>
            <span className="mt-2 flex items-end justify-between gap-1">
              <span className="text-lg font-bold tabular-nums">{formatRs(p.price)}</span>
              <span className={cx('text-xs font-semibold',
                level === 'out' ? 'text-rose-600' : level === 'low' ? 'text-amber-600' : 'text-slate-400')}>
                {level === 'out' ? 'Out' : `${p.stock_qty} left`}
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
