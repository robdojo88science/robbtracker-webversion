import test from 'node:test';
import assert from 'node:assert/strict';
import { createIosBuildIdentity, createIosBuildManifest, validateIosBundleMetadata } from '../scripts/ios-build-metadata.mjs';

const identity = createIosBuildIdentity({ version: '1.1.0', commit: 'd52841e123456789abcdef0123456789abcdef0123', build: '12', attempt: '2' });
const correctPlist = {
  CFBundleDisplayName: 'Robb Tracker', CFBundleShortVersionString: '1.1.0', CFBundleVersion: '12',
  CFBundleIdentifier: 'com.ftracker.personal', RobbTrackerCommit: identity.commit, RobbTrackerBuild: '12',
};

test('iOS download identity distinguishes source commit, build and rerun attempt', () => {
  assert.equal(identity.ipaFile, 'RobbTracker-1.1.0-d52841e-build12-2.ipa');
  assert.notEqual(createIosBuildIdentity({ ...identity, attempt: '3' }).ipaFile, identity.ipaFile);
  assert.notEqual(createIosBuildIdentity({ ...identity, commit: 'a0fee6d123456789abcdef0123456789abcdef0123' }).ipaFile, identity.ipaFile);
  assert.equal(createIosBuildIdentity({ version: '1.1.0', commit: 'local' }).ipaFile, 'RobbTracker-1.1.0-local-build1-1.ipa');
});

test('iOS packaging refuses the old app identity, wrong source, wrong version and missing offline bundle', () => {
  assert.doesNotThrow(() => validateIosBundleMetadata(correctPlist, identity, true));
  for (const [key, wrong] of [
    ['CFBundleDisplayName', 'F-Tracker'], ['CFBundleShortVersionString', '1.0.0'], ['CFBundleVersion', '1'],
    ['CFBundleIdentifier', 'com.someone.other'], ['RobbTrackerCommit', 'a0fee6d'], ['RobbTrackerBuild', '1'],
  ]) assert.throws(() => validateIosBundleMetadata({ ...correctPlist, [key]: wrong }, identity, true), new RegExp(key));
  assert.throws(() => validateIosBundleMetadata(correctPlist, identity, false), /main\.jsbundle/);
});

test('iOS manifest identifies the exact downloadable IPA and content checksum', () => {
  const sha256 = 'abcd'.repeat(16), manifest = createIosBuildManifest(identity, sha256);
  assert.equal(manifest.ipaFile, identity.ipaFile); assert.equal(manifest.commit, identity.commit);
  assert.equal(manifest.appName, 'Robb Tracker'); assert.equal(manifest.sha256, sha256);
  assert.throws(() => createIosBuildManifest(identity, 'incomplete'), /SHA-256/);
});

test('iOS download identity rejects malformed values before constructing any filesystem path', () => {
  for (const invalid of [{ version: '../1' }, { commit: '../bad' }, { build: '0' }, { attempt: '../2' }, { bundleIdentifier: '../app' }]) {
    assert.throws(() => createIosBuildIdentity({ ...identity, ...invalid }));
  }
});
