/**
 * Unit tests for ServiceStatus value object
 * Tests status computation based on dates and manual status preservation
 */

import {
    SERVICE_STATUS,
    computeServiceStatus,
    isAutomaticServiceStatusTransitionAllowed,
    shouldUpdateStatus,
    isManualStatus,
} from "domain/value-objects/service-status.vo";

describe("SERVICE_STATUS constants", () => {
    it("should have all expected status values", () => {
        expect(SERVICE_STATUS.PRE_BOOKING).toBe("pre_booking");
        expect(SERVICE_STATUS.WAITING).toBe("waiting");
        expect(SERVICE_STATUS.ACTIVE).toBe("active");
        expect(SERVICE_STATUS.COMPLETED).toBe("completed");
        expect(SERVICE_STATUS.TERMINATED).toBe("terminated");
        expect(SERVICE_STATUS.REPLACEMENT_REQUESTED).toBe("replacement_requested");
    });
});

describe("computeServiceStatus", () => {
    // Helper to create dates relative to today
    const daysFromNow = (days: number): Date => {
        const date = new Date();
        date.setDate(date.getDate() + days);
        return date;
    };

    describe("given manual statuses", () => {
        it("should preserve pre-booking status without service dates", () => {
            const result = computeServiceStatus("pre_booking", null, null);

            expect(result).toBe(SERVICE_STATUS.PRE_BOOKING);
        });

        it("should preserve terminated status", () => {
            const pastStart = daysFromNow(-30);
            const pastEnd = daysFromNow(-10);
            // Even though dates indicate completed, terminated should be preserved
            const result = computeServiceStatus("terminated", pastStart, pastEnd);
            expect(result).toBe(SERVICE_STATUS.TERMINATED);
        });

        it("should preserve replacement_requested status", () => {
            const pastStart = daysFromNow(-10);
            const futureEnd = daysFromNow(20);
            // Even though dates indicate active, replacement_requested should be preserved
            const result = computeServiceStatus("replacement_requested", pastStart, futureEnd);
            expect(result).toBe(SERVICE_STATUS.REPLACEMENT_REQUESTED);
        });
    });

    describe("given date-based computation", () => {
        it("should return waiting when start date is in the future", () => {
            const futureStart = daysFromNow(10);
            const futureEnd = daysFromNow(40);
            const result = computeServiceStatus(null, futureStart, futureEnd);
            expect(result).toBe(SERVICE_STATUS.WAITING);
        });

        it("should return waiting when current status is null and start date is tomorrow", () => {
            const tomorrow = daysFromNow(1);
            const futureEnd = daysFromNow(30);
            const result = computeServiceStatus(null, tomorrow, futureEnd);
            expect(result).toBe(SERVICE_STATUS.WAITING);
        });

        it("should return active when today is between start and end dates", () => {
            const pastStart = daysFromNow(-10);
            const futureEnd = daysFromNow(20);
            const result = computeServiceStatus(null, pastStart, futureEnd);
            expect(result).toBe(SERVICE_STATUS.ACTIVE);
        });

        it("should return active when today equals start date", () => {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const futureEnd = daysFromNow(30);
            const result = computeServiceStatus("waiting", today, futureEnd);
            expect(result).toBe(SERVICE_STATUS.ACTIVE);
        });

        it("should return active when today equals end date", () => {
            const pastStart = daysFromNow(-30);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const result = computeServiceStatus("active", pastStart, today);
            expect(result).toBe(SERVICE_STATUS.ACTIVE);
        });

        it("should return completed when end date has passed", () => {
            const pastStart = daysFromNow(-30);
            const pastEnd = daysFromNow(-1);
            const result = computeServiceStatus("active", pastStart, pastEnd);
            expect(result).toBe(SERVICE_STATUS.COMPLETED);
        });

        it("should return completed when end date was yesterday", () => {
            const pastStart = daysFromNow(-30);
            const yesterday = daysFromNow(-1);
            const result = computeServiceStatus(null, pastStart, yesterday);
            expect(result).toBe(SERVICE_STATUS.COMPLETED);
        });
    });

    describe("given null dates", () => {
        it("should return pre-booking when start date is null", () => {
            const result = computeServiceStatus(null, null, daysFromNow(30));
            expect(result).toBe(SERVICE_STATUS.PRE_BOOKING);
        });

        it("should return pre-booking when end date is null", () => {
            const result = computeServiceStatus(null, daysFromNow(-10), null);
            expect(result).toBe(SERVICE_STATUS.PRE_BOOKING);
        });

        it("should return pre-booking when both dates are null", () => {
            const result = computeServiceStatus(null, null, null);
            expect(result).toBe(SERVICE_STATUS.PRE_BOOKING);
        });

        it("should return pre-booking when dates are null even with existing status", () => {
            const result = computeServiceStatus("active", null, null);
            expect(result).toBe(SERVICE_STATUS.PRE_BOOKING);
        });
    });

    describe("given edge cases with time zones", () => {
        it("should use date-only comparison (ignoring time)", () => {
            // Create dates with specific times
            const startDate = new Date();
            startDate.setHours(23, 59, 59, 999);
            startDate.setDate(startDate.getDate() - 1);

            const endDate = new Date();
            endDate.setHours(0, 0, 0, 0);
            endDate.setDate(endDate.getDate() + 1);

            const result = computeServiceStatus(null, startDate, endDate);
            expect(result).toBe(SERVICE_STATUS.ACTIVE);
        });
    });

    describe("given override of waiting status", () => {
        it("should update waiting to active when dates indicate active", () => {
            const pastStart = daysFromNow(-5);
            const futureEnd = daysFromNow(25);
            const result = computeServiceStatus("waiting", pastStart, futureEnd);
            expect(result).toBe(SERVICE_STATUS.ACTIVE);
        });

        it("should update waiting to completed when dates indicate completed", () => {
            const pastStart = daysFromNow(-30);
            const pastEnd = daysFromNow(-5);
            const result = computeServiceStatus("waiting", pastStart, pastEnd);
            expect(result).toBe(SERVICE_STATUS.COMPLETED);
        });
    });

    describe("given override of active status", () => {
        it("should update active to completed when end date has passed", () => {
            const pastStart = daysFromNow(-30);
            const pastEnd = daysFromNow(-5);
            const result = computeServiceStatus("active", pastStart, pastEnd);
            expect(result).toBe(SERVICE_STATUS.COMPLETED);
        });

        it("should keep active status when still within date range", () => {
            const pastStart = daysFromNow(-10);
            const futureEnd = daysFromNow(20);
            const result = computeServiceStatus("active", pastStart, futureEnd);
            expect(result).toBe(SERVICE_STATUS.ACTIVE);
        });
    });
});

