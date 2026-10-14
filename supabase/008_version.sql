-- =====================================================================
-- CHER MEUBLE ERP — رقم نسخة قاعدة البيانات
-- يُشغَّل بعد 007_accounts.sql. صفحة «حالة النظام» تقرأ هذا الرقم
-- لتعرف أن كل الملفات حتى 008 قد شُغّلت.
-- =====================================================================

create or replace function erp_schema_version() returns int
language sql stable as $$ select 8 $$;

revoke all on function erp_schema_version() from public, anon;
grant execute on function erp_schema_version() to authenticated;
