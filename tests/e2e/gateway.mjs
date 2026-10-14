import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import pg from 'pg'

const DIST = process.argv[2]
const SECRET = 'e2e-test-secret-that-is-at-least-32-characters-long'
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
export const sign = (claims) => { const h = b64({ alg: 'HS256', typ: 'JWT' }), p = b64(claims); return `${h}.${p}.${crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}` }
const verify = (t) => { try { const [h, p, s] = t.split('.'); if (crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url') !== s) return null; return JSON.parse(Buffer.from(p, 'base64url')) } catch { return null } }
const db = new pg.Pool({ host: process.argv[3], port: 5433, user: 'postgres', database: 'erp' })
const files = new Map() // storage: path -> Buffer
const FN = { 'send-push': 8010, 'manage-users': 8011 }
const log = fs.createWriteStream(process.argv[4] ?? 'gateway.log', { flags: 'a' })

function session(u) {
  const exp = Math.floor(Date.now() / 1000) + 3600
  const user = { id: u.id, email: u.email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: u.raw_user_meta_data ?? {}, created_at: new Date().toISOString() }
  return { access_token: sign({ sub: u.id, role: 'authenticated', aud: 'authenticated', exp, email: u.email }), token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: 'r-' + u.id, user }
}
const body = async (req) => { const c = []; for await (const x of req) c.push(x); return Buffer.concat(c) }
const send = (res, code, obj, headers = {}) => { res.writeHead(code, { 'content-type': 'application/json', ...headers }); res.end(obj === undefined ? '' : JSON.stringify(obj)) }

async function proxy(req, res, port, pathOut) {
  const raw = await body(req)
  const headers = { ...req.headers }; delete headers.host
  const up = http.request({ host: '127.0.0.1', port, path: pathOut, method: req.method, headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res) })
  up.on('error', (e) => send(res, 502, { message: 'upstream ' + e.message }))
  up.end(raw)
}

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x')
  try {
    if (u.pathname.startsWith('/rest/v1/')) {
      log.write(`${req.method} ${decodeURIComponent(req.url)}\n`)
      return proxy(req, res, 3000, req.url.replace('/rest/v1', ''))
    }
    if (u.pathname.startsWith('/functions/v1/')) {
      const name = u.pathname.split('/')[3]
      if (!FN[name]) return send(res, 404, { error: 'no function' })
      return proxy(req, res, FN[name], '/')
    }
    if (u.pathname === '/auth/v1/token') {
      const b = JSON.parse((await body(req)).toString() || '{}')
      let row
      if (u.searchParams.get('grant_type') === 'password') {
        row = (await db.query('select * from auth.users where email = $1 and password = $2', [b.email, b.password])).rows[0]
        if (!row) return send(res, 400, { code: 'invalid_credentials', error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials' })
      } else {
        row = (await db.query('select * from auth.users where id = $1', [String(b.refresh_token).slice(2)])).rows[0]
      }
      if (row.banned) return send(res, 400, { code: 'user_banned', msg: 'User is banned' })
      return send(res, 200, session(row))
    }
    if (u.pathname === '/auth/v1/user') {
      const c = verify((req.headers.authorization || '').replace('Bearer ', ''))
      if (!c?.sub) return send(res, 401, { msg: 'invalid JWT' })
      const row = (await db.query('select * from auth.users where id = $1', [c.sub])).rows[0]
      if (req.method === 'PUT') { const b = JSON.parse((await body(req)).toString()); if (b.password) await db.query('update auth.users set password = $1 where id = $2', [b.password, c.sub]) }
      return send(res, 200, session(row).user)
    }
    if (u.pathname === '/auth/v1/logout') { res.writeHead(204); return res.end() }
    if (u.pathname.startsWith('/auth/v1/admin/users')) {
      const c = verify((req.headers.authorization || '').replace('Bearer ', ''))
      if (c?.role !== 'service_role') return send(res, 403, { msg: 'not admin' })
      const b = JSON.parse((await body(req)).toString() || '{}')
      if (req.method === 'POST') {
        const dup = (await db.query('select 1 from auth.users where email = $1', [b.email])).rowCount
        if (dup) return send(res, 422, { code: 'email_exists', msg: 'A user with this email address has already been registered' })
        const r = await db.query('insert into auth.users (email, password, raw_user_meta_data, raw_app_meta_data) values ($1, $2, $3, $4) returning *', [b.email, b.password, b.user_metadata ?? {}, b.app_metadata ?? {}])
        return send(res, 200, session(r.rows[0]).user)
      }
      const id = u.pathname.split('/').pop()
      if (b.password) await db.query('update auth.users set password = $1 where id = $2', [b.password, id])
      if (b.ban_duration) await db.query('update auth.users set banned = $1 where id = $2', [b.ban_duration !== 'none', id])
      return send(res, 200, { id })
    }
    if (u.pathname.startsWith('/storage/v1/object/')) {
      const rest = u.pathname.replace('/storage/v1/object/', '')
      if (rest.startsWith('list/')) return send(res, 200, [])
      if (rest.startsWith('sign/') && req.method === 'POST') {
        const b = JSON.parse((await body(req)).toString())
        return send(res, 200, (b.paths ?? []).map((p) => ({ path: p, signedURL: `/storage/v1/object/sign/chat/${p}?token=t`, error: null })))
      }
      if (rest.startsWith('sign/') && req.method === 'GET') { const f = files.get(rest.replace(/^sign\/chat\//, '')); res.writeHead(f ? 200 : 404, { 'content-type': 'image/jpeg' }); return res.end(f ?? '') }
      if (req.method === 'POST') { const key = rest.replace(/^chat\//, ''); files.set(key, await body(req)); return send(res, 200, { Key: 'chat/' + key }) }
      if (req.method === 'DELETE') return send(res, 200, [])
    }
    if (u.pathname.startsWith('/realtime/')) { res.writeHead(404); return res.end() }
    // التطبيق نفسه
    let p = path.join(DIST, decodeURIComponent(u.pathname))
    if (fs.existsSync(p) && fs.statSync(p).isDirectory() && fs.existsSync(path.join(p, 'index.html'))) p = path.join(p, 'index.html')
    if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(DIST, 'index.html')
    const ext = path.extname(p)
    res.writeHead(200, { 'content-type': { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' }[ext] ?? 'application/octet-stream' })
    fs.createReadStream(p).pipe(res)
  } catch (e) { send(res, 500, { message: String(e) }) }
}).listen(4174, () => console.log('gateway on 4174'))
