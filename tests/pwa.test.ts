import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import vm from 'node:vm';

const dist = join(process.cwd(), 'dist');
const built = existsSync(join(dist, 'sw.js'));
const options = { skip: built ? false : 'Build the PWA before running export checks.' };
const source = built ? readFileSync(join(dist, 'sw.js'), 'utf8') : '';
const origin = 'https://tracker.example';
type CacheData = Map<string, Map<string, Response>>;
const key = (request: { url: string } | string) => new URL(typeof request === 'string' ? request : request.url, origin).href;
function worker(input: { active?: boolean; fail?: string; data?: CacheData; source?: string } = {}) {
  const data = input.data ?? new Map<string, Map<string, Response>>();
  const listeners = new Map<string, (event: any) => void>();
  const deleted: string[] = [], fetched: string[] = [];
  let online = true, skips = 0, claims = 0;
  class BrowserRequest {
    url: string; method: string; cache: string; mode: string;
    constructor(value: string | { url: string }, init: any = {}) { this.url = key(value); this.method = init.method ?? 'GET'; this.cache = init.cache ?? 'default'; this.mode = init.mode ?? 'cors'; }
  }
  const fetchAsset = async (request: any) => {
    const url = key(request); fetched.push(url);
    if (!online || new URL(url).pathname === input.fail) throw new Error('Network unavailable');
    const path = join(dist, decodeURIComponent(new URL(url).pathname));
    if (!existsSync(path)) throw new Error('Missing exported asset: ' + path);
    return new Response(readFileSync(path));
  };
  const caches = {
    async open(name: string) {
      if (!data.has(name)) data.set(name, new Map());
      const values = data.get(name)!;
      return {
        async addAll(requests: BrowserRequest[]) {
          const staged: [string, Response][] = [];
          for (const request of requests) { assert.equal(request.cache, 'reload'); staged.push([key(request), await fetchAsset(request)]); }
          for (const [url, response] of staged) values.set(url, response);
        },
        async match(request: any) { return values.get(key(request))?.clone(); },
      };
    },
    async keys() { return [...data.keys()]; },
    async delete(name: string) { deleted.push(name); return data.delete(name); },
    async match(request: any) { for (const values of data.values()) if (values.has(key(request))) return values.get(key(request))!.clone(); },
  };
  const self = {
    location: { origin },
    registration: { active: input.active ? { scriptURL: origin + '/sw.js' } : null },
    addEventListener(type: string, listener: (event: any) => void) { listeners.set(type, listener); },
    async skipWaiting() { skips++; },
    clients: { async claim() { claims++; }, async matchAll() { return []; }, async openWindow() {} },
  };
  const sandbox: any = { self, caches, Request: BrowserRequest, URL, fetch: fetchAsset, Set, Promise };
  vm.runInNewContext((input.source ?? source) + '\nglobalThis.testCache = CACHE; globalThis.testAssets = ASSETS;', sandbox);
  const life = async (type: string, fields: any = {}) => {
    const waits: Promise<unknown>[] = [];
    listeners.get(type)!({ ...fields, waitUntil(value: Promise<unknown>) { waits.push(Promise.resolve(value)); } });
    await Promise.all(waits);
  };
  const request = async (path: string, mode = 'cors') => {
    let response: Promise<Response> | undefined;
    listeners.get('fetch')!({ request: new BrowserRequest(path, { mode }), respondWith(value: Promise<Response>) { response = Promise.resolve(value); } });
    return response ? await response : undefined;
  };
  return { data, deleted, fetched, cache: sandbox.testCache as string, assets: Array.from(sandbox.testAssets) as string[], life, request, offline: () => { online = false; }, get skips() { return skips; }, get claims() { return claims; } };
}
function files(directory: string): string[] {
  return readdirSync(directory).filter(name => !['server', '.openai'].includes(name)).flatMap(name => { const path = join(directory, name); return statSync(path).isDirectory() ? files(path) : [path]; });
}
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

