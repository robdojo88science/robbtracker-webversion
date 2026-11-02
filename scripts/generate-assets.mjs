// Reproducible code-native branding. No network or additional dependencies.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const directory = fileURLToPath(new URL('../assets/', import.meta.url));
mkdirSync(directory, { recursive: true });
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, bytes) {
  const content = Buffer.concat([Buffer.from(type), bytes]);
  const size = Buffer.alloc(4); size.writeUInt32BE(bytes.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(content));
  return Buffer.concat([size, content, crc]);
}
function render(size, transparent) {
  const data = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < 2; sy++) for (let sx = 0; sx < 2; sx++) {
        const px = (x + (sx + 0.5) / 2) / size, py = (y + (sy + 0.5) / 2) / size;
        const mark = (px >= .28 && px <= .40 && py >= .24 && py <= .77) ||
          (px >= .40 && px <= .65 && ((py >= .24 && py <= .35) || (py >= .46 && py <= .57))) ||
          (px >= .61 && px <= .72 && py >= .32 && py <= .50) ||
          (py >= .52 && py <= .77 && Math.abs(px - (.46 + .84 * (py - .52))) <= .065);
        const shade = (px + py) / 2;
        const c = mark ? [255, 255, 255, 255] : transparent ? [0, 0, 0, 0] : [0, 125 - 38 * shade, 254 - 23 * shade, 255];
        r += c[0]; g += c[1]; b += c[2]; a += c[3];
      }
      const i = y * (size * 4 + 1) + 1 + x * 4;
      data[i] = Math.round(r / 4); data[i+1] = Math.round(g / 4); data[i+2] = Math.round(b / 4); data[i+3] = Math.round(a / 4);
    }
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(data)), chunk('IEND', Buffer.alloc(0))]);
}
writeFileSync(`${directory}/icon.png`, render(1024, false));
writeFileSync(`${directory}/adaptive-icon.png`, render(1024, true));
writeFileSync(`${directory}/splash.png`, render(512, false));
writeFileSync(`${directory}/brand.svg`, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="blue" x2="1" y2="1"><stop stop-color="#007DFE"/><stop offset="1" stop-color="#0057E7"/></linearGradient></defs><rect width="100" height="100" rx="24" fill="url(#blue)"/><path d="M28 77V24H62Q73 24 73 40Q73 54 59 56L75 77H60L45 57H40V77ZM40 35V46H59Q62 46 62 40Q62 35 59 35Z" fill="white"/></svg>');
console.log('Generated native icon and splash assets.');
