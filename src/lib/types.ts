export type Role = 'cashier' | 'admin'

export interface Profile {
  id: string
  email: string | null
  full_name: string
  role: Role
  active: boolean
  created_at: string
}

export interface Product {
  id: string
  name: string
  sku: string | null
  category: string
  price: number
  stock_qty: number
  low_stock_threshold: number
  active: boolean
  created_at: string
  updated_at: string
}

export type StockMovementType = 'initial' | 'import' | 'adjustment' | 'sale' | 'void'

export interface StockMovement {
  id: number
  product_id: string
  delta: number
  qty_after: number
  type: StockMovementType
  reason: string | null
  sale_id: string | null
  user_id: string | null
  created_at: string
}

export interface Settings {
  id: 1
  event_name: string
  event_start_date: string | null
  event_days: number
  receipt_header: string
  receipt_footer: string
  opening_float: number
  logo_data_url: string | null
  updated_at: string
}

export type StockLevel = 'ok' | 'low' | 'out'

export function stockLevel(p: Pick<Product, 'stock_qty' | 'low_stock_threshold'>): StockLevel {
  if (p.stock_qty <= 0) return 'out'
  if (p.stock_qty <= p.low_stock_threshold) return 'low'
  return 'ok'
}

export type PaymentMethod = 'cash' | 'card' | 'split'

export interface SaleItem {
  id: number
  product_id: string
  name: string
  sku: string | null
  category: string | null
  unit_price: number
  qty: number
  discount_type: 'amount' | 'percent' | null
  discount_value: number | null
  discount_amount: number
  line_total: number
}

export interface Sale {
  id: string
  invoice_no: number
  temp_no: string | null
  device_id: string | null
  created_at: string
  client_created_at: string | null
  client_tz: string | null
  cashier_id: string
  cashier_name: string
  subtotal: number            // gross, before discounts
  line_discount_total: number
  bill_discount_type: 'amount' | 'percent' | null
  bill_discount_value: number | null
  bill_discount_amount: number
  total: number
  payment_method: PaymentMethod
  cash_amount: number
  card_amount: number
  cash_received: number | null
  change_due: number
  card_ref: string | null
  items_count: number
  status: 'completed' | 'voided'
  voided_at: string | null
  voided_by: string | null
  voided_by_name: string | null
  void_reason: string | null
  synced_from_offline: boolean
  items?: SaleItem[]
}
