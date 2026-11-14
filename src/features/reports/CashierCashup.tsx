import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthProvider'
import { Badge, Button, cx, ErrorBox, Field, Input, Modal, Select, Spinner } from '../../components/ui'
import { NumPad } from '../../components/NumPad'
import { useToast } from '../../components/Toast'
import { errorMessage } from '../../lib/errors'
import { formatRs } from '../../lib/money'
import { downloadFile, toCsv } from '../../lib/csv'
import { formatDayKey, formatTime, localDateKey, userTimeZone } from '../../lib/time'

export interface CashierRow {
  cashier_id: string; cashier_name: string; invoices: number; items: number; total: number; cash: number; card: number
  voided_invoices: number; floats: number; collected: number; outstanding: number; last_collection_at: string | null
}
interface Entry {
  id: number; cashier_id: string; cashier_name: string; type: 'float' | 'collection'; amount: number
  expected: number | null; difference: number | null; notes: string | null; recorded_by_name: string | null; created_at: string
}

const toNum = (r: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'string' && /^-?\d+$/.test(v) ? Number(v) : v]))

export function useCashierSummary(day: string) {
  return useQuery({
    queryKey: ['sales', 'cashier-summary', day],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('cashier_summary', { p_day: day, p_tz: userTimeZone })
      if (error) throw error
      return (data as Record<string, unknown>[]).map(toNum) as unknown as CashierRow[]
    },
    refetchInterval: 30_000,
  })
}

