import { setup, as, expectErr, check, summary, ADMIN, CASHIER, CASHIER2 } from './harness.mjs'

const db = await setup()
const one = async (uid, sql, p) => (await as(db, uid, sql, p)).rows
const TZ = 'Asia/Karachi'
const id = async (sku) => (await db.query(`select id from public.products where sku = $1`, [sku])).rows[0].id
const kurta = await id('APP-001') // 2450
const mug = await id('HOM-003')   // 550
const sell = (who, payload) => as(db, who, `select public.create_sale($1::jsonb) as s`, [JSON.stringify({ id: crypto.randomUUID(), ...payload })]).then((r) => r.rows[0].s)
const today = (await db.query(`select (now() at time zone $1)::date::text as d`, [TZ])).rows[0].d

// Bilal (CASHIER): cash 2450 + split (cash 1450, card 1000) + card 550 ; Cashier2: cash 550 x2, one voided
await sell(CASHIER, { payment_method: 'cash', cash_received: 3000, items: [{ product_id: kurta, qty: 1, unit_price: 2450 }] })
await sell(CASHIER, { payment_method: 'split', card_amount: 1000, cash_received: 1500, items: [{ product_id: kurta, qty: 1, unit_price: 2450 }] })
await sell(CASHIER, { payment_method: 'card', items: [{ product_id: mug, qty: 1, unit_price: 550 }] })
await sell(CASHIER2, { payment_method: 'cash', items: [{ product_id: mug, qty: 1, unit_price: 550 }] })
const v = await sell(CASHIER2, { payment_method: 'cash', items: [{ product_id: mug, qty: 1, unit_price: 550 }] })
await one(ADMIN, `select public.void_sale($1, 'test')`, [v.id])

// an offline sale made "yesterday" but synced today counts on yesterday
const yesterday = (await db.query(`select ($1::date - 1)::text as d`, [today])).rows[0].d
const off = await sell(CASHIER2, { payment_method: 'cash', offline: true, client_created_at: `${yesterday}T12:00:00+05:00`, items: [{ product_id: mug, qty: 1, unit_price: 550 }] })
check('offline sale stored with device time', off.synced_from_offline === true)

console.log('cashier summary')
const sum = async (who = ADMIN, day = today) => Object.fromEntries((await one(who, `select * from public.cashier_summary($1::date, $2)`, [day, TZ])).map((r) => [r.cashier_name, r]))
let s = await sum()
check('Bilal: 3 invoices, total 5450, cash 3900, card 1550, outstanding 3900',
  s['Bilal Cashier'].invoices === 3 && Number(s['Bilal Cashier'].total) === 5450 && Number(s['Bilal Cashier'].cash) === 3900 &&
  Number(s['Bilal Cashier'].card) === 1550 && Number(s['Bilal Cashier'].outstanding) === 3900, JSON.stringify(s['Bilal Cashier']))
check('cash2: 1 invoice (void excluded), 1 void, outstanding 550 (offline sale is on yesterday)',
  s['cash2'].invoices === 1 && s['cash2'].voided_invoices === 1 && Number(s['cash2'].outstanding) === 550, JSON.stringify(s['cash2']))
const y = await sum(ADMIN, yesterday)
check('yesterday has the offline sale for cash2', Number(y['cash2']?.cash) === 550)

console.log('float + collections')
await one(ADMIN, `select public.record_cashier_cash($1, $2::date, $3, 'float', 2000, 'change')`, [CASHIER, today, TZ])
s = await sum()
check('float raises outstanding to 5900', Number(s['Bilal Cashier'].outstanding) === 5900)
const c1 = (await one(ADMIN, `select * from public.record_cashier_cash($1, $2::date, $3, 'collection', 5000, 'mid-day')`, [CASHIER, today, TZ]))[0]
check('collection snapshots expected 5900, difference -900', Number(c1.expected) === 5900 && Number(c1.difference) === -900)
s = await sum()
check('after partial collection outstanding 900', Number(s['Bilal Cashier'].outstanding) === 900 && Number(s['Bilal Cashier'].collected) === 5000)
const c2 = (await one(ADMIN, `select * from public.record_cashier_cash($1, $2::date, $3, 'collection', 900)`, [CASHIER, today, TZ]))[0]
check('final collection balances to 0', Number(c2.expected) === 900 && Number(c2.difference) === 0)
check('outstanding now 0', Number((await sum())['Bilal Cashier'].outstanding) === 0)

console.log('permissions')
await expectErr('cashier cannot record cash', /NOT_AUTHORIZED/, () => as(db, CASHIER, `select public.record_cashier_cash($1, current_date, 'UTC', 'collection', 1)`, [CASHIER]))
const mine = await sum(CASHIER)
check('cashier sees only their own summary row', Object.keys(mine).length === 1 && mine['Bilal Cashier'])
const entriesSeenByCashier2 = await one(CASHIER2, `select * from public.cashier_cash_entries`)
check('cashier cannot see other cashiers\' cash entries', entriesSeenByCashier2.length === 0)
await expectErr('nobody writes entries directly', /permission denied/, () => as(db, ADMIN, `insert into public.cashier_cash_entries (cashier_id, cashier_name, day, tz, type, amount) values ($1, 'x', current_date, 'UTC', 'float', 1)`, [CASHIER]))
const daily = (await one(ADMIN, `select * from public.daily_summary($1::date, $1::date, $2)`, [today, TZ]))[0]
check('daily summary today excludes the back-dated offline sale', daily.invoices === 4, JSON.stringify(daily))
summary()
