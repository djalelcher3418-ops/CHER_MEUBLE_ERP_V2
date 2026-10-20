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

// --- phase 10: order photos + tracking link
await db.exec('reset role')
await db.exec(fs.readFileSync(R + '/supabase/010_photos_tracking.sql', 'utf8'))
console.log('ok   photos and tracking migration ran on existing data')
await as(ADMIN)
ok((await q(`select erp_schema_version() as v`))[0].v === 10, 'schema version is 10')
ok((await q(`select count(*)::int n from orders where track_token is null`))[0].n === 0, 'every existing order got a tracking token')
await q(`insert into storage.objects (bucket_id, name) values ('orders', '${OPEN}/design.jpg')`)
await q(`insert into order_photos (order_id, path, caption) values (${OPEN}, '${OPEN}/design.jpg', 'التصميم'), (2, '2/old.jpg', null)`)
await as(WORKER)
let wp = await q(`select order_id from order_photos`)
ok(wp.length === 1 && Number(wp[0].order_id) === OPEN, 'a worker sees photos of open orders only')
ok((await q(`select * from storage.objects where bucket_id = 'orders'`)).length === 1, 'a worker can open the photo file of an open order')
await q(`insert into storage.objects (bucket_id, name) values ('orders', '${OPEN}/done.jpg')`)
await q(`insert into order_photos (order_id, path) values (${OPEN}, '${OPEN}/done.jpg')`)
ok(true, 'a worker can add a photo of the finished piece')
let closedPhoto = false; try { await q(`insert into storage.objects (bucket_id, name) values ('orders', '2/x.jpg')`) } catch { closedPhoto = true }
ok(closedPhoto, 'a worker cannot upload to a delivered order')
ok((await q(`delete from order_photos where path = '${OPEN}/design.jpg' returning id`)).length === 0, "a worker cannot delete the manager's photo")
ok((await q(`delete from order_photos where path = '${OPEN}/done.jpg' returning id`)).length === 1, 'a worker can delete their own photo')
let peek = false; try { await q(`select track_token from orders`) } catch { peek = true }
ok(peek || (await q(`select track_token from orders`)).length === 0, 'a worker cannot read tracking tokens')
await as(STRANGER)
ok((await q(`select * from order_photos`)).length === 0, 'an inactive account sees no photos')

await as(ADMIN)
const token = (await q(`select track_token from orders where id = ${newId}`))[0].track_token
await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false); set role anon;`)
const tr = (await q(`select track_order('${token}') as t`))[0].t
ok(tr && tr.id == newId && tr.title === 'طاولة كبيرة' && Number(tr.total) === 25000 && tr.items.length === 1, `a customer opens the tracking link without an account (${tr?.title}, ${tr?.status})`)
ok(tr.customer === 'زبون' && !('phone' in tr), 'the tracking page shows only the first name, no phone')
ok((await q(`select track_order('00000000-0000-0000-0000-000000000000') as t`))[0].t === null, 'a wrong link shows nothing')
let anonPhotos = false; try { await q(`select * from order_photos`) } catch { anonPhotos = true }
ok(anonPhotos || (await q(`select * from order_photos`)).length === 0, 'a visitor without account sees no photos')

// --- phase 11: quotes
await db.exec('reset role')
await db.exec(fs.readFileSync(R + '/supabase/011_quotes.sql', 'utf8'))
console.log('ok   quotes migration ran on existing data')
await as(ADMIN)
ok((await q(`select erp_schema_version() as v`))[0].v === 11, 'schema version is 11')
const balBefore = Number((await q(`select balance from customer_balances where id = 1`))[0].balance)
const QUOTE = (await q(`select save_order(null, '{"customer_id":1,"title":"مطبخ كامل","order_date":"2026-09-01","is_quote":true}', '[{"description":"خزائن","qty":6,"unit_price":20000}]') as id`))[0].id
let qt = (await q(`select is_quote, total, status from order_totals where id = ${QUOTE}`))[0]
ok(qt.is_quote === true && Number(qt.total) === 120000 && qt.status === 'new', 'a quote is saved with its lines')
ok(Number((await q(`select balance from customer_balances where id = 1`))[0].balance) === balBefore, 'a quote does not count as customer debt')
await q(`select save_order(${QUOTE}, '{"customer_id":1,"title":"مطبخ كامل مع رخام","order_date":"2026-09-01"}', '[{"description":"خزائن","qty":6,"unit_price":22000}]')`)
ok((await q(`select is_quote from orders where id = ${QUOTE}`))[0].is_quote === true, 'editing a quote keeps it a quote')

await as(WORKER)
ok((await q(`select * from orders_public where id = ${QUOTE}`)).length === 0, 'the workshop does not see quotes')
ok((await q(`select * from order_items_public where order_id = ${QUOTE}`)).length === 0, 'workers do not see quote lines')
let qMat = false; try { await q(`insert into stock_movements (material_id, type, qty, order_id, created_by) values (1, 'out', 1, ${QUOTE}, '${WORKER}')`) } catch { qMat = true }
ok(qMat, 'no material can be taken out for a quote')
let qWs = false; try { await q(`select workshop_set_status(${QUOTE}, 'in_production')`) } catch { qWs = true }
ok(qWs, 'a worker cannot start a quote')
let qPh = false; try { await q(`insert into storage.objects (bucket_id, name) values ('orders', '${QUOTE}/x.jpg')`) } catch { qPh = true }
ok(qPh, 'a worker cannot add photos to a quote')

await as(ADMIN)
const qToken = (await q(`select track_token from orders where id = ${QUOTE}`))[0].track_token
await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false); set role anon;`)
const qtr = (await q(`select track_order('${qToken}') as t`))[0].t
ok(qtr.is_quote === true && Number(qtr.total) === 132000, 'the customer sees the quote through the link')
let anonConvert = false; try { await q(`select convert_quote(${QUOTE})`) } catch { anonConvert = true }
ok(anonConvert, 'a visitor cannot accept a quote')