/** Admin: cash by cashier for a day — give floats, collect cash, see over/short. */
export function CashierCashup({ days }: { days: string[] }) {
  const today = localDateKey()
  const [day, setDay] = useState(days.includes(today) ? today : days[days.length - 1])
  const summary = useCashierSummary(day)
  const [action, setAction] = useState<{ row: CashierRow; type: 'float' | 'collection' } | null>(null)
  const [showLog, setShowLog] = useState(false)
  const entries = useQuery({
    queryKey: ['sales', 'cashier-entries', day],
    queryFn: async () => {
      const { data, error } = await supabase.from('cashier_cash_entries').select('*').eq('day', day).order('created_at', { ascending: false })
      if (error) throw error
      return (data as Record<string, unknown>[]).map(toNum) as unknown as Entry[]
    },
  })

  const rows = summary.data ?? []
  const t = rows.reduce((a, r) => ({
    invoices: a.invoices + r.invoices, total: a.total + r.total, cash: a.cash + r.cash, card: a.card + r.card,
    floats: a.floats + r.floats, collected: a.collected + r.collected, outstanding: a.outstanding + r.outstanding,
  }), { invoices: 0, total: 0, cash: 0, card: 0, floats: 0, collected: 0, outstanding: 0 })

  function exportCsv() {
    downloadFile(`cash-by-cashier_${day}.csv`, toCsv(rows.map((r) => ({
      day, cashier: r.cashier_name, invoices: r.invoices, items: r.items, total_sales: r.total, card: r.card,
      cash_sales: r.cash, float_given: r.floats, cash_collected: r.collected, still_to_collect: r.outstanding, voided_invoices: r.voided_invoices,
    }))))
  }

  return (
    <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-lg font-bold">Cash by cashier</h2>
        {summary.isFetching && <Spinner className="size-5 text-teal-700" />}
        <Select className="w-auto" value={day} onChange={(e) => setDay(e.target.value)}>
          {[...new Set([...days, today])].sort().map((d) => <option key={d} value={d}>{formatDayKey(d)}{d === today ? ' (today)' : ''}</option>)}
        </Select>
        <Button variant="secondary" size="sm" onClick={exportCsv} disabled={!rows.length}>Export CSV</Button>
      </div>
      <p className="text-sm text-slate-600">
        Each cashier owes: <b>float given + cash taken in sales − cash already collected</b>. Collect as often as you like;
        each collection records whether the cashier was over or short at that moment.
      </p>
      {summary.error && <ErrorBox>{errorMessage(summary.error)}</ErrorBox>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-right text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-2 text-left">Cashier</th><th className="px-3 py-2">Invoices</th><th className="px-3 py-2">Sales</th>
              <th className="px-3 py-2">Card</th><th className="px-3 py-2">Cash sales</th><th className="px-3 py-2">Float given</th>
              <th className="px-3 py-2">Collected</th><th className="px-3 py-2">Still to collect</th><th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {rows.map((r) => (
              <tr key={r.cashier_id} className="border-t border-slate-100">
                <td className="px-3 py-2 text-left font-semibold">
                  {r.cashier_name}
                  {r.voided_invoices > 0 && <Badge tone="red" className="ml-2">{r.voided_invoices} void</Badge>}
                  {r.last_collection_at && <div className="text-xs font-normal text-slate-500">last collected {formatTime(r.last_collection_at)}</div>}
                </td>
                <td className="px-3 py-2">{r.invoices}</td>
                <td className="px-3 py-2">{formatRs(r.total)}</td>
                <td className="px-3 py-2">{formatRs(r.card)}</td>
                <td className="px-3 py-2">{formatRs(r.cash)}</td>
                <td className="px-3 py-2">{formatRs(r.floats)}</td>
                <td className="px-3 py-2">{formatRs(r.collected)}</td>
                <td className={cx('px-3 py-2 text-base font-bold', r.outstanding > 0 ? 'text-amber-700' : r.outstanding < 0 ? 'text-sky-700' : 'text-emerald-700')}>
                  {formatRs(r.outstanding)}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <Button size="sm" variant="ghost" onClick={() => setAction({ row: r, type: 'float' })}>Give float</Button>
                  <Button size="sm" onClick={() => setAction({ row: r, type: 'collection' })}>Collect cash</Button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && !summary.isLoading && (
              <tr><td colSpan={9} className="px-3 py-4 text-left text-slate-500">No sales or cash entries for this day yet.</td></tr>
            )}
            {rows.length > 1 && (
              <tr className="border-t-2 border-slate-300 font-bold">
                <td className="px-3 py-2 text-left">All cashiers</td>
                <td className="px-3 py-2">{t.invoices}</td><td className="px-3 py-2">{formatRs(t.total)}</td>
                <td className="px-3 py-2">{formatRs(t.card)}</td><td className="px-3 py-2">{formatRs(t.cash)}</td>
                <td className="px-3 py-2">{formatRs(t.floats)}</td><td className="px-3 py-2">{formatRs(t.collected)}</td>
                <td className="px-3 py-2">{formatRs(t.outstanding)}</td><td />
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">
        Card sales are settled by the bank, not collected from the cashier. Admins appear here only if they sold something themselves.
      </p>

      <button type="button" className="text-sm font-semibold text-teal-700" onClick={() => setShowLog((x) => !x)}>
        {showLog ? '▲ Hide' : '▼ Show'} cash log for {formatDayKey(day)} ({entries.data?.length ?? 0})
      </button>
      {showLog && (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 text-sm">
          {(entries.data ?? []).map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <span className="text-slate-500">{formatTime(e.created_at)}</span>
              <b>{e.cashier_name}</b>
              {e.type === 'float' ? <Badge tone="blue">float given</Badge> : <Badge tone="teal">collected</Badge>}
              <span className="font-semibold tabular-nums">{formatRs(e.amount)}</span>
              {e.type === 'collection' && e.expected != null && (
                <span className="text-slate-600">
                  expected {formatRs(e.expected)} ·{' '}
                  <b className={e.difference === 0 ? 'text-emerald-700' : (e.difference ?? 0) < 0 ? 'text-rose-700' : 'text-sky-700'}>
                    {e.difference === 0 ? 'exact' : (e.difference ?? 0) < 0 ? `short ${formatRs(-(e.difference ?? 0))}` : `over ${formatRs(e.difference ?? 0)}`}
                  </b>
                </span>
              )}
              <span className="ml-auto text-slate-500">by {e.recorded_by_name}</span>
              {e.notes && <span className="w-full text-slate-500">{e.notes}</span>}
            </li>
          ))}
          {entries.data?.length === 0 && <li className="px-3 py-3 text-slate-500">No floats or collections yet.</li>}
        </ul>
      )}

      {action && <CashDialog day={day} row={action.row} type={action.type} onClose={() => setAction(null)} />}
    </section>
  )
}

function CashDialog({ day, row, type, onClose }: { day: string; row: CashierRow; type: 'float' | 'collection'; onClose: () => void }) {
  const toast = useToast()
  const qc = useQueryClient()
  const [amount, setAmount] = useState(type === 'collection' && row.outstanding > 0 ? '' : '')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const n = amount === '' ? null : Number(amount)
  const diff = type === 'collection' && n != null ? n - row.outstanding : null

  async function save() {
    if (n == null) return
    setBusy(true); setError(null)
    const { error } = await supabase.rpc('record_cashier_cash', {
      p_cashier: row.cashier_id, p_day: day, p_tz: userTimeZone, p_type: type, p_amount: n, p_notes: notes,
    })
    setBusy(false)
    if (error) return setError(errorMessage(error))
    toast(type === 'float' ? `Float of ${formatRs(n)} given to ${row.cashier_name}` : `Collected ${formatRs(n)} from ${row.cashier_name}`)
    void qc.invalidateQueries({ queryKey: ['sales'] })
    onClose()
  }

  return (
    <Modal open onClose={onClose} size="lg" title={type === 'float' ? `Give change float · ${row.cashier_name}` : `Collect cash · ${row.cashier_name}`}
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button busy={busy} disabled={n == null} onClick={() => void save()}>{type === 'float' ? 'Record float' : 'Record collection'}</Button>
      </>}>
      <div className="grid gap-6 md:grid-cols-[1fr_300px]">
        <div className="space-y-3">
          {error && <ErrorBox>{error}</ErrorBox>}
          {type === 'collection' ? (
            <dl className="grid grid-cols-2 gap-y-1 rounded-xl bg-slate-50 p-3 text-sm">
              <dt className="text-slate-600">Float given</dt><dd className="text-right tabular-nums">{formatRs(row.floats)}</dd>
              <dt className="text-slate-600">+ Cash taken ({row.invoices} invoices)</dt><dd className="text-right tabular-nums">{formatRs(row.cash)}</dd>
              <dt className="text-slate-600">− Already collected</dt><dd className="text-right tabular-nums">{formatRs(row.collected)}</dd>
              <dt className="font-bold">Should hand over</dt><dd className="text-right text-xl font-bold tabular-nums">{formatRs(row.outstanding)}</dd>
            </dl>
          ) : (
            <p className="text-slate-600">Change money handed to {row.cashier_name} for their drawer. It is added to what they must hand back.</p>
          )}
          <div className="rounded-xl border-2 border-teal-600 bg-white px-4 py-3 text-right">
            <div className="text-sm text-slate-500">{type === 'float' ? 'Float amount' : 'Cash counted from cashier'}</div>
            <div className="text-3xl font-black tabular-nums">{n == null ? '—' : formatRs(n)}</div>
          </div>
          {type === 'collection' && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => setAmount(String(Math.max(0, row.outstanding)))}>Exact ({formatRs(Math.max(0, row.outstanding))})</Button>
            </div>
          )}
          {diff != null && (
            <div className={cx('rounded-xl p-3 text-center font-bold', diff === 0 ? 'bg-emerald-50 text-emerald-800' : diff < 0 ? 'bg-rose-50 text-rose-800' : 'bg-sky-50 text-sky-800')}>
              {diff === 0 ? 'Exact — balanced' : diff < 0 ? `Short by ${formatRs(-diff)}` : `Over by ${formatRs(diff)}`}
              {diff < 0 && <div className="text-xs font-normal">The shortfall stays on record. You can also collect less now and the rest later.</div>}
            </div>
          )}
          <Field label="Notes"><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional, e.g. end of day" /></Field>
        </div>
        <NumPad value={amount} onChange={setAmount} />
      </div>
    </Modal>
  )
}

