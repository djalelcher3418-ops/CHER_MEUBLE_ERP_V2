-- =====================================================================
-- CHER MEUBLE ERP — المرحلة 19: إصلاحات المراجعة
--   1) حركة إخراج أُعيد إرسالها (بدون إنترنت) لا تُنقص المخزون مرتين
--   2) العامل لا يرى تكلفة المواد (unit_cost) في حركاته
--   3) العامل لا يرى أسعار الكتالوج (الزبائن يرونها عبر الصفحة العامة فقط)
--   4) عامل موقوف لا يحذف صور الطلبيات
--   5) سجل التنبيهات المرسلة: لا تنبيه مكرر لنفس الحدث
--   6) إنهاء جلسات حساب عند تغيير رمزه السري
-- يُشغَّل مرة واحدة بعد 017_catalog_planning.sql (Supabase → SQL Editor → Run)
-- =====================================================================

do $$ begin
  if erp_schema_version() < 17 then
    raise exception 'شغّل الملف 017_catalog_planning.sql أولًا ثم أعد تشغيل هذا الملف';
  end if;
  if erp_schema_version() > 18 then
    raise exception 'هذا الملف شُغّل من قبل وقاعدة البيانات أحدث منه — لا حاجة لتشغيله';
  end if;
end $$;

-- ---------- 1) المخزون يتغيّر فقط للحركة التي حُفظت فعلًا ----------
-- كان التحديث في trigger «قبل» الإدخال، فينفَّذ حتى لو رُفضت الحركة كمكررة (ON CONFLICT DO NOTHING).
-- الآن: «قبل» يحدد سعر الوحدة فقط، و«بعد» (لا يعمل إلا للسطر المحفوظ) يحدّث المخزون.
create or replace function stock_movement_cost() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.type = 'out' then
    new.unit_cost := (select avg_cost from materials where id = new.material_id);  -- لا نقبل سعرًا من التطبيق
  elsif new.type = 'adjust' then
    new.unit_cost := coalesce(new.unit_cost, (select avg_cost from materials where id = new.material_id));
  end if;
  return new;
end $$;

create or replace function apply_stock_movement() returns trigger
language plpgsql security definer set search_path = public as $$
declare m materials%rowtype;
begin
  select * into m from materials where id = new.material_id for update;

  if new.type = 'in' then
    if new.unit_cost is not null and greatest(m.qty, 0) + new.qty > 0 then
      update materials
         set avg_cost = round((greatest(m.qty,0) * m.avg_cost + new.qty * new.unit_cost)
                              / (greatest(m.qty,0) + new.qty), 2),
             qty = m.qty + new.qty
       where id = m.id;
    else
      update materials set qty = m.qty + new.qty where id = m.id;
    end if;
  elsif new.type = 'out' then
    if m.qty < new.qty and not is_admin() then
      raise exception 'الكمية غير كافية في المخزون: الموجود % فقط', m.qty::float8;
    end if;
    update materials set qty = m.qty - new.qty where id = m.id;
  else
    update materials set qty = m.qty + new.qty where id = m.id;
  end if;
  return null;
end $$;

drop trigger if exists trg_apply_stock_movement on stock_movements;
drop trigger if exists trg_stock_movement_cost on stock_movements;
create trigger trg_stock_movement_cost
  before insert on stock_movements
  for each row execute function stock_movement_cost();
create trigger trg_apply_stock_movement
  after insert on stock_movements
  for each row execute function apply_stock_movement();

-- ---------- 2) حركات العامل بدون تكلفة ----------
drop policy if exists worker_own on stock_movements;
create or replace view my_stock_moves as
  select id, material_id, type, qty, note, order_id, created_at
    from stock_movements
   where created_by = auth.uid() and is_active_user();
revoke all on my_stock_moves from anon;
grant select on my_stock_moves to authenticated;

-- ---------- 3) الكتالوج للمدير فقط داخل التطبيق ----------
drop policy if exists active_select on products;

-- ---------- 4) صور الطلبيات: الحذف للحساب النشط فقط ----------
drop policy if exists worker_delete on order_photos;
create policy worker_delete on order_photos for delete to authenticated
  using (created_by = auth.uid() and is_active_user() and order_is_open(order_id));

-- ---------- 5) سجل التنبيهات: كل حدث يُرسَل مرة واحدة ----------
create table if not exists push_log (
  kind        text not null,
  ref         text not null,
  created_at  timestamptz not null default now(),
  primary key (kind, ref)
);
alter table push_log enable row level security;  -- بلا سياسات: دالة الخادم وحدها تكتب فيه
revoke all on push_log from anon, authenticated;

-- ---------- 6) إنهاء جلسات حساب (عند تغيير الرمز السري من المدير) ----------
create or replace function revoke_user_sessions(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from auth.sessions where user_id = p_user;
end $$;
revoke all on function revoke_user_sessions(uuid) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function revoke_user_sessions(uuid) to service_role;
  end if;
end $$;

create or replace function erp_schema_version() returns int
language sql stable as $$ select 18 $$;
