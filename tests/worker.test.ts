import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pbkdf2Sync } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
const source = readFileSync('dist/server/index.js', 'utf8');
const modulePromise = import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const origin = 'https://tracker.example';
function fixture() {
  const database = new DatabaseSync(':memory:');
  database.exec(readFileSync('drizzle/0000_groovy_genesis.sql','utf8'));
  const salt='ab'.repeat(32), pin='837251';
  const env={ ACCESS_PIN_SALT:salt, ACCESS_PIN_HASH:pbkdf2Sync(pin,Buffer.from(salt,'hex'),100000,32,'sha256').toString('hex'), ACCESS_SESSION_SECRET:'cd'.repeat(32),
    DB:{prepare(sql:string){return{bind(...params:any[]){return{async first(){return database.prepare(sql).get(...params);},async run(){return database.prepare(sql).run(...params);}};}};}}};
  return {env,pin};
}
async function cookie(worker:any,env:any,pin:string){
  const response=await worker.fetch(new Request(origin+'/activate',{method:'POST',headers:{Origin:origin,'Content-Type':'application/x-www-form-urlencoded','CF-Connecting-IP':'198.51.100.3'},body:'pin='+pin}),env);
  assert.equal(response.status,303);return response.headers.get('Set-Cookie')!;
}
test('built Worker enforces activation before serving index, JavaScript, WASM and service worker',async()=>{
  const {default:worker}=await modulePromise,f=fixture();
  const gate=await worker.fetch(new Request(origin+'/',{headers:{Accept:'text/html'}}),f.env);
  assert.match(await gate.text(),/Ask the owner/);
  for(const path of ['/sw.js','/app-boot.js','/sql-wasm-browser.wasm','/sql-wasm-browser.js']){
    const response=await worker.fetch(new Request(origin+path),f.env);assert.equal(response.status,401);assert.equal(response.headers.get('Cache-Control'),'no-store');
  }
});
test('built Worker serves every precached asset byte-for-byte after activation and supports offline SPA paths',async()=>{
  const {default:worker}=await modulePromise,f=fixture(),access=await cookie(worker,f.env,f.pin);
  const manifest=JSON.parse(readFileSync('dist/offline-manifest.json','utf8'));
  for(const path of [...manifest.files,'/sw.js']){
    const response=await worker.fetch(new Request(origin+path,{headers:{Cookie:access}}),f.env);
    assert.equal(response.status,200,path);if(['/app-boot.js','/manifest.webmanifest','/sql-wasm-browser.js','/sql-wasm-browser.wasm','/sw.js'].includes(path))assert.equal(response.headers.get('Cache-Control'),'no-cache',path);assert.deepEqual(Buffer.from(await response.arrayBuffer()),readFileSync('dist'+path),path);
    if(path.endsWith('.wasm'))assert.equal(response.headers.get('Content-Type'),'application/wasm');
    if(path.endsWith('.js'))assert.equal(response.headers.get('Content-Type'),'text/javascript; charset=utf-8');
  }
  const deep=await worker.fetch(new Request(origin+'/transaction/123',{headers:{Cookie:access}}),f.env);
  assert.equal(await deep.text(),readFileSync('dist/index.html','utf8'));
  const missing=await worker.fetch(new Request(origin+'/missing.js',{headers:{Cookie:access}}),f.env);assert.equal(missing.status,404);
});
test('built Worker does not ship server sources, rate-limit storage or runtime secrets to the app',async()=>{
  const {default:worker}=await modulePromise,f=fixture(),access=await cookie(worker,f.env,f.pin);
  for(const path of ['/server/index.js','/.openai/hosting.json','/worker/access.mjs'])assert.equal((await worker.fetch(new Request(origin+path,{headers:{Cookie:access}}),f.env)).status,404);
  for(const path of ['/sw.js','/app-boot.js','/index.html']){
    const text=await(await worker.fetch(new Request(origin+path,{headers:{Cookie:access}}),f.env)).text();
    assert.ok(!text.includes(f.env.ACCESS_PIN_HASH));assert.ok(!text.includes(f.env.ACCESS_SESSION_SECRET));
  }
});