await as(WORKER)
await q(`select convert_quote(${QUOTE})`).catch(() => {})
await as(ADMIN)
ok((await q(`select is_quote from orders where id = ${QUOTE}`))[0].is_quote === true, 'a worker cannot convert a quote')
await q(`select convert_quote(${QUOTE})`)
qt = (await q(`select is_quote, status, order_date from order_totals where id = ${QUOTE}`))[0]
ok(qt.is_quote === false && qt.status === 'new' && String(qt.order_date) !== '2026-09-01', 'converting turns the quote into a new order dated today')
ok(Number((await q(`select balance from customer_balances where id = 1`))[0].balance) === balBefore + 132000, 'after conversion it counts on the customer')
let again = false; try { await q(`select convert_quote(${QUOTE})`) } catch { again = true }
ok(again, 'an order cannot be converted twice')
await as(WORKER)
ok((await q(`select * from orders_public where id = ${QUOTE}`)).length === 1, 'the converted order reaches the workshop')

// --- phase 12: bed size per order line
await db.exec('reset role')
await db.exec(fs.readFileSync(R + '/supabase/012_bed_size.sql', 'utf8'))
console.log('ok   bed size migration ran on existing data')
await as(ADMIN)
ok((await q(`select erp_schema_version() as v`))[0].v === 12, 'schema version is 12')
const BED = (await q(`select save_order(null, '{"customer_id":1,"title":"غرفة أطفال","order_date":"2026-10-15"}', '[{"description":"سرير","size":"90/190","qty":2,"unit_price":30000},{"description":"أريكة","size":"أريكة","qty":1,"unit_price":45000},{"description":"خزانة","size":"","qty":1,"unit_price":40000}]') as id`))[0].id
const sizes = (await q(`select size from order_items where order_id = ${BED} order by id`)).map((r) => r.size)
ok(sizes[0] === '90/190' && sizes[1] === 'أريكة' && sizes[2] === null, `each line keeps its size, empty size is stored as nothing (${sizes})`)
let longSize = false; try { await q(`select save_order(null, '{"customer_id":1,"title":"x","order_date":"2026-10-15"}', '[{"description":"سرير","size":"${'9'.repeat(41)}","qty":1,"unit_price":1}]')`) } catch { longSize = true }
ok(longSize, 'an absurdly long size is refused')
await q(`select save_order(${BED}, '{"customer_id":1,"title":"غرفة أطفال","order_date":"2026-10-15"}', '[{"description":"سرير","size":"120/190","qty":2,"unit_price":32000}]')`)
ok((await q(`select size from order_items where order_id = ${BED}`))[0].size === '120/190', 'editing the order updates the size')
await as(WORKER)
const wl = await q(`select description, size from order_items_public where order_id = ${BED}`)
ok(wl.length === 1 && wl[0].size === '120/190' && wl[0].unit_price === undefined, 'the workshop sees the size, still without prices')
await as(ADMIN)
const bedToken = (await q(`select track_token from orders where id = ${BED}`))[0].track_token
await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false); set role anon;`)
ok((await q(`select track_order('${bedToken}') as t`))[0].t.items[0].size === '120/190', 'the customer page shows the size')

// --- phase 13: fabric and legs per order line
await db.exec('reset role')
await db.exec(fs.readFileSync(R + '/supabase/013_fabric_legs.sql', 'utf8'))
console.log('ok   fabric/legs migration ran on existing data')
await as(ADMIN)
ok((await q(`select erp_schema_version() as v`))[0].v === 13, 'schema version is 13')
ok((await q(`select size from order_items where order_id = ${BED}`))[0].size === '120/190', 'existing sizes survive the migration')
const SOFA = (await q(`select save_order(null, '{"customer_id":1,"title":"صالون","order_date":"2026-10-15"}', '[{"description":"سرير","size":"160/190","fabric":" قطيفة ","legs":"معدن ذهبي","qty":1,"unit_price":60000},{"description":"أريكة","size":"أريكة","fabric":"","legs":"  ","qty":1,"unit_price":45000}]') as id`))[0].id
const fl = await q(`select size, fabric, legs from order_items where order_id = ${SOFA} order by id`)
ok(fl[0].size === '160/190' && fl[0].fabric === 'قطيفة' && fl[0].legs === 'معدن ذهبي', 'each line keeps its size, fabric and legs (trimmed)')
ok(fl[1].fabric === null && fl[1].legs === null, 'empty fabric/legs are stored as nothing')
let longFabric = false; try { await q(`select save_order(null, '{"customer_id":1,"title":"x","order_date":"2026-10-15"}', '[{"description":"سرير","fabric":"${'ق'.repeat(61)}","qty":1,"unit_price":1}]')`) } catch { longFabric = true }
ok(longFabric, 'an absurdly long fabric name is refused')
let longLegs = false; try { await q(`select save_order(null, '{"customer_id":1,"title":"x","order_date":"2026-10-15"}', '[{"description":"سرير","legs":"${'x'.repeat(61)}","qty":1,"unit_price":1}]')`) } catch { longLegs = true }
ok(longLegs, 'an absurdly long legs name is refused')
await q(`select save_order(${SOFA}, '{"customer_id":1,"title":"صالون","order_date":"2026-10-15"}', '[{"description":"سرير","size":"160/190","fabric":"شنيل","legs":"خشب","qty":1,"unit_price":60000}]')`)
const fl2 = await q(`select fabric, legs from order_items where order_id = ${SOFA}`)
ok(fl2.length === 1 && fl2[0].fabric === 'شنيل' && fl2[0].legs === 'خشب', 'editing the order updates fabric and legs')
await as(WORKER)
const wf = await q(`select * from order_items_public where order_id = ${SOFA}`)
ok(wf.length === 1 && wf[0].fabric === 'شنيل' && wf[0].legs === 'خشب' && wf[0].size === '160/190' && wf[0].unit_price === undefined, 'the workshop sees fabric and legs, still without prices')
await as(ADMIN)
const sofaToken = (await q(`select track_token from orders where id = ${SOFA}`))[0].track_token
await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false); set role anon;`)
const ti = (await q(`select track_order('${sofaToken}') as t`))[0].t.items[0]
ok(ti.fabric === 'شنيل' && ti.legs === 'خشب' && ti.size === '160/190' && ti.unit_price === undefined, 'the customer page shows fabric and legs, without unit prices')
await db.exec('reset role')
let old012 = ''; try { await db.exec(fs.readFileSync(R + '/supabase/012_bed_size.sql', 'utf8')) } catch (e) { old012 = e.message }
ok(old012.includes('شُغّل من قبل'), 'running the older 012 again after 013 is refused with a clear message')
await db.exec(fs.readFileSync(R + '/supabase/013_fabric_legs.sql', 'utf8'))
const rerun = await q(`select erp_schema_version() as v, (select fabric from order_items where order_id = ${SOFA}) as f`)
ok(rerun[0].v === 13 && rerun[0].f === 'شنيل', 'running 013 a second time by mistake is harmless')

