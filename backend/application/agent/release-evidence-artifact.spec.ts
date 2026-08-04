import {
    evidenceBundleDigest,
    parseReleaseEvidenceArtifact,
    releaseEvidenceDigest,
    type ReleaseEvidenceArtifact,
    type UnsignedReleaseEvidenceArtifact,
} from "./release-evidence-artifact";

describe("release evidence artifacts", () => {
    const now = new Date("2026-08-03T00:00:00.000Z");

    function artifact(): ReleaseEvidenceArtifact {
        const unsigned: UnsignedReleaseEvidenceArtifact = {
            version: 1,
            kind: "securityE2E",
            commitSha: "abcdef1234567",
            createdAt: "2026-08-02T00:00:00.000Z",
            expiresAt: "2026-08-04T00:00:00.000Z",
            mode: "real-database-e2e",
            passed: true,
            payload: {
                scenarioIds: ["cross-user-denial"],
                database: "postgres",
                cache: "valkey",
                minimizedModelPayloadVerified: true,
            },
        };
        return { ...unsigned, digest: releaseEvidenceDigest(unsigned) };
    }

    it("accepts fresh evidence bound to the expected commit and contents", () => {
        const parsed = parseReleaseEvidenceArtifact(JSON.stringify(artifact()), {
            kind: "securityE2E", commitSha: "abcdef1234567", now,
        });

        expect(parsed.payload.scenarioIds).toEqual(["cross-user-denial"]);
        expect(evidenceBundleDigest({ security: parsed })).toHaveLength(64);
    });

    it.each([
        ["tampered payload", (value: ReleaseEvidenceArtifact) => ({ ...value, payload: { ...value.payload, scenarioIds: ["cross-branch-isolation"] } })],
        ["wrong commit", (value: ReleaseEvidenceArtifact) => ({ ...value, commitSha: "1234567" })],
        ["expired evidence", (value: ReleaseEvidenceArtifact) => ({ ...value, expiresAt: "2026-08-02T12:00:00.000Z" })],
    ])("rejects %s", (_label, mutate) => {
        expect(() => parseReleaseEvidenceArtifact(JSON.stringify(mutate(artifact())), {
            kind: "securityE2E", commitSha: "abcdef1234567", now,
        })).toThrow();
    });

    it("rejects an unbounded validity window and arbitrary per-kind payloads", () => {
        expect(() => parseReleaseEvidenceArtifact(JSON.stringify({
            ...artifact(),
            expiresAt: "2026-09-03T00:00:00.000Z",
        }), { kind: "securityE2E", commitSha: "abcdef1234567", now })).toThrow("lifetime");

        const { digest: _digest, ...unsigned } = artifact();
        const malformed = { ...unsigned, payload: { suites: 7 } };
        expect(() => parseReleaseEvidenceArtifact(JSON.stringify({
            ...malformed,
            digest: releaseEvidenceDigest(malformed as unknown as UnsignedReleaseEvidenceArtifact),
        }), { kind: "securityE2E", commitSha: "abcdef1234567", now })).toThrow();
    });
});
