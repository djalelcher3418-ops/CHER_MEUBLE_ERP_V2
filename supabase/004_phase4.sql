-- =====================================================================
-- CHER MEUBLE ERP — المرحلة 4
-- لوحة الورشة للعمّال + سجل حالات الطلبية
-- يُشغَّل مرة واحدة بعد 003_phase3.sql (Supabase → SQL Editor → Run)
-- =====================================================================

-- ---------- 1) سجل الحالات: من غيّر حالة الطلبية ومتى ----------
create table order_events (
  id          bigint generated always as identity primary key,
  order_id    bigint not null references orders(id) on delete cascade,
  status      order_status not null,
  created_by  uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index on order_events (order_id, created_at);

create or replace function log_order_status() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into order_events (order_id, status, created_by) values (new.id, new.status, auth.uid());
  end if;
  return new;
end $$;

create trigger trg_log_order_status
  after insert or update of status on orders
  for each row execute function log_order_status();

-- الطلبيات الموجودة قبل هذه المرحلة: نسجّل حالتها الحالية مرة واحدة
insert into order_events (order_id, status, created_by, created_at)
  select id, status, created_by, created_at from orders;

alter table order_events enable row level security;
create policy admin_select on order_events for select using (is_admin());

-- ---------- 2) ما يراه العامل في لوحة الورشة (بدون أي مبلغ) ----------
create or replace view orders_public as
  select o.id, o.title, c.name as customer_name, o.due_date, o.status, o.notes
    from orders o
    join customers c on c.id = o.customer_id
   where o.status in ('new', 'in_production');

create view order_items_public as
  select i.id, i.order_id, i.description, i.qty
    from order_items i
    join orders o on o.id = i.order_id
   where o.status in ('new', 'in_production');

revoke all on orders_public, order_items_public from anon;
grant select on orders_public, order_items_public to authenticated;

-- ---------- 3) العامل يغيّر الحالة خطوة واحدة فقط إلى الأمام ----------
-- جديدة → في الورشة، في الورشة → جاهزة. باقي التغييرات للمدير.
create or replace function workshop_set_status(p_order bigint, p_status order_status) returns void
language plpgsql security definer set search_path = public as $$
declare cur order_status;
begin
  if not exists (select 1 from profiles where id = auth.uid() and active) then
    raise exception 'ليست لديك صلاحية لهذه العملية';
  end if;
  select status into cur from orders where id = p_order for update;
  if cur is null then
    raise exception 'الطلبية غير موجودة';
  end if;
  if not ((cur = 'new' and p_status = 'in_production') or (cur = 'in_production' and p_status = 'ready')) then
    raise exception 'لا يمكن تغيير حالة هذه الطلبية من الورشة';
  end if;
  update orders set status = p_status where id = p_order;
end $$;

revoke all on function workshop_set_status(bigint, order_status) from public, anon;
grant execute on function workshop_set_status(bigint, order_status) to authenticated;
