#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -gt 1 ]]; then
    echo "Usage: $0 [native-root]" >&2
    exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NATIVE_ROOT="${1:-$(cd "$SCRIPT_DIR/.." && pwd)}"
DOC="$NATIVE_ROOT/SETUP.md"
GRADLE_WRAPPER="$NATIVE_ROOT/gradlew"
WRAPPER_PROPERTIES="$NATIVE_ROOT/gradle/wrapper/gradle-wrapper.properties"
VERSION_CATALOG="$NATIVE_ROOT/gradle/libs.versions.toml"
DAEMON_PROPERTIES="$NATIVE_ROOT/gradle/gradle-daemon-jvm.properties"
ANDROID_BUILD="$NATIVE_ROOT/androidApp/build.gradle.kts"
SHARED_BUILD="$NATIVE_ROOT/shared/build.gradle.kts"
IOS_FASTFILE="$NATIVE_ROOT/iosApp/fastlane/Fastfile"
IOS_INFO_PLIST="$NATIVE_ROOT/iosApp/iosApp/Info.plist"

required_files=(
    "$DOC"
    "$GRADLE_WRAPPER"
    "$WRAPPER_PROPERTIES"
    "$VERSION_CATALOG"
    "$DAEMON_PROPERTIES"
    "$ANDROID_BUILD"
    "$SHARED_BUILD"
    "$IOS_FASTFILE"
    "$IOS_INFO_PLIST"
)

for required_file in "${required_files[@]}"; do
    if [[ ! -f "$required_file" ]]; then
        echo "Missing setup freshness input: $required_file" >&2
        exit 2
    fi
done

read_value() {
    local pattern="$1"
    local file="$2"
    sed -nE "s/${pattern}/\\1/p" "$file" | head -n 1
}

read_catalog_version() {
    local key="$1"
    sed -nE "s/^${key} = \"([^\"]+)\"$/\\1/p" "$VERSION_CATALOG" | head -n 1
}

failures=0

require_doc_text() {
    local expected="$1"
    local description="$2"

    if ! grep -Fq -- "$expected" "$DOC"; then
        echo "SETUP freshness failure: $description (expected: $expected)" >&2
        failures=$((failures + 1))
    fi
}