// --- phase 14: team page (posts, kudos, comments, games)
await db.exec('reset role')
await db.exec(fs.readFileSync(R + '/supabase/014_team_social.sql', 'utf8'))
await db.exec(fs.readFileSync(R + '/supabase/014_team_social.sql', 'utf8'))
console.log('ok   team migration ran (twice, harmlessly)')
let old013 = ''; try { await db.exec(fs.readFileSync(R + '/supabase/013_fabric_legs.sql', 'utf8')) } catch (e) { old013 = e.message }
ok(old013.includes('شُغّل من قبل'), 'running the older 013 again after 014 is refused')
await as(WORKER)
ok((await q(`select erp_schema_version() as v`))[0].v === 14, 'schema version is 14')
const [tp] = await q(`insert into team_posts (body, author_id, author_name) values ('صباح الخير يا جماعة', '${ADMIN}', 'مزوّر') returning *`)
ok(tp.author_id === WORKER && tp.author_name === 'عامل', 'a post is signed with the real author, a forged name is ignored')
let gamePost = false; try { await q(`insert into team_posts (kind, body) values ('game', '🏆 مزيف')`) } catch { gamePost = true }
ok(gamePost, 'nobody can fake a game trophy post')
let selfThanks = false; try { await q(`insert into team_posts (kind, body, kudos_to) values ('kudos', 'شكرًا لي', '${WORKER}')`) } catch (e) { selfThanks = e.message.includes('نفسك') }
ok(selfThanks, 'you cannot thank yourself')
const [kd] = await q(`insert into team_posts (kind, body, kudos_to) values ('kudos', 'ساعدني في تركيب الخزانة', '${INVITED}') returning *`)
ok(kd.kudos_name === 'مدعو', 'thanking a colleague stores their name')
let thankInactive = false; try { await q(`insert into team_posts (kind, body, kudos_to) values ('kudos', 'x', '${STRANGER}')`) } catch { thankInactive = true }
ok(thankInactive, 'you cannot thank an inactive account')
const mates = await q(`select * from team_members()`)
ok(mates.length >= 3 && mates.every((m) => Object.keys(m).join() === 'id,full_name,role') && !mates.some((m) => m.id === STRANGER), 'team members list shows only active names, nothing else')

