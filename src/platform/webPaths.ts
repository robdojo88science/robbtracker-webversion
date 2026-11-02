/** GitHub project pages serve the app below a path; local previews use '/'. */
export function getWebBasePath(): string {
  const configured = typeof document === 'undefined' ? '/' : document.querySelector('meta[name="robb-base-path"]')?.getAttribute('content') || '/';
  const path = configured.trim();
  if (!path.startsWith('/') || path.startsWith('//') || /[?#\\]/.test(path) || path.split('/').some(part => part === '.' || part === '..')) throw new Error('The app base path is invalid. Reopen the published app link.');
  return path.replace(/\/+$/, '') + '/';
}
export function webPath(path = ''): string {
  const relative = path.replace(/^\/+/, '');
  if (/^[a-z][a-z0-9+.-]*:/i.test(relative) || /(?:^|\/)\.\.?(?:\/|$|[?#])/.test(relative) || relative.includes('\\')) throw new Error('Use a path within this app.');
  return getWebBasePath() + relative;
}
export function webAppUrl(path = ''): string {
  return new URL(webPath(path), location.origin).href;
}