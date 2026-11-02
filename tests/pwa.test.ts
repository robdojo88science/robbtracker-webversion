import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import vm from 'node:vm';

const dist = join(process.cwd(), 'dist');
const built = existsSync(join(dist, 'sw.js'));
const options = { skip: built ? false : 'Build the PWA before running export checks.' };
const source = built ? readFileSync(join(dist, 'sw.js'), 'utf8') : '';
const manifest = built ? JSON.parse(readFileSync(join(dist, 'offline-manifest.json'), 'utf8')) : { basePath: '/', files: [] };
const base: string = manifest.basePath || '/';
const origin = 'https://tracker.example';
const app = (path = '') => base + path.replace(/^\/+/, '');
type CacheData = Map<string, Map<string, Response>>;
const key = (request: { url: string } | string) => new URL(typeof request === 'string' ? request : request.url, origin).href;
function worker(input: { active?: boolean; fail?: string; data?: CacheData; source?: string; clients?: any[] } = {}) {
  const data = input.data ?? new Map<string, Map<string, Response>>();
  const listeners = new Map<string, (event: any) => void>();
  const deleted: string[] = [], fetched: string[] = [], opened: string[] = [];
  let online = true, skips = 0, claims = 0;
  class BrowserRequest {
    url: string; method: string; cache: string; mode: string;
    constructor(value: string | { url: string }, init: any = {}) { this.url = key(value); this.method = init.method ?? 'GET'; this.cache = init.cache ?? 'default'; this.mode = init.mode ?? 'cors'; }
  }
  const fetchAsset = async (request: any) => {
    const url = key(request); fetched.push(url);
    if (!online || new URL(url).pathname === input.fail) throw new Error('Network unavailable');
    const pathname = decodeURIComponent(new URL(url).pathname);
    assert.ok(pathname.startsWith(base), 'Asset request escaped the app scope: ' + pathname);
    const path = join(dist, pathname.slice(base.length));
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
  };
  const self = {
    location: { origin },
    registration: { active: input.active ? { scriptURL: origin + app('sw.js') } : null },
    addEventListener(type: string, listener: (event: any) => void) { listeners.set(type, listener); },
    async skipWaiting() { skips++; },
    clients: { async claim() { claims++; }, async matchAll() { return input.clients ?? []; }, async openWindow(url: string) { opened.push(url); } },
  };
  const sandbox: any = { self, caches, Request: BrowserRequest, URL, fetch: fetchAsset, Set, Promise };
  vm.runInNewContext((input.source ?? source) + '\nglobalThis.testCache = CACHE; globalThis.testPrefix = PREFIX; globalThis.testAssets = ASSETS;', sandbox);
  const life = async (type: string, fields: any = {}) => {
    const waits: Promise<unknown>[] = [];
    listeners.get(type)!({ ...fields, waitUntil(value: Promise<unknown>) { waits.push(Promise.resolve(value)); } });
    await Promise.all(waits);
  };
  const request = async (path: string, mode = 'cors', method = 'GET') => {
    let response: Promise<Response> | undefined;
    listeners.get('fetch')!({ request: new BrowserRequest(path, { mode, method }), respondWith(value: Promise<Response>) { response = Promise.resolve(value); } });
    return response ? await response : undefined;
  };
  return { data, deleted, fetched, opened, cache: sandbox.testCache as string, prefix: sandbox.testPrefix as string, assets: Array.from(sandbox.testAssets) as string[], life, request, offline: () => { online = false; }, get skips() { return skips; }, get claims() { return claims; } };
}
function files(directory: string): string[] {
  return readdirSync(directory).filter(name => !['server', '.openai'].includes(name)).flatMap(name => { const path = join(directory, name); return statSync(path).isDirectory() ? files(path) : [path]; });
}
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

