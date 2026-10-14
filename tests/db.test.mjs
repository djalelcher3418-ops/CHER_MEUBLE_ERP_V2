import { PGlite } from '@electric-sql/pglite'
import fs from 'node:fs'
// اختبار قاعدة البيانات: يشغّل كل ملفات supabase/*.sql على Postgres داخل Node (PGlite)
// ثم يتحقق من الأرقام والصلاحيات. التشغيل: npm run test:db
import { fileURLToPath } from 'node:url'
const R = process.argv[2] ?? fileURLToPath(new URL('..', import.meta.url))
const db = new PGlite()
const q = async (sql, params) => (await db.query(sql, params)).rows
let passed = 0, failed = 0
const ok = (c, m) => { if (!c) { console.error('FAIL', m); failed++; process.exitCode = 1 } else { passed++; console.log('ok  ', m) } }

// --- Supabase-like stubs
await db.exec(`
create role anon nologin; create role authenticated nologin;
create schema auth;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb, raw_app_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema public, auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean);
create table storage.objects (id bigint generated always as identity, bucket_id text, name text, owner uuid default auth.uid());
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
grant usage on schema storage to anon, authenticated;
grant all on storage.objects to anon, authenticated;
grant execute on function storage.foldername(text) to anon, authenticated;
create publication supabase_realtime;
`)
await db.exec(fs.readFileSync(R + '/supabase/001_phase1.sql', 'utf8'))
await db.exec(fs.readFileSync(R + '/supabase/002_phase2.sql', 'utf8'))
await db.exec(fs.readFileSync(R + '/supabase/003_phase3.sql', 'utf8'))
console.log('ok   all three migrations ran')
const P4 = fs.readFileSync(R + '/supabase/004_phase4.sql', 'utf8')

const ADMIN = '00000000-0000-0000-0000-00000000000a', WORKER = '00000000-0000-0000-0000-00000000000b'
await db.exec(`insert into auth.users values ('${ADMIN}','boss@x.dz','{"full_name":"المدير"}'), ('${WORKER}','w@x.dz','{"full_name":"عامل"}')`)
const as = async (uid) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid}', false); set role authenticated;`) }

// --- admin setup
await as(ADMIN)
await q(`insert into materials (name, unit) values ('MDF 18', 'sheet')`)
await q(`insert into suppliers (name) values ('مورد')`)
await q(`insert into purchases (supplier_id) values (1)`)
await q(`insert into purchase_items (purchase_id, material_id, qty, unit_price) values (1, 1, 10, 5000)`)
await q(`insert into customers (name, opening_balance) values ('زبون', 1000)`)
await q(`insert into orders (customer_id, title, discount, due_date) values (1, 'غرفة نوم', 2000, current_date - 1)`)
await q(`insert into order_items (order_id, description, qty, unit_price) values (1, 'سرير', 1, 60000), (1, 'خزانة', 2, 30000)`)
await q(`insert into customer_payments (customer_id, order_id, amount) values (1, 1, 50000)`)
let [t] = await q(`select * from order_totals where id = 1`)
ok(Number(t.total) === 118000 && Number(t.paid) === 50000 && t.status === 'new', `order total 118000, paid 50000, status new (got ${t.total}, ${t.paid}, ${t.status})`)
let [b] = await q(`select balance from customer_balances where id = 1`)
ok(Number(b.balance) === 69000, `customer balance 1000 + 118000 - 50000 = 69000 (got ${b.balance})`)

// --- worker
await as(WORKER)
let pub = await q(`select * from orders_public`)
ok(pub.length === 1 && pub[0].total === undefined, 'worker sees the active order without amounts')
ok((await q(`select * from order_totals`)).length === 0, 'worker sees no rows in order_totals')
ok((await q(`select * from customer_balances`)).length === 0, 'worker sees no customer balances')
let denied = false; try { await q(`select * from customers`); denied = (await q(`select * from customers`)).length === 0 } catch { denied = true }
ok(denied, 'worker cannot read customers')
await q(`insert into stock_movements (material_id, type, qty, order_id, created_by) values (1, 'out', 3, 1, '${WORKER}')`)
console.log('ok   worker took 3 sheets for order 1')
let blocked = false; try { await q(`insert into customer_payments (customer_id, amount) values (1, 10)`) } catch { blocked = true }
ok(blocked, 'worker cannot record a customer payment')

