#!/usr/bin/env node

/**
 * Catches the failure mode where a user-facing Korean string is reworded in app
 * source while a Playwright spec still asserts the old wording.
 *
 * jest specs do not need this — they run on every local `pnpm test`, so a stale
 * expectation fails immediately. The e2e specs under mobile/tests and
 * frontend/tests only run in CI against a seeded backend, so a stale assertion
 * there stays invisible until the pipeline turns red.
 *
 * The check is deliberately narrow to stay quiet: a phrase is only reported
 * when it was REMOVED from app source by the diff AND no longer appears
 * anywhere in app source AND is still asserted by an e2e spec. A reworded
 * string satisfies all three; moving a string between files does not.
 *
 * Usage:
 *   node packages/shared/scripts/e2e-string-drift-gate.mjs [--base <ref>]
 *
 * --base defaults to origin/dev, falling back to HEAD~1 when that ref is
 * missing (shallow CI clones, fresh worktrees).
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_GLOBS = ["frontend/src", "mobile/src", "packages/shared/src"];
const E2E_GLOBS = ["frontend/tests", "mobile/tests"];

/** Hangul syllables, so a run of at least this many is a real phrase and not a word fragment. */
const MIN_PHRASE_SYLLABLES = 5;

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "../../..");

function git(args, { allowFailure = false } = {}) {
  const result = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) {
    if (allowFailure) return null;
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr?.trim()}`);
  }
  return result.stdout;
}

function parseArgs(argv) {
  const parsed = { base: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--base") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("Missing value for --base. Expected a git ref.");
      }
      parsed.base = value;
      index += 1;
    }
  }
  return parsed;
}

function resolveBase(requested) {
  const candidates = requested ? [requested] : ["origin/dev", "HEAD~1"];
  for (const ref of candidates) {
    if (git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], { allowFailure: true })) {
      return ref;
    }
  }
  return null;
}

/**
 * Korean phrases carry punctuation and spaces mid-sentence, so a run is any
 * stretch of Hangul plus the characters that legitimately sit inside one. The
 * run is only kept when it holds enough syllables to be a phrase.
 */
function extractPhrases(text) {
  const runs = text.match(/[가-힣][가-힣0-9a-zA-Z .,!?~·%()/-]*[가-힣.!?]/g) ?? [];
  const phrases = new Set();
  for (const run of runs) {
    const trimmed = run.trim();
    const syllables = trimmed.match(/[가-힣]/g)?.length ?? 0;
    if (syllables >= MIN_PHRASE_SYLLABLES) phrases.add(trimmed);
  }
  return phrases;
}

function removedPhrases(base) {
  const diff = git(["diff", "--unified=0", `${base}...HEAD`, "--", ...SOURCE_GLOBS]);
  const phrases = new Set();
  for (const line of diff.split("\n")) {
    if (!line.startsWith("-") || line.startsWith("---")) continue;
    for (const phrase of extractPhrases(line.slice(1))) phrases.add(phrase);
  }
  return phrases;
}

/** ripgrep is not guaranteed on a runner, so fall back to git grep, which always is. */
function grepFixed(phrase, globs) {
  const out = git(["grep", "-n", "--fixed-strings", phrase, "--", ...globs], { allowFailure: true });
  if (!out) return [];
  return out.split("\n").filter(Boolean);
}

function main() {
  const { base: requestedBase } = parseArgs(process.argv.slice(2));
  const base = resolveBase(requestedBase);

  if (!base) {
    console.log("e2e string drift: no comparable base ref, skipping.");
    return;
  }

  const removed = removedPhrases(base);
  if (removed.size === 0) {
    console.log(`e2e string drift: no Korean phrases removed from app source since ${base}.`);
    return;
  }

  const findings = [];
  for (const phrase of removed) {
    // Still somewhere in app source: the string moved or was only partly
    // rewritten, so any spec asserting it is still telling the truth.
    if (grepFixed(phrase, SOURCE_GLOBS).length > 0) continue;

    const hits = grepFixed(phrase, E2E_GLOBS);
    if (hits.length > 0) findings.push({ phrase, hits });
  }

  if (findings.length === 0) {
    console.log(
      `e2e string drift: ${removed.size} phrase(s) changed since ${base}, none still asserted by an e2e spec.`,
    );
    return;
  }

  console.error(
    `\ne2e string drift: ${findings.length} phrase(s) were reworded in app source but are still asserted by e2e specs.`,
  );
  console.error("These specs only run in CI, so they would fail there rather than locally.\n");
  for (const { phrase, hits } of findings) {
    console.error(`  "${phrase}"`);
    for (const hit of hits) console.error(`    ${hit}`);
    console.error("");
  }
  console.error("Update the specs to the new wording, or keep the old wording in source.");
  process.exitCode = 1;
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
