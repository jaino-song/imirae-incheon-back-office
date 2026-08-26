# 이미래 인천 (imirae-incheon) — Native App Setup Guide

> This guide describes the native files committed in this repository. It does not claim that a device, provider account, Xcode package, or live backend has been verified.
>
> Run `bash native/scripts/setup-doc-freshness.test.sh` from the repository root after changing native tooling or setup instructions. The check extracts pinned facts from the committed Gradle configuration and fails when this document drifts.

## Repository status

- **Android:** A committed Gradle/Kotlin Multiplatform project is present under `native/`. The Android application module is `androidApp`.
- **Shared module:** `shared` declares Android, iOS device, and iOS simulator framework targets.
- **iOS:** SwiftUI source files and `Info.plist` are present under `native/iosApp/iosApp/`, but no Xcode project or workspace is committed. There is therefore no repository-backed iOS app build, signing, or run workflow yet.
- **Push and OAuth:** Android libraries and source hooks exist, but provider configuration is not committed and the iOS Kakao action is still a TODO. Treat those integrations as unverified.

## Prerequisites

### Java and Gradle

The project uses two Java version facts:

1. The Android and shared modules compile with the Java 17 JVM toolchain.
2. `gradle/gradle-daemon-jvm.properties` requests Java 21 for the Gradle daemon.

Install a JDK 17 distribution and make it visible to the shell. If the Gradle daemon cannot provision or locate its requested JDK 21, make JDK 21 available to Gradle as well. The repository does not claim that daemon provisioning succeeds on every machine.

```bash
brew install openjdk@17

# Add to your shell profile if your JDK is not already discoverable:
export JAVA_HOME=$(/usr/libexec/java_home -v 17 2>/dev/null || echo "/opt/homebrew/opt/openjdk@17")
export PATH="$JAVA_HOME/bin:$PATH"

# Reload and inspect the active runtime:
source ~/.zshrc
java -version
```

The Gradle wrapper is already committed at `native/gradlew` and is pinned to the version listed below. Do not regenerate it as part of normal setup.

```bash
cd /path/to/babyjamjam-admin/native
./gradlew --version
```

### Android SDK and Android Studio

Android Studio is useful for emulator and IDE work, but the documented build commands use the committed wrapper directly.

