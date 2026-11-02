import { browserImageData, imageCanvas, loadBrowserImage, pickBrowserImages } from './browserImages';

const MAX_IMAGE_CHARS = 8_000_000, MAX_TOTAL_CHARS = 12_000_000;
/** Preserve original source pixels. Oversized files may use full-resolution lossless PNG. */
export async function chooseNotePhotos(existing: string[] = []): Promise<string[]> {
  if (existing.length >= 3) throw new Error('Attach up to 3 photos. Remove one before choosing another.');
  const files = await pickBrowserImages(true);
  if (!files?.length) return existing;
  if (files.length > 3 - existing.length) throw new Error(`Choose up to ${3 - existing.length} more photos.`);
  const photos = [...existing]; let total = photos.reduce((sum, photo) => sum + photo.length, 0);
  for (const file of files) {
    const source = await loadBrowserImage(file); let canvas: HTMLCanvasElement | undefined;
    try {
      let selected = file.size <= 6_000_000 ? await browserImageData(file, source.mime) : null;
      if (!selected || selected.length > MAX_IMAGE_CHARS) {
        const prepared = imageCanvas(source.image.naturalWidth, source.image.naturalHeight); canvas = prepared.canvas;
        prepared.context.drawImage(source.image, 0, 0);
        selected = canvas.toDataURL('image/png');
      }
      if (!selected || selected.length > MAX_IMAGE_CHARS) throw new Error('This image cannot fit without reducing quality. Crop to the receipt area and try again.');
      total += selected.length;
      if (total > MAX_TOTAL_CHARS) throw new Error('These photos are too large together. Crop to the receipt area or attach fewer photos.');
      photos.push(selected);
    } finally { source.release(); if (canvas) { canvas.width = 0; canvas.height = 0; } }
  }
  return photos;
}
