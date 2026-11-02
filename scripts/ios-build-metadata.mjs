/**
 * Identity shared by the native build checks and the downloadable manifest.
 * @typedef {{ appName: string, version: string, build: string, attempt: string, commit: string,
 * shortCommit: string, bundleIdentifier: string, ipaFile: string }} IosBuildIdentity
 */

/** @param {{ version: string, commit: string, build?: string, attempt?: string, bundleIdentifier?: string }} input
 * @returns {IosBuildIdentity}
 */
export function createIosBuildIdentity(input) {
  const version = String(input.version ?? '').trim();
  const commit = String(input.commit ?? '').trim().toLowerCase();
  const build = String(input.build ?? '1');
  const attempt = String(input.attempt ?? '1');
  const bundleIdentifier = input.bundleIdentifier ?? 'com.ftracker.personal';
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('The iOS version must contain three numeric components.');
  if (commit !== 'local' && !/^[a-f0-9]{7,64}$/.test(commit)) throw new Error('The build commit must be a Git commit SHA or local.');
  if (!/^[1-9]\d*$/.test(build) || !/^[1-9]\d*$/.test(attempt)) throw new Error('Build and attempt must be positive integers.');
  if (!/^(?:[A-Za-z0-9-]+\.)+[A-Za-z0-9-]+$/.test(bundleIdentifier)) throw new Error('The iOS bundle identifier is invalid.');
  const shortCommit = commit === 'local' ? 'local' : commit.slice(0, 7);
  return { appName: 'Robb Tracker', version, build, attempt, commit, shortCommit, bundleIdentifier,
    ipaFile: `RobbTracker-${version}-${shortCommit}-build${build}-${attempt}.ipa` };
}

/** Fail before packaging if native generation or compilation produced another app.
 * @param {Record<string, unknown>} plist
 * @param {IosBuildIdentity} identity
 * @param {boolean} hasJavascriptBundle
 */
export function validateIosBundleMetadata(plist, identity, hasJavascriptBundle) {
  const expected = {
    CFBundleDisplayName: identity.appName,
    CFBundleShortVersionString: identity.version,
    CFBundleVersion: identity.build,
    CFBundleIdentifier: identity.bundleIdentifier,
    RobbTrackerCommit: identity.commit,
    RobbTrackerBuild: identity.build,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (plist[key] !== value) throw new Error(`Refusing to package an unexpected iOS app: ${key} must be ${JSON.stringify(value)}, received ${JSON.stringify(plist[key])}.`);
  }
  if (!hasJavascriptBundle) throw new Error('The native app is missing main.jsbundle. A standalone offline iPhone build must contain its JavaScript bundle.');
}

/** @param {IosBuildIdentity} identity
 * @param {string} sha256
 */
export function createIosBuildManifest(identity, sha256) {
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('The IPA checksum must be a SHA-256 digest.');
  return { ...identity, sha256 };
}
