-- =====================================================================
-- CHER MEUBLE ERP — المرحلة 5: الرسائل بين المدير والعمّال
-- دردشة جماعية «كل الفريق» + دردشة خاصة بين الإدارة وكل عامل، مع الصور
-- يُشغَّل مرة واحدة بعد 004_phase4.sql (Supabase → SQL Editor → Run)
-- =====================================================================

-- ---------- 1) الدردشات ----------
-- team = كل الفريق (واحدة فقط)، worker = خاصة بين عامل واحد والإدارة
create table chats (
  id          bigint generated always as identity primary key,
  kind        text not null check (kind in ('team', 'worker')),
  worker_id   uuid unique references profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  check ((kind = 'team' and worker_id is null) or (kind = 'worker' and worker_id is not null))
);
create unique index chats_one_team on chats (kind) where kind = 'team';

create table messages (
  id           bigint generated always as identity primary key,
  chat_id      bigint not null references chats(id) on delete cascade,
  sender_id    uuid references profiles(id) on delete set null default auth.uid(),
  sender_name  text,
  body         text check (body is null or length(body) <= 4000),
  image_path   text,
  created_at   timestamptz not null default now(),
  check (coalesce(length(trim(body)), 0) > 0 or image_path is not null)
);
create index on messages (chat_id, created_at desc);

-- آخر وقت قرأ فيه كل شخص كل دردشة
create table chat_reads (
  chat_id       bigint not null references chats(id) on delete cascade,
  profile_id    uuid not null references profiles(id) on delete cascade,
  last_read_at  timestamptz not null default now(),
  primary key (chat_id, profile_id)
);

-- من يحق له دخول الدردشة: المدير يدخل الكل، العامل يدخل «كل الفريق» ودردشته فقط
create or replace function can_access_chat(p_chat bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from chats c
      join profiles me on me.id = auth.uid() and me.active
     where c.id = p_chat
       and (me.role = 'admin' or c.kind = 'team' or c.worker_id = me.id)
  );
$$;

-- المرسل واسمه يُسجَّلان من الحساب نفسه، فلا يمكن انتحال اسم شخص آخر
create or replace function stamp_message_sender() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.sender_id := auth.uid();
  new.sender_name := (select full_name from profiles where id = auth.uid());
  new.created_at := now();
  return new;
end $$;

create trigger trg_stamp_message_sender
  before insert on messages
  for each row execute function stamp_message_sender();

-- ---------- 2) إنشاء الدردشات تلقائيًا ----------
insert into chats (kind) values ('team');

create or replace function ensure_worker_chat() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role = 'worker' then
    insert into chats (kind, worker_id) values ('worker', new.id) on conflict (worker_id) do nothing;
  end if;
  return new;
end $$;

create trigger trg_ensure_worker_chat
  after insert or update of role on profiles
  for each row execute function ensure_worker_chat();

-- العمّال الموجودون قبل هذه المرحلة
insert into chats (kind, worker_id)
  select 'worker', id from profiles where role = 'worker'
  on conflict (worker_id) do nothing;

-- ---------- 3) قائمة الدردشات مع آخر رسالة وعدد غير المقروء ----------
create or replace function chat_overview()
returns table (chat_id bigint, kind text, title text, last_text text, last_at timestamptz, unread integer)
language sql stable security invoker set search_path = public as $$
  select c.id as chat_id,
         c.kind,
         case when c.kind = 'team' then 'كل الفريق'
              when c.worker_id = auth.uid() then 'الإدارة'
              else coalesce(w.full_name, 'عامل') end as title,
         lm.last_text,
         lm.created_at as last_at,
         (select count(*)::int from messages m
           where m.chat_id = c.id
             and m.sender_id is distinct from auth.uid()
             and m.created_at > coalesce(r.last_read_at, '-infinity')) as unread
    from chats c
    left join profiles w on w.id = c.worker_id
    left join chat_reads r on r.chat_id = c.id and r.profile_id = auth.uid()
    left join lateral (
      select coalesce(nullif(trim(m.body), ''), '📷 صورة') as last_text, m.created_at
        from messages m where m.chat_id = c.id
       order by m.created_at desc limit 1
    ) lm on true
   where can_access_chat(c.id)
     and (c.kind = 'team' or w.active)
   order by (c.kind = 'team') desc, lm.created_at desc nulls last, title;
$$;

create or replace function mark_chat_read(p_chat bigint) returns void
language sql security invoker set search_path = public as $$
  insert into chat_reads (chat_id, profile_id, last_read_at)
  values (p_chat, auth.uid(), now())
  on conflict (chat_id, profile_id) do update set last_read_at = excluded.last_read_at;
$$;

-- ---------- 4) الصلاحيات (RLS) ----------
alter table chats      enable row level security;
alter table messages   enable row level security;
alter table chat_reads enable row level security;

create policy member_select on chats for select to authenticated using (can_access_chat(id));

create policy member_select on messages for select to authenticated using (can_access_chat(chat_id));
create policy member_insert on messages for insert to authenticated with check (can_access_chat(chat_id));
create policy own_or_admin_delete on messages for delete to authenticated
  using (can_access_chat(chat_id) and (sender_id = auth.uid() or is_admin()));

create policy member_select on chat_reads for select to authenticated using (can_access_chat(chat_id));
create policy own_insert on chat_reads for insert to authenticated
  with check (profile_id = auth.uid() and can_access_chat(chat_id));
create policy own_update on chat_reads for update to authenticated
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());

revoke all on function chat_overview(), mark_chat_read(bigint), can_access_chat(bigint) from anon;

-- ---------- 5) الصور (Supabase Storage) ----------
-- كل صورة تُحفظ في مجلد باسم رقم الدردشة: chat/<chat_id>/<ملف>.jpg
insert into storage.buckets (id, name, public) values ('chat', 'chat', false)
  on conflict (id) do nothing;

create or replace function can_access_chat_file(p_bucket text, p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
           when p_bucket = 'chat' and (storage.foldername(p_name))[1] ~ '^[0-9]+$'
             then can_access_chat(((storage.foldername(p_name))[1])::bigint)
           else false
         end;
$$;

create policy chat_images_read on storage.objects for select to authenticated
  using (can_access_chat_file(bucket_id, name));
create policy chat_images_upload on storage.objects for insert to authenticated
  with check (can_access_chat_file(bucket_id, name));
revoke all on function can_access_chat_file(text, text) from anon;

-- ---------- 6) وصول الرسائل فورًا (Realtime) ----------
alter publication supabase_realtime add table messages;
alter publication supabase_realtime add table chat_reads;
