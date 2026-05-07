import { ExpoConfig } from 'expo/config';

export default (): ExpoConfig => {
  const revenueCatAppleKey = process.env.REVENUECAT_APPLE_KEY;
  const revenueCatGoogleKey = process.env.REVENUECAT_GOOGLE_KEY;

  return {
    name: 'Rope Access Logbook',
    slug: 'ralb',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'light',
    newArchEnabled: true,
    scheme: 'logbook',
    runtimeVersion: { policy: 'fingerprint' },
    updates: {
      url: 'https://u.expo.dev/86367272-4f69-486f-9baf-27583a16ea70',
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.ropeaccess.logbook',
      usesAppleSignIn: true,
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
        NSCameraUsageDescription:
          'Take photos of your SPRAT card and on-site work to attach to logbook entries.',
        NSPhotoLibraryUsageDescription:
          'Pick photos from your library to attach to logbook entries or upload your SPRAT card.',
        NSLocationWhenInUseUsageDescription:
          'Stamp the location of your job site on logbook entries when you choose to.',
      },
    },
    android: {
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: '#FAF7F2',
      },
      edgeToEdgeEnabled: true,
      predictiveBackGestureEnabled: false,
      package: 'com.ropeaccess.logbook',
    },
    splash: { image: './assets/splash-icon.png', resizeMode: 'contain', backgroundColor: '#FAF7F2' },
    assetBundlePatterns: ['**/*'],
    web: { favicon: './assets/favicon.png' },
    plugins: ['expo-sqlite', 'expo-web-browser', '@react-native-community/datetimepicker', 'expo-notifications', 'expo-apple-authentication'],
    extra: {
      supabaseUrl: process.env.SUPABASE_URL,
      supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
      // Only include RevenueCat keys when they are defined to keep the
      // fingerprint consistent across environments where they may not be set.
      ...(revenueCatAppleKey ? { revenueCatAppleKey } : {}),
      ...(revenueCatGoogleKey ? { revenueCatGoogleKey } : {}),
      mockSubscription: process.env.MOCK_SUBSCRIPTION,
      eas: {
        projectId: '86367272-4f69-486f-9baf-27583a16ea70',
      },
    },
  };
};
