import Constants from 'expo-constants';

export function appBuildLabel(): string {
  const version = Constants.expoConfig?.version ?? '1.4.0';
  const info = Constants.expoConfig?.extra?.build;
  const commit = typeof info?.commit === 'string' ? info.commit.slice(0, 7) : 'local';
  const number = typeof info?.number === 'string' ? info.number : '1';
  return `Version ${version} · Build ${number} · ${commit}`;
}
