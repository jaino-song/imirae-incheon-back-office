import {
    isContractReviewWindowOpen,
    resolveEformsignDocDisplayStatus,
} from "application/utils/eformsign-doc-display-status";

/**
 * Parity pin: these fixtures mirror
 * packages/shared/src/constants/eformsign-doc-status.test.ts. The backend copy
 * of the display-status rule must answer exactly like the shared one — when a
 * case is added or changed there, add it here too.
 */

const kstNoon = (ymd: string) => new Date(`${ymd}T03:00:00.000Z`);

function reviewStepDoc(contractEndDate?: string | null) {
    return {
        id: "doc-1",
        current_status: { status_type: "070", step_type: "06", step_name: "제공기관 확인" },
        ...(contractEndDate ? { contract_end_date: contractEndDate } : {}),
    };
}

describe("isContractReviewWindowOpen (backend copy)", () => {
    it("opens exactly 1 business day before the end date (Friday end → Thursday)", () => {
        expect(isContractReviewWindowOpen("2026-08-07", kstNoon("2026-08-05"))).toBe(false);
        expect(isContractReviewWindowOpen("2026-08-07", kstNoon("2026-08-06"))).toBe(true);
        expect(isContractReviewWindowOpen("2026-08-07", kstNoon("2026-08-07"))).toBe(true);
    });

    it("skips the weekend (Monday end → Friday)", () => {
        expect(isContractReviewWindowOpen("2026-08-10", kstNoon("2026-08-06"))).toBe(false);
        expect(isContractReviewWindowOpen("2026-08-10", kstNoon("2026-08-07"))).toBe(true);
        expect(isContractReviewWindowOpen("2026-08-10", kstNoon("2026-08-08"))).toBe(true);
        expect(isContractReviewWindowOpen("2026-08-10", kstNoon("2026-08-09"))).toBe(true);
    });

    it("stays open after the end date and for weekend end dates", () => {
        expect(isContractReviewWindowOpen("2026-08-07", kstNoon("2026-08-20"))).toBe(true);
        expect(isContractReviewWindowOpen("2026-08-08", kstNoon("2026-08-06"))).toBe(false);
        expect(isContractReviewWindowOpen("2026-08-08", kstNoon("2026-08-07"))).toBe(true);
        expect(isContractReviewWindowOpen("2026-08-09", kstNoon("2026-08-07"))).toBe(true);
    });

    it("skips Korean holidays like weekends (Tuesday end after 광복절 대체휴일 → preceding Friday)", () => {
        expect(isContractReviewWindowOpen("2026-08-18", kstNoon("2026-08-13"))).toBe(false);
        expect(isContractReviewWindowOpen("2026-08-18", kstNoon("2026-08-14"))).toBe(true);
        expect(isContractReviewWindowOpen("2026-08-18", kstNoon("2026-08-17"))).toBe(true);
    });

    it("uses the KST calendar day, not the UTC one", () => {
        expect(isContractReviewWindowOpen("2026-08-07", new Date("2026-08-05T16:00:00.000Z"))).toBe(true);
        expect(isContractReviewWindowOpen("2026-08-07", new Date("2026-08-05T14:00:00.000Z"))).toBe(false);
    });

    it("treats a missing or malformed end date as an open window", () => {
        expect(isContractReviewWindowOpen(null, kstNoon("2026-08-01"))).toBe(true);
        expect(isContractReviewWindowOpen(undefined, kstNoon("2026-08-01"))).toBe(true);
        expect(isContractReviewWindowOpen("", kstNoon("2026-08-01"))).toBe(true);
        expect(isContractReviewWindowOpen("nonsense", kstNoon("2026-08-01"))).toBe(true);
    });
});

describe("resolveEformsignDocDisplayStatus", () => {
    it("maps terminal categories regardless of dates", () => {
        expect(resolveEformsignDocDisplayStatus(
            { id: "d", current_status: { status_type: "003" } }, kstNoon("2026-08-01"),
        )).toBe("completed");
        expect(resolveEformsignDocDisplayStatus(
            { id: "d", current_status: { status_type: "080" } }, kstNoon("2026-08-01"),
        )).toBe("expired");
        expect(resolveEformsignDocDisplayStatus(
            { id: "d", current_status: { status_type: "049" } }, kstNoon("2026-08-01"),
        )).toBe("unknown");
    });

    it("splits provider-review docs on the review window", () => {
        expect(resolveEformsignDocDisplayStatus(reviewStepDoc("2026-08-07"), kstNoon("2026-08-01"))).toBe("signed");
        expect(resolveEformsignDocDisplayStatus(reviewStepDoc("2026-08-07"), kstNoon("2026-08-06"))).toBe("review");
        expect(resolveEformsignDocDisplayStatus(reviewStepDoc(null), kstNoon("2026-08-01"))).toBe("review");
    });

    it("labels docs before the customer signature pending", () => {
        expect(resolveEformsignDocDisplayStatus(
            {
                id: "d",
                current_status: { status_type: "060", step_type: "05", step_name: "이용자 서명" },
                contract_end_date: "2026-08-07",
            },
            kstNoon("2026-08-06"),
        )).toBe("pending");
    });
});
