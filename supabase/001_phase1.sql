-- =====================================================================
-- CHER MEUBLE ERP — المرحلة 1
-- الحسابات والأدوار + المواد + المخزون + الموردون + المشتريات + الباركود
-- PostgreSQL / Supabase
-- =====================================================================

-- ---------- 1) الحسابات والأدوار ----------
create type user_role as enum ('admin', 'worker');

create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null,
  role        user_role not null default 'worker',
  phone       text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin' and active
  );
$$;

-- عند إنشاء أي مستخدم جديد: نُنشئ له profile تلقائيًا.
-- أول مستخدم يُنشأ يصبح مديرًا (admin)، والبقية عمّال (worker).
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    case when exists (select 1 from profiles where role = 'admin')
         then 'worker'::user_role else 'admin'::user_role end
  );
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------- 2) الموردون ----------
create table suppliers (
  id               bigint generated always as identity primary key,
  name             text not null,
  phone            text,
  address          text,
  notes            text,
  opening_balance  numeric(14,2) not null default 0,  -- دين قديم لهم قبل بدء النظام
  active           boolean not null default true,
  created_at       timestamptz not null default now()
);

-- ---------- 3) المواد ----------
create table material_categories (
  id    bigint generated always as identity primary key,
  name  text not null unique
);

insert into material_categories (name) values
  ('MDF وخشب'), ('قماش'), ('إسفنج'), ('لواحق وخردوات'), ('غراء ومواد كيميائية'), ('تغليف'), ('أخرى');

create sequence material_barcode_seq start 1000;

create table materials (
  id           bigint generated always as identity primary key,
  name         text not null,
  category_id  bigint references material_categories(id),
  unit         text not null check (unit in ('piece','sheet','meter','m2','kg','liter','roll','box')),
  barcode      text not null unique default ('CM' || nextval('material_barcode_seq')),
  qty          numeric(14,3) not null default 0,   -- الكمية الحالية (مجموع، وليس قطعة بقطعة)
  avg_cost     numeric(14,2) not null default 0,   -- متوسط سعر الشراء
  min_qty      numeric(14,3) not null default 0,   -- حد التنبيه
  notes        text,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

-- ---------- 4) المشتريات والدفعات ----------
create table purchases (
  id             bigint generated always as identity primary key,
  supplier_id    bigint references suppliers(id),
  purchase_date  date not null default current_date,
  invoice_ref    text,
  notes          text,
  created_by     uuid references profiles(id) default auth.uid(),
  created_at     timestamptz not null default now()
);

create table purchase_items (
  id           bigint generated always as identity primary key,
  purchase_id  bigint not null references purchases(id) on delete cascade,
  material_id  bigint not null references materials(id),
  qty          numeric(14,3) not null check (qty > 0),
  unit_price   numeric(14,2) not null check (unit_price >= 0)
);

create table supplier_payments (
  id           bigint generated always as identity primary key,
  supplier_id  bigint not null references suppliers(id),
  purchase_id  bigint references purchases(id) on delete set null,
  amount       numeric(14,2) not null check (amount > 0),
  paid_on      date not null default current_date,
  method       text not null default 'cash' check (method in ('cash','cheque','transfer')),
  notes        text,
  created_by   uuid references profiles(id) default auth.uid(),
  created_at   timestamptz not null default now()
);

-- ---------- 5) حركات المخزون ----------
-- in = دخول (شراء)، out = خروج إلى الورشة، adjust = تصحيح جرد (+ أو -)
create type movement_type as enum ('in', 'out', 'adjust');

create table stock_movements (
  id                bigint generated always as identity primary key,
  material_id       bigint not null references materials(id),
  type              movement_type not null,
  qty               numeric(14,3) not null,
  unit_cost         numeric(14,2),
  purchase_item_id  bigint references purchase_items(id) on delete set null,
  note              text,
  created_by        uuid references profiles(id) default auth.uid(),
  created_at        timestamptz not null default now(),
  check ((type in ('in','out') and qty > 0) or (type = 'adjust' and qty <> 0))
);

create index on stock_movements (material_id, created_at desc);
create index on purchase_items (purchase_id);
create index on supplier_payments (supplier_id);

-- كل حركة تُحدّث كمية المادة ومتوسط سعرها تلقائيًا
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
    new.unit_cost := coalesce(new.unit_cost, m.avg_cost);  -- لحساب التكلفة لاحقًا
    update materials set qty = m.qty - new.qty where id = m.id;
  else
    new.unit_cost := coalesce(new.unit_cost, m.avg_cost);
    update materials set qty = m.qty + new.qty where id = m.id;
  end if;
  return new;
