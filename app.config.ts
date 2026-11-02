import type { ExpoConfig, ConfigContext } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Robb Tracker',
  slug: 'ftracker-shareable',
  version: '1.4.1',
  scheme: 'ftracker',
  orientation: 'default',
  userInterfaceStyle: 'automatic',
  icon: './assets/icon.png',
  ios: {
    bundleIdentifier: process.env.FTRACKER_IOS_BUNDLE_ID || 'com.ftracker.personal',
    buildNumber: process.env.FTRACKER_BUILD_NUMBER || process.env.GITHUB_RUN_NUMBER || '1',
    supportsTablet: true,
    requireFullScreen: false,
    infoPlist: {
      RobbTrackerCommit: process.env.FTRACKER_BUILD_COMMIT || process.env.GITHUB_SHA || 'local',
      RobbTrackerBuild: process.env.FTRACKER_BUILD_NUMBER || process.env.GITHUB_RUN_NUMBER || '1',
      RobbTrackerBrand: 'R-blue-v1.4',
      ITSAppUsesNonExemptEncryption: false,
      UIFileSharingEnabled: false,
      LSSupportsOpeningDocumentsInPlace: false,
      NSAppTransportSecurity: {
        NSAllowsArbitraryLoads: process.env.FTRACKER_BUILD_MODE !== 'release',
        ...(process.env.FTRACKER_BUILD_MODE !== 'release' ? { NSAllowsLocalNetworking: true } : {}),
      },
    },
    privacyManifests: {
      NSPrivacyTracking: false,
      NSPrivacyCollectedDataTypes: [],
      NSPrivacyAccessedAPITypes: [
        { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults', NSPrivacyAccessedAPITypeReasons: ['CA92.1'] },
        { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryFileTimestamp', NSPrivacyAccessedAPITypeReasons: ['C617.1'] },
        { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryDiskSpace', NSPrivacyAccessedAPITypeReasons: ['E174.1'] },
      ],
    },
  },
  android: { package: 'com.ftracker.personal', adaptiveIcon: { foregroundImage: './assets/adaptive-icon.png', backgroundColor: '#007DFE' } },
  plugins: [
    'expo-router',
    ['expo-dev-client', { launchMode: 'most-recent', toolsButton: false }],
    'expo-status-bar',
    'expo-font',
    'expo-asset',
    'expo-sharing',
    'expo-sqlite',
    ['expo-secure-store', { configureAndroidBackup: true }],
    ['expo-notifications', { color: '#007DFE', sounds: ['./assets/sounds/chime.wav', './assets/sounds/pop.wav'] }],
    ['expo-audio', { microphonePermission: false, recordAudioAndroid: false, enableBackgroundPlayback: false }],
    ['expo-image-picker', { photosPermission: 'Choose a profile photo or attach photos to your Robb Tracker transaction notes.', cameraPermission: false, microphonePermission: false }],
    ['expo-splash-screen', { backgroundColor: '#F4F8FF', image: './assets/splash.png', imageWidth: 160, dark: { backgroundColor: '#0B1528' } }],
    './plugins/with-robb-launch.cjs',
  ],
  web: { bundler: 'metro', output: 'single', favicon: './assets/icon.png', name: 'Robb Tracker', shortName: 'Robb Tracker', themeColor: '#007DFE', backgroundColor: '#F4F8FF' },
  experiments: { typedRoutes: false },
  extra: {
    build: {
      commit: process.env.FTRACKER_BUILD_COMMIT || process.env.GITHUB_SHA || 'local',
      number: process.env.FTRACKER_BUILD_NUMBER || process.env.GITHUB_RUN_NUMBER || '1',
    },
    ...(process.env.EAS_PROJECT_ID ? { eas: { projectId: process.env.EAS_PROJECT_ID } } : {}),
  },
});
