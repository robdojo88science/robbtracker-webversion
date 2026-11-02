import { Alert, Linking, Platform } from 'react-native';

type Request = { title: string; message?: string; buttons?: Parameters<typeof Alert.alert>[2]; options?: Parameters<typeof Alert.alert>[3] };
const queue: Request[] = [];
let showing = false;
function next() {
  if (showing || !queue.length) return;
  showing = true;
  const request = queue.shift()!;
  const previous = document.activeElement as HTMLElement | null;
  const dialog = document.createElement('dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'robb-dialog-title');
  dialog.style.cssText = 'width:min(420px,calc(100vw - 48px));padding:20px;border:1px solid rgba(130,165,215,.4);border-radius:3px;background:var(--robb-dialog-bg,#f5f8ff);color:var(--robb-dialog-text,#142b50);box-shadow:0 20px 70px #07193740;font:15px -apple-system,BlinkMacSystemFont,sans-serif;line-height:1.4';
  const title = document.createElement('h2'); title.id = 'robb-dialog-title'; title.textContent = request.title; title.style.cssText = 'font-size:19px;margin:0 0 10px;font-weight:650'; dialog.append(title);
  if (request.message) { const message = document.createElement('p'); message.textContent = request.message; message.style.cssText = 'white-space:pre-wrap;margin:0 0 18px'; dialog.append(message); }
  const actions = document.createElement('div'); actions.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end'; dialog.append(actions);
  let finished = false;
  const finish = (callback?: () => void) => {
    if (finished) return; finished = true;
    dialog.close(); dialog.remove(); showing = false; previous?.focus();
    try { callback?.(); } finally { next(); }
  };
  const buttons = request.buttons?.length ? request.buttons : [{ text: 'OK' }];
  for (const button of buttons) {
    const control = document.createElement('button'); control.type = 'button'; control.textContent = button.text || 'OK';
    control.style.cssText = `min-height:44px;padding:10px 15px;border:0;border-radius:3px;cursor:pointer;font:600 15px -apple-system,BlinkMacSystemFont,sans-serif;background:${button.style === 'cancel' ? '#e5effe' : button.style === 'destructive' ? '#d63b51' : '#007dfe'};color:${button.style === 'cancel' ? '#0057e7' : '#fff'}`;
    control.onclick = () => finish(() => button.onPress?.()); actions.append(control);
    if (button.style === 'cancel') control.autofocus = true;
  }
  dialog.addEventListener('cancel', event => {
    event.preventDefault();
    if (!request.options?.cancelable) return;
    const cancel = buttons.find(button => button.style === 'cancel');
    finish(cancel?.onPress ? () => cancel.onPress?.() : request.options.onDismiss);
  });
  document.body.append(dialog); dialog.showModal();
}
if (Platform.OS === 'web' && typeof document !== 'undefined') {
  Alert.alert = (title, message, buttons, options) => { queue.push({ title: title ?? '', message: message ?? undefined, buttons, options }); next(); };
  Linking.openSettings = async () => { Alert.alert('Browser permissions', 'Open this website’s Safari or browser settings to manage permissions. Reminders can alert while this web app is open; offline alerts after closing it are unavailable.'); };
}