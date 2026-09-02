#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runManifestGate } from "./design-system-manifest-gate.mjs";

const TARGET_RULES = new Set(["data-component/require-data-component"]);
const TARGET_RULE_PREFIX = "ui-architecture/";
const BASELINE_PATH = "docs/design-system/ui-debt-baseline.json";
const RULES_DOC_PATH = "docs/design-system/AGENT_UI_RULES.md";
const VALID_PLATFORMS = ["frontend", "mobile"];
export const IDENTITY_BASELINE_VERSION = 2;

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "../../..");
const baselineAbsolutePath = path.join(repoRoot, BASELINE_PATH);

function parseArgs(argv) {
  const parsed = {
    platform: undefined,
    update: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--update") {
      parsed.update = true;
      continue;
    }

    if (arg === "--platform") {
      const platform = argv[index + 1];
      if (!platform || platform.startsWith("--")) {
        throw new Error("Missing value for --platform. Expected frontend or mobile.");
      }
      parsed.platform = platform;
      index += 1;
      continue;
    }

    if (arg.startsWith("--platform=")) {
      parsed.platform = arg.slice("--platform=".length);
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (parsed.platform && !VALID_PLATFORMS.includes(parsed.platform)) {
    throw new Error(`Invalid platform "${parsed.platform}". Expected frontend or mobile.`);
  }

  return parsed;
}

function slashify(value) {
  return String(value).replaceAll("\\", "/");
}

function normalizeSlashPath(value) {
  const slashified = slashify(value);
  const absolute = slashified.startsWith("/");
  const segments = [];

  for (const segment of slashified.split("/")) {
    if (segment === "" || segment === ".") {
      continue;
    }

    if (segment === "..") {
      if (segments.length > 0 && segments.at(-1) !== "..") {
        segments.pop();
      } else if (!absolute) {
        segments.push(segment);
      }
      continue;
    }

    segments.push(segment);
  }

  const normalized = segments.join("/");
  return absolute ? `/${normalized}` : normalized;
}

export function normalizeRepoRelativePath(filePath, root = repoRoot) {
  const normalizedFile = normalizeSlashPath(filePath);
  const normalizedRoot = normalizeSlashPath(root).replace(/\/$/, "");

  if (
    normalizedRoot &&
    (normalizedFile === normalizedRoot || normalizedFile.startsWith(`${normalizedRoot}/`))
  ) {
    return normalizedFile.slice(normalizedRoot.length).replace(/^\/+/, "");
  }

  return normalizedFile.replace(/^\.\/+/, "");
}

function normalizePlatformFilePath(platform, filePath, root = repoRoot) {
  const relativeFile = normalizeRepoRelativePath(filePath, root);

  if (relativeFile === platform || relativeFile.startsWith(`${platform}/`)) {
    return relativeFile;
  }

  if (relativeFile.startsWith("src/")) {
    return `${platform}/${relativeFile}`;
  }

  return relativeFile;
}

function normalizePosition(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric >= 0 ? numeric : fallback;
}

function normalizeLocation(message) {
  const line = normalizePosition(message.line);
  const column = normalizePosition(message.column);
  const endLine = normalizePosition(message.endLine, line);
  const endColumn = normalizePosition(message.endColumn, column);
  return `${line}:${column}-${endLine}:${endColumn}`;
}

function normalizeMessageKey(message) {
  const candidate = message.messageId ?? message.message ?? "unknown";
  return String(candidate).trim().replace(/\s+/g, " ") || "unknown";
}

function normalizeLocationValue(record) {
  if (typeof record.location === "string" && record.location.trim() !== "") {
    return record.location.trim().replace(/\s+/g, " ");
  }

  const line = normalizePosition(record.line);
  const column = normalizePosition(record.column);
  const endLine = normalizePosition(record.endLine, line);
  const endColumn = normalizePosition(record.endColumn, column);
  return `${line}:${column}-${endLine}:${endColumn}`;
}

function normalizeViolationRecord(record) {
  return {
    file: normalizeRepoRelativePath(record.file ?? record.filePath ?? ""),
    ruleId: String(record.ruleId ?? "unknown"),
    location: normalizeLocationValue(record),
    messageKey: String(
      record.messageKey ?? record.messageId ?? record.message ?? "unknown",
    )
      .trim()
      .replace(/\s+/g, " ") || "unknown",
  };
}

function createViolationRecord({ platform, filePath, repoRoot: root = repoRoot, message }) {
  return normalizeViolationRecord({
    file: normalizePlatformFilePath(platform, filePath, root),
    ruleId: message.ruleId,
    location: normalizeLocation(message),
    messageKey: normalizeMessageKey(message),
  });
}

function recordIdentity(record) {
  const normalized = normalizeViolationRecord(record);
  return [normalized.file, normalized.ruleId, normalized.location, normalized.messageKey].join(
    "\u001f",
  );
}

function displayIdentity(record) {
  const normalized = normalizeViolationRecord(record);
  return [normalized.file, normalized.ruleId, normalized.location, normalized.messageKey].join(
    "|",
  );
}

function compareStrings(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function stableViolationRecords(records) {
  const unique = new Map();

  for (const record of records ?? []) {
    const normalized = normalizeViolationRecord(record);
    unique.set(recordIdentity(normalized), normalized);
  }

  return [...unique.entries()]
    .sort(([left], [right]) => compareStrings(left, right))
    .map(([, record]) => record);
}

function sortedViolationRecords(records) {
  return (records ?? [])
    .map(normalizeViolationRecord)
    .sort((left, right) => compareStrings(recordIdentity(left), recordIdentity(right)));
}

function isIdentityPlatform(value) {
  if (Array.isArray(value)) {
    return true;
  }

  return Object.values(value ?? {}).some((rules) =>
    Object.values(rules ?? {}).some((identities) => Array.isArray(identities)),
  );
}

function identityRecords(value) {
  if (Array.isArray(value)) {
    return stableViolationRecords(value);
  }

  const records = [];
  for (const [file, rules] of Object.entries(value ?? {})) {
    for (const [ruleId, identities] of Object.entries(rules ?? {})) {
      if (!Array.isArray(identities)) {
        continue;
      }

      for (const identity of identities) {
        if (Array.isArray(identity)) {
          records.push({
            file,
            ruleId,
            location: identity[0],
            messageKey: identity[1],
          });
        } else if (typeof identity === "string") {
          const separator = identity.indexOf("|");
          records.push({
            file,
            ruleId,
            location: separator === -1 ? identity : identity.slice(0, separator),
            messageKey: separator === -1 ? "unknown" : identity.slice(separator + 1),
          });
        } else if (identity && typeof identity === "object") {
          records.push({ file, ruleId, ...identity });
        }
      }
    }
  }

  return stableViolationRecords(records);
}

function serializeIdentityPlatform(records) {
  const grouped = {};

  for (const record of stableViolationRecords(records)) {
    grouped[record.file] ??= {};
    grouped[record.file][record.ruleId] ??= [];
    grouped[record.file][record.ruleId].push(`${record.location}|${record.messageKey}`);
  }

  return stableSort(grouped);
}

function rawPlatformCounts(violations) {
  const counts = new Map();
  const records = Array.isArray(violations)
    ? violations.map(normalizeViolationRecord)
    : identityRecords(violations);

  for (const record of records) {
    const key = `${record.file}\u001f${record.ruleId}`;
    const existing = counts.get(key);
    counts.set(key, {
      file: record.file,
      ruleId: record.ruleId,
      count: (existing?.count ?? 0) + 1,
    });
  }

  return counts;
}

function legacyCapMap(legacyPlatform) {
  const caps = new Map();

  for (const [file, rules] of Object.entries(legacyPlatform ?? {})) {
    const normalizedFile = normalizeRepoRelativePath(file);
    for (const [ruleId, cap] of Object.entries(rules ?? {})) {
      const key = `${normalizedFile}\u001f${ruleId}`;
      if (caps.has(key) && caps.get(key) !== cap) {
        throw new Error(
          `Cannot migrate: legacy baseline has conflicting caps for ${normalizedFile} ${ruleId}.`,
        );
      }
      caps.set(key, cap);
    }
  }

  return caps;
}

export function migrateLegacyBaseline(current, legacyBaseline, platforms = VALID_PLATFORMS) {
  const migrated = { ...legacyBaseline };

  for (const platform of platforms) {
    const legacyPlatform = legacyBaseline?.[platform];
    if (!legacyPlatform || Array.isArray(legacyPlatform)) {
      throw new Error(`Cannot migrate ${platform}: legacy baseline is missing.`);
    }

    const currentRecords = identityRecords(current?.[platform] ?? []);
    const currentCounts = rawPlatformCounts(current?.[platform] ?? []);
    const legacyCaps = legacyCapMap(legacyPlatform);

    for (const [key, current] of currentCounts) {
      const legacyCap = legacyCaps.get(key);

      if (legacyCap === undefined) {
        throw new Error(
          `Cannot migrate ${platform}: current finding ${current.file} ${current.ruleId} ` +
            "is not covered by the legacy baseline.",
        );
      }

      if (!Number.isInteger(legacyCap) || legacyCap < 0) {
        throw new Error(
          `Cannot migrate ${platform}: legacy cap for ${current.file} ${current.ruleId} ` +
            "must be a non-negative integer.",
        );
      }

      if (current.count > legacyCap) {
        throw new Error(
          `Cannot migrate ${platform}: current count ${current.count} for ${current.file} ` +
            `${current.ruleId} exceeds legacy cap ${legacyCap}.`,
        );
      }
    }

    migrated[platform] = serializeIdentityPlatform(currentRecords);
  }

  if (VALID_PLATFORMS.every((platform) => platforms.includes(platform))) {
    migrated.version = IDENTITY_BASELINE_VERSION;
  }

  return migrated;
}

export function violationIdentity({
  platform,
  filePath,
  repoRoot: root = repoRoot,
  message,
}) {
  return displayIdentity(createViolationRecord({ platform, filePath, repoRoot: root, message }));
}

function stableSort(value) {
  if (Array.isArray(value)) {
    return value.map(stableSort);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableSort(value[key])]),
    );
  }

  return value;
}

