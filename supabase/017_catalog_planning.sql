-- =====================================================================
-- CHER MEUBLE ERP — المرحلة 17
--   1) ربح كل طلبية: تكاليف إضافية للطلبية (نقل، عمل خارجي…) تدخل في الربح
--   5) توزيع العمل: إسناد الطلبية لعامل
--   6) المواد اللازمة لكل طلبية، والنقص مقارنة بالمخزون (قائمة شراء)
--   7) كتالوج المنتجات: صورة، سعر، ومكوّنات من المواد؛ وصفحة عامة للزبائن
--  11) نسخ احتياطية أسبوعية في مخزن خاص «backups»
--  12) إخراج المواد بدون إنترنت: رقم فريد لكل حركة حتى لا تتكرر عند الإرسال
-- يُشغَّل مرة واحدة بعد 016_purchase_photo.sql (Supabase → SQL Editor → Run)
-- =====================================================================

do $$ begin
  if erp_schema_version() < 16 then
    raise exception 'شغّل الملف 016_purchase_photo.sql أولًا ثم أعد تشغيل هذا الملف';
  end if;
  if erp_schema_version() > 17 then
    raise exception 'هذا الملف شُغّل من قبل وقاعدة البيانات أحدث منه — لا حاجة لتشغيله';
  end if;
end $$;

-- ---------- 1) تكاليف إضافية لكل طلبية ----------
create table if not exists order_costs (
  id           bigint generated always as identity primary key,
  order_id     bigint not null references orders(id) on delete cascade,
  description  text not null check (length(trim(description)) between 1 and 120),
  amount       numeric(14,2) not null check (amount > 0),
  spent_on     date not null default current_date,
  created_by   uuid references profiles(id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now()
);
create index if not exists order_costs_order on order_costs (order_id);
alter table order_costs enable row level security;
drop policy if exists admin_all on order_costs;
create policy admin_all on order_costs for all to authenticated using (is_admin()) with check (is_admin());

-- ---------- 5) إسناد الطلبية لعامل ----------
alter table orders add column if not exists assigned_to uuid references profiles(id) on delete set null;

-- الأعمدة الجديدة في آخر العرض (شرط create or replace view)
create or replace view order_totals with (security_invoker = true) as
  select o.id, o.customer_id, c.name as customer_name, o.title, o.order_date, o.due_date,
         o.status, o.discount, o.delivered_on,
         coalesce((select sum(i.qty * i.unit_price) from order_items i where i.order_id = o.id), 0)
           - o.discount as total,
         coalesce((select sum(p.amount) from customer_payments p where p.order_id = o.id), 0) as paid,
         coalesce((select sum(m.qty * coalesce(m.unit_cost, 0)) from stock_movements m
                    where m.order_id = o.id and m.type = 'out'), 0) as material_cost,
         o.is_quote,
         coalesce((select sum(x.amount) from order_costs x where x.order_id = o.id), 0) as extra_cost,
         o.assigned_to
    from orders o
    join customers c on c.id = o.customer_id;

create or replace view orders_public as
  select o.id, o.title, c.name as customer_name, o.due_date, o.status, o.notes,
         o.assigned_to, a.full_name as assigned_name
    from orders o
    join customers c on c.id = o.customer_id
    left join profiles a on a.id = o.assigned_to
   where o.status in ('new', 'in_production') and not o.is_quote and is_active_user();

-- ---------- 7) الكتالوج ----------
create table if not exists products (
  id           bigint generated always as identity primary key,
  name         text not null check (length(trim(name)) between 1 and 120),
  description  text check (description is null or length(description) <= 1000),
  price        numeric(14,2) not null default 0 check (price >= 0),
  size         text check (size is null or length(size) <= 40),
  fabric       text check (fabric is null or length(fabric) <= 60),
  legs         text check (legs is null or length(legs) <= 60),
  photo_path   text check (photo_path is null or length(photo_path) <= 200),
  public       boolean not null default true,   -- يظهر في صفحة الكتالوج للزبائن
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

-- مكوّنات المنتج: كمية كل مادة لقطعة واحدة
create table if not exists product_materials (
  product_id   bigint not null references products(id) on delete cascade,
  material_id  bigint not null references materials(id) on delete cascade,
  qty          numeric(14,3) not null check (qty > 0),
  primary key (product_id, material_id)
);

alter table products enable row level security;
alter table product_materials enable row level security;
drop policy if exists admin_all on products;
drop policy if exists active_select on products;
drop policy if exists admin_all on product_materials;
create policy admin_all on products for all to authenticated using (is_admin()) with check (is_admin());
create policy active_select on products for select to authenticated using (is_active_user() and active);
create policy admin_all on product_materials for all to authenticated using (is_admin()) with check (is_admin());

alter table order_items add column if not exists product_id bigint references products(id) on delete set null;

-- save_order: نفس السابق + رقم المنتج لكل سطر (إن كان من الكتالوج)
create or replace function save_order(p_id bigint, p_order jsonb, p_items jsonb) returns bigint
language plpgsql security invoker set search_path = public as $$
declare
  oid bigint;
  subtotal numeric;
begin
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'أضف سطرًا واحدًا على الأقل';
  end if;
  select coalesce(sum((i->>'qty')::numeric * coalesce((i->>'unit_price')::numeric, 0)), 0)
    into subtotal from jsonb_array_elements(p_items) i;
  if coalesce((p_order->>'discount')::numeric, 0) > subtotal then
    raise exception 'التخفيض أكبر من المجموع';
  end if;

  if p_id is null then
    insert into orders (customer_id, title, order_date, due_date, notes, discount, is_quote)
    values ((p_order->>'customer_id')::bigint, p_order->>'title', (p_order->>'order_date')::date,
            nullif(p_order->>'due_date', '')::date, nullif(p_order->>'notes', ''),
            coalesce((p_order->>'discount')::numeric, 0), coalesce((p_order->>'is_quote')::boolean, false))
    returning id into oid;
  else
    update orders
       set customer_id = (p_order->>'customer_id')::bigint, title = p_order->>'title',
           order_date = (p_order->>'order_date')::date, due_date = nullif(p_order->>'due_date', '')::date,
           notes = nullif(p_order->>'notes', ''), discount = coalesce((p_order->>'discount')::numeric, 0)
     where id = p_id
    returning id into oid;
    if oid is null then raise exception 'الطلبية غير موجودة'; end if;
    delete from order_items where order_id = oid;
  end if;

  insert into order_items (order_id, description, qty, unit_price, size, fabric, legs, product_id)
  select oid, i->>'description', (i->>'qty')::numeric, coalesce((i->>'unit_price')::numeric, 0),
         nullif(trim(coalesce(i->>'size', '')), ''),
         nullif(trim(coalesce(i->>'fabric', '')), ''),
         nullif(trim(coalesce(i->>'legs', '')), ''),
         (select p.id from products p where p.id = nullif(i->>'product_id', '')::bigint)
    from jsonb_array_elements(p_items) i;
  return oid;
end $$;

-- الكتالوج العام للزبائن (بدون حساب): المنتجات النشطة المعروضة فقط، بدون مكوّناتها
create or replace function catalog_public() returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object(
           'id', p.id, 'name', p.name, 'description', p.description, 'price', p.price,
           'size', p.size, 'fabric', p.fabric, 'legs', p.legs, 'photo_path', p.photo_path) order by p.name), '[]'::json)
    from products p
   where p.active and p.public;
