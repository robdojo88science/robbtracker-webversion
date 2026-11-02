const COOKIE = '__Host-robb_access';
const TTL = 365 * 24 * 60 * 60;
const WINDOW = 15 * 60 * 1000;
const ATTEMPTS = 8;
const ITERATIONS = 100000;
const encoder = new TextEncoder();
const hex = bytes => Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
const unhex = text => Uint8Array.from(text.match(/../g), part => parseInt(part, 16));
const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
const unb64 = text => Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), letter => letter.charCodeAt(0));
const escape = text => String(text).replace(/[&<>"']/g, letter => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[letter]);
const sha = async text => hex(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
function configured(env) {
  return ['ACCESS_PIN_SALT', 'ACCESS_PIN_HASH', 'ACCESS_SESSION_SECRET'].every(key => /^[0-9a-f]{64}$/.test(env[key] || '')) && typeof env.DB?.prepare === 'function';
}
async function key(env) { return crypto.subtle.importKey('raw', unhex(env.ACCESS_SESSION_SECRET), { name:'HMAC', hash:'SHA-256' }, false, ['sign', 'verify']); }
async function version(env) { return (await sha(env.ACCESS_PIN_SALT + env.ACCESS_PIN_HASH)).slice(0, 16); }
async function authorized(request, env) {
  const candidates = (request.headers.get('Cookie') || '').split(';').map(item => item.trim()).filter(item => item.startsWith(COOKIE + '='));
  if (candidates.length !== 1) return false;
  const token = candidates[0].slice(COOKIE.length + 1);
  if (token.length > 256 || !/^v1\.\d{10}\.[0-9a-f]{32}\.[0-9a-f]{16}\.[A-Za-z0-9_-]{43}$/.test(token)) return false;
  const parts = token.split('.'), expires = Number(parts[1]), now = Math.floor(Date.now() / 1000);
  if (expires <= now || expires > now + TTL + 60 || parts[3] !== await version(env)) return false;
  if (b64(unb64(parts[4])) !== parts[4]) return false;
  try { return await crypto.subtle.verify('HMAC', await key(env), unb64(parts[4]), encoder.encode(new URL(request.url).origin + '|' + parts.slice(0, 4).join('.'))); }
  catch { return false; }
}
async function activationCookie(origin, env) {
  const nonce = hex(crypto.getRandomValues(new Uint8Array(16)));
  const data = ['v1', Math.floor(Date.now() / 1000) + TTL, nonce, await version(env)].join('.');
  const signature = b64(await crypto.subtle.sign('HMAC', await key(env), encoder.encode(origin + '|' + data)));
  return `${COOKIE}=${data}.${signature}; Max-Age=${TTL}; Path=/; Secure; HttpOnly; SameSite=Strict`;
}
function form(message = '', status = 200, extra = {}) {
  const nonce = b64(crypto.getRandomValues(new Uint8Array(18)));
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#007DFE"><title>Access Robb Tracker</title><style nonce="${nonce}">
*{box-sizing:border-box}body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:24px;font:15px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#142b50;background:linear-gradient(125deg,#e3f0ff,#eee8ff,#ddf7f3);background-size:180% 180%;animation:drift 16s ease infinite}main{width:min(100%,410px);padding:28px;background:#ffffffb8;border:1px solid #fff;border-radius:3px;box-shadow:0 18px 65px #25456c16;backdrop-filter:blur(18px)}.brand{width:50px;height:50px;border-radius:3px;display:grid;place-items:center;font-size:36px;font-weight:800;color:#fff;background:linear-gradient(130deg,#007dfe,#0057e7)}h1{font-size:29px;letter-spacing:-.9px;line-height:1.12;margin:20px 0 10px}p{margin:10px 0;color:#526681}.field{display:flex;gap:8px;margin:18px 0 10px}input{min-width:0;flex:1;padding:12px;background:#fff9;border:1px solid #bdcee5;border-radius:3px;font:25px -apple-system,sans-serif;letter-spacing:6px;min-height:49px}button{border:0;border-radius:3px;font:600 15px -apple-system,sans-serif;min-height:46px;cursor:pointer;padding:10px;color:#0057e7;background:#e5efff}.submit{width:100%;color:white;background:linear-gradient(115deg,#007dfe,#0057e7)}small{display:block;color:#61738f;margin-top:18px;line-height:1.4}.error{color:#b32640;min-height:20px;font-size:13px}button:disabled{opacity:.6}a{color:#0057e7}@keyframes drift{50%{background-position:100% 80%}}@media(prefers-reduced-motion:reduce){body{animation:none}}@media(prefers-color-scheme:dark){body{color:#f2f7ff;background:linear-gradient(125deg,#0b1528,#24284d,#163a42)}main{background:#14223bcf;border-color:#a8d2ff40}p,small{color:#b3c2d8}input{background:#1a2d4c;color:#f2f7ff;border-color:#405c83}.error{color:#ff9eaf}}
</style></head><body><main><div class="brand" aria-label="Robb Tracker">R</div><h1>Your tracker.<br>Your own space.</h1><p>Ask the owner for the access PIN to activate this app.</p><form action="/activate" method="post"><label for="access-pin">Access PIN</label><div class="field"><input id="access-pin" name="pin" type="password" inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6" autocomplete="off" required aria-describedby="pin-error"><button type="button" id="show-pin" aria-label="Show access PIN">Show</button></div><p class="error" role="status" id="pin-error">${escape(message)}</p><button class="submit" type="submit">Activate app</button></form><small>No Google or other account needed. Activation needs internet. After installation, your records stay on your device and work offline. You’ll choose your own 4-digit action PIN inside.</small></main><script nonce="${nonce}">const field=document.getElementById('access-pin'),toggle=document.getElementById('show-pin');toggle.onclick=()=>{const visible=field.type==='password';field.type=visible?'text':'password';toggle.textContent=visible?'Hide':'Show';toggle.setAttribute('aria-label',visible?'Hide access PIN':'Show access PIN')};document.querySelector('form').onsubmit=()=>{const button=document.querySelector('.submit');button.disabled=true;button.textContent='Activating…'};</script></body></html>`;
  return new Response(html, { status, headers: { 'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer', 'X-Frame-Options':'DENY', 'Content-Security-Policy':`default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`, ...extra } });
}
async function boundedText(request) {
  if (Number(request.headers.get('Content-Length') || '0') > 1024) throw new Error('large');
  const reader = request.body?.getReader(); if (!reader) return '';
  const chunks = []; let size = 0;
  try { while (true) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > 1024) { await reader.cancel(); throw new Error('large'); } chunks.push(value); } }
  finally { reader.releaseLock(); }
  const result = new Uint8Array(size); let offset = 0; for (const bytes of chunks) { result.set(bytes, offset); offset += bytes.length; }
  return new TextDecoder().decode(result);
}
async function reserve(request, env) {
  // Only Cloudflare supplies this trusted address; never trust forwarded headers.
  const address = request.headers.get('CF-Connecting-IP') || 'unknown';
  const ipHash = await sha(env.ACCESS_SESSION_SECRET + ':' + address), now = Date.now(), expired = now - WINDOW;
  const result = await env.DB.prepare(`INSERT INTO access_attempts(ip_hash,window_started_at,attempts) VALUES (?, ?, 1)
ON CONFLICT(ip_hash) DO UPDATE SET attempts=CASE WHEN window_started_at <= ? THEN 1 ELSE attempts + 1 END,
window_started_at=CASE WHEN window_started_at <= ? THEN ? ELSE window_started_at END
WHERE window_started_at <= ? OR attempts < ? RETURNING attempts`).bind(ipHash, now, expired, expired, now, expired, ATTEMPTS).first();
  return { allowed: !!result, ipHash };
}
export async function handleAccess(request, env) {
  const url = new URL(request.url);
  if (!configured(env)) return form('Activation is not ready yet. Please ask the owner to finish setup.', 503);
  if (url.protocol !== 'https:') return new Response('HTTPS is required.', { status: 400 });
  if (url.pathname === '/activate') {
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { Allow:'POST', 'Cache-Control':'no-store' } });
    if (request.headers.get('Origin') !== url.origin || request.headers.get('Sec-Fetch-Site') === 'cross-site') return form('Open the app link and try again.', 403);
    if (!(request.headers.get('Content-Type') || '').toLowerCase().startsWith('application/x-www-form-urlencoded')) return form('Use the access PIN form to activate.', 415);
    try {
      const body = new URLSearchParams(await boundedText(request));
      const attempt = await reserve(request, env);
      if (!attempt.allowed) return form('Too many attempts. Try again in 15 minutes.', 429, { 'Retry-After':'900' });
      const pin = body.get('pin') || '';
      let valid = false;
      if (/^[0-9]{6}$/.test(pin) && body.getAll('pin').length === 1) {
        const material = await crypto.subtle.importKey('raw', encoder.encode(pin), 'PBKDF2', false, ['deriveBits']);
        const hash = new Uint8Array(await crypto.subtle.deriveBits({ name:'PBKDF2', hash:'SHA-256', salt:unhex(env.ACCESS_PIN_SALT), iterations:ITERATIONS }, material, 256));
        const expected = unhex(env.ACCESS_PIN_HASH); let difference = 0; for (let index = 0; index < expected.length; index++) difference |= hash[index] ^ expected[index]; valid = difference === 0;
      }
      if (!valid) return form('That access PIN is incorrect. Ask the owner for the current PIN.', 401);
      await env.DB.prepare('DELETE FROM access_attempts WHERE ip_hash = ?').bind(attempt.ipHash).run();
      return new Response(null, { status: 303, headers: { Location:'/', 'Set-Cookie':await activationCookie(url.origin, env), 'Cache-Control':'no-store' } });
    } catch (error) { return form(error instanceof Error && error.message === 'large' ? 'The form is too large. Enter only the access PIN.' : 'Activation could not complete. Please try again shortly.', error instanceof Error && error.message === 'large' ? 413 : 503); }
  }
  if (url.pathname === '/access') return form();
  if (await authorized(request, env)) return null;
  const navigation = request.mode === 'navigate' || (request.headers.get('Accept') || '').includes('text/html') || !url.pathname.split('/').pop().includes('.');
  if (navigation) return form();
  return new Response('Activate this device with the owner’s access PIN first.', { status: 401, headers: { 'Cache-Control':'no-store', 'Content-Type':'text/plain; charset=utf-8' } });
}