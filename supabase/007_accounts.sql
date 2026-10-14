-- =====================================================================
-- CHER MEUBLE ERP — المرحلة 7: حسابات الدخول بالهاتف
-- يُشغَّل مرة واحدة بعد 006_push.sql (Supabase → SQL Editor → Run)
-- ثم تُنشر الدالة supabase/functions/manage-users (انظر README)
-- =====================================================================

-- إذا أصبح عامل مديرًا: تُحذف دردشته الخاصة إن كانت فارغة (المدير يرى كل الدردشات أصلًا)
create or replace function ensure_worker_chat() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role = 'worker' then
    insert into chats (kind, worker_id) values ('worker', new.id) on conflict (worker_id) do nothing;
  else
    delete from chats c
     where c.worker_id = new.id
       and not exists (select 1 from messages m where m.chat_id = c.id);
  end if;
  return new;
end $$;

-- تنظيف ما سبق
delete from chats c
 using profiles p
 where p.id = c.worker_id and p.role = 'admin'
   and not exists (select 1 from messages m where m.chat_id = c.id);

-- قائمة الدردشات لا تعرض إلا دردشات العمّال (لا المديرين)
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
     and (c.kind = 'team' or (w.active and w.role = 'worker'))
   order by (c.kind = 'team') desc, lm.created_at desc nulls last, title;
$$;

-- رقم الهاتف لا يتكرر بين الحسابات
create unique index if not exists profiles_phone_unique on profiles (phone) where phone is not null;
