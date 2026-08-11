import {
    buildServiceRecordDocumentFields,
    chunkSessions,
    chunkSessionsByTier,
    selectTemplateTier,
    yymmddToIso,
    type ServiceRecordDayInput,
    type ServiceRecordHeaderInput,
} from "application/usecases/eformsign-doc/service-record-field-mapper";
import {
    CHECKBOX_CHECKED_VALUE,
    CHECKBOX_UNCHECKED_VALUE,
} from "application/usecases/eformsign-doc/service-record-field-ids";

/** Build a {id → value} map; asserts no id is emitted twice. */
function toMap(fields: Array<{ id: string; value: string }>): Map<string, string> {
    const map = new Map<string, string>();
    for (const f of fields) {
        expect(map.has(f.id)).toBe(false); // no duplicate ids
        map.set(f.id, f.value);
    }
    return map;
}

/** UTC-midnight date, matching Prisma @db.Date reads. */
const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

function day(overrides: Partial<ServiceRecordDayInput> = {}): ServiceRecordDayInput {
    return {
        sessionIndex: 1,
        serviceDate: utc("2026-07-09"),
        answers: {},
        etcService: null,
        notes: null,
        paymentConfirmed: false,
        momApproval: null,
        clientSignature: null,
        ...overrides,
    };
}

const CHECKED = CHECKBOX_CHECKED_VALUE;
const UNCHECKED = CHECKBOX_UNCHECKED_VALUE;

describe("yymmddToIso", () => {
    it("pivots 00–29 to the 2000s and 30–99 to the 1900s", () => {
        expect(yymmddToIso("260101")).toBe("2026-01-01"); // newborn
        expect(yymmddToIso("050815")).toBe("2005-08-15"); // young mother
        expect(yymmddToIso("291231")).toBe("2029-12-31"); // pivot boundary (<30)
        expect(yymmddToIso("300101")).toBe("1930-01-01"); // pivot boundary (>=30)
        expect(yymmddToIso("900101")).toBe("1990-01-01"); // mother born 1990
    });

    it("returns null for malformed or implausible input", () => {
        expect(yymmddToIso(null)).toBeNull();
        expect(yymmddToIso("")).toBeNull();
        expect(yymmddToIso("9001")).toBeNull(); // too short
        expect(yymmddToIso("1990-01-01")).toBeNull(); // not 6 digits
        expect(yymmddToIso("901301")).toBeNull(); // month 13
        expect(yymmddToIso("900132")).toBeNull(); // day 32
    });
});

describe("chunkSessions", () => {
    const sizes = (n: number) => chunkSessions(Array.from({ length: n }, (_, i) => i)).map((c) => c.length);

    it("splits into ceil(N/5) chunks of <=5", () => {
        expect(sizes(1)).toEqual([1]);
        expect(sizes(5)).toEqual([5]);
        expect(sizes(6)).toEqual([5, 1]);
        expect(sizes(10)).toEqual([5, 5]);
        expect(sizes(11)).toEqual([5, 5, 1]);
    });

    it("keeps sessions contiguous and in order (session 6 => slot 1 of doc 2)", () => {
        const chunks = chunkSessions([1, 2, 3, 4, 5, 6, 7]);
        expect(chunks[0]).toEqual([1, 2, 3, 4, 5]);
        expect(chunks[1]).toEqual([6, 7]);
    });

    it("returns [] for no sessions and rejects size < 1", () => {
        expect(chunkSessions([])).toEqual([]);
        expect(() => chunkSessions([1], 0)).toThrow();
    });
});

describe("selectTemplateTier", () => {
    const tiers = [5, 10, 15, 20];

    it("picks the smallest configured tier that fits dayCount", () => {
        expect(selectTemplateTier(5, tiers)).toBe(5);
        expect(selectTemplateTier(6, tiers)).toBe(10);
        expect(selectTemplateTier(7, tiers)).toBe(10);
        expect(selectTemplateTier(10, tiers)).toBe(10);
        expect(selectTemplateTier(11, tiers)).toBe(15);
        expect(selectTemplateTier(16, tiers)).toBe(20);
        expect(selectTemplateTier(20, tiers)).toBe(20);
    });

    it("falls back to the max configured tier when dayCount exceeds every tier", () => {
        expect(selectTemplateTier(25, tiers)).toBe(20);
    });

    it("uses the single configured tier when only one is set (base-only env)", () => {
        expect(selectTemplateTier(7, [5])).toBe(5);
    });

    it("throws for an empty tier list", () => {
        expect(() => selectTemplateTier(5, [])).toThrow();
    });
});

