-- =====================================================================
-- CHER MEUBLE ERP — المرحلة 3
-- العمّال والرواتب (أجر يومي، غيابات، تسبيقات) + المصاريف العامة
-- يُشغَّل مرة واحدة بعد 002_phase2.sql (Supabase → SQL Editor → Run)
-- =====================================================================

-- ---------- 1) العمّال ----------
-- عامل الورشة قد لا يملك حسابًا في التطبيق؛ profile_id اختياري
create table employees (
  id          bigint generated always as identity primary key,
  full_name   text not null,
  phone       text,
  daily_wage  numeric(14,2) not null default 0 check (daily_wage >= 0),
  profile_id  uuid unique references profiles(id) on delete set null,
  hired_on    date,
  notes       text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- غياب يوم كامل أو نصف يوم
create table absences (
  id           bigint generated always as identity primary key,
  employee_id  bigint not null references employees(id) on delete cascade,
  day          date not null,
  half_day     boolean not null default false,
  note         text,
  created_by   uuid references profiles(id) default auth.uid(),
  unique (employee_id, day)
);

create table employee_advances (
  id           bigint generated always as identity primary key,
  employee_id  bigint not null references employees(id) on delete cascade,
  amount       numeric(14,2) not null check (amount > 0),
  given_on     date not null default current_date,
  notes        text,
  created_by   uuid references profiles(id) default auth.uid(),
  created_at   timestamptz not null default now()
);

-- تسوية راتب فترة: ما دُفع للعامل في آخر الفترة (بعد خصم التسبيقات)
create table payroll_payments (
  id            bigint generated always as identity primary key,
  employee_id   bigint not null references employees(id) on delete cascade,
  period_start  date not null,
  period_end    date not null check (period_end >= period_start),
  days_worked   numeric(6,1) not null,
  daily_wage    numeric(14,2) not null,
  gross         numeric(14,2) not null,
  advances      numeric(14,2) not null default 0,
  amount        numeric(14,2) not null check (amount >= 0),   -- الصافي المدفوع
  paid_on       date not null default current_date,
  notes         text,
  created_by    uuid references profiles(id) default auth.uid(),
  created_at    timestamptz not null default now(),
  unique (employee_id, period_start)
);

create index on absences (employee_id, day);
create index on employee_advances (employee_id, given_on);
create index on payroll_payments (paid_on);

-- ---------- 2) المصاريف العامة ----------
create table expense_categories (
  id    bigint generated always as identity primary key,
  name  text not null unique
);

insert into expense_categories (name) values
  ('كراء'), ('كهرباء وغاز'), ('ماء'), ('نقل وتوصيل'), ('صيانة وأدوات'), ('ضرائب ورسوم'), ('أخرى');

create table expenses (
  id           bigint generated always as identity primary key,
  category_id  bigint references expense_categories(id),
  amount       numeric(14,2) not null check (amount > 0),
  spent_on     date not null default current_date,
  description  text,
  method       text not null default 'cash' check (method in ('cash','cheque','transfer')),
  created_by   uuid references profiles(id) default auth.uid(),
  created_at   timestamptz not null default now()
);

create index on expenses (spent_on);

-- ---------- 3) الصلاحيات (RLS) ----------
alter table employees          enable row level security;
alter table absences           enable row level security;
alter table employee_advances  enable row level security;
alter table payroll_payments   enable row level security;
alter table expense_categories enable row level security;
alter table expenses           enable row level security;

create policy admin_all on employees          for all using (is_admin()) with check (is_admin());
create policy admin_all on absences           for all using (is_admin()) with check (is_admin());
create policy admin_all on employee_advances  for all using (is_admin()) with check (is_admin());
create policy admin_all on payroll_payments   for all using (is_admin()) with check (is_admin());
create policy admin_all on expense_categories for all using (is_admin()) with check (is_admin());
create policy admin_all on expenses           for all using (is_admin()) with check (is_admin());

-- العامل المرتبط بحساب يرى بياناته فقط (صفحة «راتبي»)، ولا يعدّل شيئًا
create or replace function my_employee_id() returns bigint
language sql stable security definer set search_path = public as $$
  select id from employees where profile_id = auth.uid() and active
$$;

create policy self_select on employees         for select to authenticated using (profile_id = auth.uid());
create policy self_select on absences          for select to authenticated using (employee_id = my_employee_id());
create policy self_select on employee_advances for select to authenticated using (employee_id = my_employee_id());
create policy self_select on payroll_payments  for select to authenticated using (employee_id = my_employee_id());