// --- back to admin
await as(ADMIN)
;[t] = await q(`select * from order_totals where id = 1`)
ok(t.status === 'in_production', `first material out moved order to in_production (got ${t.status})`)
ok(Number(t.material_cost) === 15000, `material cost 3 x 5000 = 15000 (got ${t.material_cost})`)
let [m] = await q(`select qty from materials where id = 1`)
ok(Number(m.qty) === 7, `stock went 10 -> 7 (got ${m.qty})`)
await q(`update orders set status = 'delivered' where id = 1`)
let [o] = await q(`select delivered_on is not null as d from orders where id = 1`)
ok(o.d, 'delivered_on set on delivery')
await q(`update orders set status = 'ready' where id = 1`)
;[o] = await q(`select delivered_on is null as d from orders where id = 1`)
ok(o.d, 'delivered_on cleared when status leaves delivered')
await q(`update orders set status = 'cancelled' where id = 1`)
;[b] = await q(`select balance from customer_balances where id = 1`)
ok(Number(b.balance) === 1000 - 50000, `cancelled order excluded from balance (got ${b.balance})`)
// edit order lines: delete + reinsert
await q(`delete from order_items where order_id = 1`)
await q(`insert into order_items (order_id, description, qty, unit_price) values (1, 'سرير', 1, 70000)`)
;[t] = await q(`select total from order_totals where id = 1`)
ok(Number(t.total) === 68000, `lines replaced, total 70000 - 2000 = 68000 (got ${t.total})`)

// --- phase 3
await as(ADMIN)
await q(`insert into employees (full_name, daily_wage, profile_id) values ('عامل مربوط', 2000, '${WORKER}'), ('عامل بدون حساب', 1800, null)`)
await q(`insert into absences (employee_id, day) values (1, '2026-10-01'), (2, '2026-10-01')`)
await q(`insert into absences (employee_id, day, half_day) values (1, '2026-10-02', true)`)
let dup = false; try { await q(`insert into absences (employee_id, day) values (1, '2026-10-01')`) } catch { dup = true }
ok(dup, 'same absence day cannot be recorded twice')
await q(`insert into employee_advances (employee_id, amount, given_on) values (1, 5000, '2026-10-03'), (2, 3000, '2026-10-03')`)
await q(`insert into payroll_payments (employee_id, period_start, period_end, days_worked, daily_wage, gross, advances, amount) values (1, '2026-09-15', '2026-10-14', 28.5, 2000, 57000, 5000, 52000)`)
let dupPay = false; try { await q(`insert into payroll_payments (employee_id, period_start, period_end, days_worked, daily_wage, gross, amount) values (1, '2026-09-15', '2026-10-14', 1, 1, 1, 1)`) } catch { dupPay = true }
ok(dupPay, 'a period cannot be paid twice')
await q(`insert into expenses (category_id, amount) values (1, 30000)`)
ok((await q(`select * from expense_categories`)).length === 7, 'seven expense categories seeded')

await as(WORKER)
let emps = await q(`select * from employees`)
ok(emps.length === 1 && emps[0].full_name === 'عامل مربوط', 'worker sees only their own employee card')
ok((await q(`select * from absences`)).length === 2, 'worker sees only their own absences')
ok((await q(`select * from employee_advances`)).length === 1, 'worker sees only their own advances')
ok((await q(`select * from payroll_payments`)).length === 1, 'worker sees their own payroll payment')
ok((await q(`select * from expenses`)).length === 0, 'worker sees no expenses')
let wBlocked = false; try { await q(`insert into absences (employee_id, day) values (1, '2026-10-05')`) } catch { wBlocked = true }
ok(wBlocked, 'worker cannot record absences')
let wAdv = false; try { await q(`insert into employee_advances (employee_id, amount) values (1, 100000)`) } catch { wAdv = true }
ok(wAdv, 'worker cannot give themselves an advance')
await q(`update employees set daily_wage = 99999 where id = 1`)
await as(ADMIN)
let [e1] = await q(`select daily_wage from employees where id = 1`)
ok(Number(e1.daily_wage) === 2000, `worker cannot change their wage (still ${e1.daily_wage})`)
await q(`update employees set active = false where id = 1`)
await as(WORKER)
ok((await q(`select * from absences`)).length === 0, 'stopped worker no longer sees absences')

