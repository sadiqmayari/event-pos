import { useMemo, useState } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { formatRs } from '../../lib/money'
import { stockLevel, type Product } from '../../lib/types'
import { downloadFile, toCsv } from '../../lib/csv'
import { localDateKey } from '../../lib/time'
import { errorMessage } from '../../lib/errors'
import { Badge, Button, cx, EmptyState, ErrorBox, Input, Select, Spinner } from '../../components/ui'
import { useProducts } from './useProducts'
import { StockBadge } from './StockBadge'
import { ProductFormDialog } from './ProductFormDialog'
import { StockAdjustDialog } from './StockAdjustDialog'
import { CsvImportDialog } from './CsvImportDialog'

type StockFilter = 'all' | 'low' | 'out' | 'inactive'

export function ProductsPage() {
  const { isAdmin } = useAuth()
  const { products, categories, isLoading, error } = useProducts()
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [stockFilter, setStockFilter] = useState<StockFilter>('all')
  const [editing, setEditing] = useState<Product | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [adjusting, setAdjusting] = useState<Product | null>(null)
  const [importOpen, setImportOpen] = useState(false)

  const counts = useMemo(() => {
    const active = products.filter((p) => p.active)
    return {
      low: active.filter((p) => stockLevel(p) === 'low').length,
      out: active.filter((p) => stockLevel(p) === 'out').length,
      units: active.reduce((s, p) => s + p.stock_qty, 0),
      value: active.reduce((s, p) => s + p.stock_qty * p.price, 0),
    }
  }, [products])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return products.filter((p) => {
      if (stockFilter === 'inactive' ? p.active : !p.active) return false
      if (category && p.category !== category) return false
      if (stockFilter === 'low' && stockLevel(p) !== 'low') return false
      if (stockFilter === 'out' && stockLevel(p) !== 'out') return false
      if (q && !p.name.toLowerCase().includes(q) && !(p.sku ?? '').toLowerCase().includes(q)) return false
      return true
    })
  }, [products, search, category, stockFilter])

  function exportStock() {
    downloadFile(`stock-${localDateKey()}.csv`, toCsv(products.map((p) => ({
      name: p.name, sku: p.sku ?? '', category: p.category, price: p.price, stock_qty: p.stock_qty,
      low_stock_threshold: p.low_stock_threshold, active: p.active ? 'yes' : 'no', stock_value: p.price * p.stock_qty,
    }))))
  }

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-2xl font-bold">Products & stock</h1>
        <Button variant="secondary" onClick={exportStock} disabled={!products.length}>Export CSV</Button>
        {isAdmin && <>
          <Button variant="secondary" onClick={() => setImportOpen(true)}>Import CSV</Button>
          <Button onClick={() => { setEditing(null); setFormOpen(true) }}>+ Add product</Button>
        </>}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Products" value={String(products.filter((p) => p.active).length)} />
        <Stat label="Units in stock" value={counts.units.toLocaleString('en-US')} />
        <Stat label="Low stock" value={String(counts.low)} tone={counts.low ? 'amber' : undefined} onClick={() => setStockFilter('low')} />
        <Stat label="Out of stock" value={String(counts.out)} tone={counts.out ? 'red' : undefined} onClick={() => setStockFilter('out')} />
      </div>

      <div className="flex flex-wrap gap-2">
        <Input className="min-w-64 flex-1" type="search" placeholder="Search name or SKU…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select className="w-auto min-w-44" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {categories.map((c) => <option key={c}>{c}</option>)}
        </Select>
        <div className="flex rounded-xl border border-slate-300 bg-white p-1">
          {(['all', 'low', 'out', 'inactive'] as StockFilter[]).map((f) => (
            <button key={f} type="button" onClick={() => setStockFilter(f)}
              className={cx('h-10 rounded-lg px-3 text-sm font-semibold capitalize', stockFilter === f ? 'bg-slate-900 text-white' : 'text-slate-600')}>
              {f === 'out' ? 'Out' : f}
            </button>
          ))}
        </div>
      </div>

      {error && <ErrorBox>Could not load products: {errorMessage(error)}</ErrorBox>}
      {isLoading ? <div className="grid place-items-center p-10 text-teal-700"><Spinner className="size-10" /></div>
        : visible.length === 0 ? (
          <EmptyState title={products.length ? 'No products match' : 'No products yet'}>
            {!products.length && isAdmin && 'Add products one by one or import a CSV file.'}
          </EmptyState>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
            <table className="w-full min-w-[720px]">
              <thead className="bg-slate-50 text-left text-sm text-slate-600">
                <tr>
                  <th className="px-4 py-3">Product</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3 text-right">Price</th>
                  <th className="px-4 py-3">Stock</th>
                  {isAdmin && <th className="px-4 py-3 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {visible.map((p) => (
                  <tr key={p.id} className="border-t border-slate-100">
                    <td className="px-4 py-2">
                      <div className="font-semibold">{p.name}</div>
                      <div className="text-xs text-slate-500">{p.sku ?? 'No SKU'}{!p.active && <Badge className="ml-2">inactive</Badge>}</div>
                    </td>
                    <td className="px-4 py-2 text-slate-600">{p.category}</td>
                    <td className="px-4 py-2 text-right font-semibold tabular-nums">{formatRs(p.price)}</td>
                    <td className="px-4 py-2"><StockBadge product={p} /></td>
                    {isAdmin && (
                      <td className="px-4 py-2 text-right whitespace-nowrap">
                        <Button size="sm" variant="secondary" onClick={() => setAdjusting(p)}>Adjust stock</Button>{' '}
                        <Button size="sm" variant="ghost" onClick={() => { setEditing(p); setFormOpen(true) }}>Edit</Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      {isAdmin && <p className="text-sm text-slate-500">Stock value at sale price: {formatRs(counts.value)}</p>}

      <ProductFormDialog open={formOpen} product={editing} categories={categories} onClose={() => setFormOpen(false)} />
      <StockAdjustDialog product={adjusting} onClose={() => setAdjusting(null)} />
      <CsvImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  )
}

function Stat({ label, value, tone, onClick }: { label: string; value: string; tone?: 'amber' | 'red'; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} disabled={!onClick}
      className={cx('rounded-2xl border bg-white p-4 text-left', onClick && 'hover:border-slate-400',
        tone === 'amber' ? 'border-amber-300' : tone === 'red' ? 'border-rose-300' : 'border-slate-200')}>
      <div className="text-sm text-slate-500">{label}</div>
      <div className={cx('text-2xl font-bold', tone === 'amber' && 'text-amber-700', tone === 'red' && 'text-rose-700')}>{value}</div>
    </button>
  )
}
