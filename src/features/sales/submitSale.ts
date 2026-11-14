import { supabase } from '../../lib/supabase'
import { toAppError, type AppError } from '../../lib/errors'
import { getDeviceId } from '../../lib/device'
import { userTimeZone } from '../../lib/time'
import type { CartLine, Discount, Totals } from '../../lib/pricing'
import type { PaymentMethod, Sale, SaleItem } from '../../lib/types'
import { setNetworkDown } from '../offline/outbox'

export interface PaymentInput {
  method: PaymentMethod
  cashReceived: number | null
  cardAmount: number | null
  cardRef: string
}

export interface StockShortage { product_id: string; name: string; requested: number; available: number }
export interface PriceChange { product_id: string; name: string; old_price: number; new_price: number }

export type SubmitResult =
  | { ok: true; sale: Sale }
  | { ok: false; error: AppError; shortages?: StockShortage[]; priceChanges?: PriceChange[] }

export function buildPayload(saleId: string, lines: CartLine[], billDiscount: Discount | null, pay: PaymentInput,
  extra: { offline?: boolean; temp_no?: string } = {}) {
  return {
    id: saleId,
    offline: extra.offline ?? false,
    temp_no: extra.temp_no ?? null as string | null,
    device_id: getDeviceId(),
    client_created_at: new Date().toISOString(),
    client_tz: userTimeZone,
    items: lines.map((l) => ({
      product_id: l.product_id,
      qty: l.qty,
      unit_price: l.unit_price,
      discount_type: l.discount?.value ? l.discount.type : null,
      discount_value: l.discount?.value ? l.discount.value : null,
    })),
    bill_discount_type: billDiscount?.value ? billDiscount.type : null,
    bill_discount_value: billDiscount?.value ? billDiscount.value : null,
    payment_method: pay.method,
    cash_received: pay.method === 'card' ? null : pay.cashReceived,
    card_amount: pay.method === 'split' ? pay.cardAmount : null,
    card_ref: pay.method === 'cash' ? null : pay.cardRef.trim() || null,
  }
}

/**
 * Sends the sale and waits for the database to confirm it.
 * Only a successful reply means the sale is saved. A network error or timeout is ambiguous:
 * retry with the SAME sale id — the server returns the existing sale instead of making a second one.
 */
export async function submitSale(payload: ReturnType<typeof buildPayload>, timeoutMs = 20_000): Promise<SubmitResult> {
  try {
    const { data, error } = await supabase.rpc('create_sale', { p: payload }).abortSignal(AbortSignal.timeout(timeoutMs))
    if (error) {
      const e = toAppError(error)
      setNetworkDown(e.code === 'NETWORK')
      return withDetails(e)
    }
    setNetworkDown(false)
    if (!data) return { ok: false, error: { code: 'UNKNOWN', message: 'The server did not confirm the sale.' } }
    return { ok: true, sale: data as Sale }
  } catch (err) {
    const e = toAppError(err)
    if (e.code === 'NETWORK') setNetworkDown(true)
    return { ok: false, error: e }
  }
}

/** The sale as the server would record it — used for the receipt of an offline (queued) sale. */
export function buildLocalSale(payload: ReturnType<typeof buildPayload>, totals: Totals, cashier: { id: string; name: string }): Sale {
  const now = payload.client_created_at
  const cash = payload.payment_method === 'cash' ? totals.total : payload.payment_method === 'split' ? totals.total - (payload.card_amount ?? 0) : 0
  const card = totals.total - cash
  const received = payload.payment_method === 'card' ? null : payload.cash_received ?? cash
  const items: SaleItem[] = totals.lines.map((l, i) => ({
    id: i + 1, product_id: l.product_id, name: l.name, sku: l.sku, category: null, unit_price: l.unit_price, qty: l.qty,
    discount_type: l.discountAmount > 0 ? l.discount!.type : null, discount_value: l.discountAmount > 0 ? l.discount!.value : null,
    discount_amount: l.discountAmount, line_total: l.lineTotal,
  }))
  return {
    id: payload.id, invoice_no: 0, temp_no: payload.temp_no, device_id: payload.device_id,
    created_at: now, client_created_at: now, client_tz: payload.client_tz,
    cashier_id: cashier.id, cashier_name: cashier.name,
    subtotal: totals.gross, line_discount_total: totals.lineDiscountTotal,
    bill_discount_type: totals.billDiscountAmount > 0 ? payload.bill_discount_type : null,
    bill_discount_value: totals.billDiscountAmount > 0 ? payload.bill_discount_value : null,
    bill_discount_amount: totals.billDiscountAmount, total: totals.total,
    payment_method: payload.payment_method, cash_amount: cash, card_amount: card,
    cash_received: received, change_due: received == null ? 0 : Math.max(0, received - cash), card_ref: payload.card_ref,
    items_count: totals.itemsCount, status: 'completed', voided_at: null, voided_by: null, voided_by_name: null, void_reason: null,
    synced_from_offline: true, items,
  }
}

function withDetails(error: AppError): SubmitResult {
  let parsed: unknown
  try { parsed = error.details ? JSON.parse(error.details) : undefined } catch { parsed = undefined }
  if (error.code === 'INSUFFICIENT_STOCK') return { ok: false, error, shortages: (parsed as StockShortage[]) ?? [] }
  if (error.code === 'PRICE_CHANGED') return { ok: false, error, priceChanges: (parsed as PriceChange[]) ?? [] }
  return { ok: false, error }
}

const LAST_SALE_KEY = 'event-pos-last-sale'
export function rememberLastSale(sale: Sale) {
  localStorage.setItem(LAST_SALE_KEY, JSON.stringify(sale))
}
export function getLastSale(): Sale | null {
  try { return JSON.parse(localStorage.getItem(LAST_SALE_KEY) ?? 'null') as Sale | null } catch { return null }
}
