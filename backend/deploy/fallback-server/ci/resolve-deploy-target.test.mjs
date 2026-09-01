import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  canonicalDnsHash,
  resolveDeployTarget,
} from "./resolve-deploy-target.mjs";

function hash(records) {
  return createHash("sha256")
    .update(`${[...records].sort().join("\n")}\n`)
    .digest("hex");
}

test("preview always targets Lightsail without production routing secrets", () => {
  assert.equal(resolveDeployTarget({ refName: "preview" }), "lightsail");
});

test("main targets LightNode only when the authoritative A-record hash matches", () => {
  const fallbackRecords = ["192.0.2.10"];

  assert.equal(resolveDeployTarget({
    refName: "main",
    dnsRecords: fallbackRecords,
    fallbackDnsSha256: hash(fallbackRecords),
    lightsailDnsSha256: hash(["192.0.2.20"]),
  }), "lightnode");
});

test("main targets Lightsail only when its registered A-record hash matches", () => {
  const lightsailRecords = ["192.0.2.20"];

  assert.equal(resolveDeployTarget({
    refName: "main",
    dnsRecords: lightsailRecords,
    fallbackDnsSha256: hash(["192.0.2.10"]),
    lightsailDnsSha256: hash(lightsailRecords),
  }), "lightsail");
});

test("main fails closed for an unregistered or mixed routing identity", () => {
  assert.throws(() => resolveDeployTarget({
    refName: "main",
    dnsRecords: ["192.0.2.10", "192.0.2.20"],
    fallbackDnsSha256: hash(["192.0.2.10"]),
    lightsailDnsSha256: hash(["192.0.2.20"]),
  }), /does not match an approved production target/);
});

test("main rejects missing, duplicate, or malformed target hashes", () => {
  const records = ["192.0.2.10"];
  const approvedHash = hash(records);

  assert.throws(() => resolveDeployTarget({
    refName: "main",
    dnsRecords: records,
    fallbackDnsSha256: "",
    lightsailDnsSha256: approvedHash,
  }), /approved DNS hashes/);
  assert.throws(() => resolveDeployTarget({
    refName: "main",
    dnsRecords: records,
    fallbackDnsSha256: approvedHash,
    lightsailDnsSha256: approvedHash,
  }), /must be distinct/);
  assert.throws(() => canonicalDnsHash(["not-an-ip"]), /valid IPv4/);
});
