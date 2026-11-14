import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { downloadFile, parseCsvFile, toCsv } from '../../lib/csv'
import { errorMessage } from '../../lib/errors'
import { formatRs } from '../../lib/money'
import { Button, cx, ErrorBox, Modal, Select } from '../../components/ui'
import { useToast } from '../../components/Toast'
import { PRODUCTS_KEY } from './useProducts'

interface Row { name: string; sku: string; category: string; price: string; stock_qty: string; low_stock_threshold: string }
interface Checked { row: Row; problems: string[] }

const HEADER_ALIASES: Record<string, keyof Row> = {
  name: 'name', product: 'name', product_name: 'name', item: 'name',
  sku: 'sku', barcode: 'sku', code: 'sku',
  category: 'category', cat: 'category',
  price: 'price', sale_price: 'price', rate: 'price',
  stock_qty: 'stock_qty', stock: 'stock_qty', qty: 'stock_qty', quantity: 'stock_qty',
  low_stock_threshold: 'low_stock_threshold', low_stock: 'low_stock_threshold', threshold: 'low_stock_threshold', reorder_level: 'low_stock_threshold',
}

function normalise(raw: Record<string, string>): Row {
  const row: Row = { name: '', sku: '', category: '', price: '', stock_qty: '', low_stock_threshold: '' }
  for (const [k, v] of Object.entries(raw)) {
    const key = HEADER_ALIASES[k]
    if (key) row[key] = String(v ?? '').trim()
  }
  row.price = row.price.replace(/rs\.?/i, '').replace(/[,\s]/g, '')
  row.stock_qty = row.stock_qty.replace(/[,\s]/g, '')
  return row
}

function validate(rows: Row[]): Checked[] {
  const skus = new Map<string, number>()
  rows.forEach((r) => { if (r.sku) skus.set(r.sku, (skus.get(r.sku) ?? 0) + 1) })
  const isNum = (s: string) => s === '' || Number.isFinite(Number(s))
  const isInt = (s: string) => s === '' || (Number.isInteger(Number(s)))
  return rows.map((row) => {
    const problems: string[] = []
    if (!row.name) problems.push('missing name')
    if (!isNum(row.price) || Number(row.price) < 0) problems.push('bad price')
    if (!isInt(row.stock_qty)) problems.push('stock must be a whole number')
    if (!isInt(row.low_stock_threshold) || Number(row.low_stock_threshold) < 0) problems.push('bad low-stock value')
    if (row.sku && (skus.get(row.sku) ?? 0) > 1) problems.push('duplicate SKU in file')
    return { row, problems }
  })
}

export function CsvImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast()
  const qc = useQueryClient()
  const [checked, setChecked] = useState<Checked[] | null>(null)
  const [fileName, setFileName] = useState('')
  const [mode, setMode] = useState<'set' | 'add'>('set')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const bad = checked?.filter((c) => c.problems.length) ?? []

  function reset() { setChecked(null); setFileName(''); setError(null) }
  function close() { reset(); onClose() }

  async function onFile(file: File | undefined) {
    if (!file) return
    setError(null)
    try {
      const raw = await parseCsvFile(file)
      if (!raw.length) return setError('The file has no rows.')
      if (!('name' in raw[0]) && !Object.keys(raw[0]).some((k) => HEADER_ALIASES[k] === 'name')) {
        return setError('Could not find a "name" column. Download the template to see the expected columns.')
      }
      setChecked(validate(raw.map(normalise)))
      setFileName(file.name)
    } catch (err) { setError(errorMessage(err)) }
  }

  async function onImport() {
    if (!checked || bad.length) return
    setBusy(true)
    setError(null)
    const { data, error } = await supabase.rpc('import_products', {
      p_rows: checked.map((c) => c.row), p_stock_mode: mode,
    })
    setBusy(false)
    if (error) return setError(errorMessage(error))
    const r = data as { inserted: number; updated: number }
    await qc.invalidateQueries({ queryKey: PRODUCTS_KEY })
    toast(`Imported: ${r.inserted} new, ${r.updated} updated`)
    close()
  }

  function downloadTemplate() {
    downloadFile('products-template.csv', toCsv([
      { name: 'Cotton Kurta - Men', sku: 'APP-001', category: 'Apparel', price: 2450, stock_qty: 40, low_stock_threshold: 5 },
      { name: 'Ceramic Mug', sku: '', category: 'Home', price: 550, stock_qty: 70, low_stock_threshold: 10 },
    ], ['name', 'sku', 'category', 'price', 'stock_qty', 'low_stock_threshold']))
  }

  return (
    <Modal open={open} onClose={close} title="Import products from CSV" size="xl"
      footer={<>
        <Button variant="ghost" className="mr-auto" onClick={downloadTemplate}>Download template</Button>
        <Button variant="secondary" onClick={close}>Cancel</Button>
        <Button busy={busy} disabled={!checked || bad.length > 0} onClick={() => void onImport()}>
          Import {checked ? checked.length : ''} rows
        </Button>
      </>}
    >
      <div className="space-y-4">
        <p className="text-slate-600">
          Columns: <code>name</code>, <code>sku</code>, <code>category</code>, <code>price</code>, <code>stock_qty</code>, <code>low_stock_threshold</code>.
          Existing products are matched by SKU (or by name if there is no SKU) and updated; others are added.
          Empty cells leave the existing value unchanged. The whole file is imported, or nothing is.
        </p>
        {error && <ErrorBox>{error}</ErrorBox>}
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex h-12 cursor-pointer items-center rounded-xl border border-slate-300 bg-white px-4 font-semibold hover:bg-slate-50">
            Choose CSV file…
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = '' }} />
          </label>
          {fileName && <span className="text-slate-600">{fileName}</span>}
          <div className="ml-auto flex items-center gap-2">
            <span className="text-sm text-slate-600">Stock column:</span>
            <Select value={mode} onChange={(e) => setMode(e.target.value as 'set' | 'add')} className="w-auto">
              <option value="set">Replaces current stock</option>
              <option value="add">Is added to current stock</option>
            </Select>
          </div>
        </div>

        {checked && (
          <>
            {bad.length > 0
              ? <ErrorBox>{bad.length} row(s) have problems. Fix the file and choose it again.</ErrorBox>
              : <div className="rounded-xl bg-emerald-50 px-4 py-2 text-emerald-800">All {checked.length} rows look good.</div>}
            <div className="max-h-[45vh] overflow-auto rounded-xl border border-slate-200">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-100 text-left">
                  <tr>{['#', 'Name', 'SKU', 'Category', 'Price', 'Stock', 'Low at', 'Check'].map((h) => <th key={h} className="px-3 py-2">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {checked.map(({ row, problems }, i) => (
                    <tr key={i} className={cx('border-t border-slate-100', problems.length > 0 && 'bg-rose-50')}>
                      <td className="px-3 py-1.5 text-slate-400">{i + 1}</td>
                      <td className="px-3 py-1.5 font-medium">{row.name}</td>
                      <td className="px-3 py-1.5">{row.sku}</td>
                      <td className="px-3 py-1.5">{row.category}</td>
                      <td className="px-3 py-1.5">{row.price !== '' && Number.isFinite(Number(row.price)) ? formatRs(Number(row.price)) : row.price}</td>
                      <td className="px-3 py-1.5">{row.stock_qty}</td>
                      <td className="px-3 py-1.5">{row.low_stock_threshold}</td>
                      <td className="px-3 py-1.5 text-rose-700">{problems.join(', ') || '✓'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
