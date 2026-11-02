/** File selection and raster decoding stay entirely inside the browser. */
export function pickBrowserImages(multiple = false): Promise<File[] | null> {
  if (typeof document === 'undefined') return Promise.reject(new Error('Photo selection is available in the browser.'));
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp'; input.multiple = multiple;
    input.style.position = 'fixed'; input.style.left = '-10000px';
    let finished = false, timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (files: File[] | null) => {
      if (finished) return; finished = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener('focus', onFocus); input.remove(); resolve(files);
    };
    const onFocus = () => { timer = setTimeout(() => { if (!input.files?.length) finish(null); }, 350); };
    input.addEventListener('change', () => finish(input.files?.length ? Array.from(input.files) : null), { once: true });
    input.addEventListener('cancel', () => finish(null), { once: true });
    window.addEventListener('focus', onFocus);
    document.body.append(input);
    try { input.click(); } catch { window.removeEventListener('focus', onFocus); input.remove(); reject(new Error('Photo selection could not open. Try again.')); }
  });
}
export interface BrowserImage { image: HTMLImageElement; mime: string; release(): void }
export async function loadBrowserImage(file: File): Promise<BrowserImage> {
  if (!file.size || file.size > 24_000_000) throw new Error('Choose a photo smaller than 24 MB.');
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const mime = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? 'image/jpeg'
    : bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a ? 'image/png'
      : bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50 ? 'image/webp' : null;
  if (!mime) throw new Error('Choose a JPEG, PNG or WebP photo.');
  const image = new Image(), url = URL.createObjectURL(file);
  const release = () => { image.onload = null; image.onerror = null; image.removeAttribute('src'); URL.revokeObjectURL(url); };
  try {
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('This photo could not be read. Choose another image.')); image.src = url; });
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 24_000_000) throw new Error('This photo is too large. Crop to the photo or receipt area and try again.');
    return { image, mime, release };
  } catch (error) { release(); throw error; }
}
export function browserImageData(file: File, mime: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('This photo could not be read.'));
    reader.onabort = () => reject(new Error('Photo reading was cancelled.'));
    reader.onload = () => {
      const value = reader.result;
      if (typeof value !== 'string' || !value.includes(';base64,')) { reject(new Error('This photo could not be read.')); return; }
      resolve(`data:${mime};base64,${value.slice(value.indexOf(',') + 1)}`);
    };
    reader.readAsDataURL(file);
  });
}
export function imageCanvas(width: number, height: number): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser could not prepare the photo.');
  return { canvas, context };
}
