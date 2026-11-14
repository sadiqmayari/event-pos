import { cx } from './ui'

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', '⌫'] as const

/** Big touch keypad. Applies keys to a string value (digits only). */
export function NumPad({ value, onChange, maxLength = 9, className }: {
  value: string
  onChange: (v: string) => void
  maxLength?: number
  className?: string
}) {
  function press(k: (typeof KEYS)[number] | 'C') {
    if (k === 'C') return onChange('')
    if (k === '⌫') return onChange(value.slice(0, -1))
    const next = (value === '0' ? '' : value) + k
    if (next.replace(/^0+/, '').length > maxLength) return
    onChange(next.replace(/^0+(?=\d)/, ''))
  }
  return (
    <div className={cx('grid grid-cols-3 gap-2', className)}>
      {KEYS.map((k) => (
        <button key={k} type="button" onClick={() => press(k)}
          className="h-14 rounded-xl border border-slate-200 bg-white text-2xl font-semibold text-slate-800 active:bg-slate-200">
          {k}
        </button>
      ))}
      <button type="button" onClick={() => press('C')}
        className="col-span-3 h-11 rounded-xl border border-slate-200 bg-slate-50 text-base font-semibold text-slate-600 active:bg-slate-200">
        Clear
      </button>
    </div>
  )
}
