-- =====================================================================
-- CHER MEUBLE ERP — المرحلة 9: إصلاحات الأمان والدقة
-- يُشغَّل مرة واحدة بعد 008_version.sql (Supabase → SQL Editor → Run)
-- =====================================================================

-- هل صاحب الطلب حساب نشط؟
create or replace function is_active_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and active);
$$;

-- ---------- 1) لا أحد يدخل بالتسجيل المفتوح ----------
-- الحساب الجديد يكون نشطًا فقط إذا كان أول حساب (المدير)، أو أنشأه المدير من صفحة «الحسابات».
-- أي تسجيل آخر (مثلًا من شخص غريب يستعمل المفتاح العام) يبقى موقوفًا ولا يرى شيئًا.
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare first_user boolean;
begin
  perform pg_advisory_xact_lock(717171); -- حسابان في نفس اللحظة لا يصبحان مديرين معًا
  first_user := not exists (select 1 from profiles where role = 'admin');
  insert into profiles (id, full_name, role, active)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    case when first_user then 'admin'::user_role else 'worker'::user_role end,
    first_user or coalesce((new.raw_app_meta_data->>'created_by_admin')::boolean, false)
  );
  return new;
end $$;

-- ---------- 2) إخراج المواد: التكلفة يحددها الخادم، والكمية لا تتجاوز الموجود ----------
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
    new.unit_cost := m.avg_cost;  -- لا نقبل سعرًا من التطبيق
    update materials set qty = m.qty - new.qty where id = m.id;
  else
    new.unit_cost := coalesce(new.unit_cost, m.avg_cost);
    update materials set qty = m.qty + new.qty where id = m.id;
  end if;
  return new;
end $$;

-- الطلبية مفتوحة (يمكن إخراج مواد لها)؟
create or replace function order_is_open(p_order bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from orders where id = p_order and status in ('new', 'in_production'));
$$;

drop policy if exists worker_out on stock_movements;
create policy worker_out on stock_movements for insert to authenticated
  with check (
    type = 'out'
    and created_by = auth.uid()
    and is_active_user()
    and (order_id is null or order_is_open(order_id))
  );

-- ---------- 3) ما يراه العامل: للحسابات النشطة فقط ----------
create or replace view materials_public as
  select m.id, m.name, c.name as category, m.unit, m.barcode, m.qty, m.min_qty,
         (m.qty <= m.min_qty) as low_stock
    from materials m
    left join material_categories c on c.id = m.category_id
   where m.active and is_active_user();

create or replace view orders_public as
  select o.id, o.title, c.name as customer_name, o.due_date, o.status, o.notes
    from orders o
    join customers c on c.id = o.customer_id
   where o.status in ('new', 'in_production') and is_active_user();

create or replace view order_items_public as
  select i.id, i.order_id, i.description, i.qty
    from order_items i
    join orders o on o.id = i.order_id
   where o.status in ('new', 'in_production') and is_active_user();

-- ---------- 4) حذف صورة رسالة: صاحبها أو المدير ----------
create policy chat_images_delete on storage.objects for delete to authenticated
  using (can_access_chat_file(bucket_id, name) and (owner = auth.uid() or is_admin()));

-- ---------- 5) حفظ الطلبية وأسطرها دفعة واحدة ----------
-- إن فشل أي جزء لا يُحفظ شيء، فلا تبقى طلبية بلا أسطر
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
    insert into orders (customer_id, title, order_date, due_date, notes, discount)
    values ((p_order->>'customer_id')::bigint, p_order->>'title', (p_order->>'order_date')::date,
            nullif(p_order->>'due_date', '')::date, nullif(p_order->>'notes', ''),
            coalesce((p_order->>'discount')::numeric, 0))
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

  insert into order_items (order_id, description, qty, unit_price)
  select oid, i->>'description', (i->>'qty')::numeric, coalesce((i->>'unit_price')::numeric, 0)
    from jsonb_array_elements(p_items) i;
  return oid;
end $$;

-- ---------- 6) مجاميع الشهر تُحسب في قاعدة البيانات (بدون حد 1000 صف) ----------
create or replace function month_summary(p_from date, p_to date) returns json
language sql stable security invoker set search_path = public as $$
  select json_build_object(
    'received',      (select coalesce(sum(amount), 0) from customer_payments where paid_on between p_from and p_to),
    'suppliers',     (select coalesce(sum(amount), 0) from supplier_payments where paid_on between p_from and p_to),
    'payroll',       (select coalesce(sum(amount), 0) from payroll_payments  where paid_on between p_from and p_to),
    'advances',      (select coalesce(sum(amount), 0) from employee_advances where given_on between p_from and p_to),
    'expenses',      (select coalesce(sum(amount), 0) from expenses where spent_on between p_from and p_to),
    'purchases',     (select coalesce(sum(total), 0) from purchase_totals where purchase_date between p_from and p_to),
    'materials_out', (select coalesce(sum(qty * coalesce(unit_cost, 0)), 0) from stock_movements
                       where type = 'out' and (created_at at time zone 'Africa/Algiers')::date between p_from and p_to),
    'expenses_by_category', (
      select coalesce(json_agg(json_build_object('name', coalesce(c.name, 'بدون صنف'), 'sum', s.total) order by s.total desc), '[]'::json)
        from (select category_id, sum(amount) as total from expenses
               where spent_on between p_from and p_to group by category_id) s
        left join expense_categories c on c.id = s.category_id)
  );
$$;

revoke all on function is_active_user(), order_is_open(bigint), save_order(bigint, jsonb, jsonb), month_summary(date, date) from anon;

-- ---------- 7) رقم النسخة ----------
create or replace function erp_schema_version() returns int
language sql stable as $$ select 9 $$;
