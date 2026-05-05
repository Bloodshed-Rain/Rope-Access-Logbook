---
name: eas-expo
description: "Guide for building, submitting, and managing Expo/EAS workflows for the Rope Access Logbook project. Use for: creating EAS builds, submitting to app stores, managing OTA updates, and handling EAS environment variables."
---

# EAS/Expo Workflows for Rope Access Logbook

This skill provides the standard operating procedures for managing Expo Application Services (EAS) workflows in the Rope Access Logbook project.

## Core Concepts

- **Build Profiles (`eas.json`)**: The project uses three main profiles: `development`, `preview`, and `production`.
- **Runtime Versions**: Used to ensure OTA updates are compatible with the native code in a build.
- **Channels**: Used to direct OTA updates to specific builds (e.g., `preview` channel for preview builds).
- **Environment Variables**: Managed via EAS to keep secrets out of version control.

## 1. Building the App

Use `eas build` to create binaries for iOS and Android.

### Development Builds
Development builds include `expo-dev-client` and are used for local development on physical devices or simulators.

```bash
# Android (APK for emulator/device)
eas build --platform android --profile development

# iOS (Simulator)
eas build --platform ios --profile development
```

### Preview Builds
Preview builds are for internal testing. They do not include developer tools.

```bash
# Android (APK)
eas build --platform android --profile preview

# iOS (Ad-hoc/Enterprise)
eas build --platform ios --profile preview
```

### Production Builds
Production builds are intended for app store submission.

```bash
# Android (AAB)
eas build --platform android --profile production

# iOS (App Store)
eas build --platform ios --profile production
```

## 2. Submitting to App Stores

Use `eas submit` to upload production builds to Google Play Console and App Store Connect (TestFlight).

```bash
# Submit the latest Android build
eas submit --platform android --latest

# Submit the latest iOS build
eas submit --platform ios --latest

# Build and auto-submit (iOS example)
eas build --platform ios --profile production --auto-submit
```

*Note: For Android, the first submission must be done manually through the Google Play Console web UI.*

## 3. Over-The-Air (OTA) Updates

Use `eas update` to push JavaScript and asset changes without requiring a new app store review.

```bash
# Publish an update to the preview channel
eas update --channel preview --message "Fix login bug" --environment preview

# Publish an update to the production channel
eas update --channel production --message "Release feature X" --environment production
```

### Runtime Version Policy
Ensure the `runtimeVersion` in `app.json` matches the native code of the target build. If native code changes (e.g., adding a new Expo module), you MUST create a new build; an OTA update will not work.

## 4. Environment Variables

EAS manages environment variables for cloud builds and updates.

- **Create a variable:**
  ```bash
  eas env:create --name EXPO_PUBLIC_API_URL --value https://api.example.com --environment production --visibility plaintext
  ```
- **Pull variables locally:**
  ```bash
  eas env:pull --environment development
  ```

*Note: Secrets (like `SUPABASE_ANON_KEY`) should be set via the EAS dashboard or CLI and never committed to `.env`.*

## 5. Credentials Management

EAS automatically manages iOS certificates/provisioning profiles and Android keystores.

- **View/Manage Credentials:**
  ```bash
  eas credentials
  ```

## References

- [EAS Build Configuration](https://docs.expo.dev/build/eas-json/)
- [EAS Submit](https://docs.expo.dev/submit/introduction/)
- [EAS Update](https://docs.expo.dev/eas-update/getting-started/)
- [EAS Environment Variables](https://docs.expo.dev/eas/environment-variables/)
