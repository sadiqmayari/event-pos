import { supabase } from '../../lib/supabase'
import { downloadFile, toCsv } from '../../lib/csv'
import { dayRange, formatDateTime, localDateKey } from '../../lib/time'
import type { Sale, SaleItem } from '../../lib/types'

type Row = Record<string, unknown>
type Page = (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>

/** PostgREST returns at most 1000 rows per request — page through everything. */
async function fetchAll<T = Row>(page: Page): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999)
    if (error) throw error
    out.push(...((data ?? []) as T[]))
    if (!data || data.length < 1000) return out
  }
}

function range(fromKey: string, toKey: string) {
  return { from: dayRange(fromKey).from, to: dayRange(toKey).to }
}

export async function exportSales(fromKey: string, toKey: string) {
  const r = range(fromKey, toKey)
  const sales = await fetchAll<Sale>((a, b) => supabase.from('sales').select('*')
    .gte('created_at', r.from).lt('created_at', r.to).order('invoice_no').range(a, b))
  downloadFile(`sales_${fromKey}_to_${toKey}.csv`, toCsv(sales.map((s) => ({
    invoice_no: s.invoice_no,
    date_time: formatDateTime(s.created_at),
    status: s.status,
    cashier: s.cashier_name,
    items: s.items_count,
    subtotal: s.subtotal,
    item_discounts: s.line_discount_total,
    bill_discount: s.bill_discount_amount,
    total: s.total,
    payment_method: s.payment_method,
    cash: s.cash_amount,
    card: s.card_amount,
    cash_received: s.cash_received ?? '',
    change: s.change_due,
    card_ref: s.card_ref ?? '',
    void_reason: s.void_reason ?? '',
    voided_by: s.voided_by_name ?? '',
    offline_receipt: s.temp_no ?? '',
    device: s.device_id ?? '',
    sale_id: s.id,
  }))))
  return sales.length
}

export async function exportSaleItems(fromKey: string, toKey: string) {
  const r = range(fromKey, toKey)
  type ItemRow = SaleItem & { sales: Pick<Sale, 'invoice_no' | 'created_at' | 'status' | 'cashier_name' | 'payment_method'> }
  const items = await fetchAll<ItemRow>((a, b) => supabase.from('sale_items')
    .select('*, sales!inner(invoice_no, created_at, status, cashier_name, payment_method)')
    .gte('sales.created_at', r.from).lt('sales.created_at', r.to).order('id').range(a, b))
  downloadFile(`sale_items_${fromKey}_to_${toKey}.csv`, toCsv(items.map((i) => ({
    invoice_no: i.sales.invoice_no,
    date_time: formatDateTime(i.sales.created_at),
    status: i.sales.status,
    cashier: i.sales.cashier_name,
    payment_method: i.sales.payment_method,
    product: i.name,
    sku: i.sku ?? '',
    category: i.category ?? '',
    unit_price: i.unit_price,
    qty: i.qty,
    discount: i.discount_amount,
    line_total: i.line_total,
  }))))
  return items.length
}

export async function exportStockMovements() {
  const rows = await fetchAll<Row & { products: { name: string; sku: string | null } }>((a, b) => supabase.from('stock_movements')
    .select('*, products(name, sku)').order('id').range(a, b))
  downloadFile(`stock_movements_${localDateKey()}.csv`, toCsv(rows.map((m) => ({
    date_time: formatDateTime(String(m.created_at)),
    product: m.products?.name ?? '',
    sku: m.products?.sku ?? '',
    type: m.type,
    change: m.delta,
    stock_after: m.qty_after,
    reason: m.reason ?? '',
  }))))
  return rows.length
}

/** Everything in one JSON file — keep a copy on a USB stick at the end of each day. */
export async function downloadFullBackup(extra: Record<string, unknown> = {}) {
  const tables = ['settings', 'profiles', 'products', 'sales', 'sale_items', 'stock_movements', 'cash_counts'] as const
  const backup: Record<string, unknown> = { exported_at: new Date().toISOString(), ...extra }
  for (const t of tables) {
    backup[t] = await fetchAll((a, b) => supabase.from(t).select('*').range(a, b))
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  downloadFile(`event-pos-backup_${stamp}.json`, JSON.stringify(backup, null, 1), 'application/json')
}
