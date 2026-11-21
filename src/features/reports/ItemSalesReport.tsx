import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { Button, cx, ErrorBox, Input, Select, Spinner } from '../../components/ui'
import { errorMessage } from '../../lib/errors'
import { formatRs } from '../../lib/money'
import { downloadFile, toCsv } from '../../lib/csv'
import { formatDayKey, localDateKey, userTimeZone } from '../../lib/time'
import { useProducts } from '../products/useProducts'

interface SoldRow { product_id: string; name: string; category: string; qty: number; revenue: number }
interface ItemRow { product_id: string; name: string; sku: string | null; category: string; qty: number; revenue: number; stock: number | null; active: boolean }
type SortKey = 'qty' | 'revenue' | 'name' | 'stock'

/** Every product with quantity sold, revenue and stock left — for one day or the whole event. */
export function ItemSalesReport({ days }: { days: string[] }) {
  const today = localDateKey()
  const [period, setPeriod] = useState<string>('all')
  const [includeUnsold, setIncludeUnsold] = useState(false)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortKey>('qty')
  const { products } = useProducts()

  const [from, to] = period === 'all' ? [days[0], days[days.length - 1]] : [period, period]
  const sold = useQuery({
    queryKey: ['sales', 'report', 'items', from, to],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('top_products', { p_from: from, p_to: to, p_tz: userTimeZone, p_limit: 100000 })
      if (error) throw error
      return (data as Record<string, unknown>[]).map((r) => ({ ...r, qty: Number(r.qty), revenue: Number(r.revenue) })) as SoldRow[]
    },
  })

  const rows = useMemo<ItemRow[]>(() => {
    const byId = new Map(products.map((p) => [p.id, p]))
    const out: ItemRow[] = (sold.data ?? []).map((s) => {
      const p = byId.get(s.product_id)
      return { product_id: s.product_id, name: s.name, sku: p?.sku ?? null, category: s.category ?? p?.category ?? '', qty: s.qty, revenue: s.revenue, stock: p?.stock_qty ?? null, active: p?.active ?? false }
    })
    if (includeUnsold) {
      const soldIds = new Set(out.map((r) => r.product_id))
      for (const p of products) {
        if (!soldIds.has(p.id)) out.push({ product_id: p.id, name: p.name, sku: p.sku, category: p.category, qty: 0, revenue: 0, stock: p.stock_qty, active: p.active })
      }
    }
    const q = search.trim().toLowerCase()
    return out
      .filter((r) => !q || r.name.toLowerCase().includes(q) || (r.sku ?? '').toLowerCase().includes(q) || r.category.toLowerCase().includes(q))
      .sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name)
        : sort === 'stock' ? (a.stock ?? 0) - (b.stock ?? 0)
        : (b[sort] - a[sort]) || a.name.localeCompare(b.name))
  }, [sold.data, products, includeUnsold, search, sort])

  const totals = rows.reduce((t, r) => ({ qty: t.qty + r.qty, revenue: t.revenue + r.revenue }), { qty: 0, revenue: 0 })
  const periodLabel = period === 'all' ? `${formatDayKey(from)} – ${formatDayKey(to)}` : formatDayKey(period)

  function exportCsv() {
    downloadFile(`item-sales_${period === 'all' ? `${from}_to_${to}` : period}.csv`, toCsv(rows.map((r) => ({
      product: r.name, sku: r.sku ?? '', category: r.category, qty_sold: r.qty, revenue: r.revenue,
      share_of_revenue_pct: totals.revenue ? Math.round((r.revenue / totals.revenue) * 1000) / 10 : 0,
      stock_left_now: r.stock ?? '',
    }))))
  }

  const th = (key: SortKey, label: string, right = true) => (
    <th className={cx('px-3 py-2', right && 'text-right')}>
      <button type="button" onClick={() => setSort(key)} className={cx('font-semibold', sort === key ? 'text-teal-700' : 'text-slate-600')}>
        {label}{sort === key ? ' ▼' : ''}
      </button>
    </th>
  )

  return (
    <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-lg font-bold">Sales by item</h2>
        {sold.isFetching && <Spinner className="size-5 text-teal-700" />}
        <Select className="w-auto" value={period} onChange={(e) => setPeriod(e.target.value)}>
          <option value="all">Whole event</option>
          {[...new Set([...days, today])].sort().map((d) => <option key={d} value={d}>{formatDayKey(d)}{d === today ? ' (today)' : ''}</option>)}
        </Select>
        <Button variant="secondary" size="sm" onClick={exportCsv} disabled={!rows.length}>Export CSV</Button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Input className="max-w-xs" type="search" placeholder="Search product, SKU or category" value={search} onChange={(e) => setSearch(e.target.value)} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-5 accent-teal-700" checked={includeUnsold} onChange={(e) => setIncludeUnsold(e.target.checked)} />
          Include items not sold
        </label>
        <span className="text-sm text-slate-500">{periodLabel} · {rows.length} item{rows.length === 1 ? '' : 's'}</span>
      </div>
      {sold.error && <ErrorBox>{errorMessage(sold.error)}</ErrorBox>}
      <div className="max-h-[60vh] overflow-auto rounded-xl border border-slate-200">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="sticky top-0 bg-slate-50 text-left">
            <tr>
              <th className="w-10 px-3 py-2 text-right text-slate-400">#</th>
              {th('name', 'Product', false)}
              <th className="px-3 py-2 text-slate-600">Category</th>
              {th('qty', 'Qty sold')}
              {th('revenue', 'Revenue')}
              <th className="px-3 py-2 text-right text-slate-600">Share</th>
              {th('stock', 'Stock left')}
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {rows.map((r, i) => (
              <tr key={r.product_id} className={cx('border-t border-slate-100', r.qty === 0 && 'text-slate-400')}>
                <td className="px-3 py-2 text-right text-slate-400">{i + 1}</td>
                <td className="px-3 py-2"><span className="font-semibold">{r.name}</span>{r.sku && <span className="ml-2 text-xs text-slate-400">{r.sku}</span>}</td>
                <td className="px-3 py-2">{r.category}</td>
                <td className="px-3 py-2 text-right font-semibold">{r.qty}</td>
                <td className="px-3 py-2 text-right">{formatRs(r.revenue)}</td>
                <td className="px-3 py-2 text-right">{totals.revenue ? `${Math.round((r.revenue / totals.revenue) * 1000) / 10}%` : '–'}</td>
                <td className={cx('px-3 py-2 text-right', r.stock === 0 && 'font-semibold text-rose-600')}>{r.stock ?? '–'}</td>
              </tr>
            ))}
            {rows.length === 0 && !sold.isLoading && (
              <tr><td colSpan={7} className="px-3 py-4 text-slate-500">{search ? 'No items match.' : 'No sales in this period yet.'}</td></tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="sticky bottom-0 bg-slate-100 font-bold tabular-nums">
              <tr>
                <td /><td className="px-3 py-2">Total</td><td />
                <td className="px-3 py-2 text-right">{totals.qty}</td>
                <td className="px-3 py-2 text-right">{formatRs(totals.revenue)}</td>
                <td className="px-3 py-2 text-right">100%</td><td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="text-xs text-slate-500">
        Revenue is after item discounts; whole-bill discounts are not split per item, so this total can be slightly higher than net sales.
        Voided sales are excluded. “Stock left” is the stock right now.
      </p>
    </section>
  )
}
