(() => {
  const state = window.__ROBB_PWA__ = { ready: false, update: false, error: '', installed: matchMedia('(display-mode: standalone)').matches || navigator.standalone === true };
  const emit = () => window.dispatchEvent(new Event('robb-pwa'));
  let registration;
  window.robbCheckUpdate = async () => { if (!registration) throw new Error('Offline installation is not ready.'); await registration.update(); state.update = !!registration.waiting; emit(); };
  window.robbInstallUpdate = () => {
    if (!registration?.waiting) return;
    navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
    registration.waiting.postMessage({ type: 'ACTIVATE_UPDATE' });
  };
  window.addEventListener('appinstalled', () => { state.installed = true; emit(); });
  if (!('serviceWorker' in navigator) || !window.isSecureContext) {
    state.error = 'Offline installation needs HTTPS and a browser with service worker support.'; emit(); return;
  }
  navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).then(async result => {
    registration = result;
    if (navigator.storage?.persist) void navigator.storage.persist().catch(() => {});
    const observe = worker => {
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'redundant' && !state.ready) { state.error = 'Offline setup could not finish. Reconnect and unlock /access, then reopen the app.'; emit(); }
        if (result.waiting && navigator.serviceWorker.controller) { state.update = true; emit(); }
      });
    };
    observe(result.installing);
    result.addEventListener('updatefound', () => observe(result.installing));
    const current = await navigator.serviceWorker.ready;
    const channel = new MessageChannel();
    channel.port1.onmessage = event => { if (event.data?.type === 'OFFLINE_READY') { state.ready = true; state.error = ''; emit(); } };
    current.active?.postMessage({ type: 'STATUS' }, [channel.port2]);
    state.update = !!result.waiting; emit();
    result.addEventListener('updatefound', () => result.installing?.addEventListener('statechange', () => {
      if (result.waiting && navigator.serviceWorker.controller) { state.update = true; emit(); }
    }));
  }).catch(() => { state.error = 'Offline files could not finish downloading. Reconnect and unlock /access, then reopen the app.'; emit(); });
})();