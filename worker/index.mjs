import { handleAccess } from './access.mjs';
import assets from './assets.generated.mjs';
export default {
  async fetch(request, env) {
    const access = await handleAccess(request, env);
    if (access) return access;
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
    const path = new URL(request.url).pathname;
    const asset = assets[path] || (!path.split('/').pop().includes('.') ? assets['/index.html'] : undefined);
    if (!asset) return new Response('Not found', { status: 404 });
    const headers = { 'Content-Type': asset.type, 'Cache-Control': /[-.][a-f0-9]{32}\.[a-z0-9]+$/i.test(path) ? 'private, max-age=31536000, immutable' : 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy':'same-origin', 'X-Frame-Options':'DENY', 'Service-Worker-Allowed':'/' };
    return new Response(request.method === 'HEAD' ? null : Uint8Array.from(atob(asset.data), letter => letter.charCodeAt(0)), { headers });
  }
};