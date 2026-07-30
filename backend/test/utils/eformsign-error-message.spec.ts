import { describeEformsignBackfillError } from "application/utils/eformsign-backfill-error";
import { sanitizeEformsignErrorMessage } from "application/utils/eformsign-error-message";
import { BackfillEformsignDocsError } from "application/usecases/eformsign-doc/backfill-eformsign-docs.usecase";

describe("sanitizeEformsignErrorMessage", () => {
    it("redacts vendor credentials, customer phones, and database credentials", () => {
        const result = sanitizeEformsignErrorMessage(
            new Error(
                "Bearer bearer-secret "
                + "access_token=query-secret "
                + '"refresh_token":"json-secret" '
                + "phone=010-1234-5678 "
                + "postgresql://db-user:db-password@db.example.test:5432/app "
                + "rediss://cache-user:cache-password@cache.example.test:6380/0",
            ),
        );

        expect(result).toContain("Bearer [REDACTED]");
        expect(result).toContain("access_token=[REDACTED]");
        expect(result).toContain('"refresh_token":[REDACTED]');
        expect(result).toContain("[REDACTED_PHONE]");
        expect(result).toContain("postgresql://[REDACTED]@db.example.test:5432/app");
        expect(result).toContain("rediss://[REDACTED]@cache.example.test:6380/0");
        expect(result).not.toContain("bearer-secret");
        expect(result).not.toContain("query-secret");
        expect(result).not.toContain("json-secret");
        expect(result).not.toContain("010-1234-5678");
        expect(result).not.toContain("db-password");
        expect(result).not.toContain("cache-password");
    });

    it("normalizes whitespace and bounds output size", () => {
        const result = sanitizeEformsignErrorMessage(`failure\n\t${"x".repeat(3_000)}`);

        expect(result).not.toMatch(/\s{2,}/);
        expect(result).toHaveLength(2_000);
    });

    it("redacts Korean mobile numbers in supported international formats only", () => {
        const result = sanitizeEformsignErrorMessage(
            "spaced=+82 10-1234-5678 compact=+821012345678 mixed=+82-10 1234-5678 "
            + "domestic-dot=010.1234.5678 international-dot=+82.10.1234.5678 "
            + "international-mixed=+82 10.1234-5678 invalid-prefix=+821112345678 "
            + "no-plus=821012345678 too-long=+8210123456789 embedded=A010.1234.5678 "
            + "invalid-domestic=010.12.5678 seoul=+82 2-1234-5678 "
            + "gyeonggi=+82.31-123-4567 voip=+82-70 1234.5678 "
            + "invalid-international=+82 1-1234-5678 version=1.+82 2-1234-5678.2",
        );

        expect(result.match(/\[REDACTED_PHONE\]/g)).toHaveLength(9);
        expect(result).not.toContain("+82 10-1234-5678");
        expect(result).not.toContain("compact=+821012345678");
        expect(result).not.toContain("+82-10 1234-5678");
        expect(result).not.toContain("domestic-dot=010.1234.5678");
        expect(result).not.toContain("+82.10.1234.5678");
        expect(result).not.toContain("+82 10.1234-5678");
        expect(result).not.toContain("seoul=+82 2-1234-5678");
        expect(result).not.toContain("+82.31-123-4567");
        expect(result).not.toContain("+82-70 1234.5678");
        expect(result).toContain("+821112345678");
        expect(result).toContain("821012345678");
        expect(result).toContain("+8210123456789");
        expect(result).toContain("A010.1234.5678");
        expect(result).toContain("010.12.5678");
        expect(result).toContain("+82 1-1234-5678");
        expect(result).toContain("1.+82 2-1234-5678.2");
    });

    it("redacts supported domestic landline formats without matching IPs, dates, or versions", () => {
        const result = sanitizeEformsignErrorMessage(
            "seoul=02-1234-5678 gyeonggi=031.123.4567 compact=0212345678 "
            + "internet=070 1234 5678 ip=192.168.0.1 date=2026.07.30 "
            + "version=v02.1234.5678 dotted-version=1.02.1234.5678.2",
        );

        expect(result.match(/\[REDACTED_PHONE\]/g)).toHaveLength(4);
        expect(result).not.toContain("02-1234-5678");
        expect(result).not.toContain("031.123.4567");
        expect(result).not.toContain("compact=0212345678");
        expect(result).not.toContain("070 1234 5678");
        expect(result).toContain("192.168.0.1");
        expect(result).toContain("2026.07.30");
        expect(result).toContain("v02.1234.5678");
        expect(result).toContain("1.02.1234.5678.2");
    });
});

describe("describeEformsignBackfillError", () => {
    const summary = {
        fetched: 0,
        created: 0,
        updated: 0,
        skipped: 0,
        duplicates: 0,
        failed: 0,
        pages: 0,
        byDocumentType: {
            "01": {
                status: "pending" as const,
                fetched: 0,
                created: 0,
                updated: 0,
                skipped: 0,
                duplicates: 0,
                failed: 0,
                pages: 0,
                error: null,
            },
            "03": {
                status: "pending" as const,
                fetched: 0,
                created: 0,
                updated: 0,
                skipped: 0,
                duplicates: 0,
                failed: 0,
                pages: 0,
                error: null,
            },
            "04": {
                status: "pending" as const,
                fetched: 0,
                created: 0,
                updated: 0,
                skipped: 0,
                duplicates: 0,
                failed: 0,
                pages: 0,
                error: null,
            },
        },
    };

    it("unwraps nested backfill causes while redacting every layer", () => {
        const root = new Error(
            "Bearer root-secret phone=010-1234-5678 international=+82 10-1234-5678",
        );
        const documentFailure = new BackfillEformsignDocsError(
            "Failed to verify locally active eformsign document doc-123",
            summary,
            root,
        );
        const runFailure = new BackfillEformsignDocsError(
            "Eformsign document backfill failed",
            summary,
            [documentFailure],
        );

        const result = describeEformsignBackfillError(runFailure);

        expect(result).toContain("Eformsign document backfill failed");
        expect(result).toContain(
            "Failed to verify locally active eformsign document doc-123",
        );
        expect(result).toContain("Bearer [REDACTED]");
        expect(result).toContain("[REDACTED_PHONE]");
        expect(result).not.toContain("root-secret");
        expect(result).not.toContain("010-1234-5678");
        expect(result).not.toContain("+82 10-1234-5678");
    });

    it("does not recurse forever when causes repeat", () => {
        const cyclic = new BackfillEformsignDocsError(
            "cyclic failure",
            summary,
        );
        (cyclic as unknown as { cause: unknown }).cause = cyclic;

        expect(describeEformsignBackfillError(cyclic)).toBe("cyclic failure");
    });
});
