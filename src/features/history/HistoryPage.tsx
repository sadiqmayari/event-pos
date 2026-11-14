import { useMemo, useState } from 'react'
import { Badge, Button, cx, EmptyState, ErrorBox, Input, Select, Spinner } from '../../components/ui'
import { errorMessage } from '../../lib/errors'
import { formatRs } from '../../lib/money'
import { formatDayKey, formatTime, formatDate, localDateKey, eventDayKeys } from '../../lib/time'
import type { PaymentMethod } from '../../lib/types'
import { useSettings } from '../settings/useSettings'
import { useSalesList, useStaffList, type SalesFilter } from './useSales'
import { SaleDetailDialog } from './SaleDetailDialog'
import { MyShiftCard } from '../reports/CashierCashup'

export function HistoryPage() {
  const { data: settings } = useSettings()
  const staff = useStaffList()
  const [f, setF] = useState<SalesFilter>({ day: localDateKey(), invoice: '', cashierId: '', method: '', status: '', limit: 100 })
  const [open, setOpen] = useState<string | null>(null)
  const { data, isLoading, isFetching, error } = useSalesList(f)
  const set = (patch: Partial<SalesFilter>) => setF((x) => ({ ...x, limit: 100, ...patch }))

  const days = useMemo(() => {
    const keys = new Set(eventDayKeys(settings.event_start_date, settings.event_days))
    keys.add(localDateKey())
    return [...keys].sort()
  }, [settings])

  const shown = data?.sales ?? []
  const completed = shown.filter((s) => s.status === 'completed')
  const sum = completed.reduce((a, s) => a + s.total, 0)

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-2xl font-bold">Sales history</h1>
        {isFetching && <Spinner className="size-5 text-teal-700" />}
      </div>

      <MyShiftCard />

      <div className="grid grid-cols-2 gap-2 rounded-2xl border border-slate-200 bg-white p-3 md:grid-cols-3 xl:grid-cols-6">
        <Input inputMode="numeric" placeholder="Invoice #" value={f.invoice} onChange={(e) => set({ invoice: e.target.value.replace(/\D/g, '') })} />
        <Select className="w-auto" value={f.day ?? ''} onChange={(e) => set({ day: e.target.value || null })} disabled={Boolean(f.invoice)}>
          <option value="">All dates</option>
          {days.map((d) => <option key={d} value={d}>{formatDayKey(d)}{d === localDateKey() ? ' (today)' : ''}</option>)}
        </Select>
        <Input type="date" className="w-auto" value={f.day ?? ''} onChange={(e) => set({ day: e.target.value || null })} disabled={Boolean(f.invoice)} />
        <Select className="w-auto" value={f.cashierId} onChange={(e) => set({ cashierId: e.target.value })}>
          <option value="">All cashiers</option>
          {(staff.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
        </Select>
        <Select className="w-auto" value={f.method} onChange={(e) => set({ method: e.target.value as PaymentMethod | '' })}>
          <option value="">All payments</option>
          <option value="cash">Cash</option>
          <option value="card">Card</option>
          <option value="split">Cash + Card</option>
        </Select>
        <Select className="w-auto" value={f.status} onChange={(e) => set({ status: e.target.value as SalesFilter['status'] })}>
          <option value="">Completed & voided</option>
          <option value="completed">Completed only</option>
          <option value="voided">Voided only</option>
        </Select>
      </div>

      {error && <ErrorBox>{errorMessage(error)}</ErrorBox>}
      {data && (
        <p className="text-sm text-slate-600">
          {data.count} sale{data.count === 1 ? '' : 's'}{shown.length < data.count ? ` (showing ${shown.length})` : ''}
          {' · '}completed total shown: <b>{formatRs(sum)}</b>
        </p>
      )}

      {isLoading ? <div className="grid place-items-center p-10 text-teal-700"><Spinner className="size-10" /></div>
        : shown.length === 0 ? <EmptyState title="No sales found">Try another date or clear the filters.</EmptyState>
        : (
          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
            <table className="w-full min-w-[720px]">
              <thead className="bg-slate-50 text-left text-sm text-slate-600">
                <tr>
                  <th className="px-4 py-3">Invoice</th><th className="px-4 py-3">Time</th><th className="px-4 py-3">Cashier</th>
                  <th className="px-4 py-3">Payment</th><th className="px-4 py-3 text-right">Items</th><th className="px-4 py-3 text-right">Total</th><th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {shown.map((s) => (
                  <tr key={s.id} onClick={() => setOpen(s.id)} className={cx('cursor-pointer border-t border-slate-100 hover:bg-slate-50', s.status === 'voided' && 'text-slate-400')}>
                    <td className="px-4 py-3 font-bold">#{s.invoice_no}</td>
                    <td className="px-4 py-3">{f.day ? formatTime(s.created_at) : `${formatDate(s.created_at)} ${formatTime(s.created_at)}`}</td>
                    <td className="px-4 py-3">{s.cashier_name}</td>
                    <td className="px-4 py-3 capitalize">{s.payment_method === 'split' ? 'Cash + Card' : s.payment_method}</td>
                    <td className="px-4 py-3 text-right">{s.items_count}</td>
                    <td className={cx('px-4 py-3 text-right font-semibold tabular-nums', s.status === 'voided' && 'line-through')}>{formatRs(s.total)}</td>
                    <td className="px-4 py-3 text-right">{s.status === 'voided' ? <Badge tone="red">Void</Badge> : <span className="text-sm font-semibold text-teal-700">View ›</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      {data && shown.length < data.count && (
        <div className="text-center"><Button variant="secondary" onClick={() => setF((x) => ({ ...x, limit: x.limit + 100 }))}>Load more</Button></div>
      )}
      <SaleDetailDialog saleId={open} onClose={() => setOpen(null)} />
    </div>
  )
}
