#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NATIVE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CHECK_SCRIPT="$SCRIPT_DIR/check-setup-doc.sh"

if [[ ! -x "$CHECK_SCRIPT" ]]; then
    echo "Expected executable freshness check at $CHECK_SCRIPT" >&2
    exit 1
fi

"$CHECK_SCRIPT" "$NATIVE_ROOT"

fixture_root="$(mktemp -d)"
trap 'rm -rf "$fixture_root"' EXIT

mkdir -p "$fixture_root/native/androidApp" "$fixture_root/native/shared" "$fixture_root/native/gradle/wrapper" "$fixture_root/native/iosApp/fastlane" "$fixture_root/native/iosApp/iosApp"
cp "$NATIVE_ROOT/SETUP.md" "$fixture_root/native/SETUP.md"
cp "$NATIVE_ROOT/gradlew" "$fixture_root/native/gradlew"
cp "$NATIVE_ROOT/androidApp/build.gradle.kts" "$fixture_root/native/androidApp/build.gradle.kts"
cp "$NATIVE_ROOT/shared/build.gradle.kts" "$fixture_root/native/shared/build.gradle.kts"
cp "$NATIVE_ROOT/gradle/libs.versions.toml" "$fixture_root/native/gradle/libs.versions.toml"
cp "$NATIVE_ROOT/gradle/gradle-daemon-jvm.properties" "$fixture_root/native/gradle/gradle-daemon-jvm.properties"
cp "$NATIVE_ROOT/gradle/wrapper/gradle-wrapper.properties" "$fixture_root/native/gradle/wrapper/gradle-wrapper.properties"
cp "$NATIVE_ROOT/iosApp/fastlane/Fastfile" "$fixture_root/native/iosApp/fastlane/Fastfile"
cp "$NATIVE_ROOT/iosApp/iosApp/Info.plist" "$fixture_root/native/iosApp/iosApp/Info.plist"

python3 - "$fixture_root/native/SETUP.md" <<'PY'
from pathlib import Path
import sys

setup_path = Path(sys.argv[1])
setup = setup_path.read_text()
setup = setup.replace("- **Gradle wrapper**: 9.2.1", "- **Gradle wrapper**: 0.0.0", 1)
setup_path.write_text(setup)
PY

if "$CHECK_SCRIPT" "$fixture_root/native" >/dev/null 2>&1; then
    echo "Freshness check accepted a deliberately stale Gradle version" >&2
    exit 1
fi

echo "Setup documentation freshness contract passed"
