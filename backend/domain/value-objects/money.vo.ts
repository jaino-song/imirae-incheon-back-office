/**
 * Money Value Object
 * 금액을 관리하는 값 객체
 *
 * DB에 문자열로 저장되므로 문자열 ↔ 숫자 변환을 안전하게 처리
 * 통화 계산 시 정밀도 문제 방지
 */

/**
 * Accepted Korean-won input grammar for client pricing fields.
 *
 * The boundary accepts plain digits or correctly grouped thousands separators,
 * with an optional terminal `원`. It intentionally does not accept decimals,
 * signs, exponents, or any trailing text. Persistence always uses an ungrouped
 * canonical decimal string (for example, `1,000원` → `1000`).
 */
export const KOREAN_WON_INPUT_PATTERN = /^(?:\d+|\d{1,3}(?:,\d{3})+)(?:원)?$/u;

export function normalizeKoreanWon(value: string | null | undefined): string | null {
    if (value === null || value === undefined) return null;

    const trimmed = value.trim();
    if (!KOREAN_WON_INPUT_PATTERN.test(trimmed)) {
        throw new Error("Invalid Korean won amount");
    }

    const digits = trimmed.replace(/원$/u, "").replace(/,/g, "");
    // BigInt avoids silently rounding a large persisted amount through Number.
    return BigInt(digits).toString();
}

export function assertCanonicalKoreanWon(value: string | null | undefined): string | null {
    const normalized = normalizeKoreanWon(value);
    if (normalized !== value && value !== null && value !== undefined) {
        throw new Error("Client pricing must use canonical Korean won representation");
    }
    return normalized;
}

export class Money {
    private readonly amount: number;

    private constructor(amount: number) {
        this.amount = amount;
    }

    /**
     * 문자열 또는 숫자에서 Money 생성
     * @param value 금액 (문자열 또는 숫자)
     * @returns Money 인스턴스 또는 null (유효하지 않은 경우)
     */
    static create(value: string | number | null | undefined): Money | null {
        if (value === null || value === undefined) return null;

        let numValue: number;

        if (typeof value === 'string') {
            // 쉼표 및 공백 제거
            const cleaned = value.replace(/[,\s원]/g, '');
            if (cleaned === '') return null;

            numValue = Number(cleaned);
        } else {
            numValue = value;
        }

        if (!Number.isFinite(numValue)) {
            return null;
        }

        return new Money(numValue);
    }

    /**
     * Money 생성. 유효하지 않으면 예외를 던집니다.
     * @param value 금액
     * @throws Error 유효하지 않은 금액인 경우
     */
    static createOrThrow(value: string | number): Money {
        const money = Money.create(value);
        if (!money) {
            throw new Error(`Invalid money value: ${value}`);
        }
        return money;
    }

    /**
     * 0원 생성
     */
    static zero(): Money {
        return new Money(0);
    }

    /**
     * 숫자 값 반환
     */
    toNumber(): number {
        return this.amount;
    }

    /**
     * DB 저장용 문자열 반환 (쉼표 없음)
     */
    toString(): string {
        return String(this.amount);
    }

    /**
     * 화면 표시용 포맷 (쉼표 포함)
     * @param includeWon 원 단위 포함 여부
     */
    toFormattedString(includeWon: boolean = false): string {
        const formatted = this.amount.toLocaleString('ko-KR');
        return includeWon ? `${formatted}원` : formatted;
    }

    /**
     * 덧셈
     */
    add(other: Money): Money {
        return new Money(this.amount + other.amount);
    }

    /**
     * 뺄셈
     */
    subtract(other: Money): Money {
        return new Money(this.amount - other.amount);
    }

    /**
     * 곱셈
     */
    multiply(factor: number): Money {
        return new Money(Math.round(this.amount * factor));
    }

    /**
     * 음수 여부
     */
    isNegative(): boolean {
        return this.amount < 0;
    }

    /**
     * 0 여부
     */
    isZero(): boolean {
        return this.amount === 0;
    }

    /**
     * 양수 여부
     */
    isPositive(): boolean {
        return this.amount > 0;
    }

    /**
     * 값 동등성 비교
     */
    equals(other: Money | null | undefined): boolean {
        if (!other) return false;
        return this.amount === other.amount;
    }

    /**
     * 크기 비교
     */
    isGreaterThan(other: Money): boolean {
        return this.amount > other.amount;
    }

    isLessThan(other: Money): boolean {
        return this.amount < other.amount;
    }

    isGreaterThanOrEqual(other: Money): boolean {
        return this.amount >= other.amount;
    }

    isLessThanOrEqual(other: Money): boolean {
        return this.amount <= other.amount;
    }
}
