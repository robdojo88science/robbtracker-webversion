import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
import plist from '@expo/plist';
import branding from '../plugins/with-robb-launch.cjs';

const { applyLaunchBranding, launchBranding, validateCompiledLaunchBranding } = branding;
const version = '1.4.0', names = launchBranding(version);
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'robb-launch-test-')), projectName = 'RobbTracker';
  const source = join(root, 'ios', projectName), images = join(source, 'Images.xcassets', 'SplashScreenLogo.imageset'), project = join(root, 'ios', `${projectName}.xcodeproj`);
  mkdirSync(images, { recursive: true }); mkdirSync(project, { recursive: true });
  const storyboard = '<document launchScreen="YES"><imageView image="SplashScreenLogo"/><resources><image name="SplashScreenLogo"/></resources></document>';
  writeFileSync(join(source, 'SplashScreen.storyboard'), storyboard);
  writeFileSync(join(project, 'project.pbxproj'), 'A /* SplashScreen.storyboard in Resources */ = {isa = PBXBuildFile; fileRef = B /* SplashScreen.storyboard */; };\nB /* SplashScreen.storyboard */ = {isa = PBXFileReference; path = "RobbTracker/SplashScreen.storyboard"; };');
  writeFileSync(join(source, 'Info.plist'), plist.build({ CFBundleIdentifier: 'com.ftracker.personal', CFBundleShortVersionString: version, UILaunchStoryboardName: 'SplashScreen', RobbTrackerBrand: names.marker }));
  writeFileSync(join(images, 'Contents.json'), JSON.stringify({ images: [{ filename: 'image.png', idiom: 'universal', scale: '1x' }], info: { version: 1, author: 'xcode' } }));
  writeFileSync(join(images, 'image.png'), readFileSync(new URL('../assets/splash.png', import.meta.url)));
  return { root, source, images, project, storyboard, options: { projectRoot: root, platformProjectRoot: join(root, 'ios'), projectName, version }, close() {
    const target = resolve(root);
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('robb-launch-test-')) throw new Error('Refusing to delete a path outside the launch test fixture.');
    rmSync(target, { recursive: true, force: true });
  } };
}

test('finalized launch branding versions every Xcode, storyboard, image and plist reference without changing app identity', () => {
  const f = fixture(); try {
    assert.deepEqual(applyLaunchBranding(f.options), names);
    const updated = plist.parse(readFileSync(join(f.source, 'Info.plist'), 'utf8')) as Record<string, unknown>;
    assert.equal(updated.CFBundleIdentifier, 'com.ftracker.personal'); assert.equal(updated.RobbTrackerBrand, 'R-blue-v1.4');
    assert.equal(updated.UILaunchStoryboardName, 'RobbTrackerLaunchV1_4_0'); assert.equal(updated.RobbTrackerLaunchAsset, 'RobbTrackerSplashV1_4_0');
    const project = readFileSync(join(f.project, 'project.pbxproj'), 'utf8'), storyboard = readFileSync(join(f.source, `${names.storyboard}.storyboard`), 'utf8');
    assert.ok(!project.includes('SplashScreen.storyboard')); assert.ok(project.includes(`${names.storyboard}.storyboard in Resources`)); assert.ok(project.includes(`RobbTracker/${names.storyboard}.storyboard`));
    assert.ok(!storyboard.includes('SplashScreenLogo')); assert.ok(storyboard.includes(`image="${names.image}"`)); assert.ok(storyboard.includes(`name="${names.image}"`));
    const destination = join(f.source, 'Images.xcassets', `${names.image}.imageset`);
    assert.deepEqual(readFileSync(join(destination, 'image.png')), readFileSync(join(f.images, 'image.png')));
    assert.deepEqual(JSON.parse(readFileSync(join(destination, 'Contents.json'), 'utf8')), JSON.parse(readFileSync(join(f.images, 'Contents.json'), 'utf8')));
    assert.equal(readFileSync(join(f.source, 'SplashScreen.storyboard'), 'utf8'), f.storyboard);
    applyLaunchBranding(f.options); assert.equal(readFileSync(join(f.project, 'project.pbxproj'), 'utf8'), project);
    const next = launchBranding('1.4.1'); applyLaunchBranding({ ...f.options, version: '1.4.1' }); assert.equal((plist.parse(readFileSync(join(f.source, 'Info.plist'), 'utf8')) as Record<string, unknown>).UILaunchStoryboardName, next.storyboard);
  } finally { f.close(); }
});

