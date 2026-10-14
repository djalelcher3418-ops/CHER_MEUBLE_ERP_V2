-- =====================================================================
-- CHER MEUBLE ERP — المرحلة 11: عروض الأسعار (devis)
-- عرض السعر = طلبية عليها علامة is_quote. لا يُحسب دينًا، لا يصل للورشة،
-- ولا تُخرج له مواد، حتى يُحوَّل إلى طلبية بضغطة واحدة.
-- يُشغَّل مرة واحدة بعد 010_photos_tracking.sql (Supabase → SQL Editor → Run)
-- =====================================================================

alter table orders add column is_quote boolean not null default false;

-- ---------- 1) المبالغ: العمود الجديد في آخر العرض ----------
create or replace view order_totals with (security_invoker = true) as
  select o.id, o.customer_id, c.name as customer_name, o.title, o.order_date, o.due_date,
         o.status, o.discount, o.delivered_on,
         coalesce((select sum(i.qty * i.unit_price) from order_items i where i.order_id = o.id), 0)
           - o.discount as total,
         coalesce((select sum(p.amount) from customer_payments p where p.order_id = o.id), 0) as paid,
         coalesce((select sum(m.qty * coalesce(m.unit_cost, 0)) from stock_movements m
                    where m.order_id = o.id and m.type = 'out'), 0) as material_cost,
         o.is_quote
    from orders o
    join customers c on c.id = o.customer_id;

-- عروض الأسعار لا تُحسب على الزبون
create or replace view customer_balances with (security_invoker = true) as
  select c.id, c.name, c.phone,
         c.opening_balance
         + coalesce((select sum(t.total) from order_totals t
                      where t.customer_id = c.id and t.status <> 'cancelled' and not t.is_quote), 0)
         - coalesce((select sum(p.amount) from customer_payments p where p.customer_id = c.id), 0)
         as balance
    from customers c
   where c.active;

-- ---------- 2) الورشة لا ترى عروض الأسعار ----------
create or replace view orders_public as
  select o.id, o.title, c.name as customer_name, o.due_date, o.status, o.notes
    from orders o
    join customers c on c.id = o.customer_id
   where o.status in ('new', 'in_production') and not o.is_quote and is_active_user();

create or replace view order_items_public as
  select i.id, i.order_id, i.description, i.qty
    from order_items i
    join orders o on o.id = i.order_id
   where o.status in ('new', 'in_production') and not o.is_quote and is_active_user();

-- لا مواد ولا صور من العامل لعرض سعر
create or replace function order_is_open(p_order bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from orders where id = p_order and status in ('new', 'in_production') and not is_quote);
$$;

create or replace function workshop_set_status(p_order bigint, p_status order_status) returns void
language plpgsql security definer set search_path = public as $$
declare
  cur order_status;
  quote boolean;
begin
  if not exists (select 1 from profiles where id = auth.uid() and active) then
    raise exception 'ليست لديك صلاحية لهذه العملية';
  end if;
  select status, is_quote into cur, quote from orders where id = p_order for update;
  if cur is null or quote then
    raise exception 'الطلبية غير موجودة';
  end if;
  if not ((cur = 'new' and p_status = 'in_production') or (cur = 'in_production' and p_status = 'ready')) then
    raise exception 'لا يمكن تغيير حالة هذه الطلبية من الورشة';
  end if;
  update orders set status = p_status where id = p_order;
end $$;

-- ---------- 3) حفظ الطلبية أو عرض السعر دفعة واحدة ----------
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

  insert into order_items (order_id, description, qty, unit_price)
  select oid, i->>'description', (i->>'qty')::numeric, coalesce((i->>'unit_price')::numeric, 0)
    from jsonb_array_elements(p_items) i;
  return oid;
end $$;

-- تحويل عرض سعر إلى طلبية: يصبح تاريخ الطلب اليوم
create or replace function convert_quote(p_id bigint) returns void
language plpgsql security invoker set search_path = public as $$
begin
  update orders set is_quote = false, order_date = current_date, status = 'new'
   where id = p_id and is_quote;
  if not found then raise exception 'هذا ليس عرض سعر'; end if;
end $$;

-- ---------- 4) صفحة التتبع تعرف إن كان عرض سعر ----------
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
           'items', (select coalesce(json_agg(json_build_object('description', i.description, 'qty', i.qty) order by i.id), '[]'::json)
                       from order_items i where i.order_id = o.id))
    from orders o
    join customers c on c.id = o.customer_id
    join order_totals t on t.id = o.id
   where o.track_token = p_token;
$$;

revoke all on function convert_quote(bigint) from anon;

-- ---------- 5) رقم النسخة ----------
create or replace function erp_schema_version() returns int
language sql stable as $$ select 11 $$;