await as(INVITED)
ok((await q(`select feed_unread() as n`))[0].n === 2, 'a colleague sees 2 new posts')
await q(`insert into team_post_reactions (post_id, emoji) values (${tp.id}, '❤️'), (${tp.id}, '👏'), (${kd.id}, '❤️')`)
let badEmoji = false; try { await q(`insert into team_post_reactions (post_id, emoji) values (${tp.id}, '💩')`) } catch { badEmoji = true }
ok(badEmoji, 'only the four reactions are allowed')
let twice = false; try { await q(`insert into team_post_reactions (post_id, emoji) values (${tp.id}, '❤️')`) } catch { twice = true }
ok(twice, 'the same reaction counts once per person')
await q(`insert into team_post_comments (post_id, body) values (${kd.id}, 'العفو يا خويا 🤝')`)
await q(`select mark_feed_seen()`)
ok((await q(`select feed_unread() as n`))[0].n === 0, 'after opening the feed nothing is new')
const feed = await q(`select * from team_feed(null, 10)`)
const fk = feed.find((p) => p.id === kd.id), fw = feed.find((p) => p.id === tp.id)
ok(feed[0].id === kd.id && fk.comments === 1 && fk.reactions['❤️'] === 1 && fw.reactions['👏'] === 1 && fw.my_reactions.length === 2, 'the feed shows newest first with reaction and comment counts')
ok((await q(`select * from team_feed(${kd.id}, 10)`)).every((p) => p.id < kd.id), 'older posts load page by page')
let delOther = 0; try { delOther = (await db.query(`delete from team_posts where id = ${tp.id}`)).affectedRows } catch { /* */ }
ok(delOther === 0, 'a worker cannot delete a colleague’s post')
await q(`delete from team_post_reactions where post_id = ${tp.id} and emoji = '👏'`)
ok((await q(`select count(*)::int n from team_post_reactions where post_id = ${tp.id}`))[0].n === 1, 'a reaction can be taken back')

