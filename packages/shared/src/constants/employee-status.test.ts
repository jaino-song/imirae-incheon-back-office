import {
    EMPLOYEE_STATUS_LABELS,
    deriveEmployeeStatus,
    getOpenToNextWorkLabel,
    OPEN_TO_NEXT_WORK_LABELS,
} from "./employee-status";

describe("EMPLOYEE_STATUS_LABELS", () => {
    it("uses the mobile-canonical, space-included label for 'working' (M6 drift fix)", () => {
        expect(EMPLOYEE_STATUS_LABELS.working).toBe("근무 중");
        expect(EMPLOYEE_STATUS_LABELS.working).not.toBe("근무중");
    });

    it("has all three employee status labels", () => {
        expect(EMPLOYEE_STATUS_LABELS).toEqual({
            available: "배정 가능",
            working: "근무 중",
            unavailable: "배정 불가",
        });
    });
});

describe("OPEN_TO_NEXT_WORK_LABELS / getOpenToNextWorkLabel", () => {
    it("maps true/false to the assignment-availability labels", () => {
        expect(OPEN_TO_NEXT_WORK_LABELS.true).toBe("배정 가능");
        expect(OPEN_TO_NEXT_WORK_LABELS.false).toBe("배정 불가");
    });

    it("resolves a boolean to its label via the getter", () => {
        expect(getOpenToNextWorkLabel(true)).toBe("배정 가능");
        expect(getOpenToNextWorkLabel(false)).toBe("배정 불가");
    });
});

describe("deriveEmployeeStatus", () => {
    it.each([
        [true, true, "working"],
        [true, false, "working"],
        [false, true, "available"],
        [false, false, "unavailable"],
    ] as const)(
        "derives status from active assignment before availability",
        (hasActiveAssignment, openToNextWork, expected) => {
            expect(deriveEmployeeStatus(hasActiveAssignment, openToNextWork)).toBe(expected);
        },
    );
});