describe("chunkSessionsByTier", () => {
    const tiers = [5, 10, 15, 20];
    const days = (n: number) => Array.from({ length: n }, (_, i) => i);

    it("packs a segment into the smallest tier that fits it", () => {
        const chunks = chunkSessionsByTier(days(7), tiers);
        expect(chunks).toHaveLength(1);
        expect(chunks[0]!.tier).toBe(10);
        expect(chunks[0]!.days).toHaveLength(7);
    });

    it("splits a segment longer than the max tier: max-tier chunks then a remainder", () => {
        const chunks = chunkSessionsByTier(days(23), tiers);
        expect(chunks).toHaveLength(2);
        expect(chunks[0]).toEqual({ days: days(23).slice(0, 20), tier: 20 });
        expect(chunks[1]).toEqual({ days: days(23).slice(20), tier: 5 });
    });

    it("returns a single chunk when the segment exactly matches a tier", () => {
        const chunks = chunkSessionsByTier(days(15), tiers);
        expect(chunks).toEqual([{ days: days(15), tier: 15 }]);
    });

    it("reproduces the pre-multi-tier 5-only chunking when only the base tier is configured", () => {
        const chunks = chunkSessionsByTier(days(7), [5]);
        expect(chunks).toEqual([
            { days: days(7).slice(0, 5), tier: 5 },
            { days: days(7).slice(5), tier: 5 },
        ]);
    });

    it("returns [] for an empty segment", () => {
        expect(chunkSessionsByTier([], tiers)).toEqual([]);
    });

    it("throws for an empty tier list on a non-empty segment", () => {
        expect(() => chunkSessionsByTier(days(3), [])).toThrow();
    });
});