/** Shown to every user on their own device: what they sold today and how much cash to hand over. */
export function MyShiftCard() {
  const { profile } = useAuth()
  const today = localDateKey()
  const { data } = useCashierSummary(today)
  const me = data?.find((r) => r.cashier_id === profile?.id)
  if (!me) return null
  return (
    <div className="grid grid-cols-2 gap-3 rounded-2xl border border-teal-200 bg-teal-50 p-4 sm:grid-cols-5">
      <div className="col-span-2 sm:col-span-1">
        <div className="text-xs text-teal-800">My sales today</div>
        <div className="text-lg font-bold">{me.invoices} invoice{me.invoices === 1 ? '' : 's'}</div>
      </div>
      <Mini label="Total" value={formatRs(me.total)} />
      <Mini label="Card" value={formatRs(me.card)} />
      <Mini label="Cash taken" value={formatRs(me.cash)} />
      <div className="rounded-xl bg-white p-2">
        <div className="text-xs text-slate-500">Cash to hand over{me.floats ? ' (incl. float)' : ''}</div>
        <div className="text-xl font-black tabular-nums text-amber-700">{formatRs(me.outstanding)}</div>
      </div>
    </div>
  )
}

function Mini({ label, value }: { label: string; value: string }) {
  return <div><div className="text-xs text-teal-800">{label}</div><div className="font-bold tabular-nums">{value}</div></div>
}
