import fs from 'node:fs'
import path from 'node:path'
import { setup, as, expectErr, check, summary, REPO, ADMIN, CASHIER } from './harness.mjs'

const db = await setup()
const one = async (uid, sql, p) => (await as(db, uid, sql, p)).rows
const prod = async (sku) => (await db.query(`select * from public.products where sku = $1`, [sku])).rows[0]
const sale = (payload) => as(db, CASHIER, `select public.create_sale($1::jsonb) as s`, [JSON.stringify(payload)]).then((r) => r.rows[0].s)
const uuid = () => crypto.randomUUID()

const kurta = await prod('APP-001') // 2450, stock 40
const mug = await prod('HOM-003')   // 550, stock 70
const sandals = await prod('FTW-004') // 1150, stock 0

console.log('basic cash sale')
const id1 = uuid()
const s1 = await sale({
  id: id1, payment_method: 'cash', cash_received: 6000,
  items: [{ product_id: kurta.id, qty: 2, unit_price: 2450 }, { product_id: mug.id, qty: 1, unit_price: 550 }],
})
check('invoice #1', Number(s1.invoice_no) === 1, s1.invoice_no)
check('totals: subtotal 5450, total 5450, change 550', s1.subtotal === 5450 && s1.total === 5450 && s1.change_due === 550 && s1.cash_amount === 5450, JSON.stringify(s1))
check('cashier name snapshot', s1.cashier_name === 'Bilal Cashier')
check('2 item rows, 3 units', s1.items.length === 2 && s1.items_count === 3)
check('stock decremented (40->38, 70->69)', (await prod('APP-001')).stock_qty === 38 && (await prod('HOM-003')).stock_qty === 69)
const mv = (await db.query(`select delta, type, reason, sale_id from public.stock_movements where sale_id = $1 order by delta`, [id1])).rows
check('ledger rows for sale', mv.length === 2 && mv[0].type === 'sale' && mv[0].reason === 'Invoice #1', JSON.stringify(mv))

console.log('idempotent retry')
const again = await sale({ id: id1, payment_method: 'cash', cash_received: 6000, items: [{ product_id: kurta.id, qty: 2, unit_price: 2450 }] })
check('same invoice returned, no double stock', Number(again.invoice_no) === 1 && (await prod('APP-001')).stock_qty === 38)

console.log('discounts + card + split')
const s2 = await sale({
  id: uuid(), payment_method: 'card', card_ref: '4242',
  bill_discount_type: 'amount', bill_discount_value: 100,
  items: [
    { product_id: kurta.id, qty: 1, unit_price: 2450, discount_type: 'percent', discount_value: 10 }, // 245 off -> 2205
    { product_id: mug.id, qty: 3, unit_price: 550, discount_type: 'amount', discount_value: 50 },    // 1650-50 = 1600
  ],
})
check('line discounts 295, subtotal (gross) 4100, total 3705', s2.line_discount_total === 295 && s2.subtotal === 4100 && s2.bill_discount_amount === 100 && s2.total === 3705, JSON.stringify(s2))
check('card: card_amount = total, no cash', s2.card_amount === 3705 && s2.cash_amount === 0 && s2.card_ref === '4242' && Number(s2.invoice_no) === 2)
const s3 = await sale({
  id: uuid(), payment_method: 'split', card_amount: 2000, cash_received: 1000,
  bill_discount_type: 'percent', bill_discount_value: 5,
  items: [{ product_id: kurta.id, qty: 1, unit_price: 2450 }], // 2450 - 123 (5% rounded) = 2327; cash part 327
})
check('split: total 2327, cash 327, change 673', s3.total === 2327 && s3.card_amount === 2000 && s3.cash_amount === 327 && s3.change_due === 673, JSON.stringify(s3))