// الألعاب
const s1 = (await q(`select submit_game_score('memory', 700) as r`))[0].r
ok(s1.top === true && s1.best === 700, 'first score of the week is the top')
ok((await q(`select count(*)::int n from team_posts where kind = 'game'`))[0].n === 1, 'a trophy post appears for the new weekly top')
await as(WORKER)
const s2 = (await q(`select submit_game_score('memory', 650) as r`))[0].r
ok(s2.top === false, 'a lower score does not take the top')
await q(`select submit_game_score('memory', 820)`)
await q(`select submit_game_score('memory', 100)`)
const lb = await q(`select * from game_leaderboard('memory')`)
ok(lb.length === 2 && lb[0].player_name === 'عامل' && lb[0].best === 820 && lb[0].plays === 3 && lb[1].best === 700, 'the weekly leaderboard keeps each player’s best score')
ok((await q(`select count(*)::int n from team_posts where kind = 'game'`))[0].n === 2, 'beating the top posts a new trophy')
let cheat = false; try { await q(`select submit_game_score('memory', 5000)`) } catch { cheat = true }
ok(cheat, 'an impossible score is refused')
let directScore = false; try { await q(`insert into game_scores (profile_id, game, score) values ('${WORKER}', 'math', 999)`) } catch { directScore = true }
ok(directScore, 'scores can only be saved through the game')
ok((await q(`select * from game_leaderboard('math')`)).length === 0, 'each game has its own leaderboard')
await as(ADMIN)
ok((await db.query(`delete from team_posts where id = ${tp.id}`)).affectedRows === 1, 'the manager can remove any post')
ok((await q(`select count(*)::int n from team_post_reactions where post_id = ${tp.id}`))[0].n === 0, 'its reactions go with it')