test('PWA export scopes every JS/CSS/font/WASM asset, manifest and one bootstrap to its project URL', options, () => {
  const harness = worker();
  assert.deepEqual([...harness.assets].sort(), [...manifest.files].sort());
  assert.ok(harness.assets.every(path => path.startsWith(base)));
  for (const path of files(dist).filter(path => /\.(?:js|css|ttf|otf|woff2?|wasm)$/i.test(path) && !path.endsWith(sep + 'sw.js'))) {
    const url = app(relative(dist, path).split(sep).join('/'));
    assert.ok(harness.assets.includes(url), 'Missing offline asset: ' + url);
    assert.ok(statSync(path).size > 0);
  }
  for (const path of ['index.html', '404.html', 'app-boot.js', 'sql-wasm-browser.js', 'sql-wasm-browser.wasm', 'manifest.webmanifest']) assert.ok(harness.assets.includes(app(path)), path);
  assert.deepEqual([...readFileSync(join(dist, 'sql-wasm-browser.wasm')).subarray(0, 4)], [0, 97, 115, 109]);
  const html = readFileSync(join(dist, 'index.html'), 'utf8');
  assert.equal(html.split('src="' + app('app-boot.js') + '"').length - 1, 1);
  assert.equal((html.match(/rel="manifest"/g) ?? []).length, 1);
  assert.ok(html.includes('<meta name="robb-base-path" content="' + base + '">'));
  assert.equal(readFileSync(join(dist, '404.html'), 'utf8'), html, 'First-visit deep links need the app shell while preserving the route URL.');
  assert.ok(existsSync(join(dist, '.nojekyll')));
  for (const resource of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    if (resource[1].startsWith('/')) assert.ok(resource[1].startsWith(base), 'HTML resource escaped project base: ' + resource[1]);
  }
  const webmanifest = JSON.parse(readFileSync(join(dist, 'manifest.webmanifest'), 'utf8'));
  assert.equal(webmanifest.id, base); assert.equal(webmanifest.start_url, base); assert.equal(webmanifest.scope, base);
  assert.ok(webmanifest.icons.every((icon: any) => icon.src.startsWith(base)));
  assert.equal(readFileSync(join(dist, 'app-boot.js'), 'utf8'), readFileSync(join(process.cwd(), 'public/app-boot.js'), 'utf8'));
});

test('first installation caches the complete app and offline deep links return its index', options, async () => {
  const harness = worker(); await harness.life('install');
  assert.equal(harness.skips, 1); assert.equal(harness.data.get(harness.cache)!.size, harness.assets.length);
  await harness.life('activate'); assert.equal(harness.claims, 1);
  harness.offline(); const calls = harness.fetched.length;
  for (const path of ['transactions?period=last30', 'transaction/saved-id', 'preferences/security', 'install', '']) {
    const response = await harness.request(app(path), 'navigate');
    assert.equal(await response!.text(), readFileSync(join(dist, 'index.html'), 'utf8'));
  }
  for (const url of harness.assets.filter(url => /\.(?:js|css|ttf|otf|woff2?|wasm)$/i.test(url))) assert.ok(await harness.request(url), url);
  assert.equal(harness.fetched.length, calls, 'Offline routes/assets must not contact the network.');
});

