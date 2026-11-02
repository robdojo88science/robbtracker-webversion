# Native iOS release runbook

**The current installation plan is free-only personal sideloading with private source. Start with [FREE_INSTALL.md](FREE_INSTALL.md).** The EAS signing, TestFlight, and App Store instructions below describe a separate membership-based release path and are not authorized by the current zero-cost constraint.

The repository contains a native Expo/React Native application, iOS app configuration, assets, and EAS profiles. A signed iOS build, physical-device acceptance, TestFlight approval, and App Store submission have not been established here. This runbook is preparation for the account owner to carry out those steps; no cloud build or submission is authorized merely by reading it.

## Identity and account setup

Choose the final iOS bundle identifier before registering the app. The development default is `com.ftracker.personal`; set `FTRACKER_IOS_BUNDLE_ID` to an identifier controlled by the publisher. Keep it identical in local configuration, the EAS environment, signing credentials, and App Store Connect. Decide on publisher name, support contact, and the public privacy-policy URL before external testing.

Install the committed dependencies, log into the intended Expo account, and link the actual EAS project:

```powershell
npm.cmd ci
npx.cmd eas-cli@latest login
npx.cmd eas-cli@latest init
```

`app.config.ts` reads `EAS_PROJECT_ID` for the real project UUID. Because the app uses dynamic configuration, follow the CLI's instructions and set that value in your local environment and EAS build environment if the CLI cannot persist it automatically. Do not invent a UUID. Public app identity is not a signing secret. Use `.env.example` as the list of supported variables; never commit `.env`, Apple credentials, signing certificates, provisioning profiles, or private keys. See [EAS setup](https://docs.expo.dev/build/setup/) and [EAS environment variables](https://docs.expo.dev/eas/environment-variables/).

The account owner must supply the appropriate Apple Developer membership and App Store Connect access. Signing is managed through the authenticated EAS/Apple flow or the owner's protected credential infrastructure. Do not place signing credentials in this repository.

EAS CLI is intentionally invoked through `npx`; Expo Doctor prohibits installing it as a project dependency. `eas.json` sets `FTRACKER_BUILD_MODE=release` for preview and production, disabling arbitrary HTTP loads. Keep those profile environment settings intact when creating the release build.

## Verify the source and native configuration

```powershell
npm.cmd run typecheck
npm.cmd test
npx.cmd expo install --check
npx.cmd expo-doctor
npx.cmd expo config --type public
```

Review the generated identity, version, icons, splash configuration, tablet support, orientations, Face ID permission text, notification settings, privacy manifest, and encryption declaration. Confirm that the shipped app remains local-only and that no cloud credentials or financial data are present in its bundle. The encryption/export declaration and App Store privacy answers must describe the final linked binary, including any future dependencies.

An optional local JavaScript bundle check is:

```powershell
npx.cmd expo export --platform ios --output-dir dist/ios-bundle
```

That command does not produce an IPA or exercise native APIs. Native builds are performed by EAS on macOS infrastructure, or with an appropriately configured local macOS/Xcode setup. See Expo's [iOS build process](https://docs.expo.dev/build-reference/ios-builds/).

## Build profiles and physical testing

| Profile | Purpose | Metro requirement |
| --- | --- | --- |
| `development` | Physical-device native development client | Normally connects to the development server |
| `simulator` | iOS Simulator development client | Normally connects to the development server |
| `preview` | Internal physical-device build with embedded JavaScript | Suitable for independent offline acceptance |
| `production` | Store-signed build for TestFlight/App Store | Embedded JavaScript; no development server |

Register the intended physical iPhone and iPad for internal distribution when the selected provisioning method requires it. The owner initiates these commands after reviewing account usage and signing:

```powershell
npx.cmd eas-cli@latest device:create
npx.cmd eas-cli@latest build --platform ios --profile development
npx.cmd expo start --dev-client
```

Once the native development build is working, create the independent acceptance build:

```powershell
npx.cmd eas-cli@latest build --platform ios --profile preview
```

Install it on the iPhone 16 Pro Max-class device, iPad Air M2-class device, and a smaller supported iPhone. Record build identifiers and complete [TESTING.md](TESTING.md), including Airplane Mode cold launch, force-quit persistence, backup restore into a clean installation, Face ID/Touch ID, PIN lockout/reset, and actual local-notification delivery. Internal provisioning and device registration are described in [Expo's internal-distribution guide](https://docs.expo.dev/build/internal-distribution/).

Review iPad portrait/landscape, multitasking, safe areas, keyboards, large text, accessibility, and dark/light/system appearance on the actual native app. Screenshots or browser rendering cannot replace those checks. Validate app-switcher privacy and inspect database file protection as described in [SECURITY.md](SECURITY.md).

## Production build and TestFlight

Resolve acceptance failures before producing the candidate. EAS uses remote versioning and the production profile increments the build number. The publisher initiates:

```powershell
npx.cmd eas-cli@latest build --platform ios --profile production
npx.cmd eas-cli@latest submit --platform ios --profile production --latest
```

Create or select the matching App Store Connect app and supply the required submission identity through the account flow. `eas.json` deliberately contains no private credentials or invented App Store application ID. Uploading a binary does not itself complete App Store review or make the app publicly available; follow [Expo's iOS submission guide](https://docs.expo.dev/submit/ios/).

Wait for processing and complete the relevant TestFlight requirements. Test the actual production candidate on both physical device classes, including setup, lock, offline launch, financial persistence, reminder delivery, and backup migration. Keep test notes tied to the TestFlight version/build. Do not claim cloud synchronization in the test instructions for this local-only release.

## App Store preparation and final submission

- Publish the reviewed privacy policy on a stable public URL and provide a real support URL/contact. Resolve publisher-specific placeholders in draft documents.
- Prepare truthful screenshots from the candidate on the required iPhone/iPad display classes. Use fictional financial examples and redact personal data.
- Complete name/subtitle, description, category, age rating, language/localization, support details, version notes, and any required review information.
- Review App Privacy answers, privacy manifests, SDK behavior, permission descriptions, and encryption declarations against the final binary. Explain that local financial data and user-directed exports stay under the user's control; avoid claiming online backups or automatic device synchronization.
- Explain the optional app lock and local-only onboarding to reviewers. The release needs no Supabase or Google login to access core features.
- Review and confirm all remaining [TESTING.md](TESTING.md) release gates, including clean restore and physical offline acceptance.
- In App Store Connect, select the tested build, complete the remaining requirements, review the listing, and submit through the publisher's account. Track review outcomes and repeat affected tests after changes.

Do not commit signing material, trigger paid builds, upload binaries, or submit a listing as an automatic documentation step. Those actions belong to the account owner or an explicitly authorized release workflow.