gradle_version="$(read_value '^distributionUrl=.*gradle-([0-9]+(\.[0-9]+)*)-bin\.zip$' "$WRAPPER_PROPERTIES")"
kotlin_version="$(read_catalog_version 'kotlin')"
agp_version="$(read_catalog_version 'agp')"
compose_bom_version="$(read_catalog_version 'compose-bom')"
ktor_version="$(read_catalog_version 'ktor')"
koin_version="$(read_catalog_version 'koin')"
daemon_jvm_version="$(read_value '^toolchainVersion=([0-9]+)$' "$DAEMON_PROPERTIES")"
android_jvm_version="$(read_value '.*jvmToolchain\(([0-9]+)\).*' "$ANDROID_BUILD")"
shared_jvm_version="$(read_value '.*jvmToolchain\(([0-9]+)\).*' "$SHARED_BUILD")"
compile_sdk="$(read_value '.*compileSdk = ([0-9]+).*' "$ANDROID_BUILD")"
target_sdk="$(read_value '.*targetSdk = ([0-9]+).*' "$ANDROID_BUILD")"
min_sdk="$(read_value '.*minSdk = ([0-9]+).*' "$ANDROID_BUILD")"
application_id="$(read_value '.*applicationId = "([^"]+)".*' "$ANDROID_BUILD")"
debug_api_url="$(read_value '.*buildConfigField\("String", "API_BASE_URL", "\\"([^\"]+)\\""\).*' "$ANDROID_BUILD")"
release_api_url="$(sed -nE 's/.*buildConfigField\("String", "API_BASE_URL", "\\"([^\"]+)\\""\).*/\1/p' "$ANDROID_BUILD" | tail -n 1)"

if [[ -z "$gradle_version" || -z "$kotlin_version" || -z "$agp_version" || -z "$compose_bom_version" || -z "$ktor_version" || -z "$koin_version" || -z "$daemon_jvm_version" || -z "$android_jvm_version" || -z "$shared_jvm_version" || -z "$compile_sdk" || -z "$target_sdk" || -z "$min_sdk" || -z "$application_id" || -z "$debug_api_url" || -z "$release_api_url" ]]; then
    echo "Could not extract all setup facts from committed native configuration" >&2
    exit 2
fi

if [[ "$android_jvm_version" != "$shared_jvm_version" ]]; then
    echo "SETUP freshness failure: Android and shared JVM toolchains differ" >&2
    failures=$((failures + 1))
fi

require_doc_text "**Gradle wrapper**: $gradle_version" "Gradle wrapper version drifted"
require_doc_text "**Kotlin**: $kotlin_version" "Kotlin version drifted"
require_doc_text "**AGP**: $agp_version" "Android Gradle Plugin version drifted"
require_doc_text "**Compose BOM**: $compose_bom_version" "Compose BOM version drifted"
require_doc_text "**Ktor**: $ktor_version" "Ktor version drifted"
require_doc_text "**Koin**: $koin_version" "Koin version drifted"
require_doc_text "**Project JVM toolchain**: Java $android_jvm_version" "project JVM toolchain drifted"
require_doc_text "**Gradle daemon JVM**: Java $daemon_jvm_version" "Gradle daemon JVM drifted"
require_doc_text "**Android SDK**: compile $compile_sdk, target $target_sdk, minimum $min_sdk" "Android SDK values drifted"
require_doc_text "**Android application ID**: \`$application_id\`" "Android application ID drifted"
require_doc_text "**Debug API base URL**: \`$debug_api_url\`" "debug API endpoint drifted"
require_doc_text "**Release API base URL**: \`$release_api_url\`" "release API endpoint drifted"
require_doc_text "./gradlew :androidApp:assembleDebug" "Android build command drifted"
require_doc_text "./gradlew :shared:linkDebugFrameworkIosSimulatorArm64" "iOS framework command drifted"

for ios_target in iosX64 iosArm64 iosSimulatorArm64; do
    if ! grep -Fq -- "$ios_target()" "$SHARED_BUILD"; then
        echo "SETUP freshness failure: shared iOS target $ios_target is no longer declared" >&2
        failures=$((failures + 1))
        continue
    fi

    target_suffix="${ios_target#ios}"
    target_first="${target_suffix%${target_suffix#?}}"
    target_rest="${target_suffix#?}"
    case "$target_first" in
        X|A|S) ;;
        x) target_first="X" ;;
        a) target_first="A" ;;
        s) target_first="S" ;;
        *)
            echo "SETUP freshness failure: unsupported iOS target spelling $ios_target" >&2
            failures=$((failures + 1))
            continue
            ;;
    esac
    if ! grep -Eq -- "\\./gradlew :shared:link(Debug|Release)FrameworkIos${target_first}${target_rest}" "$DOC"; then
        echo "SETUP freshness failure: iOS target command drifted for $ios_target" >&2
        failures=$((failures + 1))
    fi
done

if grep -Fq -- "gradle wrapper --gradle-version" "$DOC"; then
    echo "SETUP freshness failure: setup still instructs developers to regenerate the committed Gradle wrapper" >&2
    failures=$((failures + 1))
fi

if ! grep -Fq -- "No .xcworkspace or .xcodeproj found" "$IOS_FASTFILE"; then
    echo "SETUP freshness failure: iOS Fastlane no-project skip behavior changed" >&2
    failures=$((failures + 1))
fi

ios_project=""
if [[ -d "$NATIVE_ROOT/iosApp" ]]; then
    ios_project="$(find "$NATIVE_ROOT/iosApp" -maxdepth 2 \( -name '*.xcodeproj' -o -name '*.xcworkspace' \) -print -quit 2>/dev/null || true)"
fi

if [[ -n "$ios_project" ]]; then
    echo "SETUP freshness failure: iOS project packaging appeared at $ios_project; update SETUP.md" >&2
    failures=$((failures + 1))
else
    require_doc_text 'No committed `.xcodeproj` or `.xcworkspace` exists under `native/iosApp/`.' "iOS project absence changed or is undocumented"
    require_doc_text "No iOS deployment target is declared in committed Xcode configuration." "iOS deployment-target limitation changed or is undocumented"
    require_doc_text "Fastlane's iOS lane skips the build when no Xcode project is present." "iOS Fastlane skip limitation changed or is undocumented"
fi

if [[ "$failures" -ne 0 ]]; then
    echo "Setup documentation freshness check failed with $failures issue(s)" >&2
    exit 1
fi

echo "Setup documentation matches committed native configuration"
