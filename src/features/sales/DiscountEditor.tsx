import { NumPad } from '../../components/NumPad'
import { cx } from '../../components/ui'
import { formatRs } from '../../lib/money'
import { discountAmount, discountError, type DiscountType } from '../../lib/pricing'

/** Rs / % toggle + keypad, with a live preview of the amount taken off `base`. */
export function DiscountEditor({ base, type, value, onType, onValue }: {
  base: number
  type: DiscountType
  value: string
  onType: (t: DiscountType) => void
  onValue: (v: string) => void
}) {
  const d = { type, value: Number(value || 0) }
  const err = discountError(base, d)
  const amt = discountAmount(base, d)
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {(['amount', 'percent'] as DiscountType[]).map((t) => (
          <button key={t} type="button" onClick={() => onType(t)}
            className={cx('h-12 rounded-xl border-2 font-semibold',
              type === t ? 'border-teal-700 bg-teal-50 text-teal-800' : 'border-slate-200 bg-white text-slate-600')}>
            {t === 'amount' ? 'Rs amount' : '% percent'}
          </button>
        ))}
      </div>
      <div className="rounded-xl bg-slate-100 px-4 py-3 text-right">
        <div className="text-3xl font-bold tabular-nums">{type === 'amount' ? `Rs ${value || '0'}` : `${value || '0'}%`}</div>
        <div className={cx('text-sm', err ? 'text-rose-600' : 'text-slate-500')}>
          {err ?? `${formatRs(amt)} off ${formatRs(base)} → ${formatRs(base - amt)}`}
        </div>
      </div>
      {type === 'percent' && (
        <div className="grid grid-cols-5 gap-2">
          {[5, 10, 15, 20, 50].map((p) => (
            <button key={p} type="button" onClick={() => onValue(String(p))}
              className="h-11 rounded-xl border border-slate-200 bg-white font-semibold active:bg-slate-200">{p}%</button>
          ))}
        </div>
      )}
      <NumPad value={value} onChange={onValue} maxLength={type === 'percent' ? 3 : 7} />
    </div>
  )
}