// --- phase 4 (run on a database that already has data)
await db.exec('reset role')
await db.exec(P4)
console.log('ok   phase 4 migration ran on existing data')
await as(ADMIN)
ok((await q(`select * from order_events where order_id = 1`)).length === 1, 'existing order got one backfilled history row')
await q(`insert into orders (customer_id, title) values (1, 'مطبخ')`)
await q(`insert into order_items (order_id, description, qty, unit_price) values (2, 'خزائن علوية', 4, 25000)`)
await q(`update employees set active = true where id = 1`)
await as(WORKER)
let items = await q(`select * from order_items_public where order_id = 2`)
ok(items.length === 1 && items[0].unit_price === undefined, 'worker sees order lines without prices')
let pub2 = await q(`select notes from orders_public where id = 2`)
ok(pub2.length === 1, 'worker sees the new order on the board')
await q(`select workshop_set_status(2, 'in_production')`)
await q(`select workshop_set_status(2, 'ready')`)
let skip = false; try { await q(`select workshop_set_status(2, 'delivered')`) } catch { skip = true }
ok(skip, 'worker cannot mark an order delivered')
let back = false; try { await q(`select workshop_set_status(2, 'new')`) } catch { back = true }
ok(back, 'worker cannot move an order backwards')
ok((await q(`select * from order_events`)).length === 0, 'worker cannot read the status history')
ok((await q(`select * from orders_public where id = 2`)).length === 0, 'ready order leaves the workshop board')
await as(ADMIN)
let evs = await q(`select status, created_by from order_events where order_id = 2 order by id`)
ok(evs.map(e => e.status).join(',') === 'new,in_production,ready', `history: ${evs.map(e => e.status).join(',')}`)
ok(evs[0].created_by === ADMIN && evs[2].created_by === WORKER, 'history records who made each change')
await q(`update orders set status = 'delivered' where id = 2`)
ok((await q(`select * from order_events where order_id = 2`)).length === 4, 'admin change is logged too')
await q(`update orders set notes = 'تعديل' where id = 2`)
ok((await q(`select * from order_events where order_id = 2`)).length === 4, 'editing other fields adds no history row')

// --- phase 5: messages
await db.exec('reset role')
await db.exec(fs.readFileSync(R + '/supabase/005_messages.sql', 'utf8'))
console.log('ok   messages migration ran on existing data')
const W2 = '00000000-0000-0000-0000-00000000000c'
await db.exec(`insert into auth.users values ('${W2}','w2@x.dz','{"full_name":"عامل 2"}')`)
let chats = await q(`select kind, worker_id from chats order by id`)
ok(chats.length === 3 && chats[0].kind === 'team', `team chat + one chat per worker, incl. the new worker (${chats.length})`)
const chatOf = async (uid) => (await q(`select id from chats where worker_id = '${uid}'`))[0].id
const C1 = await chatOf(WORKER), C2 = await chatOf(W2), TEAM = 1

await as(ADMIN)
await q(`insert into messages (chat_id, body) values (${TEAM}, 'صباح الخير للجميع'), (${C1}, 'رسالة خاصة للعامل 1'), (${C2}, 'رسالة خاصة للعامل 2')`)
let spoof = await q(`insert into messages (chat_id, body, sender_id, sender_name) values (${TEAM}, 'x', '${WORKER}', 'مزيف') returning sender_id, sender_name`)
ok(spoof[0].sender_id === ADMIN && spoof[0].sender_name === 'المدير', 'sender is always the real account')
await q(`delete from messages where body = 'x'`)

