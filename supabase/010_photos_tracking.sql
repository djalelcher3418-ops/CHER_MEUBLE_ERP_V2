-- =====================================================================
-- CHER MEUBLE ERP — المرحلة 10: صور الطلبيات + رابط تتبع للزبون
-- يُشغَّل مرة واحدة بعد 009_hardening.sql (Supabase → SQL Editor → Run)
-- =====================================================================

-- ---------- 1) صور الطلبية (تصميم، رسم، مقاسات، صورة القطعة الجاهزة) ----------
create table order_photos (
  id          bigint generated always as identity primary key,
  order_id    bigint not null references orders(id) on delete cascade,
  path        text not null unique,          -- orders/<order_id>/<ملف>.jpg في التخزين
  caption     text,
  created_by  uuid references profiles(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);
create index on order_photos (order_id, created_at);

alter table order_photos enable row level security;

-- المدير: كل شيء. العامل النشط: يرى صور الطلبيات المفتوحة ويضيف إليها، ويحذف ما أضافه هو
create policy admin_all on order_photos for all using (is_admin()) with check (is_admin());
create policy worker_select on order_photos for select to authenticated
  using (is_active_user() and order_is_open(order_id));
create policy worker_insert on order_photos for insert to authenticated
  with check (is_active_user() and order_is_open(order_id) and created_by = auth.uid());
create policy worker_delete on order_photos for delete to authenticated
  using (created_by = auth.uid() and order_is_open(order_id));

-- ملفات الصور: مجلد باسم رقم الطلبية في المخزن الخاص «orders»
insert into storage.buckets (id, name, public) values ('orders', 'orders', false)
  on conflict (id) do nothing;

create or replace function can_access_order_file(p_bucket text, p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
           when p_bucket = 'orders' and (storage.foldername(p_name))[1] ~ '^[0-9]+$'
             then is_admin() or (is_active_user() and order_is_open(((storage.foldername(p_name))[1])::bigint))
           else false
         end;
$$;

create policy order_files_read on storage.objects for select to authenticated
  using (can_access_order_file(bucket_id, name));
create policy order_files_upload on storage.objects for insert to authenticated
  with check (can_access_order_file(bucket_id, name));
create policy order_files_delete on storage.objects for delete to authenticated
  using (can_access_order_file(bucket_id, name) and (owner = auth.uid() or is_admin()));

-- ---------- 2) رابط تتبع للزبون ----------
-- رمز سري طويل لكل طلبية؛ من يملك الرابط فقط يرى حالة طلبيته، بدون حساب
alter table orders add column track_token uuid not null default gen_random_uuid();
create unique index orders_track_token on orders (track_token);

create or replace function track_order(p_token uuid) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
           'id', o.id,
           'title', o.title,
           'customer', split_part(c.name, ' ', 1),
           'status', o.status,
           'order_date', o.order_date,
           'due_date', o.due_date,
           'delivered_on', o.delivered_on,
           'total', t.total,
           'paid', t.paid,
           'items', (select coalesce(json_agg(json_build_object('description', i.description, 'qty', i.qty) order by i.id), '[]'::json)
                       from order_items i where i.order_id = o.id))
    from orders o
    join customers c on c.id = o.customer_id
    join order_totals t on t.id = o.id
   where o.track_token = p_token;
$$;

-- صفحة التتبع تُفتح بدون دخول
grant execute on function track_order(uuid) to anon, authenticated;
revoke all on function can_access_order_file(text, text) from anon;

-- ---------- 3) رقم النسخة ----------
create or replace function erp_schema_version() returns int
language sql stable as $$ select 10 $$;
