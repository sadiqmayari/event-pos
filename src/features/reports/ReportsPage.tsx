import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { Button, cx, ErrorBox, Field, Input, Select, Spinner } from '../../components/ui'
import { useToast } from '../../components/Toast'
import { errorMessage } from '../../lib/errors'
import { formatRs } from '../../lib/money'
import { eventDayKeys, formatDateTime, formatDayKey, localDateKey, userTimeZone } from '../../lib/time'
import { useSettings } from '../settings/useSettings'
import { downloadFullBackup, exportSaleItems, exportSales, exportStockMovements } from './exports'
import { CashierCashup } from './CashierCashup'
import { ItemSalesReport } from './ItemSalesReport'

interface DayRow {
  day: string; invoices: number; items: number; gross: number; discounts: number; total: number
  cash: number; card: number; voided_invoices: number; voided_total: number
}
interface TopRow { product_id: string; name: string; category: string; qty: number; revenue: number }
interface CashCount { id: number; day: string; opening_float: number; expected_cash: number; counted_cash: number; difference: number; notes: string | null; counted_by_name: string | null; created_at: string }

const num = (r: Record<string, unknown>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, k === 'day' || typeof v !== 'string' || isNaN(Number(v)) ? v : Number(v)]))

export function ReportsPage() {
  const { data: settings } = useSettings()
  const days = useMemo(() => eventDayKeys(settings.event_start_date, settings.event_days), [settings])
  const from = days[0]
  const to = days[days.length - 1]
  const today = localDateKey()
  const [selected, setSelected] = useState<string>(days.includes(today) ? today : to)

  const summary = useQuery({
    queryKey: ['sales', 'report', 'daily', from, to],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('daily_summary', { p_from: from, p_to: to, p_tz: userTimeZone })
      if (error) throw error
      return (data as Record<string, unknown>[]).map(num) as unknown as DayRow[]
    },
  })
  const top = useQuery({
    queryKey: ['sales', 'report', 'top', selected],
    queryFn: async () => {
      const [a, b] = selected === 'all' ? [from, to] : [selected, selected]
      const { data, error } = await supabase.rpc('top_products', { p_from: a, p_to: b, p_tz: userTimeZone, p_limit: 10 })
      if (error) throw error
      return (data as Record<string, unknown>[]).map(num) as unknown as TopRow[]
    },
  })

  const rows = summary.data ?? []
  const totals = rows.reduce((t, r) => ({
    invoices: t.invoices + r.invoices, items: t.items + r.items, gross: t.gross + r.gross, discounts: t.discounts + r.discounts,
    total: t.total + r.total, cash: t.cash + r.cash, card: t.card + r.card, voided_invoices: t.voided_invoices + r.voided_invoices, voided_total: t.voided_total + r.voided_total,
  }), { invoices: 0, items: 0, gross: 0, discounts: 0, total: 0, cash: 0, card: 0, voided_invoices: 0, voided_total: 0 })
  const sel = selected === 'all' ? totals : rows.find((r) => r.day === selected)

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h1 className="text-2xl font-bold">Reports</h1>
          <p className="text-sm text-slate-500">
            {formatDayKey(from)} – {formatDayKey(to)} · times in {userTimeZone}
            {!settings.event_start_date && ' · set the event start date in Settings'}
          </p>
        </div>
        {(summary.isFetching || top.isFetching) && <Spinner className="size-5 text-teal-700" />}
        <Button variant="secondary" onClick={() => { void summary.refetch(); void top.refetch() }}>Refresh</Button>
      </div>

      {summary.error && <ErrorBox>{errorMessage(summary.error)}</ErrorBox>}

      {/* per-day table */}
      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full min-w-[860px] text-right">
          <thead className="bg-slate-50 text-sm text-slate-600">
            <tr>
              <th className="px-4 py-3 text-left">Day</th><th className="px-4 py-3">Invoices</th><th className="px-4 py-3">Items</th>
              <th className="px-4 py-3">Gross</th><th className="px-4 py-3">Discounts</th><th className="px-4 py-3">Net sales</th>
              <th className="px-4 py-3">Cash</th><th className="px-4 py-3">Card</th><th className="px-4 py-3">Voids</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {rows.map((r, i) => (
              <tr key={r.day} onClick={() => setSelected(r.day)}
                className={cx('cursor-pointer border-t border-slate-100 hover:bg-slate-50', selected === r.day && 'bg-teal-50')}>
                <td className="px-4 py-3 text-left font-semibold">Day {i + 1} · {formatDayKey(r.day)}{r.day === today && ' (today)'}</td>
                <td className="px-4 py-3">{r.invoices}</td><td className="px-4 py-3">{r.items}</td>
                <td className="px-4 py-3">{formatRs(r.gross)}</td><td className="px-4 py-3">{formatRs(r.discounts)}</td>
                <td className="px-4 py-3 font-bold">{formatRs(r.total)}</td>
                <td className="px-4 py-3">{formatRs(r.cash)}</td><td className="px-4 py-3">{formatRs(r.card)}</td>
                <td className="px-4 py-3 text-rose-700">{r.voided_invoices ? `${r.voided_invoices} · ${formatRs(r.voided_total)}` : '–'}</td>
              </tr>
            ))}
            <tr onClick={() => setSelected('all')} className={cx('cursor-pointer border-t-2 border-slate-300 font-bold', selected === 'all' && 'bg-teal-50')}>
              <td className="px-4 py-3 text-left">All {rows.length} days</td>
              <td className="px-4 py-3">{totals.invoices}</td><td className="px-4 py-3">{totals.items}</td>
              <td className="px-4 py-3">{formatRs(totals.gross)}</td><td className="px-4 py-3">{formatRs(totals.discounts)}</td>
              <td className="px-4 py-3">{formatRs(totals.total)}</td>
              <td className="px-4 py-3">{formatRs(totals.cash)}</td><td className="px-4 py-3">{formatRs(totals.card)}</td>
              <td className="px-4 py-3 text-rose-700">{totals.voided_invoices ? `${totals.voided_invoices} · ${formatRs(totals.voided_total)}` : '–'}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* selected day */}
        <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex items-center gap-2">
            <h2 className="mr-auto text-lg font-bold">{selected === 'all' ? 'Whole event' : formatDayKey(selected)}</h2>
            <Select className="w-auto" value={selected} onChange={(e) => setSelected(e.target.value)}>
              {days.map((d) => <option key={d} value={d}>{formatDayKey(d)}</option>)}
              <option value="all">Whole event</option>
            </Select>
          </div>
          {sel && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Stat label="Net sales" value={formatRs(sel.total)} big />
              <Stat label="Cash" value={formatRs(sel.cash)} />
              <Stat label="Card" value={formatRs(sel.card)} />
              <Stat label="Invoices" value={String(sel.invoices)} />
              <Stat label="Items sold" value={String(sel.items)} />
              <Stat label="Average sale" value={formatRs(sel.invoices ? Math.round(sel.total / sel.invoices) : 0)} />
            </div>
          )}
          <h3 className="pt-2 font-semibold">Top 10 products <span className="text-sm font-normal text-slate-500">· all items in “Sales by item” below</span></h3>
          {top.error ? <ErrorBox>{errorMessage(top.error)}</ErrorBox> : (
            <ol className="divide-y divide-slate-100">
              {(top.data ?? []).map((t, i) => (
                <li key={t.product_id} className="flex items-center gap-3 py-2">
                  <span className="w-6 text-right font-bold text-slate-400">{i + 1}</span>
                  <span className="flex-1"><span className="font-semibold">{t.name}</span> <span className="text-sm text-slate-500">· {t.category}</span></span>
                  <span className="w-16 text-right tabular-nums">{t.qty} sold</span>
                  <span className="w-28 text-right font-semibold tabular-nums">{formatRs(t.revenue)}</span>
                </li>
              ))}
              {top.data?.length === 0 && <li className="py-3 text-slate-500">No sales yet.</li>}
            </ol>
          )}
        </section>

        <CashReconciliation days={days} defaultDay={days.includes(today) ? today : to} />
      </div>

      <ItemSalesReport days={days} />

      <CashierCashup days={days} />

      <ExportsSection from={from} to={to} />
    </div>
  )
}

