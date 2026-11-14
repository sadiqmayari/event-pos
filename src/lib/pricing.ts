// Client-side mirror of the server's money maths (process_sale in 004_sales.sql).
// The server always recomputes; this is for display and early validation.

export type DiscountType = 'amount' | 'percent'
export interface Discount { type: DiscountType; value: number }

export interface CartLine {
  product_id: string
  name: string
  sku: string | null
  unit_price: number
  qty: number
  discount: Discount | null
}

/** Same rounding as Postgres round(numeric): half away from zero (all values here are >= 0). */
export function discountAmount(base: number, d: Discount | null | undefined): number {
  if (!d || !d.value) return 0
  return d.type === 'percent' ? Math.round((base * d.value) / 100) : Math.round(d.value)
}

export function discountError(base: number, d: Discount | null | undefined): string | null {
  if (!d || !d.value) return null
  if (d.value < 0) return 'Discount cannot be negative.'
  if (d.type === 'percent' && d.value > 100) return 'Percent cannot be more than 100.'
  if (discountAmount(base, d) > base) return 'Discount is more than the amount.'
  return null
}

export interface PricedLine extends CartLine {
  gross: number
  discountAmount: number
  lineTotal: number
}

export interface Totals {
  lines: PricedLine[]
  gross: number              // before any discount
  lineDiscountTotal: number
  subtotal: number           // after line discounts
  billDiscountAmount: number
  total: number
  itemsCount: number
  discountTotal: number
}

export function computeTotals(lines: CartLine[], billDiscount: Discount | null): Totals {
  const priced = lines.map((l) => {
    const gross = l.unit_price * l.qty
    const disc = Math.min(discountAmount(gross, l.discount), gross)
    return { ...l, gross, discountAmount: disc, lineTotal: gross - disc }
  })
  const gross = priced.reduce((s, l) => s + l.gross, 0)
  const lineDiscountTotal = priced.reduce((s, l) => s + l.discountAmount, 0)
  const subtotal = gross - lineDiscountTotal
  const billDiscountAmount = Math.min(discountAmount(subtotal, billDiscount), subtotal)
  return {
    lines: priced,
    gross,
    lineDiscountTotal,
    subtotal,
    billDiscountAmount,
    total: subtotal - billDiscountAmount,
    itemsCount: priced.reduce((s, l) => s + l.qty, 0),
    discountTotal: lineDiscountTotal + billDiscountAmount,
  }
}

export function describeDiscount(d: Discount): string {
  return d.type === 'percent' ? `${d.value}% off` : `Rs ${d.value} off`
}
