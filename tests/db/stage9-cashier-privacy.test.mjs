import { setup, as, check, summary, ADMIN, CASHIER, CASHIER2 } from './harness.mjs'

const db = await setup()
const one = async (uid, sql, p) => (await as(db, uid, sql, p)).rows
const mug = (await db.query(`select id from public.products where sku = 'HOM-003'`)).rows[0].id
const sell = (who) => as(db, who, `select public.create_sale($1::jsonb) as s`, [JSON.stringify({
  id: crypto.randomUUID(), payment_method: 'card', items: [{ product_id: mug, qty: 1, unit_price: 550 }],
})]).then((r) => r.rows[0].s)

const a = await sell(CASHIER)
const b = await sell(CASHIER2)

console.log('cashier privacy')
const mine = await one(CASHIER, `select id from public.sales`)
check('cashier sees only their own sales', mine.length === 1 && mine[0].id === a.id)
const myItems = await one(CASHIER, `select sale_id from public.sale_items`)
check('cashier sees only their own sale items', myItems.length === 1 && myItems[0].sale_id === a.id)
check('admin sees all sales', (await one(ADMIN, `select id from public.sales`)).length === 2)
check('cashier cannot read the stock ledger', (await one(CASHIER, `select * from public.stock_movements`)).length === 0)
check('admin reads the stock ledger', (await one(ADMIN, `select * from public.stock_movements`)).length > 0)
check('create_sale still returns the full sale to the cashier', a.items.length === 1 && a.invoice_no === 1)

console.log('print stations are admin-only')
let blocked = false
try { await as(db, CASHIER, `insert into public.print_stations (name) values ('Phone station')`) } catch { blocked = true }
check('cashier cannot register a print station', blocked)
const st = (await one(ADMIN, `insert into public.print_stations (name) values ('Counter') returning id`))[0]
const job = (await one(CASHIER2, `insert into public.print_jobs (station_id, sale_id) values ($1, $2) returning id, status`, [st.id, b.id]))[0]
check('cashier can still send a print job', job.status === 'queued')
const claimByCashier = await one(CASHIER, `update public.print_jobs set status = 'printing' where id = $1 and status = 'queued' returning id`, [job.id])
check('cashier cannot claim / complete print jobs', claimByCashier.length === 0)
const claimByAdmin = await one(ADMIN, `update public.print_jobs set status = 'printing' where id = $1 and status = 'queued' returning id`, [job.id])
check('admin station claims the job', claimByAdmin.length === 1)
const fetched = await one(ADMIN, `select s.id, count(i.*) as n from public.sales s join public.sale_items i on i.sale_id = s.id where s.id = $1 group by s.id`, [b.id])
check('admin station can read any cashier\'s sale to print it', fetched.length === 1)
summary()
