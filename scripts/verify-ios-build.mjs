import { appendFileSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, 'build', 'ios-build-manifest.json'), 'utf8'));
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
if (manifest.appName !== 'Robb Tracker' || manifest.version !== version) throw new Error('The packaged installer does not contain the expected Robb Tracker version.');
if (process.env.GITHUB_SHA && manifest.commit !== process.env.GITHUB_SHA) throw new Error('The installer was built from a different commit.');
if (process.env.GITHUB_RUN_NUMBER && manifest.build !== process.env.GITHUB_RUN_NUMBER) throw new Error('The installer has a different build number.');
if (typeof manifest.ipaFile !== 'string' || basename(manifest.ipaFile) !== manifest.ipaFile || !/^RobbTracker-[\w.-]+\.ipa$/.test(manifest.ipaFile)) throw new Error('Invalid installer filename.');
const path = join(root, 'build', manifest.ipaFile), size = statSync(path).size;
if (!size || size > 150 * 1024 * 1024) throw new Error('IPA must be non-empty and smaller than 150 MB.');
const hash = createHash('sha256').update(readFileSync(path)).digest('hex');
if (manifest.sha256 !== hash) throw new Error('The installer checksum does not match its build report.');
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `ipa_path=build/${manifest.ipaFile}\n`);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n### Installer verified\n\n- App: **${manifest.appName} ${manifest.version}**\n- Build: ${manifest.build}\n- File: \`${manifest.ipaFile}\`\n- SHA-256: \`${hash}\`\n\nAfter installing, open **More** to check the version, build, and commit.\n`);
console.log(`Verified ${manifest.appName} ${version}, build ${manifest.build}: ${manifest.ipaFile}`);