test('launch branding rejects stale green metadata and unsafe paths before native resource writes', () => {
  const f = fixture(); try {
    const infoFile = join(f.source, 'Info.plist'), beforeProject = readFileSync(join(f.project, 'project.pbxproj'), 'utf8');
    const info = plist.parse(readFileSync(infoFile, 'utf8')) as Record<string, string>; info.RobbTrackerBrand = 'F-green-v1'; writeFileSync(infoFile, plist.build(info));
    assert.throws(() => applyLaunchBranding(f.options), /RobbTrackerBrand/); assert.equal(readFileSync(join(f.project, 'project.pbxproj'), 'utf8'), beforeProject);
    assert.ok(!existsSync(join(f.source, `${names.storyboard}.storyboard`))); assert.ok(!existsSync(join(f.source, 'Images.xcassets', `${names.image}.imageset`)));
    assert.throws(() => applyLaunchBranding({ ...f.options, projectName: '../Escape' }), /safe generated/);
    assert.throws(() => applyLaunchBranding({ ...f.options, platformProjectRoot: join(f.root, '..', 'outside') }), /project root/);
    assert.throws(() => launchBranding('../1.4.0'), /numeric app version/);
    assert.equal(applyLaunchBranding({ ...f.options, projectRoot: '/does-not-exist', introspect: true }), null);
  } finally { f.close(); }
});

test('compiled app branding checks require the blue R marker and the versioned compiled storyboard', () => {
  const f = fixture(); try {
    const app = join(f.root, 'RobbTracker.app'); mkdirSync(app);
    const info = { RobbTrackerBrand: names.marker, UILaunchStoryboardName: names.storyboard, RobbTrackerLaunchAsset: names.image };
    assert.throws(() => validateCompiledLaunchBranding(info, version, app), /missing its versioned launch storyboard/);
    const compiled = join(app, `${names.storyboard}.storyboardc`); mkdirSync(compiled); writeFileSync(join(compiled, 'Info.plist'), plist.build({ UIViewControllerIdentifiersToNibNames: { Launch: 'Launch.nib' } }));
    assert.doesNotThrow(() => validateCompiledLaunchBranding(info, version, app));
    for (const [key, wrong] of [['RobbTrackerBrand', 'F-green-v1'], ['UILaunchStoryboardName', 'SplashScreen'], ['RobbTrackerLaunchAsset', 'SplashScreenLogo']]) assert.throws(() => validateCompiledLaunchBranding({ ...info, [key]: wrong }, version, app), new RegExp(key));
    assert.throws(() => validateCompiledLaunchBranding(info, '1.4.1', app), /UILaunchStoryboardName/);
  } finally { f.close(); }
});

// These samples inspect the reproducible PNG sources, not an uncompiled iOS screenshot.
function generatedPngPixel(bytes: Buffer, x: number, y: number): number[] {
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20); assert.equal(bytes[24], 8); assert.equal(bytes[25], 6);
  const chunks: Buffer[] = []; for (let offset = 8; offset < bytes.length;) { const size = bytes.readUInt32BE(offset); if (bytes.toString('ascii', offset + 4, offset + 8) === 'IDAT') chunks.push(bytes.subarray(offset + 8, offset + 8 + size)); offset += size + 12; }
  const raw = inflateSync(Buffer.concat(chunks)), row = Math.floor(y * height) * (width * 4 + 1); assert.equal(raw[row], 0);
  return [...raw.subarray(row + 1 + Math.floor(x * width) * 4, row + 5 + Math.floor(x * width) * 4)];
}
test('native icon and launch PNG sources contain the blue background and white R stem, bowl and diagonal leg', () => {
  for (const filename of ['icon.png', 'splash.png']) {
    const bytes = readFileSync(new URL(`../assets/${filename}`, import.meta.url));
    for (const [x, y] of [[0.31, 0.30], [0.50, 0.29], [0.50, 0.52], [0.66, 0.75]]) assert.deepEqual(generatedPngPixel(bytes, x, y), [255, 255, 255, 255], `${filename} R at ${x},${y}`);
    for (const [x, y] of [[0.1, 0.1], [0.50, 0.40], [0.50, 0.70]]) { const [red, green, blue, alpha] = generatedPngPixel(bytes, x, y); assert.equal(red, 0); assert.ok(blue > green); assert.equal(alpha, 255); }
  }
});
