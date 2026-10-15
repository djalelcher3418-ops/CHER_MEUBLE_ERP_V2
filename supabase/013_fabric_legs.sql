-- =====================================================================
-- CHER MEUBLE ERP — المرحلة 13: نوع القماش ونوع الأرجل لكل سطر من الطلبية
-- يُشغَّل مرة واحدة بعد 012_bed_size.sql (Supabase → SQL Editor → Run)
-- =====================================================================

-- يجب تشغيل 012_bed_size.sql قبل هذا الملف
do $$ begin
  if erp_schema_version() < 12 then
    raise exception 'شغّل الملف 012_bed_size.sql أولًا ثم أعد تشغيل هذا الملف';
  end if;
end $$;

alter table order_items add column if not exists fabric text check (fabric is null or length(fabric) <= 60);
alter table order_items add column if not exists legs   text check (legs   is null or length(legs)   <= 60);

-- الورشة ترى القماش والأرجل (الأعمدة الجديدة في آخر العرض)
create or replace view order_items_public as
  select i.id, i.order_id, i.description, i.qty, i.size, i.fabric, i.legs
    from order_items i
    join orders o on o.id = i.order_id
   where o.status in ('new', 'in_production') and not o.is_quote and is_active_user();

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

  insert into order_items (order_id, description, qty, unit_price, size, fabric, legs)
  select oid, i->>'description', (i->>'qty')::numeric, coalesce((i->>'unit_price')::numeric, 0),
         nullif(trim(coalesce(i->>'size', '')), ''),
         nullif(trim(coalesce(i->>'fabric', '')), ''),
         nullif(trim(coalesce(i->>'legs', '')), '')
    from jsonb_array_elements(p_items) i;
  return oid;
end $$;

create or replace function track_order(p_token uuid) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
           'id', o.id,
           'title', o.title,
           'customer', split_part(c.name, ' ', 1),
           'status', o.status,
           'is_quote', o.is_quote,
           'order_date', o.order_date,
           'due_date', o.due_date,
           'delivered_on', o.delivered_on,
           'total', t.total,
           'paid', t.paid,
           'items', (select coalesce(json_agg(json_build_object(
                              'description', i.description, 'qty', i.qty, 'size', i.size,
                              'fabric', i.fabric, 'legs', i.legs) order by i.id), '[]'::json)
                       from order_items i where i.order_id = o.id))
    from orders o
    join customers c on c.id = o.customer_id
    join order_totals t on t.id = o.id
   where o.track_token = p_token;
$$;

create or replace function erp_schema_version() returns int
language sql stable as $$ select 13 $$;
