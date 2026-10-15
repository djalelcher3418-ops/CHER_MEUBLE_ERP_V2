-- =====================================================================
-- CHER MEUBLE ERP — المرحلة 14: «الفريق» — منشورات، شكر الزملاء، وألعاب تنافس
-- منشورات مثل إنستغرام (نص + صورة، تفاعلات، تعليقات)، بطاقة «شكرًا لزميل»،
-- ولعبتان قصيرتان مع ترتيب أسبوعي. كل الحسابات النشطة (مدير وعمّال) تشارك.
-- يُشغَّل مرة واحدة بعد 013_fabric_legs.sql (Supabase → SQL Editor → Run)
-- =====================================================================

do $$ begin
  if erp_schema_version() < 13 then
    raise exception 'شغّل الملف 013_fabric_legs.sql أولًا ثم أعد تشغيل هذا الملف';
  end if;
  if erp_schema_version() > 14 then
    raise exception 'هذا الملف شُغّل من قبل وقاعدة البيانات أحدث منه — لا حاجة لتشغيله';
  end if;
end $$;

-- ---------- 1) المنشورات ----------
-- kind: post = منشور عادي، kudos = شكر زميل، game = إنجاز في لعبة (يكتبه النظام)
create table if not exists team_posts (
  id           bigint generated always as identity primary key,
  kind         text not null default 'post' check (kind in ('post', 'kudos', 'game')),
  author_id    uuid references profiles(id) on delete cascade default auth.uid(),
  author_name  text,
  body         text check (body is null or length(body) <= 2000),
  image_path   text,
  kudos_to     uuid references profiles(id) on delete set null,
  kudos_name   text,
  created_at   timestamptz not null default now(),
  check (coalesce(length(trim(body)), 0) > 0 or image_path is not null),
  check (kind <> 'kudos' or kudos_to is not null)
);
create index if not exists team_posts_recent on team_posts (id desc);

create table if not exists team_post_reactions (
  post_id     bigint not null references team_posts(id) on delete cascade,
  profile_id  uuid not null references profiles(id) on delete cascade default auth.uid(),
  emoji       text not null check (emoji in ('❤️', '👏', '😂', '🔥')),
  created_at  timestamptz not null default now(),
  primary key (post_id, profile_id, emoji)
);

create table if not exists team_post_comments (
  id           bigint generated always as identity primary key,
  post_id      bigint not null references team_posts(id) on delete cascade,
  author_id    uuid references profiles(id) on delete cascade default auth.uid(),
  author_name  text,
  body         text not null check (length(trim(body)) between 1 and 1000),
  created_at   timestamptz not null default now()
);
create index if not exists team_post_comments_post on team_post_comments (post_id, id);

-- آخر مرة فتح فيها كل شخص صفحة المنشورات (لعدّ الجديد)
create table if not exists feed_reads (
  profile_id    uuid primary key references profiles(id) on delete cascade,
  last_seen_at  timestamptz not null default now()
);

-- الكاتب واسمه (واسم الزميل المشكور) يُسجَّلون من الحسابات نفسها، فلا انتحال
create or replace function stamp_team_post() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.author_id := auth.uid();
  new.author_name := (select full_name from profiles where id = auth.uid());
  new.created_at := now();
  if new.kind = 'kudos' then
    if new.kudos_to = auth.uid() then raise exception 'لا يمكنك شكر نفسك 🙂'; end if;
    new.kudos_name := (select full_name from profiles where id = new.kudos_to and active);
    if new.kudos_name is null then raise exception 'الزميل غير موجود'; end if;
  else
    new.kudos_to := null;
    new.kudos_name := null;
  end if;
  return new;
end $$;

drop trigger if exists trg_stamp_team_post on team_posts;
create trigger trg_stamp_team_post before insert on team_posts
  for each row execute function stamp_team_post();

create or replace function stamp_team_comment() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.author_id := auth.uid();
  new.author_name := (select full_name from profiles where id = auth.uid());
  new.created_at := now();
  return new;
end $$;

drop trigger if exists trg_stamp_team_comment on team_post_comments;
create trigger trg_stamp_team_comment before insert on team_post_comments
  for each row execute function stamp_team_comment();

