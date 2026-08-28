import { normalizePhone, extractPhoneCandidates } from "application/utils/normalize-phone";
import { normalizePhone as normalizeDomainPhone } from "domain/utils/normalize-phone";

describe("normalizePhone", () => {
    it.each([
        ["010-1234-5678", "01012345678"],
        ["010 1234 5678", "01012345678"],
        ["+82 10-1234-5678", "01012345678"],
        ["+821012345678", "01012345678"],
        ["0212345678", "0212345678"],
    ])("normalizes %s to %s", (input, expected) => {
        expect(normalizePhone(input)).toBe(expected);
    });

    it("returns null for non-phone strings", () => {
        expect(normalizePhone("21호 2610")).toBeNull();
        expect(normalizePhone("")).toBeNull();
        expect(normalizePhone("1234")).toBeNull();
    });

    it("uses the same canonical key from the domain boundary", () => {
        const formatted = "010-1234-5678";
        expect(normalizeDomainPhone(formatted)).toBe(normalizePhone(formatted));
        expect(normalizeDomainPhone("+82 10 1234 5678")).toBe("01012345678");
    });
});

describe("extractPhoneCandidates", () => {
    it("finds phone numbers inside a file name", () => {
        expect(extractPhoneCandidates("통화 녹음 김서연_010-4821-7763_250610_140211.m4a"))
            .toEqual(["01048217763"]);
    });

    it("returns empty array when none found", () => {
        expect(extractPhoneCandidates("recording-001.m4a")).toEqual([]);
    });
});