function Stat({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <div className={cx('rounded-xl bg-slate-50 p-3', big && 'col-span-2 sm:col-span-3 bg-teal-50')}>
      <div className="text-xs text-slate-500">{label}</div>
      <div className={cx('font-bold tabular-nums', big ? 'text-3xl' : 'text-xl')}>{value}</div>
    </div>
  )
}

function CashReconciliation({ days, defaultDay }: { days: string[]; defaultDay: string }) {
  const toast = useToast()
  const qc = useQueryClient()
  const [day, setDay] = useState(defaultDay)
  const [counted, setCounted] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)

  const expected = useQuery({
    queryKey: ['sales', 'report', 'expected', day],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('expected_cash', { p_day: day, p_tz: userTimeZone })
      if (error) throw error
      return num(data as Record<string, unknown>) as { opening_float: number; cash_sales: number; cash_invoices: number; expected: number }
    },
  })
  const counts = useQuery({
    queryKey: ['sales', 'report', 'counts'],
    queryFn: async () => {
      const { data, error } = await supabase.from('cash_counts').select('*').order('created_at', { ascending: false }).limit(20)
      if (error) throw error
      return (data as Record<string, unknown>[]).map(num) as unknown as CashCount[]
    },
  })

  const countedN = counted === '' ? null : Number(counted)
  const diff = countedN != null && expected.data ? countedN - expected.data.expected : null

  async function save() {
    if (countedN == null) return
    setBusy(true)
    const { error } = await supabase.rpc('record_cash_count', { p_day: day, p_tz: userTimeZone, p_counted: countedN, p_notes: notes })
    setBusy(false)
    if (error) return toast(errorMessage(error), 'error')
    toast('Cash count saved')
    setCounted(''); setNotes('')
    void qc.invalidateQueries({ queryKey: ['sales', 'report', 'counts'] })
  }

  return (
    <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex items-center gap-2">
        <h2 className="mr-auto text-lg font-bold">End-of-day cash count</h2>
        <Select className="w-auto" value={day} onChange={(e) => setDay(e.target.value)}>
          {days.map((d) => <option key={d} value={d}>{formatDayKey(d)}</option>)}
        </Select>
      </div>
      {expected.error ? <ErrorBox>{errorMessage(expected.error)}</ErrorBox> : expected.data && (
        <dl className="grid grid-cols-2 gap-y-1 rounded-xl bg-slate-50 p-3">
          <dt className="text-slate-600">Opening cash</dt><dd className="text-right tabular-nums">{formatRs(expected.data.opening_float)}</dd>
          <dt className="text-slate-600">+ Cash sales ({expected.data.cash_invoices} invoices)</dt><dd className="text-right tabular-nums">{formatRs(expected.data.cash_sales)}</dd>
          <dt className="font-bold">Expected in drawer</dt><dd className="text-right text-xl font-bold tabular-nums">{formatRs(expected.data.expected)}</dd>
        </dl>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Counted cash (Rs)"><Input inputMode="numeric" value={counted} onChange={(e) => setCounted(e.target.value.replace(/\D/g, ''))} /></Field>
        <div className={cx('grid place-items-center rounded-xl p-2 text-center',
          diff == null ? 'bg-slate-50 text-slate-400' : diff === 0 ? 'bg-emerald-50 text-emerald-800' : diff > 0 ? 'bg-sky-50 text-sky-800' : 'bg-rose-50 text-rose-800')}>
          <div>
            <div className="text-xs">Difference</div>
            <div className="text-2xl font-bold tabular-nums">{diff == null ? '–' : `${diff > 0 ? '+' : ''}${formatRs(diff)}`}</div>
            {diff != null && <div className="text-xs">{diff === 0 ? 'Balanced' : diff > 0 ? 'Over' : 'Short'}</div>}
          </div>
        </div>
      </div>
      <Field label="Notes"><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" /></Field>
      <Button busy={busy} disabled={countedN == null} onClick={() => void save()}>Save count</Button>

      {(counts.data ?? []).length > 0 && (
        <div className="pt-2">
          <h3 className="mb-1 font-semibold">Saved counts</h3>
          <ul className="divide-y divide-slate-100 text-sm">
            {counts.data!.map((c) => (
              <li key={c.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span>{formatDayKey(c.day)} · {c.counted_by_name} · {formatDateTime(c.created_at)}</span>
                <span className="tabular-nums">expected {formatRs(c.expected_cash)} · counted {formatRs(c.counted_cash)} ·{' '}
                  <b className={c.difference === 0 ? 'text-emerald-700' : c.difference > 0 ? 'text-sky-700' : 'text-rose-700'}>{c.difference > 0 ? '+' : ''}{formatRs(c.difference)}</b>
                </span>
                {c.notes && <span className="w-full text-slate-500">{c.notes}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

function ExportsSection({ from, to }: { from: string; to: string }) {
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  async function run(key: string, fn: () => Promise<number | void>) {
    setBusy(key)
    try {
      const n = await fn()
      toast(typeof n === 'number' ? `Exported ${n} rows` : 'Backup downloaded')
    } catch (err) { toast(errorMessage(err), 'error') } finally { setBusy(null) }
  }
  return (
    <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
      <h2 className="text-lg font-bold">Export & backup</h2>
      <p className="text-sm text-slate-600">CSV files open in Excel / Google Sheets. Sales exports cover {formatDayKey(from)} – {formatDayKey(to)}.</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" busy={busy === 'sales'} onClick={() => void run('sales', () => exportSales(from, to))}>Sales (one row per invoice)</Button>
        <Button variant="secondary" busy={busy === 'items'} onClick={() => void run('items', () => exportSaleItems(from, to))}>Sales items (one row per product)</Button>
        <Button variant="secondary" busy={busy === 'moves'} onClick={() => void run('moves', exportStockMovements)}>Stock movements</Button>
        <Button busy={busy === 'backup'} onClick={() => void run('backup', () => downloadFullBackup())}>Full backup (JSON)</Button>
      </div>
      <p className="text-xs text-slate-500">Current stock list: Stock page → Export CSV. Tip: download a full backup at the end of every day.</p>
    </section>
  )
}
