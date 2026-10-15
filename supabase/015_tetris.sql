-- =====================================================================
-- CHER MEUBLE ERP — المرحلة 15: لعبة «تتريس» في صفحة الألعاب
-- نقاط تتريس أكبر من الألعاب الأخرى (حتى 200000)، والباقي كما هو.
-- يُشغَّل مرة واحدة بعد 014_team_social.sql (Supabase → SQL Editor → Run)
-- =====================================================================

do $$ begin
  if erp_schema_version() < 14 then
    raise exception 'شغّل الملف 014_team_social.sql أولًا ثم أعد تشغيل هذا الملف';
  end if;
end $$;

alter table game_scores drop constraint if exists game_scores_game_check;
alter table game_scores drop constraint if exists game_scores_score_check;
alter table game_scores add constraint game_scores_game_check check (game in ('memory', 'math', 'tetris'));
alter table game_scores add constraint game_scores_score_check
  check (score >= 0 and score <= case when game = 'tetris' then 200000 else 1000 end);

create or replace function submit_game_score(p_game text, p_score int) returns json
language plpgsql security definer set search_path = public as $$
declare
  me_name text;
  prev_top int;
  my_best int;
  label text := case p_game when 'memory' then 'لعبة الذاكرة' when 'math' then 'حساب الورشة' when 'tetris' then 'تتريس' end;
  max_score int := case p_game when 'tetris' then 200000 else 1000 end;
begin
  select full_name into me_name from profiles where id = auth.uid() and active;
  if me_name is null then raise exception 'غير مسموح'; end if;
  if label is null then raise exception 'لعبة غير معروفة'; end if;
  if p_score is null or p_score < 0 or p_score > max_score then raise exception 'نتيجة غير صحيحة'; end if;

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

create or replace function erp_schema_version() returns int
language sql stable as $$ select 15 $$;