function readBaseline() {
  if (!existsSync(baselineAbsolutePath)) {
    return {};
  }

  return JSON.parse(readFileSync(baselineAbsolutePath, "utf8"));
}

function writeBaseline(baseline) {
  const stableBaseline = stableSort(baseline);
  writeFileSync(baselineAbsolutePath, `${JSON.stringify(stableBaseline, null, 2)}\n`);
}

function parseEslintJson(stdout) {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) {
    return [];
  }

  try {
    return JSON.parse(trimmed);
  } catch (error) {
    const start = trimmed.indexOf("[");
    const end = trimmed.lastIndexOf("]");

    if (start === -1 || end === -1 || end < start) {
      throw error;
    }

    return JSON.parse(trimmed.slice(start, end + 1));
  }
}

function isTargetRule(ruleId) {
  return (
    typeof ruleId === "string" &&
    (ruleId.startsWith(TARGET_RULE_PREFIX) || TARGET_RULES.has(ruleId))
  );
}

function runEslint(platform) {
  const executable = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const result = spawnSync(
    executable,
    ["--filter", `./${platform}`, "exec", "eslint", "src/app", "--format", "json"],
    {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 64,
    },
  );

  if (result.error) {
    throw result.error;
  }

  let reports;
  try {
    reports = parseEslintJson(result.stdout);
  } catch (error) {
    process.stderr.write(result.stderr);
    throw new Error(`Failed to parse ESLint JSON output for ${platform}: ${error.message}`);
  }

  if (result.status !== 0 && reports.length === 0) {
    process.stderr.write(result.stderr);
    throw new Error(`ESLint failed for ${platform} before producing a report.`);
  }

  return reports;
}

