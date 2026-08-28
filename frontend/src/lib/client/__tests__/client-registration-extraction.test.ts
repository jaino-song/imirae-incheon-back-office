import { extractClientRegistrationDraft } from "../client-registration-extraction";

describe("extractClientRegistrationDraft", () => {
    it("extracts a name-only registration request and lists missing fields", () => {
        expect(extractClientRegistrationDraft("산모 등록해줘. 이름은 홍길동이야.")).toEqual({
            name: "홍길동",
            missingFields: ["phone", "birthday", "address", "dueDate"],
        });
    });

    it("normalizes multiple values in one natural-language request", () => {
        const draft = extractClientRegistrationDraft(
            "홍길동 등록해줘. 연락처는 010-1234-5678, 생년월일 900101, 주소는 인천 연수구, 출산 예정일 260201.",
        );

        expect(draft).toEqual({
            name: "홍길동",
            phone: "01012345678",
            birthday: "900101",
            address: "인천 연수구",
            dueDate: "260201",
            missingFields: [],
        });
    });

    it("rejects impossible calendar values instead of seeding them", () => {
        const draft = extractClientRegistrationDraft("산모 등록 홍길동 생년월일 990230");

        expect(draft.birthday).toBeUndefined();
        expect(draft.name).toBe("홍길동");
        expect(draft.missingFields).toContain("birthday");
    });

    it("normalizes a four-digit due-date year to the wizard's YYMMDD format", () => {
        const draft = extractClientRegistrationDraft(
            "산모 등록. 출산 예정일 2026-02-01.",
        );

        expect(draft.dueDate).toBe("260201");
    });

    it("uses the labeled due date instead of an earlier ISO birthday", () => {
        const draft = extractClientRegistrationDraft(
            "산모 등록. 생년월일 2000-01-01, 출산 예정일 2026-02-01.",
        );

        expect(draft.dueDate).toBe("260201");
    });

    it("does not fall back to an earlier birthday when the labeled due date is invalid", () => {
        const draft = extractClientRegistrationDraft(
            "산모 등록. 생년월일 2000-01-01, 출산 예정일 2026-02-31.",
        );

        expect(draft.dueDate).toBeUndefined();
        expect(draft.missingFields).toContain("dueDate");
    });

    it.each([
        ["관리사는 김민이야.", "김민"],
        ["관리사는 김민님,", "김민"],
        ["관리사는 홍길동입니다!", "홍길동"],
    ])("strips the provider suffix from %s", (message, expectedName) => {
        expect(extractClientRegistrationDraft(message).employeeName).toBe(expectedName);
    });
});
