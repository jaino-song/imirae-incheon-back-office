// 한국 공휴일 (대체공휴일/선거일 포함). 발급 가능 연도 기준 2026~2027 hardcode — 매년 갱신 필요.
// 출처: 공공데이터포털 특일정보 / 중앙선거관리위원회 / 인사혁신처 공고. 음력 기반 명절은 다음 양력 변환:
// - 설날 2026: 2/16(월),17(화),18(수); 2027: 2/6(토),7(일),8(월) + 대체 2/9(화)
// - 추석 2026: 9/24(목),25(금),26(토) + 대체 9/28(월); 2027: 9/14(화),15(수),16(목)
// - 부처님오신날 2026: 5/24(일) + 대체 5/25(월); 2027: 5/13(목)
export const KR_HOLIDAYS = new Set<string>([
    // 2026
    "2026-01-01", // 신정
    "2026-02-16", "2026-02-17", "2026-02-18", // 설날
    "2026-03-01", // 삼일절
    "2026-03-02", // 삼일절 대체 (일요일)
    "2026-05-01", // 노동절
    "2026-05-05", // 어린이날
    "2026-05-24", "2026-05-25", // 부처님오신날 + 대체
    "2026-06-03", // 제9회 전국동시지방선거
    "2026-06-06", // 현충일
    "2026-07-17", // 제헌절
    "2026-08-15", // 광복절
    "2026-08-17", // 광복절 대체 (토요일)
    "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-28", // 추석 + 대체
    "2026-10-03", "2026-10-05", // 개천절 + 대체 (토요일)
    "2026-10-09", // 한글날
    "2026-12-25", // 크리스마스
    // 2027
    "2027-01-01", // 신정
    "2027-02-06", "2027-02-07", "2027-02-08", "2027-02-09", // 설날 + 대체
    "2027-03-01", // 삼일절
    "2027-05-01", // 노동절
    "2027-05-05", // 어린이날
    "2027-05-13", // 부처님오신날
    "2027-06-06", "2027-06-07", // 현충일 + 대체 (일요일)
    "2027-07-17", // 제헌절
    "2027-08-15", "2027-08-16", // 광복절 + 대체 (일요일)
    "2027-09-14", "2027-09-15", "2027-09-16", // 추석
    "2027-10-03", "2027-10-04", // 개천절 + 대체 (일요일)
    "2027-10-09", // 한글날
    "2027-12-25",
]);

const NEXT_BUSINESS_DAY_SEARCH_LIMIT = 30;
const KOREA_DATE_FORMATTER = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
});

function parseIsoDate(iso: string): Date | null {
    const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function isoFromUtcDate(date: Date): string {
    return date.toISOString().slice(0, 10);
}

export function isBusinessDayKr(iso: string): boolean {
    if (!iso) return false;
    const d = new Date(iso + "T00:00:00Z");
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) return false;
    return !KR_HOLIDAYS.has(iso);
}

export function nextBusinessDayKr(iso: string): string {
    const cursor = new Date(iso + "T00:00:00.000Z");

    for (let i = 0; i < NEXT_BUSINESS_DAY_SEARCH_LIMIT; i += 1) {
        cursor.setUTCDate(cursor.getUTCDate() + 1);
        const cursorIso = cursor.toISOString().slice(0, 10);
        if (isBusinessDayKr(cursorIso)) return cursorIso;
    }

    throw new Error(
        `Unable to find next Korean business day within ${NEXT_BUSINESS_DAY_SEARCH_LIMIT} days after ${iso}`,
    );
}

export function addBusinessDaysKr(iso: string, n: number): string {
    if (n <= 0) return iso;

    let cursor = iso;
    for (let i = 0; i < n; i += 1) {
        cursor = nextBusinessDayKr(cursor);
    }

    return cursor;
}

export function isoDateInKorea(date = new Date()): string {
    const parts = KOREA_DATE_FORMATTER.formatToParts(date);
    const year = parts.find((part) => part.type === "year")?.value ?? "";
    const month = parts.find((part) => part.type === "month")?.value ?? "";
    const day = parts.find((part) => part.type === "day")?.value ?? "";
    return `${year}-${month}-${day}`;
}

export function diffBusinessDaysKr(targetISO: string, baseISO = isoDateInKorea()): number | null {
    const target = parseIsoDate(targetISO);
    const base = parseIsoDate(baseISO);
    if (!target || !base) return null;

    const targetTime = target.getTime();
    const baseTime = base.getTime();
    if (targetTime === baseTime) return 0;

    const cursor = new Date(base);
    let count = 0;

    if (targetTime > baseTime) {
        while (cursor.getTime() < targetTime) {
            cursor.setUTCDate(cursor.getUTCDate() + 1);
            if (isBusinessDayKr(isoFromUtcDate(cursor))) count += 1;
        }
        return count;
    }

    while (cursor.getTime() > targetTime) {
        if (isBusinessDayKr(isoFromUtcDate(cursor))) count += 1;
        cursor.setUTCDate(cursor.getUTCDate() - 1);
    }
    return -count;
}

export function countBusinessDaysKr(startISO: string, endISO: string): number | null {
    const start = parseIsoDate(startISO);
    const end = parseIsoDate(endISO);
    if (!start || !end || start.getTime() > end.getTime()) return null;

    const cursor = new Date(start);
    let count = 0;
    while (cursor.getTime() <= end.getTime()) {
        if (isBusinessDayKr(isoFromUtcDate(cursor))) count += 1;
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return count;
}
