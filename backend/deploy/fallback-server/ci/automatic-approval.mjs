#!/usr/bin/env node

import { pathToFileURL } from "node:url";

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const NONCE_PATTERN = /^[0-9a-f]{32,128}$/;
const INCIDENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const MAX_APPROVAL_SECONDS = 172_800;
const SAFETY_SECONDS = 60;

export function buildAutomaticApproval({
  commitSha,
  imageDigest,
  incidentId,
  conditionHash,
  databaseHash,
  egressHash,
  issuedAt,
  oldExpiry,
  nonce,
}) {
  if (!SHA_PATTERN.test(commitSha)
      || !DIGEST_PATTERN.test(imageDigest)
      || !INCIDENT_PATTERN.test(incidentId)
      || !HASH_PATTERN.test(conditionHash)
      || !HASH_PATTERN.test(databaseHash)
      || !HASH_PATTERN.test(egressHash)
      || !NONCE_PATTERN.test(nonce)
      || !Number.isSafeInteger(issuedAt)
      || !Number.isSafeInteger(oldExpiry)) {
    throw new Error("The automatic approval input is invalid.");
  }

  const expiresAt = issuedAt + MAX_APPROVAL_SECONDS - SAFETY_SECONDS;
  if (expiresAt <= oldExpiry + SAFETY_SECONDS) {
    throw new Error("The active approval is too close to the automatic approval limit; extend it first.");
  }

  return [
    "schema_version=1",
    `incident_id=${incidentId}`,
    `primary_scheduler_condition_ref_sha256=${conditionHash}`,
    `image_tag=${commitSha}`,
    `image_digest=${imageDigest}`,
    `production_db_ref_sha256=${databaseHash}`,
    `aligo_egress_ipv4_sha256=${egressHash}`,
    `issued_at_unix=${issuedAt}`,
    `approval_nonce=${nonce}`,
    `expires_at_unix=${expiresAt}`,
  ].join("\n") + "\n";
}

function main() {
  const [commitSha, imageDigest, incidentId, conditionHash, databaseHash, egressHash, issuedAt, oldExpiry, nonce] = process.argv.slice(2);
  if (!nonce) throw new Error("Usage: automatic-approval <sha> <digest> <incident> <condition-hash> <db-hash> <egress-hash> <issued-at> <old-expiry> <nonce>");
  process.stdout.write(buildAutomaticApproval({
    commitSha,
    imageDigest,
    incidentId,
    conditionHash,
    databaseHash,
    egressHash,
    issuedAt: Number(issuedAt),
    oldExpiry: Number(oldExpiry),
    nonce,
  }));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
