import { setup, as, expectErr, check, summary, ADMIN, CASHIER, CASHIER2 } from './harness.mjs'

const db = await setup()
const one = async (uid, sql, p) => (await as(db, uid, sql, p)).rows
const mug = (await db.query(`select id from public.products where sku = 'HOM-003'`)).rows[0]
const sale = (await one(CASHIER, `select public.create_sale($1::jsonb) as s`, [JSON.stringify({
  id: crypto.randomUUID(), payment_method: 'card', items: [{ product_id: mug.id, qty: 1, unit_price: 550 }],
})]))[0].s

console.log('print stations')
const st = (await one(ADMIN, `insert into public.print_stations (name, device_id) values ('Counter', 'LAP1') returning *`))[0]
check('staff can register a station', Boolean(st.id))
await expectErr('station names are unique', /duplicate|unique/, () => as(db, CASHIER, `insert into public.print_stations (name) values ('Counter')`))
await expectErr('anon cannot see stations', /permission denied/, () => as(db, null, `select * from public.print_stations`))

const job = (await one(CASHIER, `insert into public.print_jobs (station_id, sale_id, requested_by_name, requested_device)
  values ($1, $2, 'Bilal', 'PHN1') returning *`, [st.id, sale.id]))[0]
check('cashier queues a job (requested_by = self, status queued)', job.requested_by === CASHIER && job.status === 'queued')
await expectErr('cannot queue a job in someone else\'s name', /row-level security|permission/, () =>
  as(db, CASHIER2, `insert into public.print_jobs (station_id, sale_id, requested_by) values ($1, $2, $3)`, [st.id, sale.id, CASHIER]))

// two station windows racing for the same job: only one claim succeeds
const c1 = await one(ADMIN, `update public.print_jobs set status = 'printing' where id = $1 and status = 'queued' returning id`, [job.id])
const c2 = await one(CASHIER, `update public.print_jobs set status = 'printing' where id = $1 and status = 'queued' returning id`, [job.id])
check('only one station claims the job', c1.length === 1 && c2.length === 0)
await one(ADMIN, `update public.print_jobs set status = 'printed', printed_at = now() where id = $1`, [job.id])
check('job marked printed', (await one(CASHIER, `select status from public.print_jobs where id = $1`, [job.id]))[0].status === 'printed')
await expectErr('cannot rewrite which sale a job prints', /permission denied/, () =>
  as(db, CASHIER, `update public.print_jobs set sale_id = $2 where id = $1`, [job.id, sale.id]))
await expectErr('cashier cannot delete a station', /./, async () => {
  const r = await as(db, CASHIER, `delete from public.print_stations where id = $1 returning id`, [st.id])
  if (!r.rows.length) throw new Error('0 rows (blocked)')
})
const pub = (await db.query(`select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='print_jobs'`)).rows
check('print_jobs is in the realtime publication', pub.length === 1)
summary()
