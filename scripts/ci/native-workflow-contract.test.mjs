import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WORKSPACE_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");
const WORKFLOW_ROOT = resolve(WORKSPACE_ROOT, ".github/workflows");

async function readWorkflow(fileName) {
    return readFile(resolve(WORKFLOW_ROOT, fileName), "utf8");
}

function assertNativeTriggers(workflow, fileName) {
    const ownWorkflowPath = `.github/workflows/${fileName}`;
    const otherWorkflowPath = fileName === "native-android.yml"
        ? ".github/workflows/native-ios.yml"
        : ".github/workflows/native-android.yml";

    assert.match(workflow, /^name: Native (?:Android|iOS) CI$/m, `${fileName} must have the aggregate gate name`);
    assert.match(workflow, /^  push:\n    branches: \[dev\][\s\S]*?      - ["']native\/\*\*["']/m, `${fileName} must run native changes pushed to dev`);
    assert.match(workflow, /^  pull_request:\n    branches: \[main, dev, preview\][\s\S]*?      - ["']native\/\*\*["']/m, `${fileName} must cover canonical PR branches and native paths`);
    for (const trigger of ["push", "pull_request"]) {
        const triggerPaths = trigger === "push"
            ? workflow.match(/^  push:\n    branches: \[dev\]\n    paths:\n((?:      - .+\n)+)/m)?.[1]
            : workflow.match(/^  pull_request:\n    branches: \[main, dev, preview\]\n    paths:\n((?:      - .+\n)+)/m)?.[1];
        assert.ok(triggerPaths, `${fileName} must declare ${trigger} paths`);
        assert.match(
            triggerPaths,
            /^      - ["']scripts\/ci\/native-workflow-contract\.test\.mjs["']$/m,
            `${fileName} must run when the native workflow contract test changes on ${trigger}`,
        );
    }
    assert.match(workflow, new RegExp(`^      - ["']${ownWorkflowPath.replace(/[.*+?^${}()|[\\]\\]/g, "\\\\$&")}['"]$`, "m"), `${fileName} must run when its definition changes`);
    assert.doesNotMatch(workflow, new RegExp(otherWorkflowPath.replace(/[.*+?^${}()|[\\]\\]/g, "\\\\$&")), `${fileName} must not trigger for the other native workflow definition`);
    assert.match(workflow, /^  merge_group:\n    types: \[checks_requested\]$/m, `${fileName} must run in merge queues without a path filter`);
    assert.match(workflow, /^permissions:\n  contents: read\n/m, `${fileName} must default to read-only repository access`);
    assert.doesNotMatch(workflow, /pull_request_target|continue-on-error:/, `${fileName} must not bypass untrusted-code or failure gates`);
    assert.doesNotMatch(workflow, /secrets\.|^[ ]{4,}[A-Za-z-]+: write$/m, `${fileName} must not introduce privileged native CI access`);
}

function assertPinnedActions(workflow, fileName) {
    const actionLines = workflow.split("\n").filter((line) => /\buses:\s+/.test(line));
    assert.ok(actionLines.length > 0, `${fileName} must use repository setup actions`);
    for (const line of actionLines) {
        assert.match(line, /@[0-9a-f]{40}\s+#\s+v[0-9]+(?:\.[0-9]+)+/, `${fileName} actions must use full immutable SHAs with release labels: ${line}`);
    }
}

test("native lanes are discoverable at the repository workflow root and old nested lanes are removed", async () => {
    await Promise.all([
        access(resolve(WORKFLOW_ROOT, "native-android.yml")),
        access(resolve(WORKFLOW_ROOT, "native-ios.yml")),
    ]);
    for (const nestedFile of ["native/.github/workflows/native-android.yml", "native/.github/workflows/native-ios.yml"]) {
        await assert.rejects(
            readFile(resolve(WORKSPACE_ROOT, nestedFile), "utf8"),
            (error) => error?.code === "ENOENT",
            `${nestedFile} must not remain as an unreachable duplicate lane`,
        );
    }
});

test("every repository-root workflow remains syntactically valid YAML", async () => {
    const names = (await readdir(WORKFLOW_ROOT)).filter((name) => /\.(?:yml|yaml)$/.test(name)).sort();
    const result = spawnSync(
        "ruby",
        ["-ryaml", "-e", "ARGV.each { |file| YAML.load_file(file) }", ...names.map((name) => resolve(WORKFLOW_ROOT, name))],
        { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout || "workflow YAML parsing failed");
});

test("native Android workflow has real shared and Android compile/test commands", async () => {
    const workflow = await readWorkflow("native-android.yml");
    assertNativeTriggers(workflow, "native-android.yml");
    assert.match(workflow, /^jobs:\n  android_ci:\n    name: Android CI$/m);
    assert.match(workflow, /native\/scripts\/setup-doc-freshness\.test\.sh/);
    assert.match(workflow, /:shared:compileAndroidMain/);
    assert.match(workflow, /:androidApp:test/);
    assert.match(workflow, /:androidApp:lint/);
    assert.match(workflow, /:androidApp:assembleDebug/);
    assert.match(workflow, /ANDROID_(?:HOME|SDK_ROOT)/);
    assert.match(workflow, /::error::[\s\S]*?\n[\s\S]*?exit 1/, "missing Android SDK metadata must fail the lane");
    assertPinnedActions(workflow, "native-android.yml");
    assert.match(workflow, /jobs:\n[\s\S]*?sca_scan:\n    name: SCA Scan/);
});

test("native iOS workflow has real shared framework and Xcode build/test commands", async () => {
    const workflow = await readWorkflow("native-ios.yml");
    assertNativeTriggers(workflow, "native-ios.yml");
    assert.match(workflow, /^jobs:\n  ios_ci:\n    name: iOS CI$/m);
    assert.match(workflow, /native\/scripts\/setup-doc-freshness\.test\.sh/);
    assert.match(workflow, /:shared:linkDebugFrameworkIosSimulatorArm64/);
    assert.match(workflow, /xcodebuild[\s\S]*\btest\b/);
    assert.match(workflow, /\.xcodeproj|\.xcworkspace/);
    assert.match(workflow, /IOS_BUILD_KIND=none/);
    assert.match(workflow, /\[\[\s*"\$\{IOS_BUILD_KIND\}"\s*==\s*"none"\s*\]\]/);
    assert.match(workflow, /::notice::No Xcode project or workspace found[\s\S]*?optional iOS app lane/);
    assert.doesNotMatch(workflow, /No Xcode project or workspace is committed[\s\S]*?exit 1/, "missing iOS project metadata must skip only the optional app lane");
    assertPinnedActions(workflow, "native-ios.yml");
    assert.match(workflow, /jobs:\n[\s\S]*?sca_scan:\n    name: SCA Scan/);
});

test("native Android declarations preserve FCM delivery and Kakao callback contracts", async () => {
    const [manifest, gradle, fcmService, setup] = await Promise.all([
        readFile(resolve(WORKSPACE_ROOT, "native/androidApp/src/main/AndroidManifest.xml"), "utf8"),
        readFile(resolve(WORKSPACE_ROOT, "native/androidApp/build.gradle.kts"), "utf8"),
        readFile(resolve(WORKSPACE_ROOT, "native/androidApp/src/main/kotlin/com/imirae/incheon/notification/FCMService.kt"), "utf8"),
        readFile(resolve(WORKSPACE_ROOT, "native/SETUP.md"), "utf8"),
    ]);

    assert.match(manifest, /android:name="\.notification\.FCMService"/);
    assert.match(fcmService, /class\s+FCMService\s*:\s*FirebaseMessagingService\(\)/);
    assert.match(fcmService, /override\s+fun\s+onMessageReceived\(remoteMessage:\s*RemoteMessage\)/);
    assert.match(fcmService, /notificationManager\.routeNotification\(payload\)/);
    assert.match(fcmService, /showNotification\(context, payload(?:,|\))/);
    assert.doesNotMatch(fcmService, /onNewToken|registerToken|registerDeviceToken|notifications\/subscribe/);
    assert.match(manifest, /android:scheme="kakao\$\{KAKAO_NATIVE_APP_KEY\}"/);
    assert.doesNotMatch(manifest, /kakao\{NATIVE_APP_KEY\}/, "the Kakao callback must use a Gradle manifest placeholder");
    assert.match(gradle, /manifestPlaceholders\["KAKAO_NATIVE_APP_KEY"\]/);
    assert.match(gradle, /orElse\("placeholder"\)/, "CI must have a deterministic lowercase callback-scheme fallback");
    assert.match(setup, /`kakao\$\{KAKAO_NATIVE_APP_KEY\}`/);
    assert.match(setup, /optional `KAKAO_NATIVE_APP_KEY` Gradle property/);
    assert.doesNotMatch(setup, /`kakao\{NATIVE_APP_KEY\}`/, "setup documentation must describe the real callback placeholder");
});

test("native notification sources do not expose the unsupported web-push subscription path", async () => {
    const sourcePaths = {
        notificationService: "native/shared/src/commonMain/kotlin/com/imirae/incheon/data/remote/NotificationService.kt",
        notificationManager: "native/shared/src/commonMain/kotlin/com/imirae/incheon/notification/NotificationManager.kt",
        authManager: "native/shared/src/commonMain/kotlin/com/imirae/incheon/auth/AuthManager.kt",
        sharedModule: "native/shared/src/commonMain/kotlin/com/imirae/incheon/di/SharedModule.kt",
        androidModule: "native/androidApp/src/main/kotlin/com/imirae/incheon/App.kt",
        fcmService: "native/androidApp/src/main/kotlin/com/imirae/incheon/notification/FCMService.kt",
        apnsDelegate: "native/iosApp/iosApp/Notification/APNsDelegate.swift",
    };
    const sources = await Promise.all(
        Object.entries(sourcePaths).map(async ([name, path]) => [name, await readFile(resolve(WORKSPACE_ROOT, path), "utf8")]),
    );

    for (const [name, source] of sources) {
        assert.doesNotMatch(
            source,
            /\/notifications\/(?:un)?subscribe|registerDeviceToken|unregisterDeviceToken|retryPendingToken|NotificationTokenStore|notification_device_token/,
            `${name} must not retain the unsupported native token registration path`,
        );
    }

    assert.doesNotMatch(sources.find(([name]) => name === "authManager")[1], /notificationManager/);
    assert.match(
        sources.find(([name]) => name === "apnsDelegate")[1],
        /didRegisterForRemoteNotifications\(deviceToken _:\s*Data\)/,
        "the APNs callback must ignore the provider token until the mobile-token contract exists",
    );
    await assert.rejects(
        readFile(resolve(WORKSPACE_ROOT, "native/shared/src/commonMain/kotlin/com/imirae/incheon/notification/NotificationTokenStore.kt"), "utf8"),
        (error) => error?.code === "ENOENT",
        "the native token store must be removed while mobile push is unsupported",
    );
});

test("native workflow names and jobs remain connected before aggregate activation", async () => {
    let aggregate = null;
    try {
        aggregate = await readWorkflow("ci-aggregate-gate.yml");
    } catch (error) {
        assert.equal(error?.code, "ENOENT", "aggregate workflow lookup failed unexpectedly");
    }
    const evaluator = await readFile(resolve(WORKSPACE_ROOT, "scripts/ci/aggregate-gate.mjs"), "utf8");
    for (const [workflow, job] of [["Native Android CI", "Android CI"], ["Native iOS CI", "iOS CI"]]) {
        assert.ok(evaluator.includes(`workflow: "${workflow}"`), `${workflow} must retain its exact aggregate workflow contract`);
        assert.ok(evaluator.includes(`jobs: ["${job}", "SCA Scan"]`), `${workflow} must retain its exact aggregate job contract`);
    }
    if (!aggregate) return;
    for (const [workflow, job] of [["Native Android CI", "Android CI"], ["Native iOS CI", "iOS CI"]]) {
        assert.match(aggregate, new RegExp(`- ${workflow.replace(/[.*+?^${}()|[\\]\\]/g, "\\\\$&")}`), `${workflow} must be observed by workflow_run`);
    }
});
