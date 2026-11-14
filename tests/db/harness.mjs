import { PGlite } from '@electric-sql/pglite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../supabase')
export const ADMIN = '00000000-0000-0000-0000-00000000000a'
export const CASHIER = '00000000-0000-0000-0000-00000000000c'
export const CASHIER2 = '00000000-0000-0000-0000-00000000000d'

export async function setup({ seed = true } = {}) {
  const db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    create schema auth;
    create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
    create publication supabase_realtime;
  `)
  const files = fs.readdirSync(path.join(REPO, 'migrations')).sort()
  for (const f of files) {
    try { await db.exec(fs.readFileSync(path.join(REPO, 'migrations', f), 'utf8')) }
    catch (e) { console.error('MIGRATION FAILED', f, e.message, e.position ?? ''); process.exit(1) }
  }
  if (seed) await db.exec(fs.readFileSync(path.join(REPO, 'seed.sql'), 'utf8'))
  await db.exec(`
    insert into auth.users (id, email, raw_user_meta_data) values
      ('${ADMIN}', 'admin@test.pk', '{"full_name":"Ayesha Admin"}'),
      ('${CASHIER}', 'cash@test.pk', '{"full_name":"Bilal Cashier"}'),
      ('${CASHIER2}', 'cash2@test.pk', '{}');
    update public.profiles set role = 'admin' where id = '${ADMIN}';
  `)
  return db
}

export async function as(db, uid, sql, params) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role ${uid ? 'authenticated' : 'anon'};`)
  try { return await db.query(sql, params) } finally { await db.exec('reset role') }
}

let pass = 0, fail = 0
export async function expectOk(name, fn) {
  try { const r = await fn(); pass++; console.log('  ok  ', name); return r }
  catch (e) { fail++; console.log('  FAIL', name, '->', e.message) }
}
export async function expectErr(name, re, fn) {
  try { await fn(); fail++; console.log('  FAIL', name, '-> expected error', re) }
  catch (e) {
    if (re.test(e.message)) { pass++; console.log('  ok  ', name, `(${e.message.slice(0, 70)})`) }
    else { fail++; console.log('  FAIL', name, '-> wrong error:', e.message) }
  }
}
export function check(name, cond, info) {
  if (cond) { pass++; console.log('  ok  ', name) } else { fail++; console.log('  FAIL', name, info ?? '') }
}
export function summary() { console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exitCode = 1 }
