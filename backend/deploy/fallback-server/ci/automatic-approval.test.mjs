import assert from "node:assert/strict";
import test from "node:test";

import { buildAutomaticApproval } from "./automatic-approval.mjs";

const HASH = "a".repeat(64);
const DIGEST = `sha256:${"b".repeat(64)}`;
const TAG = "c".repeat(40);

test("builds a fresh bounded approval for the requested immutable release", () => {
  const approval = buildAutomaticApproval({
    commitSha: TAG,
    imageDigest: DIGEST,
    incidentId: "fallback-incident",
    conditionHash: HASH,
    databaseHash: HASH,
    egressHash: HASH,
    issuedAt: 1_800_000_000,
    oldExpiry: 1_800_010_000,
    nonce: "d".repeat(64),
  });

  assert.match(approval, new RegExp(`image_tag=${TAG}`));
  assert.match(approval, new RegExp(`image_digest=${DIGEST}`));
  assert.match(approval, /expires_at_unix=1800172740/);
  assert.equal(approval.trim().split("\n").length, 10);
});

test("fails when the existing approval leaves no safe bounded extension", () => {
  assert.throws(() => buildAutomaticApproval({
    commitSha: TAG,
    imageDigest: DIGEST,
    incidentId: "fallback-incident",
    conditionHash: HASH,
    databaseHash: HASH,
    egressHash: HASH,
    issuedAt: 1_800_000_000,
    oldExpiry: 1_800_172_700,
    nonce: "d".repeat(64),
  }), /extend it first/);
});

test("rejects malformed release, evidence, or nonce inputs", () => {
  assert.throws(() => buildAutomaticApproval({
    commitSha: "main",
    imageDigest: DIGEST,
    incidentId: "fallback-incident",
    conditionHash: HASH,
    databaseHash: HASH,
    egressHash: HASH,
    issuedAt: 1_800_000_000,
    oldExpiry: 1_800_010_000,
    nonce: "d".repeat(64),
  }), /invalid/);
});
