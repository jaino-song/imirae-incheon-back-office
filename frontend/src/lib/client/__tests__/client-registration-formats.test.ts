import {
    buildCanonicalClientRegistrationBasics,
    getCanonicalClientRegistrationError,
} from "../client-registration-formats";

const validInput = {
    name: " 홍길동 ",
    phone: "01012345678",
    birthday: "000229",
    address: " 인천 연수구 ",
    dueDate: "260201",
};

describe("client registration formats", () => {
    it("normalizes all registration basics to the canonical dialog contract", () => {
        expect(buildCanonicalClientRegistrationBasics(validInput)).toEqual({
            name: "홍길동",
            phone: "010-1234-5678",
            birthday: "000229",
            address: "인천 연수구",
            dueDate: "2026-02-01",
        });
    });

    it("accepts a leap-day birthday only when the resolved year has one", () => {
        expect(getCanonicalClientRegistrationError({ ...validInput, birthday: "000229" })).toBeNull();
        expect(getCanonicalClientRegistrationError({ ...validInput, birthday: "990229" })).toContain("생년월일");
        expect(getCanonicalClientRegistrationError({ ...validInput, birthday: "000230" })).toContain("생년월일");
    });

    it("rejects invalid calendar dates and short phone numbers before submit", () => {
        expect(getCanonicalClientRegistrationError({ ...validInput, dueDate: "999999" })).toContain("출산 예정일");
        expect(getCanonicalClientRegistrationError({ ...validInput, birthday: "900230" })).toContain("생년월일");
        expect(getCanonicalClientRegistrationError({ ...validInput, phone: "0101234567" })).toContain("연락처");
    });
});
