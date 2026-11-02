import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { generateImageAsync } from '@expo/image-utils';

const root = process.cwd(), dist = resolve(root, 'dist');
if (!existsSync(join(dist, 'index.html'))) throw new Error('Export the web app before preparing offline files.');
for (const size of [192, 512]) {
  const image = await generateImageAsync({ projectRoot: root }, { src: join(root, 'assets/icon.png'), width: size, height: size, resizeMode: 'contain' });
  writeFileSync(join(dist, `icon-${size}.png`), image.source);
}
copyFileSync(join(root, 'assets/icon.png'), join(dist, 'apple-touch-icon.png'));
copyFileSync(join(root, 'public/app-boot.js'), join(dist, 'app-boot.js'));
const manifest = { id: '/', name: 'Robb Tracker', short_name: 'Robb Tracker', description: 'Private offline money tracker', lang: 'en', start_url: '/', scope: '/', display: 'standalone', display_override: ['standalone'], orientation: 'any', theme_color: '#007DFE', background_color: '#F4F8FF', icons: [192, 512].map(size => ({ src: `/icon-${size}.png`, sizes: `${size}x${size}`, type: 'image/png', purpose: 'any' })) };
writeFileSync(join(dist, 'manifest.webmanifest'), JSON.stringify(manifest, null, 2));
let html = readFileSync(join(dist, 'index.html'), 'utf8');
const head = '<!--robb-pwa-start--><link rel="manifest" href="/manifest.webmanifest"><link rel="apple-touch-icon" href="/apple-touch-icon.png"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="default"><meta name="apple-mobile-web-app-title" content="Robb Tracker"><meta name="theme-color" content="#007DFE"><meta name="description" content="Your private offline money tracker. Install on iPhone or iPad."><script src="/app-boot.js" defer></script><!--robb-pwa-end-->';
html = html.replace(/<!--robb-pwa-start-->[\s\S]*?<!--robb-pwa-end-->/g, '').replace('</head>', `${head}</head>`).replace(/<title>.*?<\/title>/, '<title>Robb Tracker</title>');
writeFileSync(join(dist, 'index.html'), html);
function files(directory) { return readdirSync(directory).filter(name => !['server', '.openai'].includes(name)).flatMap(name => { const full = join(directory, name); return statSync(full).isDirectory() ? files(full) : [full]; }); }
const entries = files(dist).filter(file => !['sw.js', '_headers', '_redirects', 'offline-manifest.json'].includes(relative(dist, file)) && !file.endsWith('.map'));
const hash = createHash('sha256'); for (const file of entries) hash.update(relative(dist, file)).update(readFileSync(file));
const version = hash.digest('hex').slice(0, 16), urls = entries.map(file => '/' + relative(dist, file).split(sep).join('/'));
if (!urls.includes('/sql-wasm-browser.js') || !urls.includes('/sql-wasm-browser.wasm')) throw new Error('Browser SQLite assets are missing.');
const worker = `const CACHE='robb-offline-${version}';\nconst ASSETS=${JSON.stringify(urls)};\n` + String.raw`
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const created = !(await caches.keys()).includes(CACHE);
    try {
      const cache = await caches.open(CACHE);
      await cache.addAll(ASSETS.map(url => new Request(url, { cache: 'reload' })));
      if (!self.registration.active) await self.skipWaiting();
    } catch (error) { if (created) await caches.delete(CACHE); throw error; }
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const ours = (await caches.keys()).filter(key => key.startsWith('robb-offline-'));
    const keep = new Set([CACHE, ...ours.filter(key => key !== CACHE).slice(-1)]);
    await Promise.all(ours.filter(key => !keep.has(key)).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener('message', event => {
  if (event.data?.type === 'ACTIVATE_UPDATE') event.waitUntil(self.skipWaiting());
  if (event.data?.type === 'STATUS') event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    if (await cache.match('/index.html')) event.ports[0]?.postMessage({ type: 'OFFLINE_READY' });
  })());
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  // Activation and server access checks must never use the cached app shell.
  if (['access', 'activate', 'api'].includes(url.pathname.split('/')[1])) return;
  if (event.request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      return (await cache.match('/index.html')) || fetch(event.request);
    })()); return;
  }
  if (url.pathname === '/sw.js') return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    return (await cache.match(event.request)) || (await caches.match(event.request)) || fetch(event.request);
  })());
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/reminders', self.location.origin);
  if (url.origin !== self.location.origin) return;
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients) { if ('navigate' in client) await client.navigate(url.href); await client.focus(); return; }
    await self.clients.openWindow(url.href);
  })());
});
`;
writeFileSync(join(dist, 'sw.js'), worker);
writeFileSync(join(dist, 'offline-manifest.json'), JSON.stringify({ version, files: urls, totalBytes: entries.reduce((sum, file) => sum + statSync(file).size, 0) }, null, 2));
writeFileSync(join(dist, '_redirects'), '/* /index.html 200\n');
writeFileSync(join(dist, '_headers'), '/sw.js\n  Cache-Control: no-cache\n  Service-Worker-Allowed: /\n/index.html\n  Cache-Control: no-cache\n/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: same-origin\n');
console.log(`Prepared offline version ${version}: ${urls.length} local assets.`);