function collectPlatformViolations(platform) {
  const reports = runEslint(platform);
  const violations = [];

  for (const report of reports) {
    for (const message of report.messages ?? []) {
      if (!isTargetRule(message.ruleId)) {
        continue;
      }

      violations.push(
        createViolationRecord({
          platform,
          filePath: report.filePath,
          message,
        }),
      );
    }
  }

  return sortedViolationRecords(violations);
}

function collectViolations(platforms) {
  return Object.fromEntries(
    platforms.map((platform) => [platform, collectPlatformViolations(platform)]),
  );
}

function platformCounts(violations) {
  const counts = new Map();

  if (isIdentityPlatform(violations)) {
    for (const record of identityRecords(violations)) {
      const normalized = normalizeViolationRecord(record);
      const key = `${normalized.file}\u001f${normalized.ruleId}`;
      const existing = counts.get(key);
      counts.set(key, {
        file: normalized.file,
        ruleId: normalized.ruleId,
        count: (existing?.count ?? 0) + 1,
      });
    }
    return counts;
  }

  for (const [file, rules] of Object.entries(violations ?? {})) {
    for (const [ruleId, count] of Object.entries(rules ?? {})) {
      const numericCount = Number(count);
      if (!Number.isFinite(numericCount) || numericCount <= 0) {
        continue;
      }

      counts.set(`${file}\u001f${ruleId}`, {
        file,
        ruleId,
        count: numericCount,
      });
    }
  }

  return counts;
}

