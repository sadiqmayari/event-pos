import type { Sale } from '../../lib/types'

/** A made-up sale used for the receipt preview and the printer test page. */
export function sampleSale(cashierName: string): Sale {
  const now = new Date().toISOString()
  return {
    id: '00000000-0000-0000-0000-000000000000',
    invoice_no: 123,
    temp_no: null,
    device_id: null,
    created_at: now,
    client_created_at: now,
    client_tz: null,
    cashier_id: '',
    cashier_name: cashierName,
    subtotal: 5450,
    line_discount_total: 245,
    bill_discount_type: 'percent',
    bill_discount_value: 5,
    bill_discount_amount: 260,
    total: 4945,
    payment_method: 'cash',
    cash_amount: 4945,
    card_amount: 0,
    cash_received: 5000,
    change_due: 55,
    card_ref: null,
    items_count: 3,
    status: 'completed',
    voided_at: null,
    voided_by: null,
    voided_by_name: null,
    void_reason: null,
    synced_from_offline: false,
    items: [
      { id: 1, product_id: '', name: 'Cotton Kurta - Men', sku: 'APP-001', category: 'Apparel', unit_price: 2450, qty: 2, discount_type: 'percent', discount_value: 5, discount_amount: 245, line_total: 4655 },
      { id: 2, product_id: '', name: 'Ceramic Mug', sku: 'HOM-003', category: 'Home', unit_price: 550, qty: 1, discount_type: null, discount_value: null, discount_amount: 0, line_total: 550 },
    ],
  }
}
