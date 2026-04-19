import { ExpoConfig } from 'expo/config';

export default (): ExpoConfig => ({
  name: 'Rope Access Logbook',
  slug: 'rope-access-logbook',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  newArchEnabled: true,
  scheme: 'logbook',
  ios: { supportsTablet: true, bundleIdentifier: 'com.ropeaccess.logbook' },
  android: {
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#ffffff',
    },
    edgeToEdgeEnabled: true,
    predictiveBackGestureEnabled: false,
    package: 'com.ropeaccess.logbook',
  },
  splash: { image: './assets/splash-icon.png', resizeMode: 'contain', backgroundColor: '#003366' },
  assetBundlePatterns: ['**/*'],
  web: { favicon: './assets/favicon.png' },
  plugins: ['expo-sqlite', 'expo-web-browser', '@react-native-community/datetimepicker'],
  extra: {
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
    eas: {
      projectId: '20f2ef58-1e1a-4401-a37e-85024a42b91a',
    },
  },
});