test('PWA export precaches every JS/CSS/font/WASM asset and includes one installation bootstrap', options, () => {
  const manifest = JSON.parse(readFileSync(join(dist, 'offline-manifest.json'), 'utf8'));
  const harness = worker();
  assert.deepEqual([...harness.assets].sort(), [...manifest.files].sort());
  for (const path of files(dist).filter(path => /\.(?:js|css|ttf|otf|woff2?|wasm)$/i.test(path) && !path.endsWith(sep + 'sw.js'))) {
    const url = '/' + relative(dist, path).split(sep).join('/');
    assert.ok(harness.assets.includes(url), 'Missing offline asset: ' + url);
    assert.ok(statSync(path).size > 0);
  }
  for (const url of ['/index.html', '/app-boot.js', '/sql-wasm-browser.js', '/sql-wasm-browser.wasm', '/manifest.webmanifest']) assert.ok(harness.assets.includes(url), url);
  assert.deepEqual([...readFileSync(join(dist, 'sql-wasm-browser.wasm')).subarray(0, 4)], [0, 97, 115, 109]);
  const html = readFileSync(join(dist, 'index.html'), 'utf8');
  assert.equal((html.match(/src="\/app-boot\.js"/g) ?? []).length, 1);
  assert.equal((html.match(/rel="manifest"/g) ?? []).length, 1);
  assert.equal(readFileSync(join(dist, 'app-boot.js'), 'utf8'), readFileSync(join(process.cwd(), 'public/app-boot.js'), 'utf8'));
});

test('first installation caches the complete app and offline deep links return its index', options, async () => {
  const harness = worker();
  await harness.life('install');
  assert.equal(harness.skips, 1);
  assert.equal(harness.data.get(harness.cache)!.size, harness.assets.length);
  await harness.life('activate'); assert.equal(harness.claims, 1);
  harness.offline();
  const calls = harness.fetched.length;
  for (const url of ['/transactions?period=last30', '/transaction/saved-id', '/preferences/security', '/install']) {
    const response = await harness.request(url, 'navigate');
    assert.equal(await response!.text(), readFileSync(join(dist, 'index.html'), 'utf8'));
  }
  for (const url of harness.assets.filter(url => /\.(?:js|css|ttf|otf|woff2?|wasm)$/i.test(url))) assert.ok(await harness.request(url), url);
  assert.equal(harness.fetched.length, calls, 'Offline routes/assets must not contact the network.');
});

