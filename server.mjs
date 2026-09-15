import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || path.join(root, 'data');
mkdirSync(dataDir, { recursive: true });
export const db = new DatabaseSync(path.join(dataDir, 'site.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS content(id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL, version INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS admins(username TEXT PRIMARY KEY, salt TEXT NOT NULL, hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS images(id TEXT PRIMARY KEY, mime TEXT NOT NULL, bytes BLOB NOT NULL);
CREATE TABLE IF NOT EXISTS inquiries(id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT NOT NULL, message TEXT NOT NULL, created TEXT NOT NULL);`);
const seed = JSON.parse(readFileSync(path.join(root, 'content/initial.json'), 'utf8'));
db.prepare('INSERT OR IGNORE INTO content VALUES(1,?,1)').run(JSON.stringify(seed));
const passwordFile = path.join(dataDir, 'initial-password.txt');
function passwordHash(password, salt) { return scryptSync(password, salt, 64).toString('hex'); }
function setPassword(password) {
  const salt = randomBytes(16).toString('hex');
  db.prepare('INSERT OR REPLACE INTO admins VALUES(?,?,?)').run('admin', salt, passwordHash(password, salt));
}
if (process.env.ADMIN_PASSWORD) {
    if (process.env.ADMIN_PASSWORD.length < 16) {
        throw new Error('ADMIN_PASSWORD requiere 16 caracteres como mínimo.');
    }

    setPassword(process.env.ADMIN_PASSWORD);

} else if (!db.prepare('SELECT username FROM admins').get()) {
    const password = randomBytes(24).toString('base64url');

    setPassword(password);

    writeFileSync(
        passwordFile,
        `Usuario: admin\nContraseña: ${password}\nCambiala desde /admin.`
    );
}
  
const port = Number(process.env.PORT || 3000);
const origin = process.env.APP_ORIGIN || `http://localhost:${port}`;
const originURL = new URL(origin);
const secure = process.env.COOKIE_SECURE === 'true';
if (originURL.protocol === 'https:' && !secure) throw new Error('Activá COOKIE_SECURE=true con HTTPS.');
const streams = new Set();
const limits = new Map();
const digest = value => createHash('sha256').update(value).digest('hex');
const json = (res, status, body, headers = {}) => { res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', ...headers }); res.end(JSON.stringify(body)); };
function fail(status, message) { throw Object.assign(new Error(message), { status }); }
function throttle(req, category, max) {
  const key = `${req.socket.remoteAddress}:${category}`;
  const now = Date.now();
  for (const [k, v] of limits) if (v.until < now) limits.delete(k);
  const slot = limits.get(key) || { count: 0, until: now + 15 * 60 * 1000 };
  slot.count++; limits.set(key, slot);
  if (slot.count > max) fail(429, 'Demasiados intentos. Volvé a intentar en 15 minutos.');
}
async function body(req, max = 300000) {
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > max) fail(413, 'El archivo o mensaje supera el límite permitido.'); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
async function payload(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) fail(415, 'Se requiere JSON.');
  try { return JSON.parse((await body(req)).toString()); } catch(e) { if(e.status) throw e; fail(400, 'JSON inválido.'); }
}
function authenticated(req) {
  const token = /(?:^|;\s*)session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
  const session = token && db.prepare('SELECT expires FROM sessions WHERE token=?').get(digest(token));
  if (!session || session.expires <= Date.now()) fail(401, 'Ingresá al panel para continuar.');
  return digest(token);
}
function verify(password) {
  if (typeof password !== 'string' || password.length > 256) return false;
  const admin = db.prepare('SELECT * FROM admins WHERE username=?').get('admin');
  return timingSafeEqual(Buffer.from(admin.hash, 'hex'), Buffer.from(passwordHash(password, admin.salt), 'hex'));
}
const cookie = (value, age) => `session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${secure ? '; Secure' : ''}`;
function validateShape(value, model, key = 'contenido') {
  if (typeof model === 'string') { if(typeof value !== 'string' || value.length > 10000) fail(400, `Texto inválido: ${key}`); return; }
  if (Array.isArray(model)) {
    if(!Array.isArray(value) || value.length > 30) fail(400, `Lista inválida: ${key}`);
    const itemModel = model[0] ?? { label: '', url: '' };
    value.forEach(v => validateShape(v, itemModel, key)); return;
  }
  if(!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join() !== Object.keys(model).sort().join()) fail(400, `Campos inválidos: ${key}`);
  for(const k of Object.keys(model)) validateShape(value[k], model[k], `${key}.${k}`);
}
function validateContent(c) {
  validateShape(c, seed);
  if(!c.identity.name.trim() || !c.hero.title.trim()) fail(400, 'Nombre y título son obligatorios.');
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.contact.email)) fail(400, 'Email de contacto inválido.');
  if(!/^\d{8,15}$/.test(c.contact.whatsapp)) fail(400, 'WhatsApp requiere código de país y solo dígitos.');
  if(c.identity.photo !== '/assets/marco-zarate.jpg' && !/^\/media\/[a-f0-9]{32}$/.test(c.identity.photo)) fail(400, 'Seleccioná una imagen de la biblioteca.');
  if(c.identity.photo.startsWith('/media/') && !db.prepare('SELECT id FROM images WHERE id=?').get(c.identity.photo.split('/').pop())) fail(400, 'La imagen no existe.');
  for(const social of c.footer.socials) { try { if(new URL(social.url).protocol !== 'https:') throw 0; } catch { fail(400, 'Las redes sociales requieren enlaces HTTPS.'); } }
}
const publicFiles = { '/':'index.html', '/admin':'admin.html', '/admin/':'admin.html', '/styles.css':'styles.css', '/app.js':'app.js', '/admin.js':'admin.js', '/assets/marco-zarate.jpg':'assets/marco-zarate.jpg', '/favicon.svg':'favicon.svg' };
const mime = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.jpg':'image/jpeg', '.svg':'image/svg+xml' };
export const server = http.createServer(async(req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  try {
    const url = new URL(req.url, origin); const route = url.pathname;
    if(req.headers.host !== originURL.host) fail(403, 'Usá la dirección configurada en APP_ORIGIN.');
    if(!['GET','HEAD'].includes(req.method) && req.headers.origin !== origin) fail(403, 'Origen no autorizado.');
    if(route === '/api/content' && req.method === 'GET') return json(res, 200, db.prepare('SELECT json,version FROM content WHERE id=1').get());
    if(route === '/api/events' && req.method === 'GET') {
      if(streams.size >= 100) fail(503, 'Conexiones ocupadas.');
      res.writeHead(200, {'Content-Type':'text/event-stream', 'Connection':'keep-alive', 'X-Accel-Buffering':'no'}); res.write(': connected\n\n'); streams.add(res);
      const timer = setInterval(() => res.write(': heartbeat\n\n'), 25000);
      req.on('close', () => { clearInterval(timer); streams.delete(res); }); return;
    }
    if(route === '/api/login' && req.method === 'POST') {
      throttle(req, 'login', 10); const p = await payload(req);
      if(!p || p.username !== 'admin' || !verify(p.password)) fail(401, 'Usuario o contraseña incorrectos.');
      db.prepare('DELETE FROM sessions WHERE expires<=?').run(Date.now());
      const token = randomBytes(32).toString('hex'); db.prepare('INSERT INTO sessions VALUES(?,?)').run(digest(token), Date.now()+8*3600000);
      return json(res, 200, {ok:true}, {'Set-Cookie':cookie(token, 28800)});
    }
    if(route === '/api/contact' && req.method === 'POST') {
      throttle(req, 'contact', 6); const p = await payload(req);
      if(!p || p.website) fail(400, 'Consulta inválida.');
      for(const key of ['name','email','phone','message']) if(typeof p[key] !== 'string' || !p[key].trim() || p[key].length > (key === 'message' ? 5000 : 200)) fail(400, 'Completá todos los campos dentro de los límites indicados.');
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email) || !/^[+\d\s().-]{6,40}$/.test(p.phone) || p.consent !== true) fail(400, 'Revisá el email, el teléfono y la autorización de contacto.');
      db.prepare('INSERT INTO inquiries(name,email,phone,message,created) VALUES(?,?,?,?,?)').run(p.name.trim(), p.email.trim(), p.phone.trim(), p.message.trim(), new Date().toISOString());
      return json(res, 201, {ok:true});
    }
    if(route.startsWith('/api/admin/')) {
      const token = authenticated(req);
      if(route === '/api/admin/session' && req.method === 'GET') return json(res, 200, {username:'admin'});
      if(route === '/api/admin/logout' && req.method === 'POST') { db.prepare('DELETE FROM sessions WHERE token=?').run(token); return json(res, 200, {ok:true}, {'Set-Cookie':cookie('',0)}); }
      if(route === '/api/admin/password' && req.method === 'POST') {
        throttle(req, 'password', 10); const p = await payload(req);
        if(!verify(p.current)) fail(400, 'La contraseña actual es incorrecta.');
        if(typeof p.next !== 'string' || p.next.length < 16 || p.next.length > 128 || p.next === p.current) fail(400, 'Elegí una contraseña diferente, de 16 a 128 caracteres.');
        setPassword(p.next); db.prepare('DELETE FROM sessions').run();
        if(existsSync(passwordFile)) unlinkSync(passwordFile);
        return json(res, 200, {ok:true}, {'Set-Cookie':cookie('',0)});
      }
      if(route === '/api/admin/content' && req.method === 'PUT') {
        const p = await payload(req); validateContent(p.content);
        const result = db.prepare('UPDATE content SET json=?, version=version+1 WHERE id=1 AND version=?').run(JSON.stringify(p.content), p.version);
        if(!result.changes) fail(409, 'Otra sesión modificó el contenido. Copiá tus cambios y recargá antes de guardar.');
        for(const stream of streams) stream.write('data: changed\n\n');
        return json(res, 200, {ok:true, version:p.version+1});
      }
      if(route === '/api/admin/images' && req.method === 'GET') return json(res, 200, db.prepare('SELECT id,mime FROM images ORDER BY rowid DESC').all().map(i=>({...i,url:`/media/${i.id}`})));
      if(route === '/api/admin/images' && req.method === 'POST') {
        const bytes = await body(req, 3*1024*1024);
        const jpg = bytes.length > 4 && bytes[0]===255 && bytes[1]===216 && bytes[2]===255;
        const png = bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
        const webp = bytes.subarray(0,4).toString()==='RIFF' && bytes.subarray(8,12).toString()==='WEBP';
        const type = jpg ? 'image/jpeg' : png ? 'image/png' : webp ? 'image/webp' : null;
        if(!type) fail(415, 'Subí una imagen JPG, PNG o WebP válida.');
        const id = randomBytes(16).toString('hex'); db.prepare('INSERT INTO images VALUES(?,?,?)').run(id, type, bytes);
        return json(res, 201, {url:`/media/${id}`});
      }
      if(route === '/api/admin/inquiries' && req.method === 'GET') return json(res, 200, db.prepare('SELECT * FROM inquiries ORDER BY id DESC LIMIT 200').all());
      if(/^\/api\/admin\/inquiries\/\d+$/.test(route) && req.method === 'DELETE') { db.prepare('DELETE FROM inquiries WHERE id=?').run(Number(route.split('/').pop())); return json(res, 200, {ok:true}); }
    }
    if(/^\/media\/[a-f0-9]{32}$/.test(route) && ['GET','HEAD'].includes(req.method)) {
      const img = db.prepare('SELECT mime,bytes FROM images WHERE id=?').get(route.split('/').pop());
      if(!img) fail(404, 'Imagen no encontrada.'); res.writeHead(200, {'Content-Type':img.mime}); return res.end(req.method==='HEAD' ? undefined : Buffer.from(img.bytes));
    }
    if(publicFiles[route] && ['GET','HEAD'].includes(req.method)) {
      const file = path.join(root, 'public', publicFiles[route]);
      res.writeHead(200, {'Content-Type':mime[path.extname(file)]}); return res.end(req.method==='HEAD' ? undefined : readFileSync(file));
    }
    fail(404, 'Página no encontrada.');
  } catch(error) { if(!error.status) console.error(error); if(!res.headersSent) json(res, error.status || 500, {error:error.status ? error.message : 'Ocurrió un error. Intentá nuevamente.'}); else res.end(); }
});
server.requestTimeout = 30000;
server.listen(port, process.env.HOST || '0.0.0.0', () => console.log(`Sitio: ${origin}\nPanel: ${origin}/admin\nCredenciales iniciales: ${passwordFile}`));
function shutdown() { for(const stream of streams) stream.end(); server.close(()=>{ db.close(); process.exit(0); }); }
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
