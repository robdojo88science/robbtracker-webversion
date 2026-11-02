import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const folder = fileURLToPath(new URL('../assets/sounds/', import.meta.url));
mkdirSync(folder, { recursive: true });
for (const [name, notes] of [['chime', [880, 1174.66, 1567.98]], ['pop', [660, 440]]]) {
  const rate = 22050, duration = 0.42, count = Math.floor(rate * duration), data = Buffer.alloc(44 + count * 2);
  data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8); data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22); data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28);
  data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++) {
    const t = i / rate;
    const sample = notes.reduce((sum, f, n) => { const time = t - n * 0.065; return sum + (time >= 0 ? Math.sin(2 * Math.PI * f * time) * Math.exp(-time * 17) * Math.min(1, time * 250) : 0); }, 0);
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, sample * 0.23)) * 32767), 44 + i * 2);
  }
  writeFileSync(`${folder}${name}.wav`, data);
}
