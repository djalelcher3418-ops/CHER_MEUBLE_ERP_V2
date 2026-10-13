-- =====================================================================
-- CHER MEUBLE ERP — المرحلة 6: التنبيهات والتطبيق مغلق (Web Push)
-- يُشغَّل مرة واحدة بعد 005_messages.sql (Supabase → SQL Editor → Run)
-- ثم تُنشر الدالة supabase/functions/send-push (انظر README)
-- =====================================================================

-- كل هاتف فعّل التنبيهات له اشتراك واحد
create table push_subscriptions (
  id          bigint generated always as identity primary key,
  profile_id  uuid not null references profiles(id) on delete cascade default auth.uid(),
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now()
);
create index on push_subscriptions (profile_id);

alter table push_subscriptions enable row level security;
create policy own_select on push_subscriptions for select to authenticated using (profile_id = auth.uid());
create policy own_delete on push_subscriptions for delete to authenticated using (profile_id = auth.uid());

-- حفظ اشتراك هذا الهاتف للحساب الحالي (إن كان الهاتف مسجّلًا لشخص آخر من قبل، يُنقل له)
create or replace function save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and active) then
    raise exception 'ليست لديك صلاحية لهذه العملية';
  end if;
  insert into push_subscriptions (profile_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, p_user_agent)
  on conflict (endpoint) do update
    set profile_id = excluded.profile_id, p256dh = excluded.p256dh, auth = excluded.auth,
        user_agent = excluded.user_agent, created_at = now();
end $$;

revoke all on function save_push_subscription(text, text, text, text) from public, anon;
grant execute on function save_push_subscription(text, text, text, text) to authenticated;

-- مفاتيح VAPID: تُنشئها الدالة send-push أول مرة وتحفظها هنا. لا يقرؤها أي مستخدم.
create table push_config (
  id           int primary key default 1 check (id = 1),
  public_key   text not null,
  private_key  text not null,
  created_at   timestamptz not null default now()
);
alter table push_config enable row level security;
revoke all on push_config from anon, authenticated;