await as(WORKER)
let ov = await q(`select * from chat_overview()`)
ok(ov.length === 2 && ov[0].title === 'كل الفريق' && ov[1].title === 'الإدارة', `worker sees team + own chat (${ov.map(o => o.title)})`)
ok(ov[0].unread === 1 && ov[1].unread === 1, 'worker has one unread in each')
ok((await q(`select * from messages where chat_id = ${C2}`)).length === 0, "worker cannot read another worker's private chat")
let intrude = false; try { await q(`insert into messages (chat_id, body) values (${C2}, 'تطفل')`) } catch { intrude = true }
ok(intrude, "worker cannot post in another worker's private chat")
await q(`insert into messages (chat_id, body) values (${C1}, 'تم يا معلم')`)
await q(`select mark_chat_read(${C1})`)
await q(`select mark_chat_read(${C1})`)
ov = await q(`select * from chat_overview()`)
ok(ov.find(o => o.chat_id == C1).unread === 0 && ov.find(o => o.chat_id == C1).last_text === 'تم يا معلم', 'reading clears unread; own message is last')
let empty = false; try { await q(`insert into messages (chat_id, body) values (${TEAM}, '   ')`) } catch { empty = true }
ok(empty, 'empty message is rejected')
await q(`insert into messages (chat_id, image_path) values (${TEAM}, '${TEAM}/a.jpg')`)
let otherDel = await q(`delete from messages where body = 'صباح الخير للجميع' returning id`)
ok(otherDel.length === 0, "worker cannot delete the manager's message")
await q(`insert into storage.objects (bucket_id, name) values ('chat', '${C1}/p.jpg')`)
let badUp = false; try { await q(`insert into storage.objects (bucket_id, name) values ('chat', '${C2}/p.jpg')`) } catch { badUp = true }
ok(badUp, "worker cannot upload a photo into another worker's chat")
let weird = false; try { await q(`insert into storage.objects (bucket_id, name) values ('chat', 'abc/p.jpg')`) } catch { weird = true }
ok(weird, 'non-numeric folder is refused without an error crash')
ok((await q(`select * from storage.objects`)).length === 1, 'worker sees only photos of their chats')

await as(ADMIN)
ov = await q(`select * from chat_overview()`)
ok(ov.length === 3 && ov[0].title === 'كل الفريق' && ov.some(o => o.title === 'عامل 2'), `admin sees all chats (${ov.map(o => o.title)})`)
ok(ov.find(o => o.chat_id == TEAM).last_text === '📷 صورة', 'photo-only message shows as photo')
let reads = await q(`select * from chat_reads where chat_id = ${C1}`)
ok(reads.length === 1 && reads[0].profile_id === WORKER, 'admin can see that the worker read the chat')
await q(`update profiles set active = false where id = '${W2}'`)
ov = await q(`select * from chat_overview()`)
ok(!ov.some(o => o.title === 'عامل 2'), "stopped worker's chat is hidden")
await as(W2)
ok((await q(`select * from messages`)).length === 0, 'stopped worker reads nothing')

// --- phase 6: push subscriptions
await db.exec('reset role')
await db.exec(fs.readFileSync(R + '/supabase/006_push.sql', 'utf8'))
console.log('ok   push migration ran')
await db.exec(`update profiles set active = true where id = '${W2}'`)
await as(WORKER)
await q(`select save_push_subscription('https://push.example/abc', 'p1', 'a1', 'Android')`)
await q(`select save_push_subscription('https://push.example/abc', 'p2', 'a2', 'Android')`)
let mine = await q(`select * from push_subscriptions`)
ok(mine.length === 1 && mine[0].p256dh === 'p2', 'same phone saved twice keeps one updated row')
let direct = false; try { await q(`insert into push_subscriptions (endpoint, p256dh, auth) values ('x','y','z')`) } catch { direct = true }
ok(direct, 'subscriptions can only be saved through the function')
let cfg = false; try { await q(`select * from push_config`) } catch { cfg = true }
ok(cfg, 'users cannot read the VAPID keys')
await as(W2)
ok((await q(`select * from push_subscriptions`)).length === 0, "a user cannot see another user's subscriptions")
ok((await q(`delete from push_subscriptions returning id`)).length === 0, "a user cannot delete another user's subscriptions")
await q(`select save_push_subscription('https://push.example/abc', 'p3', 'a3', null)`)
ok((await q(`select * from push_subscriptions`)).length === 1, 'a shared phone moves to whoever signs in')
await as(WORKER)
ok((await q(`select * from push_subscriptions`)).length === 0, 'previous user no longer gets that phone')
await as(W2)
ok((await q(`delete from push_subscriptions returning id`)).length === 1, 'sign-out removes own subscription')
await db.exec(`reset role; update profiles set active = false where id = '${W2}'`)
await as(W2)
let inactive = false; try { await q(`select save_push_subscription('https://push.example/zz', 'p', 'a', null)`) } catch { inactive = true }
ok(inactive, 'stopped account cannot register a phone')

