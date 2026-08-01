import {
    isContractReviewWindowOpen,
    resolveContractDocStatusLabel,
} from "./eformsign-doc-status";

/** A provider-review current_status (customer already signed). */
const PROVIDER_REVIEW_STATUS = { status_type: "070", step_type: "06", step_name: "제공기관 확인" };
const CUSTOMER_STEP_STATUS = { status_type: "060", step_type: "05", step_name: "이용자 서명" };

/** now helper: a KST calendar day at noon KST (03:00 UTC). */
const kstNoon = (ymd: string) => new Date(`${ymd}T03:00:00.000Z`);

describe("isContractReviewWindowOpen", () => {
    it("opens exactly 1 business day before the end date (Friday end → Thursday)", () => {
        // 2026-08-07 is a Friday.
        expect(isContractReviewWindowOpen("2026-08-07", kstNoon("2026-08-05"))).toBe(false); // Wed
        expect(isContractReviewWindowOpen("2026-08-07", kstNoon("2026-08-06"))).toBe(true); // Thu
        expect(isContractReviewWindowOpen("2026-08-07", kstNoon("2026-08-07"))).toBe(true); // Fri
    });

    it("skips the weekend (Monday end → Friday)", () => {
        // 2026-08-10 is a Monday.
        expect(isContractReviewWindowOpen("2026-08-10", kstNoon("2026-08-06"))).toBe(false); // Thu
        expect(isContractReviewWindowOpen("2026-08-10", kstNoon("2026-08-07"))).toBe(true); // Fri
        expect(isContractReviewWindowOpen("2026-08-10", kstNoon("2026-08-08"))).toBe(true); // Sat
        expect(isContractReviewWindowOpen("2026-08-10", kstNoon("2026-08-09"))).toBe(true); // Sun
    });

    it("stays open after the end date has passed", () => {
        expect(isContractReviewWindowOpen("2026-08-07", kstNoon("2026-08-20"))).toBe(true);
    });

    it("handles weekend end dates (Saturday/Sunday end → Friday)", () => {
        // 2026-08-08 Sat, 2026-08-09 Sun.
        expect(isContractReviewWindowOpen("2026-08-08", kstNoon("2026-08-06"))).toBe(false); // Thu
        expect(isContractReviewWindowOpen("2026-08-08", kstNoon("2026-08-07"))).toBe(true); // Fri
        expect(isContractReviewWindowOpen("2026-08-09", kstNoon("2026-08-07"))).toBe(true); // Fri
    });

    it("uses the KST calendar day, not the UTC one", () => {
        // 2026-08-05T16:00:00Z is already 2026-08-06 01:00 KST (Thursday).
        expect(isContractReviewWindowOpen("2026-08-07", new Date("2026-08-05T16:00:00.000Z"))).toBe(true);
        // 2026-08-05T14:00:00Z is still 2026-08-05 23:00 KST (Wednesday).
        expect(isContractReviewWindowOpen("2026-08-07", new Date("2026-08-05T14:00:00.000Z"))).toBe(false);
    });

    it("treats a missing or malformed end date as an open window (legacy behavior)", () => {
        expect(isContractReviewWindowOpen(null, kstNoon("2026-08-01"))).toBe(true);
        expect(isContractReviewWindowOpen(undefined, kstNoon("2026-08-01"))).toBe(true);
        expect(isContractReviewWindowOpen("", kstNoon("2026-08-01"))).toBe(true);
        expect(isContractReviewWindowOpen("nonsense", kstNoon("2026-08-01"))).toBe(true);
    });
});

describe("resolveContractDocStatusLabel", () => {
    it("labels completed documents 계약 완료 and expired ones 기간 만료 regardless of dates", () => {
        expect(resolveContractDocStatusLabel({
            category: "completed", currentStatus: null, contractEndDate: "2026-12-31", now: kstNoon("2026-08-01"),
        })).toBe("계약 완료");
        expect(resolveContractDocStatusLabel({
            category: "expired", currentStatus: null, contractEndDate: "2026-12-31", now: kstNoon("2026-08-01"),
        })).toBe("기간 만료");
    });

    it("labels a signed document 서명 완료 while the end date is more than 1 business day away", () => {
        expect(resolveContractDocStatusLabel({
            category: "in-progress",
            currentStatus: PROVIDER_REVIEW_STATUS,
            contractEndDate: "2026-08-07",
            now: kstNoon("2026-08-01"),
        })).toBe("서명 완료");
    });

    it("labels a signed document 검토 필요 once the review window opens", () => {
        expect(resolveContractDocStatusLabel({
            category: "in-progress",
            currentStatus: PROVIDER_REVIEW_STATUS,
            contractEndDate: "2026-08-07",
            now: kstNoon("2026-08-06"),
        })).toBe("검토 필요");
    });

    it("falls back to 검토 필요 when the end date is unknown", () => {
        expect(resolveContractDocStatusLabel({
            category: "in-progress",
            currentStatus: PROVIDER_REVIEW_STATUS,
            contractEndDate: null,
            now: kstNoon("2026-08-01"),
        })).toBe("검토 필요");
    });

    it("labels documents before the customer signature 대기", () => {
        expect(resolveContractDocStatusLabel({
            category: "in-progress",
            currentStatus: CUSTOMER_STEP_STATUS,
            contractEndDate: "2026-08-07",
            now: kstNoon("2026-08-06"),
        })).toBe("대기");
    });
});