function compareLegacyPlatform(platform, currentPlatform, baselinePlatform) {
  const growth = [];
  const shrink = [];
  const currentCounts = platformCounts(currentPlatform);
  const baselineCounts = platformCounts(baselinePlatform);
  const keys = new Set([...currentCounts.keys(), ...baselineCounts.keys()]);

  for (const key of [...keys].sort(compareStrings)) {
    const current = currentCounts.get(key);
    const baseline = baselineCounts.get(key);
    const currentCount = current?.count ?? 0;
    const baselineCount = baseline?.count ?? 0;
    const delta = currentCount - baselineCount;

    if (delta === 0) {
      continue;
    }

    const entry = {
      platform,
      file: current?.file ?? baseline.file,
      ruleId: current?.ruleId ?? baseline.ruleId,
      currentCount,
      baselineCount,
      delta,
    };

    if (delta > 0) {
      growth.push(entry);
    } else {
      shrink.push(entry);
    }
  }

  return { growth, shrink };
}

function compareIdentityPlatform(platform, currentPlatform, baselinePlatform) {
  const currentRecords = identityRecords(currentPlatform);
  const baselineRecords = identityRecords(baselinePlatform);
  const currentIdentities = new Set(currentRecords.map(recordIdentity));
  const baselineIdentities = new Set(baselineRecords.map(recordIdentity));
  const currentCounts = platformCounts(currentRecords);
  const baselineCounts = platformCounts(baselineRecords);
  const growth = [];
  const shrink = [];

  for (const record of currentRecords) {
    const identity = recordIdentity(record);
    if (baselineIdentities.has(identity)) {
      continue;
    }

    const key = `${record.file}\u001f${record.ruleId}`;
    growth.push({
      platform,
      file: record.file,
      ruleId: record.ruleId,
      currentCount: currentCounts.get(key)?.count ?? 0,
      baselineCount: baselineCounts.get(key)?.count ?? 0,
      delta: 1,
      identity: displayIdentity(record),
    });
  }

  for (const record of baselineRecords) {
    const identity = recordIdentity(record);
    if (currentIdentities.has(identity)) {
      continue;
    }

    const key = `${record.file}\u001f${record.ruleId}`;
    shrink.push({
      platform,
      file: record.file,
      ruleId: record.ruleId,
      currentCount: currentCounts.get(key)?.count ?? 0,
      baselineCount: baselineCounts.get(key)?.count ?? 0,
      delta: -1,
      identity: displayIdentity(record),
    });
  }

  const sortDeltas = (left, right) =>
    compareStrings(
      `${left.file}\u001f${left.ruleId}\u001f${left.identity ?? ""}`,
      `${right.file}\u001f${right.ruleId}\u001f${right.identity ?? ""}`,
    );

  growth.sort(sortDeltas);
  shrink.sort(sortDeltas);
  return { growth, shrink };
}

