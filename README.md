# CHER MEUBLE ERP

نظام تسيير ورشة CHER MEUBLE — TypeScript + React + Vite + Supabase، يُنشر على Netlify.

## المرحلة 1
- تسجيل الدخول (مدير / عامل)
- المواد: إضافة، تعديل، جرد، سجل الحركات، طباعة ملصقات الباركود
- الموردون: الحساب، الدفعات، كشف الحساب، الدين القديم
- المشتريات: فاتورة بعدة أسطر، دفع جزئي، تدخل المواد للمخزون تلقائيًا
- إخراج المواد: مسح الباركود بكاميرا الهاتف (العامل لا يرى الأسعار)
- الرئيسية: قيمة المخزون، الديون، المواد الناقصة، آخر ما خرج

## قاعدة البيانات
ملف `supabase/001_phase1.sql` (مُشغَّل مسبقًا على Supabase).

## التشغيل على الكمبيوتر
```
npm install
copy .env.example .env      (ثم ضع المفتاح العام)
npm run dev
```

## النشر على Netlify
- Build command: `npm run build`
- Publish directory: `dist`
- Environment variables: `VITE_SUPABASE_URL` و `VITE_SUPABASE_ANON_KEY`

## أدوات مستقلة في نفس المستودع

هذه صفحات HTML منفصلة عن تطبيق ERP، تُفتح مباشرة في المتصفح:

| المجلد | الأداة |
|---|---|
| `designer/` | مصمم الأثاث: تصميم الأسرّة والغرف، مخطط القصّ، الملصقات، حساب السعر. |
| `team/` | فريق شير موبل: دردشة المدير والعمال، الطلبيات، الإعلانات، الرواتب (Firebase). |

## مصدر الكود

- تطبيق ERP: https://claude.ai/artifact/HH8S54Qt7RWtKfaKEZTwoD
- مصمم الأثاث: https://claude.ai/artifact/QqGYap1TMdnYYoHS3MGBFf
- فريق شير موبل: https://claude.ai/artifact/Qahxx4oajuZRVShUyGpTTC
