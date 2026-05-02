# RevenueCat setup for Rope Access Logbook

RevenueCat is the middle layer between the app and the App Store / Play Store. The app talks only to the RevenueCat SDK; RevenueCat talks to Apple and Google. This decouples the app from store-specific receipt validation, restore flows, and cross-device entitlement aliasing.

Keys, IDs, and conventions used by this project:

| Concept | Value |
|---|---|
| Project name | `Rope Access Logbook` |
| iOS bundle id | `com.ropeaccess.logbook` |
| Android package name | `com.ropeaccess.logbook` |
| Entitlement identifier | `pro` (constant `ENTITLEMENT_ID` in `src/services/subscriptionService.ts`) |
| Product identifier | `com.ropeaccess.logbook.pro_monthly` (test-store products use whatever the wizard creates — it is opaque to the app code) |
| Offering identifier | `default` (returned automatically as `currentOffering` by the SDK) |
| Package identifier | `$rc_monthly` (RC's standard monthly-subscription convention; the SDK recognizes it natively) |
| iOS key env var | `REVENUECAT_APPLE_KEY` |
| Android key env var | `REVENUECAT_GOOGLE_KEY` |

`app.config.ts` reads the two env vars into the `extra` block; `src/services/subscriptionService.ts::init()` picks the right one per `Platform.OS` and warns if absent.

## Stage 1 — Test Store (no real store accounts needed)

This is what the project ships in dev. RC's Test Store lets the SDK return offerings, fake purchases succeed, and entitlements grant — all without an Apple Developer or Google Play account.

1. Sign up at revenuecat.com.
2. Create a project (RC asks for one during onboarding).
3. The onboarding wizard auto-creates a Test Store, a `monthly` product, and a `default` offering with one `Monthly` package. Keep these.
4. Product catalog → Entitlements → **+ New** with identifier `pro`. Attach the `monthly` product to it (Products → Monthly → Attach → `pro`).
5. Project settings → Apps & providers → API keys. Copy the test key (starts with `test_`).
6. Paste the same test key into your local `.env` for both env vars:

   ```bash
   REVENUECAT_APPLE_KEY=test_xxxxxxxxxxxx
   REVENUECAT_GOOGLE_KEY=test_xxxxxxxxxxxx
   ```

The app boots, `Purchases.configure` succeeds, `getOfferings()` returns the `default` offering, the paywall renders, and tapping a package fakes a successful purchase that flips the user's status to `trialing`.

## Stage 2 — Google Play (real Android purchases)

1. Pay the $25 Google Play Console one-time fee.
2. Create an app in Play Console with package name `com.ropeaccess.logbook`.
3. Upload a build (any closed/internal testing track is fine — the app must exist in the console before you can attach products).
4. Monetize → Products → Subscriptions → create a subscription with product id `pro_monthly` and a base plan named `monthly`. Set the price to $2.99/month. Activate.
5. Set up a service account in Google Cloud Console for the Play Developer API, grant it the **Finance** role on the Play app, download the JSON key.
6. RevenueCat dashboard → Project settings → Apps & providers → **+ New** → **Play Store** → upload the JSON key, paste the package name. Save.
7. Copy the Android API key (starts with `goog_`) from that app's detail page. Replace the test key in `.env`'s `REVENUECAT_GOOGLE_KEY`.
8. Product catalog → Products → **+ New** → Play Store → store identifier `pro_monthly:monthly` → attach to entitlement `pro`. Add to the `default` offering as a Monthly package alongside any existing test product (RC matches per-platform).
9. Add your Google account email to the Play Console's License Testing list to test purchases without being charged.
10. Build with `eas build --platform android --profile preview`, install on a device signed in to the testing Google account, complete a purchase. Verify in RC dashboard → Customers that the entitlement shows as granted.

## Stage 3 — App Store Connect (real iOS purchases)

1. Pay the $99/year Apple Developer Program fee.
2. App Store Connect → My Apps → **+** → New App with bundle id `com.ropeaccess.logbook`. Fill the metadata Apple requires.
3. Agreements, Tax, and Banking → sign the Paid Apps agreement, fill banking info, fill tax forms. Until this is complete and shows green across the board, you cannot create or purchase in-app products. This step takes wall-clock time (Apple reviews bank info).
4. App Store Connect → your app → Subscriptions → create a subscription group → create a Monthly subscription with product id `com.ropeaccess.logbook.pro_monthly`. Configure pricing ($2.99/mo), localizations, free trial period (7 days). Submit for review with the first app build.
5. App Store Connect → Users and Access → Integrations → In-App Purchase → create a key, download the `.p8`, copy the issuer id and key id.
6. RevenueCat dashboard → Project settings → Apps & providers → **+ New** → **App Store** → upload the `.p8`, paste the issuer id, key id, and bundle id. Save.
7. Copy the iOS API key (starts with `appl_`) from that app's detail page. Replace the test key in `.env`'s `REVENUECAT_APPLE_KEY`.
8. Product catalog → Products → **+ New** → App Store → store identifier `com.ropeaccess.logbook.pro_monthly` → attach to entitlement `pro`. Add to the `default` offering.
9. Create a sandbox tester in App Store Connect → Users and Access → Sandbox → Testers. Use that account on a real iOS device (sandbox sign-in is in Settings → App Store → Sandbox Account on iOS 13+).
10. Build with `eas build --platform ios --profile preview`, install via TestFlight, complete a purchase signed in as the sandbox tester. Verify in RC dashboard → Customers that the entitlement shows as granted.

## How identity is bridged

`App.tsx` subscribes to Supabase auth state changes and forwards them into RevenueCat:

- On sign-in (cold-boot session restore, magic-link callback, OAuth callback) → `subscriptionService.identify(supabase_user_id)` calls `Purchases.logIn(uid)`. Any purchase the user previously made on another device with the same Supabase account is granted on this device automatically.
- On sign-out → `subscriptionService.signOut()` calls `Purchases.logOut()`. RC reverts to an anonymous user so the next signed-in user starts clean instead of inheriting the previous user's entitlement.

The bridge runs after every auth state change and after each transition the React Query `subscriptionStatus` cache is invalidated so screens re-read.

## How read-only mode works

`useReadOnly()` in `src/hooks/useSubscription.ts` returns `true` when `subscription_status === 'lapsed'` (and only then — `'unknown'` during cold boot is intentionally NOT treated as lapsed so legitimate users aren't blocked while RC resolves). Eight screens consume it to disable Add Work, Sign, Send-for-Signature, Back-up-now, and supervisor-mutation CTAs and to surface a "Subscription lapsed — renew to continue" banner. Lapsed users can still view the logbook and export PDF/JSON (Apple HIG / store policy: users keep access to their content).
