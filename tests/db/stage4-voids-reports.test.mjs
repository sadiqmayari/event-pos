import { setup, as, expectErr, check, summary, ADMIN, CASHIER } from './harness.mjs'

const db = await setup()
const one = async (uid, sql, p) => (await as(db, uid, sql, p)).rows
const prod = async (sku) => (await db.query(`select * from public.products where sku = $1`, [sku])).rows[0]
const TZ = 'Asia/Karachi'
const sale = (payload) => as(db, CASHIER, `select public.create_sale($1::jsonb) as s`, [JSON.stringify(payload)]).then((r) => r.rows[0].s)

const kurta = await prod('APP-001') // 2450 x40
const mug = await prod('HOM-003')   // 550 x70
await db.query(`update public.settings set opening_float = 5000`)

const s1 = await sale({ id: crypto.randomUUID(), payment_method: 'cash', cash_received: 6000, items: [{ product_id: kurta.id, qty: 2, unit_price: 2450 }] })   // 4900 cash
const s2 = await sale({ id: crypto.randomUUID(), payment_method: 'card', items: [{ product_id: mug.id, qty: 3, unit_price: 550 }] })                         // 1650 card
const s3 = await sale({ id: crypto.randomUUID(), payment_method: 'split', card_amount: 1000, cash_received: 2000, items: [{ product_id: kurta.id, qty: 1, unit_price: 2450 }] }) // 1450 cash + 1000 card

console.log('void')
await expectErr('cashier cannot void', /NOT_AUTHORIZED/, () => as(db, CASHIER, `select public.void_sale($1, 'x')`, [s1.id]))
await expectErr('reason required', /REASON_REQUIRED/, () => as(db, ADMIN, `select public.void_sale($1, ' ')`, [s1.id]))
const v = (await one(ADMIN, `select public.void_sale($1, 'Customer returned') as v`, [s1.id]))[0].v
check('sale marked voided with reason + admin name', v.status === 'voided' && v.void_reason === 'Customer returned' && v.voided_by_name === 'Ayesha Admin')
check('stock restored (40-2-1+2 = 39)', (await prod('APP-001')).stock_qty === 39)
const mv = (await db.query(`select delta, type from public.stock_movements where sale_id = $1 and type = 'void'`, [s1.id])).rows
check('void movement logged', mv.length === 1 && mv[0].delta === 2)
await expectErr('cannot void twice', /ALREADY_VOIDED/, () => as(db, ADMIN, `select public.void_sale($1, 'again')`, [s1.id]))
const audit = (await db.query(`select details from public.audit_log where action = 'sale.void'`)).rows
check('void audited', audit.length === 1 && audit[0].details.reason === 'Customer returned')

console.log('reports')
const today = (await db.query(`select (now() at time zone $1)::date as d`, [TZ])).rows[0].d
const todayStr = today.toISOString().slice(0, 10)
const rows = await one(ADMIN, `select * from public.daily_summary(($1::date - 3), $1::date, $2)`, [todayStr, TZ])
check('4 days returned, including empty days', rows.length === 4)
const t = rows[3]
check('today: 2 invoices, total 4100, cash 1450, card 2650, 1 void of 4900',
  t.invoices === 2 && Number(t.total) === 4100 && Number(t.cash) === 1450 && Number(t.card) === 2650 && t.voided_invoices === 1 && Number(t.voided_total) === 4900,
  JSON.stringify(t))
check('empty day is zero', rows[0].invoices === 0 && Number(rows[0].total) === 0)
const top = await one(ADMIN, `select * from public.top_products($1::date, $1::date, $2, 5)`, [todayStr, TZ])
check('top products: mug (3) then kurta (1, voided excluded)', top[0].name === 'Ceramic Mug' && top[0].qty === 3 && top[1].qty === 1, JSON.stringify(top))
await expectErr('cashier cannot see reports', /NOT_AUTHORIZED/, () => as(db, CASHIER, `select * from public.daily_summary(current_date, current_date, 'UTC')`))

console.log('cash count')
const exp = (await one(ADMIN, `select public.expected_cash($1::date, $2) as e`, [todayStr, TZ]))[0].e
check('expected cash = float 5000 + 1450', Number(exp.expected) === 6450 && Number(exp.cash_sales) === 1450, JSON.stringify(exp))
const cc = (await one(ADMIN, `select * from public.record_cash_count($1::date, $2, 6400, 'short 50')`, [todayStr, TZ]))[0]
check('count recorded with difference -50', Number(cc.difference) === -50 && cc.counted_by_name === 'Ayesha Admin')
await expectErr('cashier cannot record count', /NOT_AUTHORIZED/, () => as(db, CASHIER, `select public.record_cash_count(current_date, 'UTC', 1)`))
await expectOkSetting()
summary()

async function expectOkSetting() {
  await as(db, ADMIN, `update public.settings set event_start_date = current_date, event_days = 4 where id = 1`)
  check('admin can set event start date', true)
}