describe("shouldUpdateStatus", () => {
    it("should return false for terminated status", () => {
        expect(shouldUpdateStatus("terminated", SERVICE_STATUS.ACTIVE)).toBe(false);
        expect(shouldUpdateStatus("terminated", SERVICE_STATUS.COMPLETED)).toBe(false);
    });

    it("should return false for replacement_requested status", () => {
        expect(shouldUpdateStatus("replacement_requested", SERVICE_STATUS.ACTIVE)).toBe(false);
        expect(shouldUpdateStatus("replacement_requested", SERVICE_STATUS.COMPLETED)).toBe(false);
    });

    it("should return true when status differs", () => {
        expect(shouldUpdateStatus("waiting", SERVICE_STATUS.ACTIVE)).toBe(true);
        expect(shouldUpdateStatus("active", SERVICE_STATUS.COMPLETED)).toBe(true);
        expect(shouldUpdateStatus(null, SERVICE_STATUS.ACTIVE)).toBe(true);
    });

    it("should return false when status is the same", () => {
        expect(shouldUpdateStatus("waiting", SERVICE_STATUS.WAITING)).toBe(false);
        expect(shouldUpdateStatus("active", SERVICE_STATUS.ACTIVE)).toBe(false);
        expect(shouldUpdateStatus("completed", SERVICE_STATUS.COMPLETED)).toBe(false);
    });
});

describe("isAutomaticServiceStatusTransitionAllowed", () => {
    it("allows an observed non-terminal status to move to a date-derived status", () => {
        expect(isAutomaticServiceStatusTransitionAllowed("waiting", SERVICE_STATUS.ACTIVE)).toBe(true);
        expect(isAutomaticServiceStatusTransitionAllowed(null, SERVICE_STATUS.PRE_BOOKING)).toBe(true);
    });

    it.each(["pre_booking", "terminated", "replacement_requested"])(
        "blocks date-derived movement from manual %s",
        (currentStatus) => {
            expect(isAutomaticServiceStatusTransitionAllowed(currentStatus, SERVICE_STATUS.ACTIVE)).toBe(false);
        },
    );

    it("blocks a manual target even when the observed status is automatic", () => {
        expect(isAutomaticServiceStatusTransitionAllowed("waiting", SERVICE_STATUS.TERMINATED)).toBe(false);
    });
});

describe("isManualStatus", () => {
    it("should return true for pre-booking", () => {
        expect(isManualStatus("pre_booking")).toBe(true);
    });

    it("should return true for terminated", () => {
        expect(isManualStatus("terminated")).toBe(true);
    });

    it("should return true for replacement_requested", () => {
        expect(isManualStatus("replacement_requested")).toBe(true);
    });

    it("should return false for auto-computed statuses", () => {
        expect(isManualStatus("waiting")).toBe(false);
        expect(isManualStatus("active")).toBe(false);
        expect(isManualStatus("completed")).toBe(false);
    });

    it("should return false for null", () => {
        expect(isManualStatus(null)).toBe(false);
    });

    it("should return false for unknown statuses", () => {
        expect(isManualStatus("unknown")).toBe(false);
        expect(isManualStatus("invalid")).toBe(false);
    });
});