await as(STRANGER)
ok((await q(`select * from team_feed()`)).length === 0 && (await q(`select * from team_members()`)).length === 0, 'an inactive account sees no posts and no names')
let strangerPost = false; try { await q(`insert into team_posts (body) values ('سبام')`) } catch { strangerPost = true }
ok(strangerPost, 'an inactive account cannot post')
let strangerGame = false; try { await q(`select submit_game_score('math', 10)`) } catch { strangerGame = true }
ok(strangerGame, 'an inactive account cannot play for the leaderboard')
await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false); set role anon;`)
let anonFeed = false; try { await q(`select * from team_feed()`) } catch { anonFeed = true }
ok(anonFeed, 'anonymous visitor cannot read the team feed')
await db.exec('reset role')
await db.exec(`insert into storage.objects (bucket_id, name) values ('team', '${WORKER}/a.jpg')`)
await as(INVITED)
ok((await q(`select * from storage.objects where bucket_id = 'team'`)).length === 1, 'colleagues can see team photos')
let foreignUpload = false; try { await q(`insert into storage.objects (bucket_id, name) values ('team', '${WORKER}/b.jpg')`) } catch { foreignUpload = true }
ok(foreignUpload, 'nobody can upload into a colleague’s photo folder')
await q(`insert into storage.objects (bucket_id, name) values ('team', '${INVITED}/c.jpg')`)
ok((await db.query(`delete from storage.objects where bucket_id = 'team' and name like '${WORKER}/%'`)).affectedRows === 0, 'a worker cannot delete a colleague’s photo')

// --- phase 15: tetris
await db.exec('reset role')
await db.exec(fs.readFileSync(R + '/supabase/015_tetris.sql', 'utf8'))
await db.exec(fs.readFileSync(R + '/supabase/015_tetris.sql', 'utf8'))
let old014 = ''; try { await db.exec(fs.readFileSync(R + '/supabase/014_team_social.sql', 'utf8')) } catch (e) { old014 = e.message }
ok(old014.includes('شُغّل من قبل'), 'running the older 014 again after 015 is refused')
await as(WORKER)
ok((await q(`select erp_schema_version() as v`))[0].v === 15, 'schema version is 15')
ok((await q(`select count(*)::int n from game_scores`))[0].n >= 4, 'earlier game scores survive the migration')
const t1 = (await q(`select submit_game_score('tetris', 12400) as r`))[0].r
ok(t1.top === true && t1.best === 12400, 'a Tetris score above 1000 is accepted and tops the week')
ok((await q(`select body from team_posts where kind = 'game' order by id desc limit 1`))[0].body.includes('تتريس'), 'the trophy post names Tetris')
let bigMemory = false; try { await q(`select submit_game_score('memory', 1001)`) } catch { bigMemory = true }
ok(bigMemory, 'the other games still stop at 1000')
let bigTetris = false; try { await q(`select submit_game_score('tetris', 200001)`) } catch { bigTetris = true }
ok(bigTetris, 'an impossible Tetris score is refused')
ok((await q(`select * from game_leaderboard('tetris')`))[0].best === 12400, 'Tetris has its own leaderboard')

// --- phase 16: invoice photo on purchases
await db.exec('reset role')
await db.exec(fs.readFileSync(R + '/supabase/016_purchase_photo.sql', 'utf8'))
await db.exec(fs.readFileSync(R + '/supabase/016_purchase_photo.sql', 'utf8'))
let old015 = ''; try { await db.exec(fs.readFileSync(R + '/supabase/015_tetris.sql', 'utf8')) } catch (e) { old015 = e.message }
ok(old015.includes('شُغّل من قبل'), 'running the older 015 again after 016 is refused')
await as(ADMIN)
ok((await q(`select erp_schema_version() as v`))[0].v === 16, 'schema version is 16')
await q(`update purchases set invoice_photo = '1/facture.jpg' where id = 1`)
ok((await q(`select invoice_photo from purchases where id = 1`))[0].invoice_photo === '1/facture.jpg', 'a purchase keeps the path of its invoice photo')
await q(`insert into storage.objects (bucket_id, name) values ('purchases', '1/facture.jpg')`)
ok((await q(`select * from storage.objects where bucket_id = 'purchases'`)).length === 1, 'the manager sees the invoice photos')
await as(WORKER)
ok((await q(`select * from storage.objects where bucket_id = 'purchases'`)).length === 0, 'a worker cannot see supplier invoice photos')
let workerUpload = false; try { await q(`insert into storage.objects (bucket_id, name) values ('purchases', '1/x.jpg')`) } catch { workerUpload = true }
ok(workerUpload, 'a worker cannot upload into the purchase photos')
ok((await db.query(`delete from storage.objects where bucket_id = 'purchases'`)).affectedRows === 0, 'a worker cannot delete invoice photos')

// --- phase 17: catalog, material needs, shortages, assignment, extra costs, offline refs
await db.exec('reset role')
await db.exec(fs.readFileSync(R + '/supabase/017_catalog_planning.sql', 'utf8'))
await db.exec(fs.readFileSync(R + '/supabase/017_catalog_planning.sql', 'utf8'))
let old016 = ''; try { await db.exec(fs.readFileSync(R + '/supabase/016_purchase_photo.sql', 'utf8')) } catch (e) { old016 = e.message }
ok(old016.includes('شُغّل من قبل'), 'running the older 016 again after 017 is refused')
await as(ADMIN)
ok((await q(`select erp_schema_version() as v`))[0].v === 17, 'schema version is 17')
const [mdfRow] = await q(`select id, qty from materials where id = 1`)
const [foam] = await q(`insert into materials (name, unit, avg_cost) values ('إسفنج 20 كثافة', 'sheet', 3000) returning id`)
const [bedP] = await q(`insert into products (name, price, size) values ('سرير أمير', 65000, '160/190') returning id`)
await q(`insert into product_materials values (${bedP.id}, 1, 2), (${bedP.id}, ${foam.id}, 1.5)`)
const CAT = (await q(`select save_order(null, '{"customer_id":1,"title":"سريران","order_date":"2026-10-18"}', '[{"description":"سرير أمير","qty":2,"unit_price":65000,"product_id":${bedP.id}},{"description":"كومودينو","qty":1,"unit_price":9000}]') as id`))[0].id
ok((await q(`select product_id from order_items where order_id = ${CAT} order by id`)).map((r) => r.product_id).join() === `${bedP.id},`, 'an order line remembers the catalog product it came from')
let badProduct = (await q(`select save_order(null, '{"customer_id":1,"title":"x","order_date":"2026-10-18"}', '[{"description":"x","qty":1,"unit_price":1,"product_id":999999}]') as id`))[0].id
ok((await q(`select product_id from order_items where order_id = ${badProduct}`))[0].product_id === null, 'an unknown product id is ignored, not trusted')
await q(`insert into order_material_plan values (${CAT}, ${foam.id}, 0.5)`)
const needs = await q(`select * from order_material_needs where order_id = ${CAT} order by material_id`)
ok(needs.length === 2 && Number(needs[0].needed) === 4 && Number(needs[1].needed) === 3.5 && needs[1].manual === true, 'needs = recipe × quantity (2 beds × 2 sheets MDF; 2 × 1.5 foam + 0.5 added by hand)')
await q(`insert into stock_movements (material_id, type, qty, order_id) values (1, 'out', 1, ${CAT})`)
const n2 = await q(`select taken, remaining from order_material_needs where order_id = ${CAT} and material_id = 1`)
ok(Number(n2[0].taken) === 1 && Number(n2[0].remaining) === 3, 'what was already taken out for the order is subtracted')
const sh = await q(`select * from material_shortages order by material_id`)
const foamShort = sh.find((r) => r.material_id === foam.id)
ok(foamShort && Number(foamShort.short) === 3.5 && Number(foamShort.est_cost) === 10500 && foamShort.orders === 1, 'the shopping list shows the missing foam (3.5 sheets, about 10 500 DZD)')
await q(`update orders set is_quote = true where id = ${CAT}`)
ok(!(await q(`select * from material_shortages`)).some((r) => r.material_id === foam.id), 'quotes do not reserve materials')
await q(`update orders set is_quote = false where id = ${CAT}`)
await q(`insert into order_costs (order_id, description, amount) values (${CAT}, 'نقل', 4000), (${CAT}, 'تنجيد خارجي', 6000)`)
const ot = (await q(`select total, extra_cost, assigned_to from order_totals where id = ${CAT}`))[0]
ok(Number(ot.extra_cost) === 10000 && Number(ot.total) === 139000, 'extra costs (transport, outside work) are added up per order')
let badCost = false; try { await q(`insert into order_costs (order_id, description, amount) values (${CAT}, 'x', -5)`) } catch { badCost = true }
ok(badCost, 'a negative cost is refused')
await q(`update orders set assigned_to = '${WORKER}' where id = ${CAT}`)
await as(WORKER)
const myJob = (await q(`select assigned_to, assigned_name from orders_public where id = ${CAT}`))[0]
ok(myJob?.assigned_to === WORKER && myJob.assigned_name === 'عامل', 'the workshop board shows who the order is assigned to')
ok((await q(`select * from order_costs`)).length === 0 && (await q(`select * from product_materials`)).length === 0, 'workers see neither order costs nor product recipes')
let assignChanged = false; try { await q(`update orders set assigned_to = null where id = ${CAT}`); assignChanged = (await q(`select assigned_to from orders_public where id = ${CAT}`))[0].assigned_to === null } catch { assignChanged = false }
ok(!assignChanged, 'a worker cannot change the assignment')
const ref = '11111111-2222-3333-4444-555555555555'
await q(`insert into stock_movements (material_id, type, qty, order_id, created_by, client_ref) values (1, 'out', 0.5, ${CAT}, '${WORKER}', '${ref}')`)
try { await q(`insert into stock_movements (material_id, type, qty, order_id, created_by, client_ref) values (1, 'out', 0.5, ${CAT}, '${WORKER}', '${ref}')`) } catch { /* مكررة */ }
await as(ADMIN)
ok((await q(`select count(*)::int n from stock_movements where client_ref = '${ref}'`))[0].n === 1, 'an offline movement sent twice is recorded once')
await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false); set role anon;`)
const pubCat = (await q(`select catalog_public() as c`))[0].c
ok(pubCat.length >= 1 && pubCat[0].name && pubCat[0].price !== undefined && pubCat[0].materials === undefined, 'the public catalog lists products and prices, without recipes')
let anonCosts = false; try { const r = await q(`select * from order_costs`); anonCosts = r.length === 0 } catch { anonCosts = true }
ok(anonCosts, 'an anonymous visitor sees no order costs')
await db.exec('reset role')
await q(`update products set public = false where id = ${bedP.id}`)
await db.exec(`select set_config('request.jwt.claim.sub', '', false); set role anon;`)
ok(!(await q(`select catalog_public() as c`))[0].c.some((p) => p.id === bedP.id), 'a product hidden from customers is not in the public catalog')
await db.exec('reset role')
await q(`update products set public = true where id = ${bedP.id}`)

