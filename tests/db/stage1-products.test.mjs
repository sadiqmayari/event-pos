import { setup, as, expectOk, expectErr, check, summary, ADMIN, CASHIER } from './harness.mjs'
const db = await setup()
const one = async (uid, sql, p) => (await as(db, uid, sql, p)).rows

console.log('profiles')
const p = (await db.query(`select email, full_name, role from public.profiles order by email`)).rows
check('profiles auto-created with names', p.length === 3 && p.find(x => x.email === 'cash@test.pk').full_name === 'Bilal Cashier' && p.find(x => x.email === 'cash2@test.pk').full_name === 'cash2', JSON.stringify(p))

console.log('anon')
await expectErr('anon cannot read products', /permission denied/, () => as(db, null, 'select * from public.products'))
await expectErr('anon cannot call adjust_stock', /permission denied/, () => as(db, null, `select public.adjust_stock(gen_random_uuid(), 'x', 1)`))

console.log('cashier')
const prods = await one(CASHIER, 'select id, sku, stock_qty, price from public.products order by sku')
check('cashier reads 40 seeded products', prods.length === 40, prods.length)
const pid = prods.find(x => x.sku === 'APP-001').id
const upd = await one(CASHIER, `update public.products set price = 1 where id = $1 returning id`, [pid])
check('cashier price update affects 0 rows', upd.length === 0)
await expectErr('cashier cannot write stock_qty', /permission denied/, () => as(db, CASHIER, `update public.products set stock_qty = 999 where id = $1`, [pid]))
await expectErr('cashier cannot adjust stock', /NOT_AUTHORIZED/, () => as(db, CASHIER, `select public.adjust_stock($1, 'x', 5)`, [pid]))
await expectErr('cashier cannot insert sales', /permission denied/, () => as(db, CASHIER, `insert into public.sales (id) values (gen_random_uuid())`))
await expectErr('cashier cannot make self admin', /./, async () => {
  const r = await as(db, CASHIER, `update public.profiles set role='admin' where id = $1 returning id`, [CASHIER])
  if (!r.rows.length) throw new Error('0 rows (blocked by RLS)')
})
check('cashier sees no audit log', (await one(CASHIER, 'select * from public.audit_log')).length === 0)

console.log('admin')
await expectOk('admin edits price', () => as(db, ADMIN, `update public.products set price = 2500 where id = $1`, [pid]))
await expectErr('admin cannot write stock_qty directly', /permission denied/, () => as(db, ADMIN, `update public.products set stock_qty = 999 where id = $1`, [pid]))
const a1 = await one(ADMIN, `select (public.adjust_stock($1, 'Delivery', 5)).stock_qty as q`, [pid])
check('adjust +5 -> 45', a1[0].q === 45, JSON.stringify(a1))
const a2 = await one(ADMIN, `select (public.adjust_stock($1, 'Recount', null, 42)).stock_qty as q`, [pid])
check('recount set -> 42', a2[0].q === 42, JSON.stringify(a2))
await expectErr('cannot go negative', /NEGATIVE_STOCK/, () => as(db, ADMIN, `select public.adjust_stock($1, 'x', -100)`, [pid]))
await expectErr('reason required', /REASON_REQUIRED/, () => as(db, ADMIN, `select public.adjust_stock($1, '  ', 1)`, [pid]))
const mv = await one(ADMIN, `select delta, qty_after, type, reason, user_id from public.stock_movements where product_id = $1 order by id`, [pid])
check('ledger: initial, +5, -3', mv.map(m => m.delta).join() === '40,5,-3' && mv[2].qty_after === 42 && mv[2].user_id === ADMIN, JSON.stringify(mv))
const newp = await one(ADMIN, `insert into public.products (name, category, price) values ('Test Item', 'Misc', 100) returning id, stock_qty`)
check('admin inserts product (stock 0)', newp[0].stock_qty === 0)
await expectOk('initial stock via adjust_stock', () => as(db, ADMIN, `select public.adjust_stock($1, 'Initial stock', 10, null, 'initial')`, [newp[0].id]))

