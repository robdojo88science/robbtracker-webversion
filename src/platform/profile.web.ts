import { imageCanvas, loadBrowserImage, pickBrowserImages } from './browserImages';

export async function chooseProfilePhoto(purpose: 'profile' | 'goal' = 'profile'): Promise<string | null> {
  const files = await pickBrowserImages();
  if (!files?.length) return null;
  const source = await loadBrowserImage(files[0]);
  let canvas: HTMLCanvasElement | undefined;
  try {
    const image = source.image, edge = Math.min(image.naturalWidth, image.naturalHeight), size = Math.min(edge, 1024);
    const prepared = imageCanvas(size, size); canvas = prepared.canvas;
    prepared.context.fillStyle = '#FFFFFF'; prepared.context.fillRect(0, 0, size, size);
    prepared.context.drawImage(image, (image.naturalWidth - edge) / 2, (image.naturalHeight - edge) / 2, edge, edge, 0, 0, size, size);
    const photo = canvas.toDataURL('image/jpeg', .82);
    if (photo.length > 4_000_000) throw new Error(`Choose a smaller ${purpose} photo, under 3 MB.`);
    return photo;
  } finally { source.release(); if (canvas) { canvas.width = 0; canvas.height = 0; } }
}
