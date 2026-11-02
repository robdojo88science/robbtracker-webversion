import test from 'node:test';
import assert from 'node:assert/strict';
import { pbkdf2Sync } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
const accessModule = import(pathToFileURL(join(process.cwd(), 'worker/access.mjs')).href);
async function handleAccess(request: Request, env: unknown) { return (await accessModule).handleAccess(request, env); }
const origin = 'https://tracker.example';
function fixture() {
  const database = new DatabaseSync(':memory:');
  database.exec('CREATE TABLE access_attempts(ip_hash TEXT PRIMARY KEY,window_started_at INTEGER NOT NULL,attempts INTEGER NOT NULL)');
  const salt = '12'.repeat(32), secret = '34'.repeat(32), pin = '675849';
  const env = { ACCESS_PIN_SALT:salt, ACCESS_PIN_HASH:pbkdf2Sync(pin, Buffer.from(salt,'hex'),100000,32,'sha256').toString('hex'), ACCESS_SESSION_SECRET:secret,
    DB:{ prepare(sql:string) { return { bind(...params:any[]) { return { async first() { return database.prepare(sql).get(...params); }, async run() { return database.prepare(sql).run(...params); } }; } }; } } };
  const activate = (value=pin, headers:Record<string,string>={}) => new Request(origin+'/activate', { method:'POST', headers:{ 'Origin':origin, 'Content-Type':'application/x-www-form-urlencoded', 'CF-Connecting-IP':'192.0.2.1', ...headers }, body:'pin='+value });
  return { env, database, activate, pin };
}
test('access gate withholds every app asset and sends no PIN/hash in its glass form', async () => {
  const f = fixture();
  const page = await handleAccess(new Request(origin, { headers:{ Accept:'text/html' } }),f.env);
  assert.equal(page.status,200); const html=await page.text();
  assert.match(html,/Access PIN/); assert.match(html,/border-radius:3px/); assert.match(html,/type="password"/);
  assert.ok(!html.includes(f.pin)); assert.ok(!html.includes(f.env.ACCESS_PIN_HASH)); assert.ok(!html.includes('app-boot.js'));
  assert.match(page.headers.get('Content-Security-Policy')!,/frame-ancestors 'none'/);
  for (const asset of ['/sw.js','/sql-wasm-browser.js','/sql-wasm-browser.wasm','/_expo/entry.js']) assert.equal((await handleAccess(new Request(origin+asset),f.env)).status,401);
});
test('correct activation creates a signed secure cookie and allows assets without financial server data', async () => {
  const f=fixture(), response=await handleAccess(f.activate(),f.env); assert.equal(response.status,303); assert.equal(response.headers.get('Location'),'/');
  const cookie=response.headers.get('Set-Cookie')!;
  for (const flag of ['__Host-robb_access=','Secure','HttpOnly','SameSite=Strict','Path=/']) assert.ok(cookie.includes(flag));
  assert.equal(await handleAccess(new Request(origin+'/sw.js',{headers:{Cookie:cookie}}),f.env),null);
  assert.equal(f.database.prepare('SELECT count(*) AS n FROM access_attempts').get()!.n,0);
});
test('cookie forgery, other origin, expiration and a rotated PIN fail closed', async () => {
  const f=fixture(), response=await handleAccess(f.activate(),f.env), cookie=response.headers.get('Set-Cookie')!.split(';')[0];
  const forged=cookie.slice(0,-1)+(cookie.endsWith('a')?'b':'a');
  assert.equal((await handleAccess(new Request(origin+'/sw.js',{headers:{Cookie:forged}}),f.env)).status,401);
  assert.equal((await handleAccess(new Request('https://other.example/sw.js',{headers:{Cookie:cookie}}),f.env)).status,401);
  assert.equal((await handleAccess(new Request(origin+'/sw.js',{headers:{Cookie:cookie}}),{...f.env,ACCESS_PIN_HASH:'ff'.repeat(32)})).status,401);
  const now=Date.now; Date.now=()=>now()+366*86400000; try { assert.equal((await handleAccess(new Request(origin+'/sw.js',{headers:{Cookie:cookie}}),f.env)).status,401); }finally{Date.now=now;}
});
test('activation enforces origin, body bounds, form type, method and configured secrets', async () => {
  const f=fixture(); assert.equal((await handleAccess(f.activate(f.pin,{Origin:'https://bad.example'}),f.env)).status,403);
  assert.equal((await handleAccess(f.activate(f.pin,{'Sec-Fetch-Site':'cross-site'}),f.env)).status,403);
  assert.equal((await handleAccess(f.activate(f.pin,{'Content-Type':'text/plain'}),f.env)).status,415);
  assert.equal((await handleAccess(f.activate('1'.repeat(1030)),f.env)).status,413);
  assert.equal((await handleAccess(new Request(origin+'/activate'),f.env)).status,405);
  assert.equal((await handleAccess(new Request(origin),{...f.env,ACCESS_SESSION_SECRET:''})).status,503);
});
test('eight failed guesses reserve durable attempts atomically; next guess is blocked even when correct', async () => {
  const f=fixture(); const responses=await Promise.all(Array.from({length:8},()=>handleAccess(f.activate('000000'),f.env)));
  assert.ok(responses.every(response=>response.status===401));
  assert.equal((await handleAccess(f.activate(),f.env)).status,429);
  const row=f.database.prepare('SELECT * FROM access_attempts').get()!; assert.equal(row.attempts,8); assert.ok(!String(row.ip_hash).includes('192.0.2.1'));
  f.database.exec('UPDATE access_attempts SET window_started_at=0'); assert.equal((await handleAccess(f.activate(),f.env)).status,303);
});
test('storage failures deny activation without returning an activation cookie', async () => {
  const f=fixture(); const env={...f.env,DB:{prepare(){throw new Error('Database offline');}}};
  const response=await handleAccess(f.activate(),env); assert.equal(response.status,503); assert.equal(response.headers.get('Set-Cookie'),null);
});