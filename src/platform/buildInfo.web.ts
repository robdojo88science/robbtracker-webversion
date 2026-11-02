import { version } from '../../package.json';

export function appBuildLabel(): string {
  return 'Browser edition · Version ' + version + ' · Data stored on this browser';
}