end $$;

create trigger trg_apply_stock_movement
  before insert on stock_movements
  for each row execute function apply_stock_movement();

-- سطر الشراء يُدخل المادة إلى المخزون تلقائيًا، وحذفه يُرجعها
create or replace function purchase_item_to_stock() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into stock_movements (material_id, type, qty, unit_cost, purchase_item_id, note)
    values (new.material_id, 'in', new.qty, new.unit_price, new.id, 'شراء رقم ' || new.purchase_id);
    return new;
  elsif tg_op = 'DELETE' then
    insert into stock_movements (material_id, type, qty, note)
    values (old.material_id, 'adjust', -old.qty, 'إلغاء سطر من الشراء رقم ' || old.purchase_id);
    return old;
  else
    raise exception 'لا يمكن تعديل سطر شراء. احذفه وأدخله من جديد.';
  end if;
end $$;

create trigger trg_purchase_item_to_stock
  after insert or update or delete on purchase_items
  for each row execute function purchase_item_to_stock();

-- ---------- 6) العروض (Views) ----------
-- للعمّال: المواد بدون أي سعر
create view materials_public as
  select m.id, m.name, c.name as category, m.unit, m.barcode, m.qty, m.min_qty,
         (m.qty <= m.min_qty) as low_stock
    from materials m
    left join material_categories c on c.id = m.category_id
   where m.active;

-- للمدير فقط (تخضع للصلاحيات)
create view purchase_totals with (security_invoker = true) as
  select p.id, p.supplier_id, p.purchase_date, p.invoice_ref,
         coalesce((select sum(i.qty * i.unit_price) from purchase_items i where i.purchase_id = p.id), 0) as total,
         coalesce((select sum(sp.amount) from supplier_payments sp where sp.purchase_id = p.id), 0) as paid
    from purchases p;

create view supplier_balances with (security_invoker = true) as
  select s.id, s.name, s.phone,
         s.opening_balance
         + coalesce((select sum(i.qty * i.unit_price)
                       from purchase_items i join purchases p on p.id = i.purchase_id
                      where p.supplier_id = s.id), 0)
         - coalesce((select sum(sp.amount) from supplier_payments sp where sp.supplier_id = s.id), 0)
         as balance
    from suppliers s;

create view stock_value with (security_invoker = true) as
  select m.id, m.name, m.qty, m.avg_cost, round(m.qty * m.avg_cost, 2) as value
    from materials m where m.active;

-- ---------- 7) الصلاحيات (RLS) ----------
alter table profiles            enable row level security;
alter table suppliers           enable row level security;
alter table material_categories enable row level security;
alter table materials           enable row level security;
alter table purchases           enable row level security;
alter table purchase_items      enable row level security;
alter table supplier_payments   enable row level security;
alter table stock_movements     enable row level security;

-- المدير: كل شيء
create policy admin_all on profiles            for all using (is_admin()) with check (is_admin());
create policy admin_all on suppliers           for all using (is_admin()) with check (is_admin());
create policy admin_all on material_categories for all using (is_admin()) with check (is_admin());
create policy admin_all on materials           for all using (is_admin()) with check (is_admin());
create policy admin_all on purchases           for all using (is_admin()) with check (is_admin());
create policy admin_all on purchase_items      for all using (is_admin()) with check (is_admin());
create policy admin_all on supplier_payments   for all using (is_admin()) with check (is_admin());
create policy admin_select on stock_movements  for select using (is_admin());
create policy admin_insert on stock_movements  for insert with check (is_admin());

-- العامل: يرى حسابه، يرى الأصناف، يُخرج مواد بالباركود، ويرى حركاته فقط
create policy self_select on profiles for select using (id = auth.uid());
create policy auth_select on material_categories for select to authenticated using (true);
create policy worker_out on stock_movements for insert to authenticated
  with check (type = 'out' and created_by = auth.uid());
create policy worker_own on stock_movements for select to authenticated
  using (created_by = auth.uid());

-- حركات المخزون لا تُعدَّل ولا تُحذف (التصحيح يكون بحركة adjust)
revoke update, delete on stock_movements from authenticated, anon;

-- لا شيء للزوار غير المسجّلين
revoke all on materials_public, purchase_totals, supplier_balances, stock_value from anon;
grant select on materials_public to authenticated;