1. Install Android Studio from [developer.android.com/studio](https://developer.android.com/studio).
2. In SDK Manager, install Android API 36, Android SDK Build-Tools, Android SDK Platform-Tools, and an emulator system image.
3. Point the shell at the standard macOS SDK location when needed:

   ```bash
   export ANDROID_HOME="$HOME/Library/Android/sdk"
   export PATH="$ANDROID_HOME/platform-tools:$PATH"
   ```

The module requires minimum SDK 26 and compiles and targets SDK 36. Android Studio's own version is not pinned in the committed project, so this guide does not claim a particular IDE release.

## Android app

### Build from the command line

From the repository root:

```bash
cd native
./gradlew :androidApp:assembleDebug
```

The command is a build request; a successful APK, emulator, or device run must be observed separately. The Android Fastlane CI lane runs the following repository-backed checks when Fastlane is available:

```bash
./gradlew :androidApp:test :androidApp:lint :androidApp:assembleDebug --stacktrace
```

To install a debug build on an already connected device or emulator, use:

```bash
./gradlew :androidApp:installDebug
```

This command requires a connected target and does not create or start an emulator.

### Android Studio

1. Open the existing `native/` directory in Android Studio.
2. Allow Gradle sync to use the committed wrapper.
3. Select the `androidApp` module and a configured device or emulator.
4. Run only after sync and compilation complete successfully.

The repository does not provide evidence that a specific Android Studio version, emulator image, or physical device has completed this flow.

### Runtime configuration currently in source

The Android module defines these build-time API endpoints in `androidApp/build.gradle.kts`:

- Debug builds use `http://10.0.2.2:3001`, which is the Android-emulator alias for the host machine. It is not a general physical-device address.
- Release builds use `https://api.imirae-incheon.com`.

- **Android application ID**: `com.imirae.incheon`

Backend reachability, authentication, and live provider behavior are not verified by these source values.

### Firebase and Kakao limitations

- `firebase-messaging` is declared as an Android dependency, but no `google-services` Gradle plugin or `google-services.json` is committed in the current build. Push notification setup is not complete or verified. Keep provider configuration outside the repository and follow the secrets policy.
- The Android manifest still contains the `kakao{NATIVE_APP_KEY}` callback placeholder. The Kakao Android library is declared, but no app key is supplied by this repository. OAuth is not a verified setup result.

Do not add provider credentials to source files while following this guide.

## iOS status and framework generation

### What is committed

The repository contains SwiftUI source files and an `Info.plist` under `native/iosApp/iosApp/`. No committed `.xcodeproj` or `.xcworkspace` exists under `native/iosApp/`.

```bash
cd native
find iosApp -maxdepth 2 \( -name '*.xcodeproj' -o -name '*.xcworkspace' \) -print
```

The command currently produces no output. Do not create an Xcode project, invent build settings, or treat the Swift source tree as a packaged app as part of setup documentation.

No iOS deployment target is declared in committed Xcode configuration. The committed `Info.plist` uses Xcode build variables for the bundle identifier and version, so it does not establish a concrete bundle ID, signing team, scheme, framework search path, or deployment target.

### Generate the shared framework

The shared KMP module declares these framework targets:

```bash
cd native

# Apple Silicon simulator:
./gradlew :shared:linkDebugFrameworkIosSimulatorArm64

# Intel simulator:
./gradlew :shared:linkDebugFrameworkIosX64

# Device framework:
./gradlew :shared:linkReleaseFrameworkIosArm64
```

When a task succeeds, its output is under `native/shared/build/bin/` for the corresponding target. Generating a framework does not prove that Swift sources are linked, signed, packaged, or runnable because the Xcode project is absent.

### Fastlane limitation

The committed `native/iosApp/fastlane/Fastfile` looks for an `.xcworkspace` or `.xcodeproj` and emits an important skip message when neither exists. Fastlane's iOS lane skips the build when no Xcode project is present. A skipped lane is not iOS CI or packaging evidence.

The old workflow that creates an Xcode project, adds files manually, configures framework search paths, or installs an uncommitted Kakao package is intentionally not documented here. Those steps require a separate, reviewed iOS packaging implementation. Xcode and CocoaPods versions are not pinned or verified by this repository.

The iOS SwiftUI Kakao button remains a TODO, and no committed iOS Firebase configuration or provider verification is present.

## Shared module checks

Run the shared Kotlin tests when the local toolchain and dependencies are available:

```bash
cd native
./gradlew :shared:allTests
```

At the time this guide was refreshed, that aggregate command compiled the shared iOS simulator sources but failed at `:shared:iosSimulatorArm64Test` because test sources were present and no tests were discovered. This is a current test-configuration limitation, not evidence that the shared test suite passes.

To remove generated Gradle outputs:

```bash
./gradlew clean
```

These commands do not require provider credentials, but they may require network access to download Gradle or Maven artifacts. A command that starts or skips is not evidence of a completed app build unless its result is observed and recorded.

## Version facts (checked against committed configuration)

- **Gradle wrapper**: 9.2.1
- **Kotlin**: 2.3.10
- **AGP**: 9.0.1
- **Compose BOM**: 2026.02.00
- **Ktor**: 3.4.0
- **Koin**: 4.1.1
- **Project JVM toolchain**: Java 17
- **Gradle daemon JVM**: Java 21
- **Android SDK**: compile 36, target 36, minimum 26
- **Debug API base URL**: `http://10.0.2.2:3001`
- **Release API base URL**: `https://api.imirae-incheon.com`

The exact values above are extracted from `gradle/wrapper/gradle-wrapper.properties`, `gradle/libs.versions.toml`, `gradle/gradle-daemon-jvm.properties`, `androidApp/build.gradle.kts`, and `shared/build.gradle.kts` by `scripts/check-setup-doc.sh`. If one of those files changes, update this section and the relevant instructions together.

## Documentation freshness check

From the repository root:

```bash
bash native/scripts/setup-doc-freshness.test.sh
```

The test first checks the current tree, then creates a temporary copy with a deliberately stale Gradle version and confirms that the checker rejects it. It removes only that temporary fixture when it exits.

## Known unverified limitations

- No successful Android build, emulator installation, physical-device run, or backend login is claimed by this document.
- The current `:shared:allTests` aggregate fails at the iOS simulator test task when no tests are discovered, as described above.
- No committed iOS Xcode project or workspace exists, so iOS packaging, signing, framework integration, and simulator/device execution are not currently available from this checkout.
- No iOS deployment target, concrete bundle identifier, scheme, signing team, or framework search path is declared in committed Xcode configuration.
- Firebase push delivery, Kakao OAuth, APNs, and live provider accounts are not verified here.
- The documentation freshness script validates pinned text against local configuration; it does not replace Gradle compilation, Xcode compilation, device testing, or provider verification.