test('failed update leaves the active cache, old offline app and unrelated data intact', options, async () => {
  const prefix = worker().prefix, name = prefix + 'old';
  const old = new Map([[key(app('index.html')), new Response('old app')], [key(app('old-chunk.js')), new Response('old chunk')]]);
  const outside = new Map([[key('/other-data'), new Response('unrelated')]]);
  const data: CacheData = new Map([[name, old], ['another-app', outside]]);
  const harness = worker({ active: true, fail: app('index.html'), data });
  await assert.rejects(harness.life('install'), /Network unavailable/);
  assert.equal(harness.skips, 0); assert.equal(harness.claims, 0);
  assert.equal(data.get(name), old); assert.equal(data.get('another-app'), outside);
  const oldWorker = worker({ active: true, data, source: source.replace(/const CACHE='[^']+';/, `const CACHE='${name}';`) });
  oldWorker.offline();
  assert.equal(await (await oldWorker.request(app('transactions'), 'navigate'))!.text(), 'old app');
  assert.equal(await (await oldWorker.request(app('old-chunk.js')))!.text(), 'old chunk');
  assert.doesNotMatch(source, /deleteDatabase|localStorage\.clear|indexedDB\.open/);
});

test('an update waits for explicit activation and keeps only the prior assets from the same project', options, async () => {
  const prefix = worker().prefix;
  const data: CacheData = new Map([
    [prefix + 'ancient', new Map()],
    [prefix + 'old', new Map([[key(app('old-chunk.js')), new Response('old chunk')]])],
    ['robb-offline-other-project-ancient', new Map()],
  ]);
  const harness = worker({ active: true, data });
  await harness.life('install'); assert.equal(harness.skips, 0);
  const messages: any[] = [];
  await harness.life('message', { data: { type: 'STATUS' }, ports: [{ postMessage: (value: any) => messages.push(value) }] });
  assert.equal(messages[0].type, 'OFFLINE_READY'); assert.equal(harness.skips, 0);
  await harness.life('message', { data: { type: 'ACTIVATE_UPDATE' } }); assert.equal(harness.skips, 1);
  await harness.life('activate');
  assert.ok(data.has(harness.cache)); assert.ok(data.has(prefix + 'old')); assert.ok(data.has('robb-offline-other-project-ancient'));
  assert.equal(data.has(prefix + 'ancient'), false);
  harness.offline(); assert.equal(await (await harness.request(app('old-chunk.js')))!.text(), 'old chunk');
});

function boot(input: { initialFailure?: boolean; waiting?: boolean; base?: string } = {}) {
  const basePath = input.base ?? base;
  const listeners = new Map<string, (event?: any) => void>(), installListeners = new Map<string, () => void>(), registrationListeners = new Map<string, () => void>();
  let reloads = 0, activations = 0, checks = 0;
  const registrations: { script: string; options: any }[] = [];
  const active = { postMessage(message: any, ports: any[]) { if (message.type === 'STATUS') ports[0].postMessage({ type: 'OFFLINE_READY' }); } };
  const installing = { state: 'installing', addEventListener(name: string, listener: () => void) { installListeners.set(name, listener); } };
  const registration: any = { active: input.initialFailure ? null : active, waiting: input.waiting ? { postMessage(message: any) { if (message.type === 'ACTIVATE_UPDATE') activations++; } } : null, installing, async update() { checks++; }, addEventListener(name: string, listener: () => void) { registrationListeners.set(name, listener); } };
  const serviceWorker = { controller: input.initialFailure ? null : active, async register(script: string, options: any) { registrations.push({ script, options }); return registration; }, ready: input.initialFailure ? new Promise(() => {}) : Promise.resolve({ active }), addEventListener(name: string, listener: () => void) { listeners.set(name, listener); } };
  class Channel { port1: any = { onmessage: null, close() {}, start() {} }; port2: any; constructor() { this.port2 = { postMessage: (data: any) => this.port1.onmessage?.({ data }), close() {} }; } }
  const window: any = { isSecureContext: true, addEventListener(name: string, listener: () => void) { listeners.set(name, listener); }, dispatchEvent() {} };
  vm.runInNewContext(readFileSync(join(dist, 'app-boot.js'), 'utf8'), {
    window, document: { querySelector: () => ({ getAttribute: () => basePath }) },
    navigator: { serviceWorker, storage: { persist: async () => true } }, location: { reload() { reloads++; } },
    matchMedia: () => ({ matches: false }), Event: class { constructor(public type: string) {} }, MessageChannel: Channel, console,
  });
  return { window, registration, installing, installListeners, registrationListeners, listeners, registrations, get reloads() { return reloads; }, get activations() { return activations; }, get checks() { return checks; } };
}

test('browser boot registers the project worker scope and never activates an update until chosen', options, async () => {
  const harness = boot({ waiting: true }); await flush();
  assert.equal(harness.registrations[0].script, app('sw.js')); assert.equal(harness.registrations[0].options.scope, base);
  assert.equal(harness.window.__ROBB_PWA__.ready, true); assert.equal(harness.window.__ROBB_PWA__.update, true);
  assert.equal(harness.activations, 0); assert.equal(harness.reloads, 0);
  await harness.window.robbCheckUpdate(); assert.equal(harness.checks, 1); assert.equal(harness.activations, 0);
  harness.window.robbInstallUpdate(); assert.equal(harness.activations, 1); assert.equal(harness.reloads, 0);
  harness.listeners.get('controllerchange')!(); assert.equal(harness.reloads, 1);
});

test('a failed first install reports failure rather than waiting forever or asking for a shared PIN', options, async () => {
  const harness = boot({ initialFailure: true }); await flush();
  harness.registrationListeners.get('updatefound')?.(); harness.installing.state = 'redundant';
  harness.installListeners.get('statechange')?.(); await flush();
  assert.equal(harness.window.__ROBB_PWA__.ready, false); assert.ok(harness.window.__ROBB_PWA__.error);
  assert.doesNotMatch(harness.window.__ROBB_PWA__.error, /access|PIN|unlock/);
  assert.equal(harness.activations, 0); assert.equal(harness.reloads, 0);
});

test('failed reinstallation of an existing version never deletes its working cache', options, async () => {
  const name = worker().cache;
  const working = new Map([[key(app('index.html')), new Response('working current version')]]);
  const data: CacheData = new Map([[name, working]]);
  const harness = worker({ active: true, fail: app('index.html'), data });
  await assert.rejects(harness.life('install'), /Network unavailable/);
  assert.equal(data.get(name), working); assert.equal(harness.deleted.includes(name), false);
  harness.offline(); assert.equal(await (await harness.request(app('transactions'), 'navigate'))!.text(), 'working current version');
});

test('project worker leaves other origins, neighboring sites, writes and service-worker updates alone', options, async () => {
  const harness = worker(); await harness.life('install'); harness.offline();
  assert.equal(await harness.request('https://other.example' + app('index.html'), 'navigate'), undefined);
  assert.equal(await harness.request(app('sw.js')), undefined);
  assert.equal(await harness.request(app('transactions'), 'navigate', 'POST'), undefined);
  if (base !== '/') for (const url of ['/', '/another-project/', base.slice(0, -1) + '-other/']) assert.equal(await harness.request(url, 'navigate'), undefined, url);
  assert.equal(await (await harness.request(app('transactions'), 'navigate'))!.text(), readFileSync(join(dist, 'index.html'), 'utf8'));
});

test('missing chunks cannot be supplied by unrelated project caches', options, async () => {
  const foreign = new Map([[key(app('missing.js')), new Response('wrong project')]]);
  const harness = worker({ data: new Map([['robb-offline-another-scope-old', foreign]]) });
  await harness.life('install'); harness.offline();
  await assert.rejects(harness.request(app('missing.js')), /Network unavailable/);
});

test('notifications open this project and do not navigate another project window', options, async () => {
  const navigated: string[] = [], focused: string[] = [];
  const clients = [
    { url: origin + '/another-app/', async navigate(url: string) { navigated.push('foreign:' + url); }, async focus() { focused.push('foreign'); } },
    { url: origin + app('transactions'), async navigate(url: string) { navigated.push(url); }, async focus() { focused.push('app'); } },
  ];
  const harness = worker({ clients });
  await harness.life('notificationclick', { notification: { data: { url: app('reminders') }, close() {} } });
  if (base !== '/') assert.deepEqual(navigated, [origin + app('reminders')]);
  else assert.equal(navigated.length, 1);
  const invalid = worker();
  await invalid.life('notificationclick', { notification: { data: { url: 'https://other.example/' }, close() {} } }); assert.equal(invalid.opened.length, 0);
  if (base !== '/') { await invalid.life('notificationclick', { notification: { data: { url: '/another-app/' }, close() {} } }); assert.equal(invalid.opened.length, 0); }
});
test('bootstrap keeps local root support and rejects an invalid external scope', options, async () => {
  for (const configured of ['/', 'https://other.example/', '/app/../', '//other.example/']) {
    const harness = boot({ base: configured }); await flush();
    assert.equal(harness.registrations[0].script, '/sw.js');
    assert.equal(harness.registrations[0].options.scope, '/');
  }
});