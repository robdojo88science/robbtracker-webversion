import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const avd = 'FTracker_Windows';
const port = 8087;
const sleep = ms => new Promise(done => setTimeout(done, ms));

async function main() {
  if (process.platform !== 'win32') throw new Error('This launcher is for the Windows Android preview.');
  const local = process.env.LOCALAPPDATA;
  if (!local) throw new Error('Windows LOCALAPPDATA is unavailable.');
  const sdk = process.env.ANDROID_HOME || join(local, 'Android', 'Sdk');
  const adb = join(sdk, 'platform-tools', 'adb.exe');
  const emulator = join(sdk, 'emulator', 'emulator.exe');
  const apk = join(root, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
  for (const file of [adb, emulator, apk]) if (!existsSync(file)) throw new Error(`Required preview file is missing: ${file}`);
  let java = process.env.JAVA_HOME;
  const portableJava = join(local, 'FTracker', 'Java');
  if (!java && existsSync(portableJava)) java = readdirSync(portableJava).map(name => join(portableJava, name)).find(path => existsSync(join(path, 'bin', 'java.exe')));
  const env = { ...process.env, ANDROID_HOME: sdk, JAVA_HOME: java, CI: '1', EXPO_NO_TELEMETRY: '1' };
  const logs = join(root, 'build', 'windows-preview');
  mkdirSync(logs, { recursive: true });
  function run(args, tolerateFailure = false) {
    const result = spawnSync(adb, args, { cwd: root, env, encoding: 'utf8', windowsHide: true, timeout: 30000 });
    if (!tolerateFailure && (result.error || result.status !== 0)) throw new Error(result.error?.message || result.stderr || `adb ${args[0]} failed`);
    return result.stdout ?? '';
  }
  run(['start-server']);
  function findEmulator() {
    const devices = run(['devices']).split(/\r?\n/).filter(line => /^emulator-\d+\s+device$/.test(line.trim())).map(line => line.trim().split(/\s+/)[0]);
    return devices.find(serial => run(['-s', serial, 'emu', 'avd', 'name'], true).split(/\r?\n/).some(line => line.trim() === avd));
  }
  let serial = findEmulator();
  if (!serial) {
    console.log('Opening the F-Tracker virtual Android phone…');
    const output = openSync(join(logs, 'emulator.log'), 'a');
    const child = spawn(emulator, ['-avd', avd, '-memory', '2048', '-cores', '2', '-no-boot-anim'], {
      cwd: root, env, detached: true, stdio: ['ignore', output, output], windowsHide: false,
    });
    child.on('error', error => console.error(`Emulator launch failed: ${error.message}`));
    child.unref();
    for (let attempt = 0; attempt < 180 && !serial; attempt++) {
      await sleep(1000); serial = findEmulator();
      if (attempt % 15 === 0) console.log('Waiting for the emulator to start…');
    }
    if (!serial) throw new Error(`The emulator did not connect. Check ${join(logs, 'emulator.log')}`);
  }
  let booted = false;
  for (let attempt = 0; attempt < 180; attempt++) {
    if (run(['-s', serial, 'shell', 'getprop', 'sys.boot_completed'], true).trim() === '1') { booted = true; break; }
    if (attempt % 15 === 0) console.log('Waiting for Android to finish booting…');
    await sleep(1000);
  }
  if (!booted) throw new Error('Android boot timed out. Check the emulator window and log.');
  async function metroRunning() {
    try { return (await (await fetch(`http://127.0.0.1:${port}/status`, { signal: AbortSignal.timeout(2000) })).text()).includes('packager-status:running'); }
    catch { return false; }
  }
  if (!(await metroRunning())) {
    console.log('Starting the local app server…');
    const output = openSync(join(logs, 'metro.log'), 'a');
    const child = spawn(process.execPath, [join(root, 'node_modules', 'expo', 'bin', 'cli'), 'start', '--dev-client', '--localhost', '--port', String(port)], {
      cwd: root, env, detached: true, windowsHide: true, stdio: ['ignore', output, output],
    });
    child.on('error', error => console.error(`App server launch failed: ${error.message}`));
    child.unref();
    for (let attempt = 0; attempt < 90 && !(await metroRunning()); attempt++) await sleep(1000);
    if (!(await metroRunning())) throw new Error(`The app server did not start. Check ${join(logs, 'metro.log')}`);
  }
  console.log('Installing F-Tracker; existing tracker data is preserved…');
  run(['-s', serial, 'install', '-r', apk]);
  run(['-s', serial, 'reverse', `tcp:${port}`, `tcp:${port}`]);
  const url = `exp+ftracker://expo-development-client/?url=${encodeURIComponent(`http://127.0.0.1:${port}`)}`;
  run(['-s', serial, 'shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', url, 'com.ftracker.personal']);
  console.log('F-Tracker is opening in the emulator. The first JavaScript bundle may take a moment.');
  console.log(`Logs: ${logs}`);
}

main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
