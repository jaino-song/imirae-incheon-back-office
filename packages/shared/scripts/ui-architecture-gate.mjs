#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TARGET_RULES = new Set(["data-component/require-data-component"]);
const TARGET_RULE_PREFIX = "ui-architecture/";
const BASELINE_PATH = "docs/design-system/ui-debt-baseline.json";
const RULES_DOC_PATH = "docs/design-system/AGENT_UI_RULES.md";
const VALID_PLATFORMS = ["frontend", "mobile"];

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
  return value.split(path.sep).join("/");
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
  const platformRoot = path.join(repoRoot, platform);
  const reports = runEslint(platform);
  const violations = {};

  for (const report of reports) {
    for (const message of report.messages ?? []) {
      if (!isTargetRule(message.ruleId)) {
        continue;
      }

      const relativeFile = slashify(
        path.relative(repoRoot, path.resolve(platformRoot, report.filePath)),
      );
      violations[relativeFile] ??= {};
      violations[relativeFile][message.ruleId] =
        (violations[relativeFile][message.ruleId] ?? 0) + 1;
    }
  }

  return stableSort(violations);
}

function collectViolations(platforms) {
  return Object.fromEntries(
    platforms.map((platform) => [platform, collectPlatformViolations(platform)]),
  );
}

function comparePlatform(platform, currentPlatform, baselinePlatform) {
  const growth = [];
  const shrink = [];
  const fileNames = new Set([
    ...Object.keys(currentPlatform ?? {}),
    ...Object.keys(baselinePlatform ?? {}),
  ]);

  for (const file of [...fileNames].sort()) {
    const currentRules = currentPlatform?.[file] ?? {};
    const baselineRules = baselinePlatform?.[file] ?? {};
    const ruleIds = new Set([...Object.keys(currentRules), ...Object.keys(baselineRules)]);

    for (const ruleId of [...ruleIds].sort()) {
      const currentCount = currentRules[ruleId] ?? 0;
      const baselineCount = baselineRules[ruleId] ?? 0;
      const delta = currentCount - baselineCount;

      if (delta > 0) {
        growth.push({ platform, file, ruleId, currentCount, baselineCount, delta });
      } else if (delta < 0) {
        shrink.push({ platform, file, ruleId, currentCount, baselineCount, delta });
      }
    }
  }

  return { growth, shrink };
}

function compareViolations(current, baseline, platforms) {
  const growth = [];
  const shrink = [];

  for (const platform of platforms) {
    const result = comparePlatform(platform, current[platform] ?? {}, baseline[platform] ?? {});
    growth.push(...result.growth);
    shrink.push(...result.shrink);
  }

  return { growth, shrink };
}

function totalsByRule(violations) {
  const totals = {};

  for (const [platform, files] of Object.entries(violations)) {
    totals[platform] ??= {};

    for (const rules of Object.values(files)) {
      for (const [ruleId, count] of Object.entries(rules)) {
        totals[platform][ruleId] = (totals[platform][ruleId] ?? 0) + count;
      }
    }
  }

  return stableSort(totals);
}

function printDeltas(title, deltas) {
  console.log(title);

  for (const delta of deltas) {
    const sign = delta.delta > 0 ? "+" : "";
    console.log(
      `- ${delta.platform}: ${delta.file} ${delta.ruleId} ` +
        `${delta.currentCount}/${delta.baselineCount} (${sign}${delta.delta})`,
    );
  }
}

function printTotals(violations) {
  const totals = totalsByRule(violations);
  console.log("Current UI architecture debt totals:");
  console.log(JSON.stringify(totals, null, 2));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const platforms = args.platform ? [args.platform] : VALID_PLATFORMS;
  const current = collectViolations(platforms);
  const baseline = readBaseline();
  const comparison = compareViolations(current, baseline, platforms);

  if (args.update) {
    if (comparison.growth.length > 0) {
      printDeltas(
        "Warning: baseline update includes growth. This should only happen in reviewed commits:",
        comparison.growth,
      );
    }

    for (const platform of platforms) {
      baseline[platform] = current[platform] ?? {};
    }

    writeBaseline(baseline);
    console.log(`Updated ${BASELINE_PATH}.`);
    printTotals(Object.fromEntries(platforms.map((platform) => [platform, baseline[platform] ?? {}])));
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

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
