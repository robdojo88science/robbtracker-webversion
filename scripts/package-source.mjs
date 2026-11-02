import { createReadStream, createWriteStream } from 'node:fs';
import { readdir, readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { zipSync, unzipSync } from 'fflate';
const root = process.cwd();
const excluded = new Set(['node_modules','.git','.expo','dist','build','android','ios','.sites-runtime','.wrangler','outputs']);
const entries = {};
async function walk(directory) {
  for (const item of await readdir(directory, { withFileTypes:true })) {
    const full=join(directory,item.name), rel=relative(root,full).split(sep).join('/');
    if (item.isDirectory()) { if (!excluded.has(item.name)) await walk(full); continue; }
    if (!item.isFile() || item.name==='original-project-baseline.json' || /^\.env/.test(item.name) && item.name!=='.env.example' || /\.(?:log|db|sqlite|p12|key|pem|p8|mobileprovision)$/i.test(item.name) || rel==='worker/assets.generated.mjs') continue;
    entries['ftracker-shareable/'+rel]=new Uint8Array(await readFile(full));
  }
}
await walk(root);await mkdir('outputs',{recursive:true});
const archive=zipSync(entries,{level:6});const target='outputs/Robb-Tracker-Shareable-Source.zip';await writeFile(target,archive);
const verified=unzipSync(archive);
for(const file of ['README.md','package-lock.json','worker/access.mjs','drizzle/meta/_journal.json','src/data/expo.web.ts','public/sql-wasm-browser.wasm'])if(!verified['ftracker-shareable/'+file])throw new Error('Source archive missing '+file);
console.log(JSON.stringify({archive:target,files:Object.keys(verified).length,bytes:archive.length}));