function comparePlatform(platform, currentPlatform, baselinePlatform) {
  if (isIdentityPlatform(currentPlatform) && isIdentityPlatform(baselinePlatform)) {
    return compareIdentityPlatform(platform, currentPlatform, baselinePlatform);
  }

  return compareLegacyPlatform(platform, currentPlatform, baselinePlatform);
}

export function compareViolations(current, baseline, platforms) {
  const growth = [];
  const shrink = [];

  for (const platform of platforms) {
    const result = comparePlatform(
      platform,
      current?.[platform] ?? [],
      baseline?.[platform] ?? {},
    );
    growth.push(...result.growth);
    shrink.push(...result.shrink);
  }

  return { growth, shrink };
}

function totalsByRule(violations) {
  const totals = {};

  for (const [platform, files] of Object.entries(violations ?? {})) {
    totals[platform] ??= {};

    if (isIdentityPlatform(files)) {
      for (const record of identityRecords(files)) {
        totals[platform][record.ruleId] = (totals[platform][record.ruleId] ?? 0) + 1;
      }
      continue;
    }

    for (const rules of Object.values(files)) {
      for (const [ruleId, count] of Object.entries(rules ?? {})) {
        totals[platform][ruleId] = (totals[platform][ruleId] ?? 0) + Number(count);
      }
    }
  }

  return stableSort(totals);
}

function printDeltas(title, deltas) {
  console.log(title);

  for (const delta of deltas) {
    const sign = delta.delta > 0 ? "+" : "";
    const identity = delta.identity ? ` [${delta.identity}]` : "";
    console.log(
      `- ${delta.platform}: ${delta.file} ${delta.ruleId} ` +
        `${delta.currentCount}/${delta.baselineCount} (${sign}${delta.delta})${identity}`,
    );
  }
}

function printTotals(violations) {
  const totals = totalsByRule(violations);
  console.log("Current UI architecture debt totals:");
  console.log(JSON.stringify(totals, null, 2));
}

function main() {
  runManifestGate(repoRoot);
  const args = parseArgs(process.argv.slice(2));
  const platforms = args.platform ? [args.platform] : VALID_PLATFORMS;
  const current = collectViolations(platforms);
  let baseline = readBaseline();
  const comparison = compareViolations(current, baseline, platforms);

  if (args.update) {
    if (comparison.growth.length > 0) {
      printDeltas(
        "Warning: baseline update includes growth. This should only happen in reviewed commits:",
        comparison.growth,
      );
    }

    const legacyPlatforms =
      baseline.version === IDENTITY_BASELINE_VERSION
        ? []
        : platforms.filter((platform) => !isIdentityPlatform(baseline[platform]));
    if (legacyPlatforms.length > 0) {
      baseline = migrateLegacyBaseline(current, baseline, legacyPlatforms);
    }

    for (const platform of platforms) {
      if (!legacyPlatforms.includes(platform)) {
        baseline[platform] = serializeIdentityPlatform(current[platform] ?? []);
      }
    }

    if (
      baseline.version === IDENTITY_BASELINE_VERSION ||
      VALID_PLATFORMS.every((platform) => isIdentityPlatform(baseline[platform]))
    ) {
      baseline.version = IDENTITY_BASELINE_VERSION;
    }

    writeBaseline(baseline);
    console.log(`Updated ${BASELINE_PATH}.`);
    printTotals(
      Object.fromEntries(platforms.map((platform) => [platform, baseline[platform] ?? []])),
    );
    return;
  }

  if (comparison.growth.length > 0) {
    printDeltas("UI architecture baseline exceeded:", comparison.growth);
    console.error(
      `\nNew UI architecture violations are not allowed. Read ${RULES_DOC_PATH} and ` +
        `fix the page or intentionally update ${BASELINE_PATH} in a reviewed commit.`,
    );
    process.exitCode = 1;
    return;
  }

  if (comparison.shrink.length > 0) {
    printDeltas("UI architecture baseline can be tightened -- run with --update:", comparison.shrink);
  } else {
    console.log("UI architecture baseline matches current state.");
  }

  printTotals(current);
}

const invokedScriptPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedScriptPath === scriptPath) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
