-- =====================================================================
-- CHER MEUBLE ERP — المرحلة 16: صورة فاتورة المورد مع كل شراء
-- الصور في مخزن خاص «purchases» لا يراه إلا المدير: purchases/<رقم الشراء>/<ملف>.jpg
-- يُشغَّل مرة واحدة بعد 015_tetris.sql (Supabase → SQL Editor → Run)
-- =====================================================================

do $$ begin
  if erp_schema_version() < 15 then
    raise exception 'شغّل الملف 015_tetris.sql أولًا ثم أعد تشغيل هذا الملف';
  end if;
  if erp_schema_version() > 16 then
    raise exception 'هذا الملف شُغّل من قبل وقاعدة البيانات أحدث منه — لا حاجة لتشغيله';
  end if;
end $$;

alter table purchases add column if not exists invoice_photo text check (invoice_photo is null or length(invoice_photo) <= 200);

insert into storage.buckets (id, name, public) values ('purchases', 'purchases', false)
  on conflict (id) do nothing;

drop policy if exists purchase_photos_read on storage.objects;
drop policy if exists purchase_photos_upload on storage.objects;
drop policy if exists purchase_photos_delete on storage.objects;
create policy purchase_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'purchases' and is_admin());
create policy purchase_photos_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'purchases' and is_admin());
create policy purchase_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'purchases' and is_admin());

create or replace function erp_schema_version() returns int
language sql stable as $$ select 16 $$;
