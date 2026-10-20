-- =====================================================================
-- CHER MEUBLE ERP — المرحلة 20: سعر الشراء
--   آخر سعر شراء لكل مادة (من آخر فاتورة فيها سعر)، يُعرض في صفحة المواد
--   ويُملأ تلقائيًا عند إضافة المادة إلى شراء جديد، بدل متوسط السعر.
-- يُشغَّل مرة واحدة بعد 018_review_fixes.sql (Supabase → SQL Editor → Run)
-- =====================================================================

do $$ begin
  if erp_schema_version() < 18 then
    raise exception 'شغّل الملف 018_review_fixes.sql أولًا ثم أعد تشغيل هذا الملف';
  end if;
  if erp_schema_version() > 19 then
    raise exception 'هذا الملف شُغّل من قبل وقاعدة البيانات أحدث منه — لا حاجة لتشغيله';
  end if;
end $$;

-- الأحدث بتاريخ الفاتورة، ثم بترتيب الإدخال. صلاحيات المشتريات نفسها (المدير فقط)
create or replace view material_last_price with (security_invoker = true) as
  select distinct on (i.material_id)
         i.material_id, i.unit_price as last_price, p.purchase_date as last_date, p.supplier_id
    from purchase_items i
    join purchases p on p.id = i.purchase_id
   where i.unit_price > 0
   order by i.material_id, p.purchase_date desc, i.id desc;
revoke all on material_last_price from anon;
grant select on material_last_price to authenticated;

create or replace function erp_schema_version() returns int
language sql stable as $$ select 19 $$;
