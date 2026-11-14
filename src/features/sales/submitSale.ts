import { supabase } from '../../lib/supabase'
import { toAppError, type AppError } from '../../lib/errors'
import { getDeviceId } from '../../lib/device'
import { userTimeZone } from '../../lib/time'
import type { CartLine, Discount } from '../../lib/pricing'
import type { PaymentMethod, Sale } from '../../lib/types'

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

export function buildPayload(saleId: string, lines: CartLine[], billDiscount: Discount | null, pay: PaymentInput) {
  return {
    id: saleId,
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
export async function submitSale(payload: ReturnType<typeof buildPayload>): Promise<SubmitResult> {
  try {
    const { data, error } = await supabase.rpc('create_sale', { p: payload }).abortSignal(AbortSignal.timeout(20_000))
    if (error) return withDetails(toAppError(error))
    if (!data) return { ok: false, error: { code: 'UNKNOWN', message: 'The server did not confirm the sale.' } }
    return { ok: true, sale: data as Sale }
  } catch (err) {
    return { ok: false, error: toAppError(err) }
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