-- ---------- 2) الألعاب ----------
create table if not exists game_scores (
  id           bigint generated always as identity primary key,
  profile_id   uuid not null references profiles(id) on delete cascade,
  player_name  text,
  game         text not null check (game in ('memory', 'math')),
  score        int not null check (score between 0 and 1000),
  created_at   timestamptz not null default now()
);
create index if not exists game_scores_week on game_scores (game, created_at desc);

-- بداية الأسبوع (السبت) بتوقيت الجزائر
create or replace function game_week_start() returns timestamptz
language sql stable as $$
  select (((now() at time zone 'Africa/Algiers')::date
           - ((extract(dow from (now() at time zone 'Africa/Algiers'))::int + 1) % 7))::timestamp)
         at time zone 'Africa/Algiers';
$$;

-- تسجيل نتيجة: إن تجاوزت أفضل نتيجة في الأسبوع ينزل منشور تهنئة تلقائي
create or replace function submit_game_score(p_game text, p_score int) returns json
language plpgsql security definer set search_path = public as $$
declare
  me_name text;
  prev_top int;
  my_best int;
  label text := case p_game when 'memory' then 'لعبة الذاكرة' when 'math' then 'حساب الورشة' end;
begin
  select full_name into me_name from profiles where id = auth.uid() and active;
  if me_name is null then raise exception 'غير مسموح'; end if;
  if label is null then raise exception 'لعبة غير معروفة'; end if;
  if p_score is null or p_score < 0 or p_score > 1000 then raise exception 'نتيجة غير صحيحة'; end if;

  select max(score) into prev_top from game_scores where game = p_game and created_at >= game_week_start();
  insert into game_scores (profile_id, player_name, game, score) values (auth.uid(), me_name, p_game, p_score);
  select max(score) into my_best from game_scores
   where game = p_game and profile_id = auth.uid() and created_at >= game_week_start();

  if p_score > 0 and (prev_top is null or p_score > prev_top) then
    insert into team_posts (kind, body)
    values ('game', format('🏆 صار الأول هذا الأسبوع في «%s» بـ %s نقطة! من يتحدّاه؟', label, p_score));
    return json_build_object('top', true, 'best', my_best);
  end if;
  return json_build_object('top', false, 'best', my_best);
end $$;

-- الترتيب: أفضل نتيجة لكل شخص (هذا الأسبوع أو منذ البداية)
create or replace function game_leaderboard(p_game text, p_all boolean default false)
returns table (profile_id uuid, player_name text, best int, plays int)
language sql stable security invoker set search_path = public as $$
  select s.profile_id, (array_agg(s.player_name order by s.created_at desc))[1], max(s.score)::int, count(*)::int
    from game_scores s
   where s.game = p_game and (p_all or s.created_at >= game_week_start())
   group by s.profile_id
   order by max(s.score) desc, min(s.created_at)
   limit 20;
$$;

-- ---------- 3) القائمة والعدّادات ----------
create or replace function team_feed(p_before bigint default null, p_limit int default 30)
returns table (id bigint, kind text, author_id uuid, author_name text, body text, image_path text,
               kudos_to uuid, kudos_name text, created_at timestamptz,
               reactions jsonb, my_reactions text[], comments int)
language sql stable security invoker set search_path = public as $$
  select p.id, p.kind, p.author_id, p.author_name, p.body, p.image_path, p.kudos_to, p.kudos_name, p.created_at,
         coalesce((select jsonb_object_agg(x.emoji, x.n)
                     from (select r.emoji, count(*) as n from team_post_reactions r where r.post_id = p.id group by r.emoji) x),
                  '{}'::jsonb),
         coalesce((select array_agg(r.emoji) from team_post_reactions r where r.post_id = p.id and r.profile_id = auth.uid()),
                  '{}'::text[]),
         (select count(*)::int from team_post_comments c where c.post_id = p.id)
    from team_posts p
   where p_before is null or p.id < p_before
   order by p.id desc
   limit least(greatest(coalesce(p_limit, 30), 1), 100);
$$;

-- عدد المنشورات الجديدة من الآخرين منذ آخر زيارة (أول مرة: آخر 3 أيام)
create or replace function feed_unread() returns int
language sql stable security invoker set search_path = public as $$
  select count(*)::int
    from team_posts p
   where p.author_id is distinct from auth.uid()
     and p.created_at > coalesce((select last_seen_at from feed_reads where profile_id = auth.uid()), now() - interval '3 days');
