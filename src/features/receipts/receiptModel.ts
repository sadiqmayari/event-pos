import { formatRs } from '../../lib/money'
import { formatDateTime } from '../../lib/time'
import type { Sale, Settings } from '../../lib/types'

export interface ReceiptRow { label: string; value: string; bold?: boolean; big?: boolean }
export interface ReceiptItem { name: string; detail: string; total: string; discount?: string }

/** Everything printed on a receipt, independent of how it is printed. */
export interface ReceiptDoc {
  logo: string | null
  title: string
  headerLines: string[]
  invoiceLabel: string
  meta: ReceiptRow[]
  items: ReceiptItem[]
  totals: ReceiptRow[]
  payments: ReceiptRow[]
  footerLines: string[]
  banner: string | null // e.g. "*** VOID ***" or "REPRINT"
}

const splitLines = (s: string) => s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)

export function buildReceipt(sale: Sale, settings: Settings, opts: { reprint?: boolean; test?: boolean } = {}): ReceiptDoc {
  const items: ReceiptItem[] = (sale.items ?? []).map((i) => ({
    name: i.name,
    detail: `${i.qty} x ${formatRs(i.unit_price)}`,
    total: formatRs(i.line_total),
    discount: i.discount_amount > 0
      ? `${i.discount_type === 'percent' ? `${Number(i.discount_value)}% off` : 'Discount'}  -${formatRs(i.discount_amount)}`
      : undefined,
  }))

  const totals: ReceiptRow[] = [{ label: `Subtotal (${sale.items_count} item${sale.items_count === 1 ? '' : 's'})`, value: formatRs(sale.subtotal) }]
  if (sale.line_discount_total > 0) totals.push({ label: 'Item discounts', value: `-${formatRs(sale.line_discount_total)}` })
  if (sale.bill_discount_amount > 0) {
    const pct = sale.bill_discount_type === 'percent' ? ` (${Number(sale.bill_discount_value)}%)` : ''
    totals.push({ label: `Bill discount${pct}`, value: `-${formatRs(sale.bill_discount_amount)}` })
  }
  totals.push({ label: 'TOTAL', value: formatRs(sale.total), bold: true, big: true })

  const payments: ReceiptRow[] = []
  if (sale.payment_method !== 'card') {
    payments.push({ label: sale.payment_method === 'split' ? 'Cash part' : 'Cash', value: formatRs(sale.cash_amount) })
  }
  if (sale.card_amount > 0) {
    payments.push({ label: `Card${sale.card_ref ? ` (${sale.card_ref})` : ''}`, value: formatRs(sale.card_amount) })
  }
  if (sale.payment_method !== 'card' && sale.cash_received != null) {
    payments.push({ label: 'Cash received', value: formatRs(sale.cash_received) })
    payments.push({ label: 'Change', value: formatRs(sale.change_due), bold: true })
  }

  const isTemp = !sale.invoice_no && sale.temp_no
  return {
    logo: settings.logo_data_url,
    title: settings.event_name,
    headerLines: splitLines(settings.receipt_header),
    invoiceLabel: isTemp ? `Receipt ${sale.temp_no}` : `Invoice #${sale.invoice_no}`,
    meta: [
      { label: 'Date', value: formatDateTime(sale.client_created_at ?? sale.created_at) },
      { label: 'Cashier', value: sale.cashier_name },
      ...(isTemp ? [{ label: 'Status', value: 'Saved offline - pending' }] : []),
    ],
    items,
    totals,
    payments,
    footerLines: splitLines(settings.receipt_footer),
    banner: opts.test ? 'TEST PRINT' : sale.status === 'voided' ? '*** VOID ***' : opts.reprint ? 'REPRINT' : null,
  }
}
