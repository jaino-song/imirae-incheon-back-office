import {
    CONTRACT_CREATION_PROGRESS_STEPS,
    INITIAL_HEADLESS_PROGRESS,
    SERVICE_RECORD_FINALIZE_PROGRESS_STEPS,
    resolveFailedHeadlessProgress,
    resolveNextHeadlessProgress,
    shouldOpenFinalizeIframe,
} from "../headless-progress";

describe("headless progress transitions", () => {
    it("omits the service end-date step for service-record finalization", () => {
        expect(SERVICE_RECORD_FINALIZE_PROGRESS_STEPS.map((step) => step.key)).toEqual([
            "client-started",
            "creating",
            "sent",
        ]);
    });

    it("advances steps monotonically", () => {
        const current = {
            step: "info-inserted" as const,
            completed: false,
            failed: false,
        };

        expect(resolveNextHeadlessProgress(
            current,
            "creating",
            CONTRACT_CREATION_PROGRESS_STEPS,
        )).toEqual({
            step: "creating",
            completed: false,
            failed: false,
        });
    });

    it("ignores duplicate or older steps", () => {
        const current = {
            step: "creating" as const,
            completed: false,
            failed: false,
        };

        expect(resolveNextHeadlessProgress(
            current,
            "creating",
            CONTRACT_CREATION_PROGRESS_STEPS,
        )).toBe(current);
        expect(resolveNextHeadlessProgress(
            current,
            "info-inserted",
            CONTRACT_CREATION_PROGRESS_STEPS,
        )).toBe(current);
    });

    it("does not regress completed progress", () => {
        const current = {
            step: "sent" as const,
            completed: true,
            failed: false,
        };

        expect(resolveNextHeadlessProgress(
            current,
            "creating",
            CONTRACT_CREATION_PROGRESS_STEPS,
        )).toBe(current);
        expect(resolveFailedHeadlessProgress(
            current,
            "creating",
            CONTRACT_CREATION_PROGRESS_STEPS,
        )).toBe(current);
    });

    it("does not overwrite failed progress", () => {
        const current = {
            step: "creating" as const,
            completed: false,
            failed: true,
        };

        expect(resolveNextHeadlessProgress(
            current,
            "sent",
            CONTRACT_CREATION_PROGRESS_STEPS,
        )).toBe(current);
        expect(resolveFailedHeadlessProgress(
            current,
            "info-inserted",
            CONTRACT_CREATION_PROGRESS_STEPS,
        )).toBe(current);
    });

    it("uses a safe failure fallback step", () => {
        expect(resolveFailedHeadlessProgress(
            INITIAL_HEADLESS_PROGRESS,
            undefined,
            CONTRACT_CREATION_PROGRESS_STEPS,
        )).toEqual({
            step: "client-started",
            completed: false,
            failed: true,
        });
    });

    it("opens the finalize iframe only for an explicit safe backend verdict", () => {
        expect(shouldOpenFinalizeIframe("iframe", false)).toBe(true);
        expect(shouldOpenFinalizeIframe("manual_check", false)).toBe(false);
        expect(shouldOpenFinalizeIframe(undefined, false)).toBe(false);
        expect(shouldOpenFinalizeIframe("iframe", true)).toBe(false);
    });
});
