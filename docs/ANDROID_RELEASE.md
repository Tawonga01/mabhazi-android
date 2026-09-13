# Mabhazi Android release

This artifact is configured for the first Google Play upload:

- application ID: `com.mabhazicom.app`
- store version: `1.0.0`
- first Android `versionCode`: `1`
- production API fallback: `https://mabhaziv-2.replit.app`
- adaptive icon foreground: `artifacts/mobile/assets/images/adaptive-icon-foreground.png`
- Play listing icon: `artifacts/mobile/assets/images/store-icon-512.png`

The repository does not contain a keystore, upload key, service-account key, or
any other signing secret. No publishing or signing was performed while preparing
this release.

## API configuration

`artifacts/mobile/app/_layout.tsx` resolves the API origin in this order during
development:

1. `EXPO_PUBLIC_API_BASE_URL` (an HTTPS URL, if supplied)
2. `EXPO_PUBLIC_DOMAIN` (a host or HTTPS URL injected by Replit/Expo Go)
3. `https://mabhaziv-2.replit.app` as the development-safe fallback when no
   value is injected

The value is normalized to an HTTPS origin. An invalid injected value warns and
uses the development fallback; an invalid release value throws a clear
configuration error. Keep Replit's injected domain for Expo Go and development
previews. A release build resolves the API origin using the same order as the
runtime and preserves the verified production default when no API override is
provided:

```text
EXPO_PUBLIC_API_BASE_URL=https://mabhaziv-2.replit.app   # optional override
```

Run the release gate before an Android export or managed production build:

```sh
pnpm --filter @workspace/mobile run preflight:release
```

The command fails when neither `EXPO_PUBLIC_REPL_ID` nor Replit's runtime
`REPL_ID` is present, or when an explicitly supplied API origin is malformed or
not HTTPS. The managed Replit build derives the public client identifier from
`REPL_ID` in the build child process and passes that same resolved value to
Metro/export; no parent-shell mutation is assumed. Do not paste values into
build logs or commit them to the repository. The `EXPO_PUBLIC_REPL_ID` value is
intentionally public in the native bundle; it is not a substitute for the
server-side `REPL_ID`.

`artifacts/mobile/lib/auth.tsx` resolves the API origin through the same
`resolveApiBaseUrl()` helper used by the generated API client. Native OAuth
still uses Replit's OIDC issuer (`https://replit.com/oidc`), while API calls use
the configured HTTPS API origin above. A standalone build that needs sign-in
must provide `EXPO_PUBLIC_REPL_ID`; it must not rely on a preview host or
development fallback being injected accidentally.

## Replit production build (signed AAB)

Replit's current Android flow is a managed production build, not a local
Gradle command:

1. Open the mobile publishing/build surface and request **Build a production
   release of Mabhazi for Google Play**.
2. Wait for the managed build to finish and download the resulting `.aab`.
   Replit documents this as a production build on its Expo-backed servers.
3. In Google Play Console, create the app with package ID
   `com.mabhazicom.app`, create an **Internal testing** release, and upload the
   `.aab`.
4. Let Google manage Play App Signing for the first upload when possible, then
   complete the store listing, policy declarations, and testing before
   promoting the same release to Production.

The repository itself does not expose a signed-AAB build trigger or contain
signing material, so the managed build and Play Console steps remain external
release gates.

References:

- [Replit: upload an Android app](https://docs.replit.com/build/mobile-upload-android)
- [Replit: submit to Google Play](https://docs.replit.com/build/mobile-publish-android)
- [Replit: internal testing](https://docs.replit.com/build/mobile-internal-testing)
- [Expo: manual first Android submission](https://docs.expo.dev/submit/android-manual/)

Do not run an EAS command for this Replit flow, and do not put signing
credentials in this repository.

## Export is not a signed Android build

The repository has two separate commands:

```sh
# Replit web/Expo-domain release build (runs release preflight first)
pnpm --filter @workspace/mobile run build

# Android JavaScript/assets export only (runs release preflight first)
pnpm --filter @workspace/mobile run android:export
```

`android:export` writes the Metro export to `artifacts/mobile/dist/android`.
It does **not** create an APK or AAB, configure Gradle, sign an app, or
replace Replit's managed production build. The signed `.aab` from the managed
build is the file that belongs in Play Console.

## SDK, target API, and 16 KB release gate

This project stays on Expo SDK 54 / React Native 0.81. Expo's current SDK 54
template and changelog target Android 16 / API 36. No manual target-SDK
override or unsupported Expo upgrade was added. Verify the final managed AAB
rather than assuming the preview configuration carried through:

```sh
bundletool dump manifest --bundle=mabhazi-release.aab --xpath \
  /manifest/uses-sdk/@android:targetSdkVersion
bundletool dump config --bundle=mabhazi-release.aab | grep PAGE_ALIGNMENT
```

Google's target API requirement is documented at
<https://developer.android.com/google/play/requirements/target-sdk>. Check that
page at each upload for the target API level and effective date that apply to
the release. Use the current 16 KB page-size guidance at
<https://developer.android.com/guide/practices/page-sizes> and verify the
signed bundle and native libraries; this document intentionally does not
assert a future 16 KB enforcement date.

Before uploading the first AAB, complete these external checks on the signed
artifact:

1. Confirm the manifest target is API 36 (or the current Play-required API).
2. Confirm `PAGE_ALIGNMENT_16K` in the bundle configuration. If the build
   reports `PAGE_ALIGNMENT_4K`, stop and have the managed build configuration
   use a supported 16 KB packaging path; do not paper over it with an
   unsupported SDK/Gradle upgrade.
3. Build representative APKs with the current `bundletool`, run Android's
   `zipalign -v -c -P 16 4` check, and inspect native `.so` files with the
   Android-provided ELF-alignment procedure.
4. Install and smoke-test the release on an Android 15+ 16 KB emulator/device,
   including launch, API requests, and OAuth return.
5. Verify the release signature with the Play Console/App Bundle tooling. Keep
   the upload key and passwords outside the repository.

The final AAB checks are intentionally external: an Expo Go preview and a
Metro export cannot prove signing, target SDK, Play bundle alignment, or
native-library compatibility.

## Permissions

The app config requests no additional Android permissions and explicitly blocks
unused location, camera, media-read, and notification permissions. The current
mobile source has no location, camera, media picker, or notification feature.
If one is added later, remove only its corresponding block after implementing
the user-facing permission flow and documenting the Play Console disclosure.