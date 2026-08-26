import test from "node:test";
import assert from "node:assert/strict";

import {
  compareViolations,
  migrateLegacyBaseline,
  normalizeRepoRelativePath,
  violationIdentity,
} from "./ui-architecture-gate.mjs";

const platform = "frontend";
const ruleId = "ui-architecture/no-page-local-components";

function finding(overrides = {}) {
  return {
    file: "frontend/src/app/(protected)/employees/page.tsx",
    ruleId,
    location: "10:3-10:15",
    messageKey: "pageLocalComponent",
    ...overrides,
  };
}

function compare(current, baseline) {
  return compareViolations(
    { [platform]: current },
    { [platform]: baseline },
    [platform],
  );
}

function legacyBaseline(
  rule = ruleId,
  file = "frontend/src/app/(protected)/employees/page.tsx",
  cap = 2,
) {
  return {
    frontend: {
      [file]: {
        [rule]: cap,
      },
    },
  };
}

test("fails an equal-count substitution with a new exact identity", () => {
  const result = compare(
    [finding({ location: "20:3-20:15" })],
    [finding()],
  );

  assert.equal(result.growth.length, 1);
  assert.equal(result.growth[0].delta, 1);
  assert.equal(result.shrink.length, 1);
});

test("treats reordered identities as unchanged", () => {
  const result = compare(
    [finding({ location: "20:3-20:15" }), finding()],
    [finding(), finding({ location: "20:3-20:15" })],
  );

  assert.deepEqual(result.growth, []);
  assert.deepEqual(result.shrink, []);
});

test("allows debt removal while reporting the removable identity", () => {
  const result = compare([], [finding()]);

  assert.deepEqual(result.growth, []);
  assert.equal(result.shrink.length, 1);
  assert.equal(result.shrink[0].delta, -1);
});

test("normalizes repository-relative paths and locations deterministically", () => {
  assert.equal(
    normalizeRepoRelativePath("./frontend\\src\\app\\page.tsx", "/repo"),
    "frontend/src/app/page.tsx",
  );

  const fromPosix = violationIdentity({
    platform,
    filePath: "/repo/frontend/src/app/page.tsx",
    repoRoot: "/repo",
    message: {
      ruleId,
      line: 7,
      column: 2,
      endLine: 7,
      endColumn: 9,
      messageId: "pageLocalComponent",
    },
  });
  const fromRelativeWindowsPath = violationIdentity({
    platform,
    filePath: ".\\frontend\\src\\app\\page.tsx",
    repoRoot: "/repo",
    message: {
      ruleId,
      line: 7,
      column: 2,
      endLine: 7,
      endColumn: 9,
      messageId: "pageLocalComponent",
    },
  });

  assert.equal(fromPosix, fromRelativeWindowsPath);
});

test("deduplicates known findings without hiding a new identity", () => {
  const known = finding();
  const newFinding = finding({
    ruleId: "ui-architecture/no-raw-ui-in-pages",
    location: "40:5-40:12",
    messageKey: "rawButton",
  });
  const result = compare(
    [known, known, newFinding],
    [known, known],
  );

  assert.equal(result.growth.length, 1);
  assert.equal(result.growth[0].ruleId, "ui-architecture/no-raw-ui-in-pages");
  assert.equal(result.growth[0].currentCount, 1);
  assert.equal(result.growth[0].baselineCount, 0);
});

test("reads the compact nested identity baseline format", () => {
  const known = finding();
  const baseline = {
    [known.file]: {
      [known.ruleId]: [`${known.location}|${known.messageKey}`],
    },
  };

  const result = compare([known], baseline);

  assert.deepEqual(result.growth, []);
  assert.deepEqual(result.shrink, []);
});

test("refuses migration when a current count exceeds its legacy cap", () => {
  const current = [
    finding(),
    finding(),
    finding({ location: "20:3-20:15" }),
    finding({ location: "30:3-30:15" }),
  ];

  assert.throws(
    () =>
      migrateLegacyBaseline(
        { frontend: current },
        legacyBaseline(ruleId, undefined, 2),
        [platform],
      ),
    /exceeds legacy cap 2/,
  );
});

test("refuses migration for an unknown current rule", () => {
  const current = [
    finding({
      ruleId: "ui-architecture/no-raw-ui-in-pages",
      messageKey: "rawUiElement",
    }),
  ];

  assert.throws(
    () => migrateLegacyBaseline({ frontend: current }, legacyBaseline(), [platform]),
    /is not covered by the legacy baseline/,
  );
});

test("refuses migration for an app absent from the legacy baseline", () => {
  const current = {
    mobile: [
      finding({
        file: "mobile/src/app/(shell)/employees/page.tsx",
      }),
    ],
  };

  assert.throws(
    () => migrateLegacyBaseline(current, legacyBaseline(), ["mobile"]),
    /legacy baseline is missing/,
  );
});

test("migrates only the current subset under each legacy cap", () => {
  const current = [finding({ location: "20:3-20:15" }), finding()];
  const migrated = migrateLegacyBaseline(
    { frontend: current },
    legacyBaseline(ruleId, undefined, 3),
    [platform],
  );

  assert.deepEqual(migrated.frontend, {
    [current[0].file]: {
      [ruleId]: [
        "10:3-10:15|pageLocalComponent",
        "20:3-20:15|pageLocalComponent",
      ],
    },
  });
});

test("normalizes legacy paths before applying migration caps", () => {
  const migrated = migrateLegacyBaseline(
    { frontend: [finding()] },
    legacyBaseline(ruleId, ".\\frontend\\src\\app\\(protected)\\employees\\page.tsx", 1),
    [platform],
  );

  assert.deepEqual(migrated.frontend, {
    [finding().file]: {
      [ruleId]: ["10:3-10:15|pageLocalComponent"],
    },
  });
});

test("tightens removed legacy findings without padding the migrated baseline", () => {
  const removedFile = "frontend/src/app/(protected)/clients/page.tsx";
  const legacy = legacyBaseline(ruleId, undefined, 2);
  legacy.frontend[removedFile] = {
    "ui-architecture/no-raw-ui-in-pages": 1,
  };

  const migrated = migrateLegacyBaseline(
    { frontend: [finding()] },
    legacy,
    [platform],
  );

  assert.deepEqual(Object.keys(migrated.frontend), [finding().file]);
  assert.deepEqual(migrated.frontend[finding().file], {
    [ruleId]: ["10:3-10:15|pageLocalComponent"],
  });
});

test("retains substitution detection after a validated migration", () => {
  const legacy = legacyBaseline(ruleId, undefined, 2);
  const migrated = migrateLegacyBaseline(
    {
      frontend: [finding(), finding({ location: "20:3-20:15" })],
    },
    legacy,
    [platform],
  );
  const result = compare(
    [finding(), finding({ location: "30:3-30:15" })],
    migrated.frontend,
  );

  assert.equal(result.growth.length, 1);
  assert.equal(result.shrink.length, 1);
  assert.equal(result.growth[0].delta, 1);
  assert.equal(result.shrink[0].delta, -1);
});