console.log('import')
const rows = [
  { name: 'Cotton Kurta - Men', sku: 'APP-001', price: '2600', stock_qty: '50' },
  { name: 'Brand New Thing', sku: 'NEW-1', category: 'Misc', price: '1234.6', stock_qty: '7', low_stock_threshold: '2' },
  { name: 'test item', price: '', stock_qty: '3' },
]
const imp = await one(ADMIN, `select public.import_products($1::jsonb, 'set') as r`, [JSON.stringify(rows)])
check('import: 1 inserted, 2 updated', imp[0].r.inserted === 1 && imp[0].r.updated === 2, JSON.stringify(imp))
const after = await one(ADMIN, `select sku, name, price, stock_qty from public.products where sku in ('APP-001','NEW-1') or lower(name)='test item' order by name`)
check('import values applied (rounded price, set mode, name match)', JSON.stringify(after) === JSON.stringify([
  { sku: 'NEW-1', name: 'Brand New Thing', price: 1235, stock_qty: 7 },
  { sku: 'APP-001', name: 'Cotton Kurta - Men', price: 2600, stock_qty: 50 },
  { sku: null, name: 'test item', price: 100, stock_qty: 3 }]), JSON.stringify(after))
await one(ADMIN, `select public.import_products($1::jsonb, 'add')`, [JSON.stringify([{ name: 'x', sku: 'APP-001', stock_qty: '5' }])])
check('import add mode -> 55', (await one(ADMIN, `select stock_qty from public.products where sku='APP-001'`))[0].stock_qty === 55)
await expectErr('import is atomic on bad row', /ROW_INVALID: row 2/, () => as(db, ADMIN, `select public.import_products($1::jsonb)`, [JSON.stringify([{ name: 'ok', sku: 'Z1', price: 1 }, { name: 'bad', sku: 'Z2', price: 'abc' }])]))
check('atomic: Z1 not inserted', (await one(ADMIN, `select 1 from public.products where sku='Z1'`)).length === 0)
await expectErr('cashier cannot import', /NOT_AUTHORIZED/, () => as(db, CASHIER, `select public.import_products('[]'::jsonb)`))

console.log('audit + staff')
const al = await one(ADMIN, `select action, actor_name, details from public.audit_log order by id`)
check('audit has product.update by Ayesha + product.import', al.some(x => x.action === 'product.update' && x.actor_name === 'Ayesha Admin') && al.some(x => x.action === 'product.import'), JSON.stringify(al.map(a => a.action)))
await expectErr('cannot demote last admin', /LAST_ADMIN/, () => as(db, ADMIN, `update public.profiles set role='cashier' where id = $1`, [ADMIN]))
await expectOk('admin promotes cashier', () => as(db, ADMIN, `update public.profiles set role='admin' where id = $1`, [CASHIER]))
await expectOk('then can demote self', () => as(db, ADMIN, `update public.profiles set role='cashier' where id = $1`, [ADMIN]))
await expectErr('inactive user cannot read products', /./, async () => {
  await as(db, CASHIER, `update public.profiles set active=false where id = $1`, [ADMIN])
  const r = await as(db, ADMIN, 'select * from public.products'); if (r.rows.length === 0) throw new Error('0 rows (blocked)')
})
const own = await one(ADMIN, `select active from public.profiles where id = $1`, [ADMIN])
check('inactive user still reads own profile', own.length === 1 && own[0].active === false)
await expectErr('nobody can write audit log directly', /permission denied/, () => as(db, CASHIER, `insert into public.audit_log (action, entity) values ('x','y')`))
const pub = (await db.query(`select tablename from pg_publication_tables where pubname='supabase_realtime' order by 1`)).rows.map(r => r.tablename).join()
check('realtime publication has products, sales', pub === 'products,sales', pub)
summary()
