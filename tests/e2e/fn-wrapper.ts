// يشغّل دالة Supabase على منفذ محدد (Deno.serve بدون منفذ يستعمل 8000)
const port = Number(Deno.env.get('FN_PORT'))
const orig = Deno.serve.bind(Deno)
// deno-lint-ignore no-explicit-any
;(Deno as any).serve = (handler: any) => orig({ port, hostname: '127.0.0.1' }, handler)
await import(Deno.env.get('FN_FILE')!)
