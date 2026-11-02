import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
const root = resolve('dist'), port = Number(process.env.PORT || 4173);
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json', '.webmanifest':'application/manifest+json', '.wasm':'application/wasm', '.png':'image/png', '.ttf':'font/ttf', '.wav':'audio/wav', '.ico':'image/x-icon', '.svg':'image/svg+xml' };
createServer((request, response) => {
  const url = new URL(request.url || '/', 'http://localhost');
  let file = resolve(root, '.' + decodeURIComponent(url.pathname));
  if (file !== root && !file.startsWith(root + sep)) { response.writeHead(403); response.end(); return; }
  if (!existsSync(file) || statSync(file).isDirectory()) {
    if (extname(file)) { response.writeHead(404); response.end('Not found'); return; }
    file = resolve(root, 'index.html');
  }
  response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control':'no-cache', 'Service-Worker-Allowed':'/', 'X-Content-Type-Options':'nosniff' });
  createReadStream(file).pipe(response);
}).listen(port, '127.0.0.1', () => console.log(`Local: http://127.0.0.1:${port}`));