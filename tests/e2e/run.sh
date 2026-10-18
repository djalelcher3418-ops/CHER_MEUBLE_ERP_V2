#!/usr/bin/env bash
# اختبار شامل: التطبيق الحقيقي + Postgres + PostgREST + الدالتان، في متصفح بحجم هاتف.
# المتطلبات: Postgres 16 يعمل (PG_SOCKET_DIR, المنفذ 5433)، PostgREST، Deno، Playwright + Chromium.
# الاستعمال: PG_SOCKET_DIR=/var/lib/postgresql POSTGREST=/path/postgrest DENO=/path/deno tests/e2e/run.sh
set -euo pipefail
E=$(cd "$(dirname "$0")" && pwd); R=$(cd "$E/../.." && pwd)
W=${WORK_DIR:-$(mktemp -d)}; mkdir -p "$W/shots"
: "${PG_SOCKET_DIR:?}" "${POSTGREST:?}" "${DENO:?}"
SECRET='e2e-test-secret-that-is-at-least-32-characters-long'
jwt() { node --input-type=module -e "import c from 'node:crypto';const b=o=>Buffer.from(JSON.stringify(o)).toString('base64url');const h=b({alg:'HS256',typ:'JWT'}),p=b($1);console.log(h+'.'+p+'.'+c.createHmac('sha256','$SECRET').update(h+'.'+p).digest('base64url'))"; }
ANON=$(jwt "{role:'anon',exp:9999999999}"); SERVICE=$(jwt "{role:'service_role',exp:9999999999}")

P="psql -h $PG_SOCKET_DIR -p 5433 -U postgres -v ON_ERROR_STOP=1 -q"
$P -c 'drop database if exists erp with (force)' -c 'create database erp' >/dev/null
$P -d erp -f "$E/supabase-stubs.sql" >/dev/null 2>&1
for f in "$R"/supabase/0*.sql; do $P -d erp -f "$f" >/dev/null; done
$P -d erp -c "insert into auth.users (email, password, raw_user_meta_data) values ('admin@test.dz','secret1','{\"full_name\":\"جلال\"}')" \
           -c "insert into auth.users (email, password, raw_user_meta_data, raw_app_meta_data) values ('0661000000@cher-meuble.app','123456','{\"full_name\":\"كريم\"}','{\"created_by_admin\":true}')" \
           -c "update profiles set phone='0661000000' where full_name='كريم'" >/dev/null

(cd "$R" && VITE_SUPABASE_URL=http://localhost:4174 VITE_SUPABASE_ANON_KEY=$ANON npx vite build --outDir "$W/dist" --emptyOutDir >/dev/null)
cat > "$W/pgrst.conf" <<CONF
db-uri = "postgres://authenticator@/erp?host=$PG_SOCKET_DIR&port=5433"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "$SECRET"
server-port = 3000
server-host = "127.0.0.1"
CONF
# دوال من تشغيل سابق ما زالت تعمل؟ كانت ستخدم نسخة قديمة من الكود بصمت
for port in 3000 4174 8010 8011 8012 8013 8014; do
  if (exec 3<>/dev/tcp/127.0.0.1/$port) 2>/dev/null; then echo "المنفذ $port مشغول (تشغيل سابق لم يتوقف). أوقفه ثم أعد المحاولة." >&2; exit 1; fi
done
pids=()
"$POSTGREST" "$W/pgrst.conf" > "$W/pgrst.log" 2>&1 & pids+=($!)
node "$E/gateway.mjs" "$W/dist" "$PG_SOCKET_DIR" "$W/gateway.log" > "$W/gw.log" 2>&1 & pids+=($!)
mkdir -p "$W/fn" && cp "$E/fn-wrapper.ts" "$W/fn/"
# scan-invoice يكلّم Claude المزيّف داخل البوابة (لا اتصال حقيقي ولا تكلفة في الاختبار)
for fn in send-push:8010 manage-users:8011 scan-invoice:8012 backup:8014; do
  (cd "$W/fn" && FN_PORT=${fn##*:} FN_FILE="file://$R/supabase/functions/${fn%%:*}/index.ts" SUPABASE_URL=http://127.0.0.1:4174 \
     SUPABASE_SERVICE_ROLE_KEY=$SERVICE ANTHROPIC_API_KEY=e2e-fake-key ANTHROPIC_BASE_URL=http://127.0.0.1:4174/fake-anthropic exec "$DENO" run --allow-net --allow-env --allow-read --allow-sys fn-wrapper.ts > "$W/fn-${fn%%:*}.log" 2>&1) & pids+=($!)
done
# نسخة ثانية من scan-invoice بمفتاح Gemini فقط (تكلّم Gemini المزيّف داخل البوابة)
(cd "$W/fn" && FN_PORT=8013 FN_FILE="file://$R/supabase/functions/scan-invoice/index.ts" SUPABASE_URL=http://127.0.0.1:4174 \
   SUPABASE_SERVICE_ROLE_KEY=$SERVICE GEMINI_API_KEY=AIza-e2e-fake GEMINI_BASE_URL=http://127.0.0.1:4174/fake-gemini \
   exec "$DENO" run --allow-net --allow-env --allow-read --allow-sys fn-wrapper.ts > "$W/fn-scan-invoice-gemini.log" 2>&1) & pids+=($!)
trap 'kill ${pids[*]} 2>/dev/null || true' EXIT
for i in $(seq 1 60); do curl -sf -o /dev/null http://127.0.0.1:8011/ -X OPTIONS && curl -sf -o /dev/null http://127.0.0.1:8012/ -X OPTIONS && curl -sf -o /dev/null http://127.0.0.1:8013/ -X OPTIONS && curl -sf -o /dev/null http://127.0.0.1:8014/ -X OPTIONS && curl -sf -o /dev/null http://127.0.0.1:4174/rest/v1/ && break; sleep 1; done
node "$E/flow.mjs" "$W/shots" "$PG_SOCKET_DIR"