describe("buildServiceRecordDocumentFields", () => {
    const header: ServiceRecordHeaderInput = {
        momName: "김산모",
        momBirth: "900101",
        babyName: "김아기",
        babyBirth: "260615",
        deliveryType: "자연분만",
        babyWeight: "3.2",
    };

    it("emits the remaining header fields once", () => {
        const map = toMap(buildServiceRecordDocumentFields({ header, employeeName: "박제공", days: [day()] }));
        expect(map.get("제공인력 이름")).toBe("박제공");
        expect(map.get("산모 이름")).toBe("김산모");
        expect(map.get("산모 생년월일")).toBe("1990-01-01");
        expect(map.get("신생아 이름")).toBe("김아기");
        expect(map.get("신생아 출생일자")).toBe("2026-06-15");
        expect(map.get("신생아 몸무게")).toBe("3.2");
        expect(map.get("자연분만")).toBe(CHECKED);
        expect(map.get("제왕절개")).toBe(UNCHECKED);
    });

    it.each([5, 10, 15, 20])("emits the required 제공기관 field for the %i-session template", (slotCount) => {
        const map = toMap(buildServiceRecordDocumentFields({
            header,
            providerName: "인천 아이미래로",
            employeeName: "박제공",
            days: [day()],
            slotCount,
        }));

        expect(map.get("제공기관 이름")).toBe("인천 아이미래로");
    });

    it("maps 제왕절개 and sends empty header fields (required at creation)", () => {
        const map = toMap(buildServiceRecordDocumentFields({
            header: { momName: null, momBirth: null, babyName: null, babyBirth: null, deliveryType: "제왕절개", babyWeight: null },
            employeeName: "인력",
            days: [day()],
        }));
        expect(map.get("제왕절개")).toBe(CHECKED);
        expect(map.get("자연분만")).toBe(UNCHECKED);
        expect(map.get("산모 이름")).toBe("");
        expect(map.get("산모 생년월일")).toBe("");
    });

    it("works with a null header — required header fields sent blank, delivery marks unchecked", () => {
        const map = toMap(buildServiceRecordDocumentFields({ header: null, employeeName: "인력", days: [day()] }));
        expect(map.get("산모 이름")).toBe("");
        expect(map.get("자연분만")).toBe(UNCHECKED);
        expect(map.get("제왕절개")).toBe(UNCHECKED);
    });

    it("maps a fully-answered session onto slot-1 fields", () => {
        const map = toMap(buildServiceRecordDocumentFields({
            header,
            employeeName: "인력",
            days: [day({
                serviceDate: utc("2026-07-09"),
                answers: {
                    perineum: ["열상", "혈종"],
                    breast: ["이상없음"],
                    excretion: ["불편감", "이상없음"],
                    sitzBath: "실시",
                    meals_meal: "3",
                    meals_snack: "2",
                    temperature_temp: "36.8",
                    sleep: "잘 잠",
                    breastFeeding_count: "5",
                    formulaFeeding_count: "2",
                    formulaFeeding_ml: "60",
                    stool: "이상변",
                    stool_color: "녹색",
                    bath: "실시",
                },
                etcService: "예방접종 안내",
                notes: "수면 부족",
                paymentConfirmed: true,
                momApproval: "approved",
                clientSignature: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
            })],
        }));
        // date
        expect(map.get("월 1")).toBe("07");
        expect(map.get("일 1")).toBe("09");
        // multi-select: one field per selected option
        expect(map.get("회음절개부위 열상 1")).toBe(CHECKED);
        expect(map.get("회음절개부위 혈종 1")).toBe(CHECKED);
        expect(map.has("회음절개부위 불편감 1")).toBe(false);
        expect(map.has("회음절개부위 이상없음 1")).toBe(false);
        expect(map.get("유방상태 이상없음 1")).toBe(CHECKED);
        expect(map.get("배뇨배변 불편감 1")).toBe(CHECKED);
        expect(map.get("배뇨배변 이상없음 1")).toBe(CHECKED);
        // single-choice radios
        expect(map.get("좌욕 실시 1")).toBe(CHECKED);
        expect(map.has("좌욕 미실시 1")).toBe(false);
        expect(map.get("잘잠 1")).toBe(CHECKED);
        expect(map.has("잘못잠 1")).toBe(false);
        expect(map.get("이상변 1")).toBe(CHECKED);
        expect(map.has("정상변 1")).toBe(false);
        expect(map.get("목욕제대관리 실시 1")).toBe(CHECKED);
        // text/counts
        expect(map.get("식사 1")).toBe("3");
        expect(map.get("간식 1")).toBe("2");
        expect(map.get("체온 1")).toBe("36.8");
        expect(map.get("모유수유횟수 1")).toBe("5");
        expect(map.get("분유수유횟수 1")).toBe("2");
        expect(map.get("분유수유ml 1")).toBe("60");
        expect(map.get("색깔 1")).toBe("녹색");
        expect(map.get("기타서비스 1")).toBe("예방접종 안내");
        expect(map.get("특이사항 1")).toBe("수면 부족");
        // required marks
        expect(map.get("결제 확인 1")).toBe(CHECKED);
        // 산모확인서명 1 is a binary(서명) field — the dataURI passes through unmodified, not a checkmark.
        expect(map.get("산모확인서명 1")).toBe("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB");
    });

    it("omits color when 정상변, and ignores unknown radio/absent answers", () => {
        const map = toMap(buildServiceRecordDocumentFields({
            header: null,
            employeeName: "인력",
            days: [day({
                answers: {
                    perineum: [], // empty multi → nothing
                    sitzBath: "해당없음", // unknown option → nothing
                    stool: "정상변",
                    stool_color: "", // present-but-empty → omitted
                },
            })],
        }));
        expect(map.get("정상변 1")).toBe(CHECKED);
        expect(map.has("색깔 1")).toBe(false);
        expect(map.has("좌욕 실시 1")).toBe(false);
        expect(map.has("좌욕 미실시 1")).toBe(false);
        expect(map.has("회음절개부위 이상없음 1")).toBe(false);
        expect(map.has("식사 1")).toBe(false);
    });

    it("encodes paymentConfirmed as checked/unchecked, independent of clientSignature", () => {
        const map = toMap(buildServiceRecordDocumentFields({
            header: null,
            employeeName: "인력",
            days: [day({ paymentConfirmed: false, clientSignature: null })],
        }));
        expect(map.get("결제 확인 1")).toBe(UNCHECKED);
        expect(map.get("산모확인서명 1")).toBe("");
    });

    it("passes a clientSignature dataURI through to 산모확인서명 unmodified", () => {
        const dataUri = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";
        const map = toMap(buildServiceRecordDocumentFields({
            header: null,
            employeeName: "인력",
            days: [day({ clientSignature: dataUri })],
        }));
        expect(map.get("산모확인서명 1")).toBe(dataUri);
    });

    it("sends empty string for 산모확인서명 when clientSignature is null", () => {
        const map = toMap(buildServiceRecordDocumentFields({
            header: null,
            employeeName: "인력",
            days: [day({ clientSignature: null })],
        }));
        expect(map.get("산모확인서명 1")).toBe("");
    });

    it("emits required marks (unchecked) for every unused slot in a short chunk", () => {
        const fields = buildServiceRecordDocumentFields({
            header,
            employeeName: "인력",
            days: [day({ sessionIndex: 6 }), day({ sessionIndex: 7 })], // chunk of 2 → slots 1,2 used; 3,4,5 unused
        });
        const map = toMap(fields);
        for (const n of [3, 4, 5]) {
            expect(map.get(`결제 확인 ${n}`)).toBe(UNCHECKED);
            expect(map.get(`산모확인서명 ${n}`)).toBe(""); // binary(서명) field: "" satisfies required, blank slot
            expect(map.get(`월 ${n}`)).toBe(""); // required date slots sent blank
            expect(map.get(`일 ${n}`)).toBe("");
            expect(map.has(`식사 ${n}`)).toBe(false); // non-required fields still omitted
        }
        // all 5 required-mark pairs present regardless of session count
        for (const n of [1, 2, 3, 4, 5]) {
            expect(map.has(`결제 확인 ${n}`)).toBe(true);
            expect(map.has(`산모확인서명 ${n}`)).toBe(true);
        }
    });

    it("reads serviceDate with UTC accessors (no local-timezone drift)", () => {
        const map = toMap(buildServiceRecordDocumentFields({
            header: null,
            employeeName: "인력",
            days: [day({ serviceDate: utc("2026-07-01") })],
        }));
        expect(map.get("월 1")).toBe("07");
        expect(map.get("일 1")).toBe("01");
    });

    describe("slotCount (BJJ-multi-tier)", () => {
        it("emits required marks for all 10 slots when slotCount=10, and nothing beyond", () => {
            const map = toMap(buildServiceRecordDocumentFields({
                header,
                employeeName: "인력",
                days: [day({ sessionIndex: 1 }), day({ sessionIndex: 2 }), day({ sessionIndex: 3 })],
                slotCount: 10,
            }));
            for (let n = 1; n <= 10; n++) {
                expect(map.has(`결제 확인 ${n}`)).toBe(true);
                expect(map.has(`산모확인서명 ${n}`)).toBe(true);
            }
            expect(map.has("결제 확인 11")).toBe(false);
            expect(map.has("산모확인서명 11")).toBe(false);
            // days 3개면 슬롯 4..10은 빈 슬롯 처리
            for (let n = 4; n <= 10; n++) {
                expect(map.get(`결제 확인 ${n}`)).toBe(UNCHECKED);
                expect(map.get(`산모확인서명 ${n}`)).toBe("");
                expect(map.get(`월 ${n}`)).toBe("");
            }
        });

        it("throws when days.length exceeds slotCount", () => {
            expect(() => buildServiceRecordDocumentFields({
                header: null,
                employeeName: "인력",
                days: [day(), day(), day()],
                slotCount: 2,
            })).toThrow();
        });
    });
});