console.log('blocked sales')
await expectErr('out of stock blocked', /INSUFFICIENT_STOCK/, () => sale({ id: uuid(), payment_method: 'card', items: [{ product_id: sandals.id, qty: 1, unit_price: 1150 }] }))
try {
  await sale({ id: uuid(), payment_method: 'card', items: [{ product_id: kurta.id, qty: 30, unit_price: 2450 }, { product_id: kurta.id, qty: 10, unit_price: 2450 }] })
  check('duplicate lines summed for stock check', false)
} catch (e) {
  const detail = JSON.parse(e.detail ?? '[]')
  check('duplicate lines summed; detail lists requested 40, available 36', detail[0]?.requested === 40 && detail[0]?.available === 36, e.detail)
}
check('failed sale left stock untouched', (await prod('APP-001')).stock_qty === 36)
await expectErr('price changed detected', /PRICE_CHANGED/, () => sale({ id: uuid(), payment_method: 'card', items: [{ product_id: mug.id, qty: 1, unit_price: 500 }] }))
await expectErr('cash short', /INSUFFICIENT_PAYMENT/, () => sale({ id: uuid(), payment_method: 'cash', cash_received: 100, items: [{ product_id: mug.id, qty: 1, unit_price: 550 }] }))
await expectErr('split card >= total', /INSUFFICIENT_PAYMENT/, () => sale({ id: uuid(), payment_method: 'split', card_amount: 550, items: [{ product_id: mug.id, qty: 1, unit_price: 550 }] }))
await expectErr('discount > line', /INVALID_DISCOUNT/, () => sale({ id: uuid(), payment_method: 'card', items: [{ product_id: mug.id, qty: 1, unit_price: 550, discount_type: 'amount', discount_value: 600 }] }))
await expectErr('percent > 100', /INVALID_DISCOUNT/, () => sale({ id: uuid(), payment_method: 'card', items: [{ product_id: mug.id, qty: 1, unit_price: 550, discount_type: 'percent', discount_value: 150 }] }))
await expectErr('empty cart', /EMPTY_CART/, () => sale({ id: uuid(), payment_method: 'card', items: [] }))
await expectErr('zero qty', /INVALID_INPUT/, () => sale({ id: uuid(), payment_method: 'card', items: [{ product_id: mug.id, qty: 0 }] }))
await expectErr('anon cannot sell', /permission denied/, () => as(db, null, `select public.create_sale('{}'::jsonb)`))
await expectErr('cashier cannot call process_sale directly', /permission denied/, () => as(db, CASHIER, `select public.process_sale('{}'::jsonb, $1)`, [CASHIER]))
check('invoice numbers stay gapless after failures', Number((await db.query('select last_no from public.invoice_counter')).rows[0].last_no) === 3)

console.log('last unit: two tills')
await as(db, ADMIN, `select public.adjust_stock($1, 'test', null, 1)`, [mug.id])
const a = await sale({ id: uuid(), payment_method: 'card', items: [{ product_id: mug.id, qty: 1, unit_price: 550 }] })
check('till A gets the last mug', a.total === 550)
await expectErr('till B is blocked', /INSUFFICIENT_STOCK/, () => sale({ id: uuid(), payment_method: 'card', items: [{ product_id: mug.id, qty: 1, unit_price: 550 }] }))
check('stock is 0, never negative', (await prod('HOM-003')).stock_qty === 0)

console.log('offline sync keeps price paid')
await as(db, ADMIN, `select public.adjust_stock($1, 'test', 5)`, [mug.id])
const off = await sale({ id: uuid(), offline: true, temp_no: 'T-AB12-0001', payment_method: 'card', items: [{ product_id: mug.id, qty: 1, unit_price: 500 }] })
check('offline sale uses price shown at time (500)', off.total === 500 && off.synced_from_offline === true && off.temp_no === 'T-AB12-0001')

console.log('fake sales generator')
await db.exec(fs.readFileSync(path.join(REPO, 'fake_sales.sql'), 'utf8'))
const stats = (await db.query(`
  select count(*)::int n, count(distinct invoice_no)::int inv, max(invoice_no)::int maxinv,
         bool_and(total = subtotal - line_discount_total - bill_discount_amount) totals_ok,
         bool_and(cash_amount + card_amount = total) pay_ok,
         count(distinct (created_at at time zone 'Asia/Karachi')::date)::int days
    from public.sales`)).rows[0]
check(`50 fake sales created (total ${stats.n})`, stats.n >= 50, JSON.stringify(stats))
check('invoices gapless', stats.inv === stats.n && stats.maxinv === stats.n)
check('every sale: total = subtotal - discounts', stats.totals_ok)
check('every sale: cash + card = total', stats.pay_ok)
check('spread over several days', stats.days >= 2, stats.days)
const neg = (await db.query(`select count(*)::int n from public.products where stock_qty < 0`)).rows[0].n
check('no negative stock', neg === 0)
const ledger = (await db.query(`
  select bool_and(p.stock_qty = coalesce(m.s, 0)) ok from public.products p
  left join (select product_id, sum(delta) s from public.stock_movements group by 1) m on m.product_id = p.id`)).rows[0].ok
check('stock ledger sums to current stock for every product', ledger)
summary()