$$;
grant execute on function catalog_public() to anon, authenticated;

-- صور المنتجات: مخزن عام للقراءة (للكتالوج)، والكتابة للمدير فقط
insert into storage.buckets (id, name, public) values ('products', 'products', true)
  on conflict (id) do update set public = true;
drop policy if exists product_photos_upload on storage.objects;
drop policy if exists product_photos_delete on storage.objects;
drop policy if exists product_photos_read on storage.objects;
create policy product_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'products' and is_active_user());
create policy product_photos_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'products' and is_admin());
create policy product_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'products' and is_admin());

-- ---------- 6) المواد اللازمة لكل طلبية ----------
-- مواد إضافية يحددها المدير يدويًا لطلبية (لما ليس من الكتالوج)
create table if not exists order_material_plan (
  order_id     bigint not null references orders(id) on delete cascade,
  material_id  bigint not null references materials(id) on delete cascade,
  qty          numeric(14,3) not null check (qty > 0),
  primary key (order_id, material_id)
);
alter table order_material_plan enable row level security;
drop policy if exists admin_all on order_material_plan;
create policy admin_all on order_material_plan for all to authenticated using (is_admin()) with check (is_admin());

-- اللازم = مكوّنات منتجات الكتالوج × الكمية + الإضافات اليدوية؛ والباقي = اللازم − ما أُخرج للطلبية
create or replace view order_material_needs with (security_invoker = true) as
  with need as (
    select i.order_id, pm.material_id, i.qty * pm.qty as q
      from order_items i join product_materials pm on pm.product_id = i.product_id
    union all
    select order_id, material_id, qty from order_material_plan
  ), n as (
    select order_id, material_id, sum(q) as needed from need group by order_id, material_id
  ), taken as (
    select order_id, material_id, sum(qty) as taken from stock_movements
     where type = 'out' and order_id is not null group by order_id, material_id
  )
  select n.order_id, n.material_id, m.name, m.unit, n.needed,
         coalesce(t.taken, 0) as taken,
         greatest(n.needed - coalesce(t.taken, 0), 0) as remaining,
         m.qty as stock, m.avg_cost,
         exists (select 1 from order_material_plan x where x.order_id = n.order_id and x.material_id = n.material_id) as manual
    from n
    join materials m on m.id = n.material_id
    left join taken t on t.order_id = n.order_id and t.material_id = n.material_id;

-- قائمة الشراء: ما تحتاجه كل الطلبيات المفتوحة (والعروض غير محسوبة) مقارنة بالمخزون
create or replace view material_shortages with (security_invoker = true) as
  select r.material_id, m.name, m.unit, m.qty as stock, r.reserved,
         r.reserved - greatest(m.qty, 0) as short,
         round((r.reserved - greatest(m.qty, 0)) * m.avg_cost, 2) as est_cost,
         r.orders
    from (
      select x.material_id, sum(x.remaining) as reserved, count(distinct x.order_id)::int as orders
        from order_material_needs x
        join orders o on o.id = x.order_id
       where o.status in ('new', 'in_production') and not o.is_quote and x.remaining > 0
       group by x.material_id
    ) r
    join materials m on m.id = r.material_id
   where r.reserved > greatest(m.qty, 0);

revoke all on order_material_needs, material_shortages from anon;

-- ---------- 11) النسخ الاحتياطية ----------
insert into storage.buckets (id, name, public) values ('backups', 'backups', false)
  on conflict (id) do nothing;
drop policy if exists backups_read on storage.objects;
drop policy if exists backups_delete on storage.objects;
create policy backups_read on storage.objects for select to authenticated
  using (bucket_id = 'backups' and is_admin());
create policy backups_delete on storage.objects for delete to authenticated
  using (bucket_id = 'backups' and is_admin());

-- ---------- 12) إخراج بدون إنترنت: لا تتكرر الحركة إن أُرسلت مرتين ----------
alter table stock_movements add column if not exists client_ref uuid;
create unique index if not exists stock_movements_client_ref on stock_movements (client_ref);

create or replace function erp_schema_version() returns int
language sql stable as $$ select 17 $$;