// --- phase 7: accounts
await db.exec('reset role')
await db.exec(fs.readFileSync(R + '/supabase/007_accounts.sql', 'utf8'))
console.log('ok   accounts migration ran')
const W3 = '00000000-0000-0000-0000-00000000000d'
await db.exec(`insert into auth.users values ('${W3}','0777000000@cher-meuble.app','{"full_name":"مدير ثان"}')`)
ok((await q(`select * from chats where worker_id = '${W3}'`)).length === 1, 'new account starts as worker with a private chat')
await db.exec(`update profiles set role = 'admin', phone = '0777000000' where id = '${W3}'`)
ok((await q(`select * from chats where worker_id = '${W3}'`)).length === 0, 'promoting to manager removes the empty private chat')
await db.exec(`update profiles set role = 'worker' where id = '${W3}'`)
ok((await q(`select * from chats where worker_id = '${W3}'`)).length === 1, 'demoting back to worker recreates it')
let dupPhone = false; try { await db.exec(`update profiles set phone = '0777000000' where id = '${WORKER}'`) } catch { dupPhone = true }
ok(dupPhone, 'two accounts cannot share a phone number')
await as(ADMIN)
let ovA = await q(`select * from chat_overview()`)
ok(ovA.some((o) => o.title === 'مدير ثان'), 'worker chat listed for the manager')

// --- version
await db.exec('reset role')
await db.exec(fs.readFileSync(R + '/supabase/008_version.sql', 'utf8'))
await as(WORKER)
ok((await q(`select erp_schema_version() as v`))[0].v === 8, 'schema version is 8')

// --- phase 9: hardening
await db.exec('reset role')
await db.exec(fs.readFileSync(R + '/supabase/009_hardening.sql', 'utf8'))
await as(WORKER)
ok((await q(`select erp_schema_version() as v`))[0].v === 9, 'schema version is 9')
await db.exec('reset role')
const STRANGER = '00000000-0000-0000-0000-0000000000e1', INVITED = '00000000-0000-0000-0000-0000000000e2'
await db.exec(`insert into auth.users (id, email, raw_user_meta_data) values ('${STRANGER}', 'x@evil.com', '{"full_name":"غريب"}')`)
await db.exec(`insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values ('${INVITED}', '0550000000@cher-meuble.app', '{"full_name":"مدعو"}', '{"created_by_admin":true}')`)
let sp = await q(`select id, role, active from profiles where id in ('${STRANGER}', '${INVITED}') order by id`)
ok(sp[0].active === false && sp[0].role === 'worker', 'an open sign-up stays inactive')
ok(sp[1].active === true, 'an account created by the manager is active')
await as(STRANGER)
ok((await q(`select * from materials_public`)).length === 0 && (await q(`select * from orders_public`)).length === 0, 'inactive sign-up sees no materials and no orders')
let strangerOut = false; try { await q(`insert into stock_movements (material_id, type, qty, created_by) values (1, 'out', 1, '${STRANGER}')`) } catch { strangerOut = true }
ok(strangerOut, 'inactive sign-up cannot take material out')
let strangerChat = false; try { await q(`insert into messages (chat_id, body) values (1, 'spam')`) } catch { strangerChat = true }
ok(strangerChat, 'inactive sign-up cannot post in the team chat')

await as(ADMIN)
await q(`insert into orders (customer_id, title) values (1, 'خزانة مفتوحة')`)
const OPEN = (await q(`select id from orders where title = 'خزانة مفتوحة'`))[0].id
await as(WORKER)
await q(`insert into stock_movements (material_id, type, qty, unit_cost, order_id, created_by) values (1, 'out', 1, 999999, ${OPEN}, '${WORKER}')`)
let mv = (await q(`select unit_cost from stock_movements where order_id = ${OPEN}`))[0]
ok(Number(mv.unit_cost) === 5000, `a fake cost from the app is replaced by the real average cost (${mv.unit_cost})`)
let tooMuch = null; try { await q(`insert into stock_movements (material_id, type, qty, created_by) values (1, 'out', 500, '${WORKER}')`) } catch (e) { tooMuch = e.message }
ok(tooMuch?.includes('الكمية غير كافية'), `worker cannot take more than the stock: ${tooMuch}`)
let closed = false; try { await q(`insert into stock_movements (material_id, type, qty, order_id, created_by) values (1, 'out', 1, 2, '${WORKER}')`) } catch { closed = true }
ok(closed, 'worker cannot book material against a delivered order')
await as(ADMIN)
await q(`insert into stock_movements (material_id, type, qty) values (1, 'out', 500)`)
ok(Number((await q(`select qty from materials where id = 1`))[0].qty) < 0, 'the manager can still go below zero when needed')
await q(`insert into stock_movements (material_id, type, qty, unit_cost) values (1, 'adjust', 600, 5000)`)