$$;

create or replace function mark_feed_seen() returns void
language sql security invoker set search_path = public as $$
  insert into feed_reads (profile_id, last_seen_at) values (auth.uid(), now())
  on conflict (profile_id) do update set last_seen_at = excluded.last_seen_at;
$$;

-- أسماء الزملاء النشطين (لاختيار من نشكر) — بدون أي بيانات أخرى
create or replace function team_members() returns table (id uuid, full_name text, role text)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.role::text from profiles p
   where p.active and is_active_user()
   order by p.full_name;
$$;

-- ---------- 4) الصلاحيات (RLS) ----------
alter table team_posts          enable row level security;
alter table team_post_reactions enable row level security;
alter table team_post_comments  enable row level security;
alter table feed_reads          enable row level security;
alter table game_scores         enable row level security;

drop policy if exists active_select on team_posts;
drop policy if exists own_insert on team_posts;
drop policy if exists own_or_admin_delete on team_posts;
create policy active_select on team_posts for select to authenticated using (is_active_user());
create policy own_insert on team_posts for insert to authenticated
  with check (is_active_user() and kind in ('post', 'kudos'));
create policy own_or_admin_delete on team_posts for delete to authenticated
  using (is_active_user() and (author_id = auth.uid() or is_admin()));

drop policy if exists active_select on team_post_reactions;
drop policy if exists own_insert on team_post_reactions;
drop policy if exists own_delete on team_post_reactions;
create policy active_select on team_post_reactions for select to authenticated using (is_active_user());
create policy own_insert on team_post_reactions for insert to authenticated
  with check (is_active_user() and profile_id = auth.uid());
create policy own_delete on team_post_reactions for delete to authenticated using (profile_id = auth.uid());

drop policy if exists active_select on team_post_comments;
drop policy if exists own_insert on team_post_comments;
drop policy if exists own_or_admin_delete on team_post_comments;
create policy active_select on team_post_comments for select to authenticated using (is_active_user());
create policy own_insert on team_post_comments for insert to authenticated with check (is_active_user());
create policy own_or_admin_delete on team_post_comments for delete to authenticated
  using (is_active_user() and (author_id = auth.uid() or is_admin()));

drop policy if exists own_all on feed_reads;
create policy own_all on feed_reads for all to authenticated
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- النتائج تُكتب فقط عبر submit_game_score؛ المدير يستطيع حذفها (إعادة البداية)
drop policy if exists active_select on game_scores;
drop policy if exists admin_delete on game_scores;
create policy active_select on game_scores for select to authenticated using (is_active_user());
create policy admin_delete on game_scores for delete to authenticated using (is_admin());

revoke all on function submit_game_score(text, int), game_leaderboard(text, boolean), team_feed(bigint, int),
  feed_unread(), mark_feed_seen(), team_members(), game_week_start() from public, anon;
grant execute on function submit_game_score(text, int), game_leaderboard(text, boolean), team_feed(bigint, int),
  feed_unread(), mark_feed_seen(), team_members(), game_week_start() to authenticated;

-- ---------- 5) صور المنشورات (Supabase Storage) ----------
-- كل صورة في مجلد باسم صاحبها: team/<profile_id>/<ملف>.jpg
insert into storage.buckets (id, name, public) values ('team', 'team', false)
  on conflict (id) do nothing;

drop policy if exists team_images_read on storage.objects;
drop policy if exists team_images_upload on storage.objects;
drop policy if exists team_images_delete on storage.objects;
create policy team_images_read on storage.objects for select to authenticated
  using (bucket_id = 'team' and is_active_user());
create policy team_images_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'team' and is_active_user() and (storage.foldername(name))[1] = auth.uid()::text);
create policy team_images_delete on storage.objects for delete to authenticated
  using (bucket_id = 'team' and is_active_user() and ((storage.foldername(name))[1] = auth.uid()::text or is_admin()));

-- ---------- 6) التحديث الفوري (Realtime) ----------
do $$ begin
  begin alter publication supabase_realtime add table team_posts; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table team_post_reactions; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table team_post_comments; exception when duplicate_object then null; end;
end $$;

create or replace function erp_schema_version() returns int
language sql stable as $$ select 14 $$;