test('failed update leaves the active cache, old offline app and unrelated data intact', options, async () => {
  const old = new Map([[key('/index.html'), new Response('old app')], [key('/old-chunk.js'), new Response('old chunk')]]);
  const outside = new Map([[key('/other-data'), new Response('unrelated')]]);
  const data: CacheData = new Map([['robb-offline-old', old], ['another-app', outside]]);
  const harness = worker({ active: true, fail: '/index.html', data });
  await assert.rejects(harness.life('install'), /Network unavailable/);
  assert.equal(harness.skips, 0); assert.equal(harness.claims, 0);
  assert.equal(harness.data.get('robb-offline-old'), old); assert.equal(harness.data.get('another-app'), outside);
  assert.equal(await old.get(key('/index.html'))!.clone().text(), 'old app');
  const oldWorker = worker({ active: true, data, source: source.replace(/const CACHE='[^']+';/, "const CACHE='robb-offline-old';") });
  oldWorker.offline();
  assert.equal(await (await oldWorker.request('/transactions', 'navigate'))!.text(), 'old app');
  assert.equal(await (await oldWorker.request('/old-chunk.js'))!.text(), 'old chunk');
  assert.doesNotMatch(source, /deleteDatabase|localStorage\.clear|indexedDB\.open/);
});

test('an update waits for explicit activation and keeps the previous assets for open tabs', options, async () => {
  const data: CacheData = new Map([
    ['robb-offline-ancient', new Map()],
    ['robb-offline-old', new Map([[key('/old-chunk.js'), new Response('old chunk')]])],
    ['other-cache', new Map()],
  ]);
  const harness = worker({ active: true, data });
  await harness.life('install'); assert.equal(harness.skips, 0);
  const messages: any[] = [];
  await harness.life('message', { data: { type: 'STATUS' }, ports: [{ postMessage: (value: any) => messages.push(value) }] });
  assert.equal(messages[0].type, 'OFFLINE_READY'); assert.equal(harness.skips, 0);
  await harness.life('message', { data: { type: 'ACTIVATE_UPDATE' } }); assert.equal(harness.skips, 1);
  await harness.life('activate');
  assert.ok(data.has(harness.cache)); assert.ok(data.has('robb-offline-old')); assert.ok(data.has('other-cache'));
  assert.equal(data.has('robb-offline-ancient'), false);
  harness.offline(); assert.equal(await (await harness.request('/old-chunk.js'))!.text(), 'old chunk');
});

function boot(input: { initialFailure?: boolean; waiting?: boolean } = {}) {
  const listeners = new Map<string, (event?: any) => void>(), installListeners = new Map<string, () => void>(), registrationListeners = new Map<string, () => void>();
  let reloads = 0, activations = 0, checks = 0;
  const active = { postMessage(message: any, ports: any[]) { if (message.type === 'STATUS') ports[0].postMessage({ type: 'OFFLINE_READY' }); } };
  const installing = { state: 'installing', addEventListener(name: string, listener: () => void) { installListeners.set(name, listener); } };
  const registration: any = { active: input.initialFailure ? null : active, waiting: input.waiting ? { postMessage(message: any) { if (message.type === 'ACTIVATE_UPDATE') activations++; } } : null, installing, async update() { checks++; }, addEventListener(name: string, listener: () => void) { registrationListeners.set(name, listener); } };
  const serviceWorker = { controller: input.initialFailure ? null : active, async register() { return registration; }, ready: input.initialFailure ? new Promise(() => {}) : Promise.resolve({ active }), addEventListener(name: string, listener: () => void) { listeners.set(name, listener); } };
  class Channel { port1: any = { onmessage: null, close() {}, start() {} }; port2: any; constructor() { this.port2 = { postMessage: (data: any) => this.port1.onmessage?.({ data }), close() {} }; } }
  const timers = new Map<number, () => void>(); let timer = 0;
  const window: any = { isSecureContext: true, addEventListener(name: string, listener: () => void) { listeners.set(name, listener); }, dispatchEvent() {} };
  vm.runInNewContext(readFileSync(join(dist, 'app-boot.js'), 'utf8'), {
    window, navigator: { serviceWorker, storage: { persist: async () => true } }, location: { reload() { reloads++; } },
    matchMedia: () => ({ matches: false }), Event: class { constructor(public type: string) {} }, MessageChannel: Channel,
    setTimeout(fn: () => void) { timers.set(++timer, fn); return timer; }, clearTimeout(id: number) { timers.delete(id); }, console,
  });
  return { window, registration, installing, installListeners, registrationListeners, listeners, timers, get reloads() { return reloads; }, get activations() { return activations; }, get checks() { return checks; } };
}

test('browser boot never activates or reloads an update until the user chooses it', options, async () => {
  const harness = boot({ waiting: true }); await flush();
  assert.equal(harness.window.__ROBB_PWA__.ready, true);
  assert.equal(harness.window.__ROBB_PWA__.update, true);
  assert.equal(harness.activations, 0); assert.equal(harness.reloads, 0);
  await harness.window.robbCheckUpdate(); assert.equal(harness.checks, 1); assert.equal(harness.activations, 0);
  harness.window.robbInstallUpdate(); assert.equal(harness.activations, 1); assert.equal(harness.reloads, 0);
  harness.listeners.get('controllerchange')!(); assert.equal(harness.reloads, 1);
});

test('a failed first install reports failure rather than waiting forever for offline readiness', options, async () => {
  const harness = boot({ initialFailure: true }); await flush();
  harness.registrationListeners.get('updatefound')?.();
  harness.installing.state = 'redundant';
  harness.installListeners.get('statechange')?.(); await flush();
  assert.equal(harness.window.__ROBB_PWA__.ready, false);
  assert.ok(harness.window.__ROBB_PWA__.error, 'A failed initial install must expose an offline setup error.');
  assert.equal(harness.activations, 0); assert.equal(harness.reloads, 0);
});

test('failed reinstallation of an existing version never deletes its working cache', options, async () => {
  const name = worker().cache;
  const working = new Map([[key('/index.html'), new Response('working current version')]]);
  const data: CacheData = new Map([[name, working]]);
  const harness = worker({ active: true, fail: '/index.html', data });
  await assert.rejects(harness.life('install'), /Network unavailable/);
  assert.equal(data.get(name), working);
  assert.equal(harness.deleted.includes(name), false);
  harness.offline();
  assert.equal(await (await harness.request('/transactions', 'navigate'))!.text(), 'working current version');
});

test('access and API routes bypass cached navigation and responses even while offline', options, async () => {
  const harness = worker();
  await harness.life('install');
  const cache = harness.data.get(harness.cache)!;
  for (const url of ['/access', '/access/login?next=%2F', '/activate', '/activate/confirm', '/api', '/api/access', '/api/access?check=1']) cache.set(key(url), new Response('must never serve cached access'));
  harness.offline();
  const calls = harness.fetched.length;
  for (const url of ['/access', '/access/login?next=%2F', '/activate', '/activate/confirm', '/api', '/api/access', '/api/access?check=1']) {
    assert.equal(await harness.request(url, 'navigate'), undefined, url + ' must use the browser network path');
    assert.equal(await harness.request(url), undefined, url + ' must bypass caches for fetch requests');
  }
  assert.equal(harness.fetched.length, calls);
  const app = await harness.request('/accounts', 'navigate');
  assert.equal(await app!.text(), readFileSync(join(dist, 'index.html'), 'utf8'));
});