// save_order: atomic
let newId = (await q(`select save_order(null, '{"customer_id":1,"title":"طاولة","order_date":"2026-10-01","discount":1000}', '[{"description":"طاولة","qty":1,"unit_price":20000},{"description":"كراسي","qty":4,"unit_price":3000}]') as id`))[0].id
let so = (await q(`select total from order_totals where id = ${newId}`))[0]
ok(Number(so.total) === 31000, `save_order creates the order and lines together (total ${so.total})`)
let bigDisc = null; try { await q(`select save_order(null, '{"customer_id":1,"title":"x","order_date":"2026-10-01","discount":99999}', '[{"description":"a","qty":1,"unit_price":10}]')`) } catch (e) { bigDisc = e.message }
ok(bigDisc?.includes('التخفيض أكبر'), 'a discount bigger than the lines is refused')
ok((await q(`select * from orders where title = 'x'`)).length === 0, 'nothing is saved when it is refused')
let badLine = false; try { await q(`select save_order(${newId}, '{"customer_id":1,"title":"طاولة","order_date":"2026-10-01","discount":0}', '[{"description":"سطر خاطئ","qty":0,"unit_price":5}]')`) } catch { badLine = true }
let kept = await q(`select count(*)::int n from order_items where order_id = ${newId}`)
ok(badLine && kept[0].n === 2, 'a failed edit keeps the old lines (no order left empty)')
await q(`select save_order(${newId}, '{"customer_id":1,"title":"طاولة كبيرة","order_date":"2026-10-01","discount":0}', '[{"description":"طاولة","qty":1,"unit_price":25000}]')`)
so = (await q(`select title, total from order_totals where id = ${newId}`))[0]
ok(so.title === 'طاولة كبيرة' && Number(so.total) === 25000, 'a valid edit replaces the lines')
await as(WORKER)
let workerSave = false; try { await q(`select save_order(null, '{"customer_id":1,"title":"w","order_date":"2026-10-01"}', '[{"description":"a","qty":1,"unit_price":1}]')`) } catch { workerSave = true }
ok(workerSave, 'a worker cannot create orders through save_order')

// month_summary
await as(ADMIN)
const ms = (await q(`select month_summary(date_trunc('month', current_date)::date, (date_trunc('month', current_date) + interval '1 month - 1 day')::date) as s`))[0].s
ok(Number(ms.expenses) === 30000 && ms.expenses_by_category.length === 1, `month summary adds up expenses by category (${ms.expenses})`)
ok(Number(ms.materials_out) > 0 && Number(ms.received) === 50000, `month summary includes material out and payments (${ms.materials_out}, ${ms.received})`)
await as(WORKER)
const wms = (await q(`select month_summary(current_date - 31, current_date) as s`))[0].s
ok(Number(wms.expenses) === 0 && Number(wms.received) === 0, 'a worker gets zeros from the month summary')

// photo deletion
await as(WORKER)
await q(`insert into storage.objects (bucket_id, name) values ('chat', '1/team-by-worker.jpg')`)
ok((await q(`delete from storage.objects where name = '${C1}/p.jpg' returning id`)).length === 1, 'a worker can delete their own photo')
await as(ADMIN)
await q(`insert into storage.objects (bucket_id, name) values ('chat', '1/team-by-admin.jpg')`)
await as(WORKER)
ok((await q(`delete from storage.objects where name = '1/team-by-admin.jpg' returning id`)).length === 0, "a worker cannot delete the manager's photo")
await as(ADMIN)
ok((await q(`delete from storage.objects where name = '1/team-by-worker.jpg' returning id`)).length === 1, "the manager can delete a worker's photo")

// --- anon
await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false); set role anon;`)
let anonBlocked = false; try { await q(`select * from orders_public`) } catch { anonBlocked = true }
ok(anonBlocked, 'anonymous visitor cannot read orders_public')
let anonRpc = false; try { await q(`select workshop_set_status(2, 'ready')`) } catch { anonRpc = true }
ok(anonRpc, 'anonymous visitor cannot call the workshop function')
let anonVer = false; try { await q(`select erp_schema_version()`) } catch { anonVer = true }
ok(anonVer, 'anonymous visitor cannot call the version function')
console.log(`\n${passed} passed, ${failed} failed`)