// --- 018: review fixes
await db.exec(fs.readFileSync(R + '/supabase/018_review_fixes.sql', 'utf8'))
await db.exec(fs.readFileSync(R + '/supabase/018_review_fixes.sql', 'utf8'))
let old017 = ''; try { await db.exec(fs.readFileSync(R + '/supabase/017_catalog_planning.sql', 'utf8')) } catch (e) { old017 = e.message }
ok(old017.includes('شُغّل من قبل'), 'running the older 017 again after 018 is refused')
await as(WORKER)
ok((await q(`select erp_schema_version() as v`))[0].v === 18, 'schema version is 18')
const stockBefore = Number((await q(`select qty from materials_public where id = ${foam.id}`))[0].qty)
await db.exec('reset role')
await q(`update materials set qty = 10 where id = ${foam.id}`)
await as(WORKER)
const ref2 = 'aaaaaaaa-2222-3333-4444-555555555555'
const ins = `insert into stock_movements (material_id, type, qty, order_id, created_by, client_ref) values (${foam.id}, 'out', 2, ${CAT}, '${WORKER}', '${ref2}')`
await q(ins)
let dupCode = ''
for (let k = 0; k < 2; k++) { try { await q(ins) } catch (e) { dupCode = e.code } }
ok(dupCode === '23505', 'sending the same movement again is refused as a duplicate (the app treats that as already saved)')
ok(Number((await q(`select qty from materials_public where id = ${foam.id}`))[0].qty) === 8, `an offline movement sent three times takes the stock out once (10 → 8; it was ${stockBefore} before the reset)`)
ok((await q(`select * from stock_movements`)).length === 0, 'a worker can no longer read stock movements directly (they carry costs)')
const myMoves = await q(`select * from my_stock_moves where material_id = ${foam.id}`)
ok(myMoves.length >= 1 && myMoves[0].unit_cost === undefined && Number(myMoves[0].qty) === 2, 'the worker sees their own movements without any cost')
let overStock = false; try { await q(`insert into stock_movements (material_id, type, qty, created_by) values (${foam.id}, 'out', 999, '${WORKER}')`) } catch (e) { overStock = e.message.includes('غير كافية') }
ok(overStock && Number((await q(`select qty from materials_public where id = ${foam.id}`))[0].qty) === 8, 'a worker still cannot take out more than the stock, and nothing changes')
ok((await q(`select * from products`)).length === 0, 'workers no longer read catalog products (and their prices) inside the app')
let pushLog = false; try { await q(`select * from push_log`) } catch { pushLog = true }
ok(pushLog, 'the push log is closed to app users')
let revoke = false; try { await q(`select revoke_user_sessions('${ADMIN}')`) } catch { revoke = true }
ok(revoke, 'only the server can end someone’s sessions')
await as(ADMIN)
const [dupMove] = await q(`select unit_cost from stock_movements where client_ref = '${ref2}'`)
ok(Number(dupMove.unit_cost) === 3000, 'the manager still sees the cost of each movement (average price at the time)')
await q(`insert into stock_movements (material_id, type, qty, unit_cost) values (${foam.id}, 'in', 2, 4500)`)
const [fm] = await q(`select qty, avg_cost from materials where id = ${foam.id}`)
ok(Number(fm.qty) === 10 && Number(fm.avg_cost) === 3300, `a purchase-in still updates stock and average cost (8 × 3000 + 2 × 4500) / 10 = 3300 (got ${fm.avg_cost})`)

// --- anon
await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false); set role anon;`)
let anonBlocked = false; try { await q(`select * from orders_public`) } catch { anonBlocked = true }
ok(anonBlocked, 'anonymous visitor cannot read orders_public')
let anonRpc = false; try { await q(`select workshop_set_status(2, 'ready')`) } catch { anonRpc = true }
ok(anonRpc, 'anonymous visitor cannot call the workshop function')
let anonVer = false; try { await q(`select erp_schema_version()`) } catch { anonVer = true }
ok(anonVer, 'anonymous visitor cannot call the version function')
console.log(`\n${passed} passed, ${failed} failed`)
