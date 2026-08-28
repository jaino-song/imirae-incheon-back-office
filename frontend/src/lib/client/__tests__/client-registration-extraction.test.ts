import { extractClientRegistrationDraft } from "../client-registration-extraction";
import { normalizeCompactDateForSubmit } from "../client-registration-formats";

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

    it("does not use a later birthday when an immediately labeled due date is invalid", () => {
        const draft = extractClientRegistrationDraft(
            "산모 등록. 출산 예정일 2026-13-01, 생년월일 900101.",
        );

        expect(draft.dueDate).toBeUndefined();
        expect(draft.birthday).toBe("900101");
        expect(draft.missingFields).toContain("dueDate");
    });

    it("does not use the later birthday from the Codex reported invalid-date case", () => {
        const draft = extractClientRegistrationDraft(
            "산모 등록. 출산 예정일 2026-02-31, 생년월일 2000-01-01.",
        );

        expect(draft.dueDate).toBeUndefined();
        expect(draft.missingFields).toContain("dueDate");
    });

    it("does not use a later date when a labeled due date has no associated value", () => {
        const draft = extractClientRegistrationDraft(
            "산모 등록. 출산 예정일 미정, 생년월일 900101.",
        );

        expect(draft.dueDate).toBeUndefined();
        expect(draft.birthday).toBe("900101");
        expect(draft.missingFields).toContain("dueDate");
    });

    it("continues to a later repeated birthday label after the first value is missing", () => {
        const draft = extractClientRegistrationDraft(
            "산모 등록. 생년월일은 모르겠고 생일은 2000-01-01.",
        );

        expect(draft.birthday).toBe("000101");
    });

    it.each([
        ["생년월일 2000-02-31, 생일 2000-01-01", "000101"],
        ["생년월일 2000-01-01, 생일 2000-02-31", "000101"],
    ])("chooses the first valid repeated birthday candidate: %s", (message, expectedBirthday) => {
        const draft = extractClientRegistrationDraft(`산모 등록. ${message}.`);

        expect(draft.birthday).toBe(expectedBirthday);
    });

    it.each([
        ["출산 예정일 미정, 분만 예정일 2026-03-01", "260301"],
        ["출산 예정일 2026-02-31, 출산예정일 2026-03-01", "260301"],
        ["출산 예정일 2026-03-01, 출산예정일 2026-02-31", "260301"],
    ])("chooses the first valid repeated due-date candidate: %s", (message, expectedDueDate) => {
        const draft = extractClientRegistrationDraft(`산모 등록. ${message}.`);

        expect(draft.dueDate).toBe(expectedDueDate);
    });

    it.each([
        [
            "생년월일은 모르겠고 출산 예정일은 2026-02-01",
            undefined,
            "260201",
        ],
        [
            "출산 예정일은 2026-02-31, 생년월일은 2000-01-01",
            "000101",
            undefined,
        ],
    ])("does not cross a later labeled field while resolving repeated dates: %s", (message, expectedBirthday, expectedDueDate) => {
        const draft = extractClientRegistrationDraft(`산모 등록. ${message}.`);

        expect(draft.birthday).toBe(expectedBirthday);
        expect(draft.dueDate).toBe(expectedDueDate);
    });

    it.each([
        ["생년월일 000101", "000101"],
        ["생년월일 900101", "900101"],
        ["생년월일 2000-01-01", "000101"],
        ["생년월일 2000-1-1", "000101"],
        ["생년월일 20000101", "000101"],
    ])("normalizes a labeled birthday without reusing it as dueDate: %s", (message, expectedBirthday) => {
        const draft = extractClientRegistrationDraft(`산모 등록. ${message}.`);

        expect(draft.birthday).toBe(expectedBirthday);
        expect(draft.dueDate).toBeUndefined();
        expect(draft.missingFields).toContain("dueDate");
    });

    it("keeps the labeled due date when it appears before the birthday", () => {
        const draft = extractClientRegistrationDraft(
            "산모 등록. 출산 예정일 26년 2월 1일, 생년월일 2000-01-01.",
        );

        expect(draft).toEqual(expect.objectContaining({
            birthday: "000101",
            dueDate: "260201",
        }));
    });

    it.each([
        ["출산 예정일은 2026년 2월 1일", "260201"],
        ["출산예정일: 2026.2.1", "260201"],
        ["출산 예정일: 2026. 2. 1", "260201"],
        ["출산일 = 260201일", "260201"],
        ["분만 예정일 26-2-1", "260201"],
        ["출산 예정일자는 2026-02-01", "260201"],
    ])("parses explicit due-date labels and Korean date forms: %s", (message, expectedDueDate) => {
        expect(extractClientRegistrationDraft(`산모 등록. ${message}.`).dueDate).toBe(expectedDueDate);
    });

    it.each([
        ["출산 예정일은 2026년 2월 1일로 정했어", "dueDate", "260201"],
        ["생년월일은 2000년 1월 1일으로 등록해줘", "birthday", "000101"],
        ["출산 예정일은 2026년 2월 1일로, 주소는 서울이야", "dueDate", "260201"],
        ["출산 예정일은 2026년 2월 1일으로 생년월일은 2000-01-01", "dueDate", "260201"],
    ])("accepts labeled dates followed by Korean 로/으로 connective context: %s", (message, field, expectedValue) => {
        const draft = extractClientRegistrationDraft(`산모 등록. ${message}.`);

        expect(draft[field as "birthday" | "dueDate"]).toBe(expectedValue);
    });

    it.each([
        "출산 예정일은 2026년 2월 1일로고",
        "출산 예정일은 2026년 2월 1일으로2",
        "출산 예정일은 2026년 2월 1일로생년월일은 2000-01-01",
    ])("does not accept a malformed or unbounded 로/으로 continuation: %s", (message) => {
        const draft = extractClientRegistrationDraft(`산모 등록. ${message}.`);

        expect(draft.dueDate).toBeUndefined();
        expect(draft.missingFields).toContain("dueDate");
    });

    it.each([
        [
            "생년월일은 2000년 1월 1일이고 출산 예정일은 2026년 2월 1일이에요",
            "000101",
            "260201",
        ],
        [
            "생년월일은 2000년 1월 1일이며 출산 예정일은 2026년 2월 1일입니다",
            "000101",
            "260201",
        ],
    ])("accepts recognized Korean sentence endings after labeled dates: %s", (message, expectedBirthday, expectedDueDate) => {
        const draft = extractClientRegistrationDraft(`산모 등록. ${message}.`);

        expect(draft.birthday).toBe(expectedBirthday);
        expect(draft.dueDate).toBe(expectedDueDate);
    });

    it.each([
        "생년월일은 2000년 1월 1일이고2 출산 예정일은 2026년 2월 1일",
        "생년월일은 2000년 1월 1일연락처는 010-1234-5678, 출산 예정일은 2026년 2월 1일",
    ])("does not cross malformed or unrelated Korean text after a labeled date: %s", (message) => {
        const draft = extractClientRegistrationDraft(`산모 등록. ${message}.`);

        expect(draft.birthday).toBeUndefined();
        expect(draft.dueDate).toBe("260201");
    });

    it("parses a complete birthday 일자 label without leaving its particle in the value", () => {
        const draft = extractClientRegistrationDraft("산모 등록. 생년월일자는 2000-01-01.");

        expect(draft.birthday).toBe("000101");
        expect(draft.dueDate).toBeUndefined();
    });

    it.each([
        ["생년월일은 양력 000101", "000101"],
        ["생년월일: 양력 2000-01-01", "000101"],
        ["생년월일은 양력으로 000101", "000101"],
        ["생년월일은 양력, 2000-01-01", "000101"],
    ])("accepts a recognized birthday calendar qualifier before the date: %s", (message, expectedBirthday) => {
        const draft = extractClientRegistrationDraft(`산모 등록. ${message}.`);

        expect(draft.birthday).toBe(expectedBirthday);
        expect(draft.dueDate).toBeUndefined();
    });

    it.each([
        "생년월일은 음력 900101",
        "생일 음력: 1990.01.01",
        "생년월일은 음력으로, 900101",
    ])("does not interpret an unsupported lunar birthday as Gregorian: %s", (message) => {
        const draft = extractClientRegistrationDraft(`산모 등록. ${message}.`);

        expect(draft.birthday).toBeUndefined();
        expect(draft.missingFields).toContain("birthday");
    });

    it.each([
        "생년월일은 양력 0001019",
        "생년월일은 음력 2000-01-019",
        "생년월일은 양력 생년월일 000101",
    ])("does not let a birthday qualifier cross a strict date boundary: %s", (message) => {
        const draft = extractClientRegistrationDraft(`산모 등록. ${message}, 출산 예정일 2026-02-01.`);

        expect(draft.birthday).toBeUndefined();
        expect(draft.dueDate).toBe("260201");
    });

    it("does not use a qualified birthday as an unlabeled due-date fallback", () => {
        const draft = extractClientRegistrationDraft(
            "산모 등록. 생년월일은 양력 2000-01-01, 2026-02-01.",
        );

        expect(draft.birthday).toBe("000101");
        expect(draft.dueDate).toBeUndefined();
        expect(draft.missingFields).toContain("dueDate");
    });

    it.each([
        ["2069-12-31", "691231", "2069-12-31"],
        ["1970-01-01", "700101", "1970-01-01"],
    ])("keeps explicit due-date years representable by the YYMMDD wizard contract: %s", (isoDate, expectedCompact, expectedIso) => {
        const draft = extractClientRegistrationDraft(`산모 등록. 출산 예정일 ${isoDate}.`);

        expect(draft.dueDate).toBe(expectedCompact);
        expect(normalizeCompactDateForSubmit(draft.dueDate ?? "")).toBe(expectedIso);
    });

    it.each(["2070-01-01", "2099-12-31", "20700101", "20991231"])(
        "does not silently pivot an unsupported explicit due-date year into the wrong century: %s",
        (isoDate) => {
            const draft = extractClientRegistrationDraft(`산모 등록. 출산 예정일 ${isoDate}.`);

            expect(draft.dueDate).toBeUndefined();
            expect(draft.missingFields).toContain("dueDate");
        },
    );

    it.each([
        "출산 예정일 2026-02-31, 생년월일 2000-01-01",
        "출산 예정일 2026-02-019, 생년월일 2000-01-01",
        "출산 예정일 2026-02-01.1, 생년월일 2000-01-01",
        "출산 예정일 2026-02-01-02, 생년월일 2000-01-01",
        "출산 예정일 260231, 생년월일 900101",
        "출산 예정일 20261301, 생년월일 900101",
    ])("rejects malformed labeled due dates instead of selecting another date: %s", (message) => {
        const draft = extractClientRegistrationDraft(`산모 등록. ${message}.`);

        expect(draft.dueDate).toBeUndefined();
        expect(draft.missingFields).toContain("dueDate");
    });

    it.each([
        ["산모 등록. 260201.", "260201"],
        ["산모 등록. 2026-02-01.", "260201"],
    ])("preserves a sole unlabelled date as the due date: %s", (message, expectedDueDate) => {
        expect(extractClientRegistrationDraft(message).dueDate).toBe(expectedDueDate);
    });

    it("does not choose one of multiple unlabelled dates as dueDate", () => {
        const draft = extractClientRegistrationDraft("산모 등록. 2026-02-01, 2026-02-02.");

        expect(draft.dueDate).toBeUndefined();
        expect(draft.missingFields).toContain("dueDate");
    });

    it.each([
        "산모 등록. 생년월일 9001019.",
        "산모 등록. 생년월일 2000-01-019.",
        "산모 등록. 생년월일 200001019.",
    ])("rejects a date token with trailing digits: %s", (message) => {
        const draft = extractClientRegistrationDraft(message);

        expect(draft.birthday).toBeUndefined();
        expect(draft.dueDate).toBeUndefined();
        expect(draft.missingFields).toEqual(expect.arrayContaining(["birthday", "dueDate"]));
    });

    it.each([
        ["관리사는 김민이야.", "김민"],
        ["관리사는 김민님,", "김민"],
        ["관리사는 홍길동입니다!", "홍길동"],
        ["관리사는 홍길동이에요.", "홍길동"],
        ["관리사는 남궁민수예요.", "남궁민수"],
        ["관리사는 남궁민수이야.", "남궁민수"],
        ["관리사는 남궁민수야.", "남궁민수"],
        ["관리사는 남궁민수입니다!", "남궁민수"],
        ["관리사는 남궁민수님,", "남궁민수"],
        ["관리사는 김영희로 해줘.", "김영희"],
        ["관리사는 김영희가 담당해.", "김영희"],
        ["관리사는 김영희가.", "김영희"],
        ["관리사는 김영희를 선택해.", "김영희"],
        ["관리사는 김영희는 담당해.", "김영희"],
        ["관리사는 김영희은 담당해.", "김영희"],
        ["관리사는 김영희이 담당해.", "김영희"],
        ["관리사는 김영희이는 담당해.", "김영희"],
        ["관리사님은 김영희입니다.", "김영희"],
        ["관리사로 김영희예요.", "김영희"],
        ["관리사님으로 김영희예요.", "김영희"],
        ["제공인력이 김영희예요.", "김영희"],
        ["제공인력으로 김영희예요.", "김영희"],
        ["이모님이 김영희야.", "김영희"],
        ["관리사를 김영희로 지정해.", "김영희"],
        ["관리사는 남궁민수예요!", "남궁민수"],
        ["관리사는 김가은, ...", "김가은"],
        ["관리사는 김가은이 담당해.", "김가은"],
        ["관리사는 김영희와 진행해.", "김영희"],
        ["관리사는 김영희에게 맡겨.", "김영희"],
        ["관리사는 김영희과 함께해.", "김영희"],
        ["관리사는 김영희랑 진행해.", "김영희"],
        ["관리사는 김영희이랑 진행해.", "김영희"],
        ["관리사는 김영희한테 맡겨.", "김영희"],
        ["관리사는 김영희께 맡겨.", "김영희"],
        ["관리사는 김영희로부터 연락받아.", "김영희"],
        ["관리사는 김민에게 맡겨.", "김민"],
        ["관리사는 박이랑이 담당해.", "박이랑"],
        ["관리사는 박이랑은 담당해.", "박이랑"],
        ["관리사는 박이랑으로 담당해.", "박이랑"],
        ["관리사는 김가은을 선택해.", "김가은"],
        ["관리사는 박이 담당해.", "박이"],
        ["관리사는 김영희고 주소는 서울이야", "김영희"],
        ["관리사는 김영희고, 주소는 서울이야", "김영희"],
        ["관리사는 김영희고 연락처는 010-1234-5678", "김영희"],
    ])("strips the provider suffix from %s", (message, expectedName) => {
        expect(extractClientRegistrationDraft(message).employeeName).toBe(expectedName);
    });

    it.each([
        ["관리사는 김가은.", "김가은"],
        ["관리사는 김나이 담당해.", "김나이"],
        ["관리사는 김민고.", "김민고"],
        ["관리사: 박고, ...", "박고"],
    ])("preserves a complete provider name ending in a particle-like syllable: %s", (message, expectedName) => {
        expect(extractClientRegistrationDraft(message).employeeName).toBe(expectedName);
    });

    it.each([
        "관리사는 김영희고2 주소는 서울이야",
        "관리사는 김영희고주소는 서울이야",
    ])("does not strip 고 from malformed provider text: %s", (message) => {
        expect(extractClientRegistrationDraft(message).employeeName).toBeUndefined();
    });

    it("skips a provider field label and scans a later provider label for the name", () => {
        const draft = extractClientRegistrationDraft(
            "산모 등록. 제공인력 연락처는 01012345678이고 관리사는 김영희야.",
        );

        expect(draft.employeeName).toBe("김영희");
    });

    it.each([
        "제공인력 전화는 01012345678이야.",
        "제공인력 등급은 VIP야.",
        "제공인력 주소는 인천이야.",
    ])("does not treat a provider field noun as an employee name: %s", (message) => {
        expect(extractClientRegistrationDraft(`산모 등록. ${message}`).employeeName).toBeUndefined();
    });

    it.each([
        "관리사는 김영희와.",
        "관리사는 김영희과.",
        "관리사는 김영희랑.",
        "관리사는 김가와.",
        "관리사는 남궁민랑.",
    ])("does not forward an ambiguous provider token at a punctuation boundary: %s", (message) => {
        expect(extractClientRegistrationDraft(message).employeeName).toBeUndefined();
    });

    it.each([
        ["관리사는 가나다입니다.", "가나다"],
        ["관리사는 가나다라님.", "가나다라"],
    ])("accepts provider names from two through four syllables: %s", (message, expectedName) => {
        expect(extractClientRegistrationDraft(message).employeeName).toBe(expectedName);
    });

    it.each([
        ["관리사: 이서야.", "이서야"],
        ["관리사: 가나야.", "가나야"],
    ])("preserves a short provider token when a final 야 may be part of the name: %s", (message, expectedName) => {
        expect(extractClientRegistrationDraft(message).employeeName).toBe(expectedName);
    });

    it.each([
        "관리사는 이서야.",
        "관리사는 이서야!",
        "관리사는 이서야, 계속해.",
        "관리사는 이서야 담당해.",
        "관리사는 이서야가 담당해.",
        "관리사는 이서야에게 맡겨.",
    ])("rejects a short provider token when a final 야 is ambiguous without a value separator: %s", (message) => {
        expect(extractClientRegistrationDraft(message).employeeName).toBeUndefined();
    });

    it("keeps the complete ambiguous name before a trailing particle after an explicit separator", () => {
        expect(extractClientRegistrationDraft("관리사: 이서야가 담당해.").employeeName).toBe("이서야");
    });

    it.each([
        ["관리사는 김민이야.", "김민"],
        ["관리사는 홍길동이에요.", "홍길동"],
        ["관리사는 홍길동예요.", "홍길동"],
        ["관리사는 남궁민수야.", "남궁민수"],
        ["관리사는 남궁민수님.", "남궁민수"],
    ])("still strips a clearly marked provider ending when the full token cannot be the name: %s", (message, expectedName) => {
        expect(extractClientRegistrationDraft(message).employeeName).toBe(expectedName);
    });

    it.each([
        "관리사는 가나다라마.",
        "관리사는 가나다라마야.",
    ])("does not truncate provider names beyond four syllables: %s", (message) => {
        expect(extractClientRegistrationDraft(message).employeeName).toBeUndefined();
    });
});
