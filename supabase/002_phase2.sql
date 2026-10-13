-- =====================================================================
-- CHER MEUBLE ERP — المرحلة 2
-- الزبائن + الطلبيات + دفعات الزبائن + ربط المواد المُخرَجة بالطلبية
-- يُشغَّل مرة واحدة بعد 001_phase1.sql (Supabase → SQL Editor → Run)
-- =====================================================================

-- ---------- 1) الزبائن ----------
create table customers (
  id               bigint generated always as identity primary key,
  name             text not null,
  phone            text,
  address          text,
  notes            text,
  opening_balance  numeric(14,2) not null default 0,  -- دين قديم على الزبون قبل بدء النظام
  active           boolean not null default true,
  created_at       timestamptz not null default now()
);

-- ---------- 2) الطلبيات ----------
-- new = جديدة، in_production = في الورشة، ready = جاهزة، delivered = سُلّمت، cancelled = ملغاة
create type order_status as enum ('new', 'in_production', 'ready', 'delivered', 'cancelled');

create table orders (
  id            bigint generated always as identity primary key,
  customer_id   bigint not null references customers(id),
  title         text not null,
  order_date    date not null default current_date,
  due_date      date,
  status        order_status not null default 'new',
  discount      numeric(14,2) not null default 0 check (discount >= 0),
  notes         text,
  delivered_on  date,
  created_by    uuid references profiles(id) default auth.uid(),
  created_at    timestamptz not null default now()
);

create table order_items (
  id           bigint generated always as identity primary key,
  order_id     bigint not null references orders(id) on delete cascade,
  description  text not null,
  qty          numeric(14,3) not null check (qty > 0),
  unit_price   numeric(14,2) not null check (unit_price >= 0)
);

create table customer_payments (
  id           bigint generated always as identity primary key,
  customer_id  bigint not null references customers(id),
  order_id     bigint references orders(id) on delete set null,
  amount       numeric(14,2) not null check (amount > 0),
  paid_on      date not null default current_date,
  method       text not null default 'cash' check (method in ('cash','cheque','transfer')),
  notes        text,
  created_by   uuid references profiles(id) default auth.uid(),
  created_at   timestamptz not null default now()
);

create index on orders (customer_id);
create index on orders (status, due_date);
create index on order_items (order_id);
create index on customer_payments (customer_id);
create index on customer_payments (order_id);

-- ---------- 3) ربط المواد المُخرَجة بالطلبية ----------
alter table stock_movements add column order_id bigint references orders(id) on delete set null;
create index on stock_movements (order_id);

-- أول مادة تخرج لطلبية جديدة تنقلها تلقائيًا إلى «في الورشة»
create or replace function order_started_by_movement() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.order_id is not null and new.type = 'out' then
    update orders set status = 'in_production' where id = new.order_id and status = 'new';
  end if;
  return new;
end $$;

create trigger trg_order_started_by_movement
  after insert on stock_movements
  for each row execute function order_started_by_movement();

-- عند التسليم: يُسجَّل تاريخ التسليم تلقائيًا
create or replace function order_delivered_date() returns trigger
language plpgsql as $$
begin
  if new.status = 'delivered' and old.status is distinct from 'delivered' then
    new.delivered_on := coalesce(new.delivered_on, current_date);
  elsif new.status <> 'delivered' then
    new.delivered_on := null;
  end if;
  return new;
end $$;

create trigger trg_order_delivered_date
  before update on orders
  for each row execute function order_delivered_date();

-- ---------- 4) العروض (Views) ----------
-- للمدير: مبلغ كل طلبية، ما دُفع منها، وتكلفة المواد التي خرجت لها
create view order_totals with (security_invoker = true) as
  select o.id, o.customer_id, c.name as customer_name, o.title, o.order_date, o.due_date,
         o.status, o.discount, o.delivered_on,
         coalesce((select sum(i.qty * i.unit_price) from order_items i where i.order_id = o.id), 0)
           - o.discount as total,
         coalesce((select sum(p.amount) from customer_payments p where p.order_id = o.id), 0) as paid,
         coalesce((select sum(m.qty * coalesce(m.unit_cost, 0)) from stock_movements m
                    where m.order_id = o.id and m.type = 'out'), 0) as material_cost
    from orders o
    join customers c on c.id = o.customer_id;

-- للمدير: الباقي على كل زبون (الطلبيات الملغاة لا تُحسب)
create view customer_balances with (security_invoker = true) as
  select c.id, c.name, c.phone,
         c.opening_balance
         + coalesce((select sum(t.total) from order_totals t
                      where t.customer_id = c.id and t.status <> 'cancelled'), 0)
         - coalesce((select sum(p.amount) from customer_payments p where p.customer_id = c.id), 0)
         as balance
    from customers c
   where c.active;

-- للعمّال: الطلبيات الجارية فقط، بدون أي مبلغ (لاختيار الطلبية عند إخراج المواد)
create view orders_public as
  select o.id, o.title, c.name as customer_name, o.due_date, o.status
    from orders o
    join customers c on c.id = o.customer_id
   where o.status in ('new', 'in_production');

-- ---------- 5) الصلاحيات (RLS) ----------
alter table customers         enable row level security;
alter table orders            enable row level security;
alter table order_items       enable row level security;
alter table customer_payments enable row level security;

create policy admin_all on customers         for all using (is_admin()) with check (is_admin());
create policy admin_all on orders            for all using (is_admin()) with check (is_admin());
create policy admin_all on order_items       for all using (is_admin()) with check (is_admin());
create policy admin_all on customer_payments for all using (is_admin()) with check (is_admin());

revoke all on order_totals, customer_balances, orders_public from anon;
grant select on orders_public to authenticated;
