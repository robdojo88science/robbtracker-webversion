import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createIosBuildIdentity, createIosBuildManifest, validateIosBundleMetadata } from './ios-build-metadata.mjs';
import robbLaunch from '../plugins/with-robb-launch.cjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dryRun = process.argv.includes('--dry-run');
const sourceVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const gitCommit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true });
const identity = createIosBuildIdentity({
  version: sourceVersion,
  commit: process.env.GITHUB_SHA || (gitCommit.status === 0 ? gitCommit.stdout.trim() : 'local'),
  build: process.env.GITHUB_RUN_NUMBER || '1',
  attempt: process.env.GITHUB_RUN_ATTEMPT || '1',
  bundleIdentifier: process.env.FTRACKER_IOS_BUNDLE_ID || 'com.ftracker.personal',
});
const env = { ...process.env, CI: '1', FTRACKER_BUILD_MODE: 'release', EXPO_NO_TELEMETRY: '1', RCT_NO_LAUNCH_PACKAGER: '1',
  FTRACKER_BUILD_COMMIT: identity.commit, FTRACKER_BUILD_NUMBER: identity.build, FTRACKER_BUILD_ATTEMPT: identity.attempt };

function run(command, args, capture = false) {
  const result = spawnSync(command, args, { cwd: root, env, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit' });
  if (result.error) throw new Error(`Cannot run ${command}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}).${capture ? `\n${result.stderr || result.stdout}` : ''}`);
  return result.stdout ?? '';
}

try {
  if (dryRun) {
    console.log(`Plan: macOS + Xcode → Expo iOS prebuild → CocoaPods → fresh unsigned Release iphoneos build → validate ${identity.appName} ${identity.version} (${identity.shortCommit}) → unsigned IPA.`);
    console.log(`Installer: build/${identity.ipaFile}`);
    console.log('Checks: display name, version, bundle identity, build commit, build number, and embedded JavaScript.');
    console.log('No EAS, Expo login, Apple credentials, signing, upload, store submission, or paid service is invoked.');
    process.exit(0);
  }
  if (process.platform !== 'darwin') throw new Error('An iPhone IPA must be compiled on macOS. On Windows use the prepared private GitHub Actions workflow after verifying free-only billing settings.');
  const xcode = run('xcodebuild', ['-version'], true);
  console.log(xcode.trim());
  const sdkVersion = run('xcrun', ['--sdk', 'iphoneos', '--show-sdk-version'], true).trim();
  if (Number.parseFloat(sdkVersion) < 26 || !/^\d+(?:\.\d+)*$/.test(sdkVersion)) throw new Error('Robb Tracker on-device AI requires an iOS SDK 26 or later. Select Xcode 26 or later before building.');
  run('pod', ['--version']);
  const linked = JSON.parse(run('npx', ['--no-install', 'expo-modules-autolinking', 'resolve', '--platform', 'apple', '--json'], true));
  if (!linked.modules?.some(module => module.packageName === 'robb-ai' && module.modules?.some(native => native.class === 'RobbAIModule'))) throw new Error('The RobbAI native bridge is missing from Expo autolinking. Include modules/robb-ai/ios in the source checkout.');
  run('npx', ['--no-install', 'expo', 'prebuild', '--clean', '--platform', 'ios', '--no-install']);
  run('pod', ['install', '--project-directory=ios']);
  const podLock = readFileSync(join(root, 'ios', 'Podfile.lock'), 'utf8');
  if (!/^\s+- RobbAI\s*\(/m.test(podLock)) throw new Error('CocoaPods did not install the RobbAI native bridge. Refusing to build an app without on-device AI support.');
  const workspaces = readdirSync(join(root, 'ios')).filter(name => name.endsWith('.xcworkspace'));
  if (workspaces.length !== 1) throw new Error(`Expected one generated iOS workspace, found ${workspaces.length}. Native output must identify a single app.`);
  const workspace = workspaces[0];
  const scheme = workspace.replace(/\.xcworkspace$/, '');
  const build = join(root, 'build');
  mkdirSync(build, { recursive: true });
  // A fresh directory avoids ever selecting a product left by a previous name/version.
  const derived = mkdtempSync(join(build, 'ios-unsigned-'));
  run('xcodebuild', ['-workspace', join(root, 'ios', workspace), '-scheme', scheme, '-configuration', 'Release',
    '-sdk', 'iphoneos', '-destination', 'generic/platform=iOS', '-derivedDataPath', derived,
    'CODE_SIGNING_ALLOWED=NO', 'CODE_SIGNING_REQUIRED=NO', 'CODE_SIGN_IDENTITY=', 'build']);
  const products = join(derived, 'Build', 'Products', 'Release-iphoneos');
  const apps = readdirSync(products).filter(name => name.endsWith('.app'));
  if (apps.length !== 1) throw new Error(`Expected one compiled device app, found ${apps.length}. Refusing ambiguous output.`);
  const app = apps[0];
  const appPath = join(products, app);
  const plist = JSON.parse(run('plutil', ['-convert', 'json', '-o', '-', join(appPath, 'Info.plist')], true));
  const jsBundle = join(appPath, 'main.jsbundle');
  validateIosBundleMetadata(plist, identity, existsSync(jsBundle) && statSync(jsBundle).isFile() && statSync(jsBundle).size > 0);
  robbLaunch.validateCompiledLaunchBranding(plist, identity.version, appPath);
  const staging = mkdtempSync(join(build, 'ipa-staging-'));
  const payload = join(staging, 'Payload');
  mkdirSync(payload);
  cpSync(appPath, join(payload, app), { recursive: true });
  const output = join(build, identity.ipaFile);
  run('ditto', ['-c', '-k', '--keepParent', payload, output]);
  if (!existsSync(output) || statSync(output).size === 0) throw new Error('IPA packaging failed.');
  const manifest = createIosBuildManifest(identity, createHash('sha256').update(readFileSync(output)).digest('hex'));
  writeFileSync(join(build, 'ios-build-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Verified app: ${identity.appName} ${identity.version}, build ${identity.build}, commit ${identity.commit}`);
  console.log(`Unsigned IPA: ${output}`);
  console.log(`SHA-256: ${manifest.sha256}`);
  console.log('Sign and install with your own free Apple ID using a sideloading tool. This file cannot be tapped to install directly.');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
