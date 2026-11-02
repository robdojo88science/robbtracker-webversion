# Free Windows Android preview

This preview uses a local Android emulator, SDK, Java, and Gradle. No Apple membership, cloud build, store upload, subscription, or public source repository is needed. It previews the native Android version of the same React Native application; iPhone/iPad behavior still needs separate device testing.

Once the initial native build and `FTracker_Windows` emulator setup are complete on this PC, open PowerShell in the project folder:

```powershell
cd "C:\Users\rober\OneDrive\Desktop\ftracker"
npm.cmd run preview:windows
```

The launcher opens the virtual phone, starts/reuses the local Metro server on port 8087, installs the existing debug APK while retaining tracker data, and opens F-Tracker. The initial Android boot and JavaScript bundle can take a moment. Close the virtual phone window when you finish.

The preview's data belongs to this virtual device. It is separate from an iPhone, iPad, or physical Android tracker. Use local backups to migrate into an empty tracker; cloud sync remains unavailable.

## Troubleshooting

- Logs: `build/windows-preview/emulator.log` and `build/windows-preview/metro.log`.
- Missing APK: the native Android build must finish before the launcher can install it.
- Emulator missing: the named `FTracker_Windows` virtual device must exist in the current Windows user's Android tools.
- After changing native packages or configuration, regenerate/build with `npm.cmd run android` using the installed SDK and Java. JavaScript screens use the existing native development build.
- `npm.cmd run check` verifies TypeScript and financial/platform unit tests without opening the app.

The standalone SDK tools are enough to run the emulator. The full Android Studio IDE is optional. SDK downloads and the first native build require internet; the development preview also needs its local Metro server. Use an embedded release build for independent airplane-mode acceptance.
