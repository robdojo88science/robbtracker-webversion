import { appendFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const commit = process.env.GITHUB_SHA || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const short = commit.slice(0, 7), number = process.env.GITHUB_RUN_NUMBER || '1', attempt = process.env.GITHUB_RUN_ATTEMPT || '1';
if (!/^[a-f0-9]{7,40}$/.test(commit) || !/^\d+$/.test(number) || !/^\d+$/.test(attempt)) throw new Error('Invalid build identity.');
const artifact = `RobbTracker-${version}-${short}-build${number}-${attempt}`;
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `artifact_name=${artifact}\n`);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Robb Tracker build\n\n| Source | Value |\n| --- | --- |\n| Version | ${version} |\n| Commit | ${commit} |\n| Branch | ${process.env.GITHUB_REF_NAME || 'local'} |\n| Download | ${artifact} |\n\nThis build uses the commit shown above. Starting **Run workflow** on main selects the latest code; rerunning an older job keeps its original commit.\n`);
console.log(`Building Robb Tracker ${version} from ${commit}; download: ${artifact}`);
