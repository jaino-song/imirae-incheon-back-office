import type {
    HeadlessProgressState,
    HeadlessProgressStep,
    HeadlessProgressStepKey,
} from "@babyjamjam/shared/types/eformsign";

export type {
    HeadlessProgressEvent,
    HeadlessProgressState,
    HeadlessProgressStep,
    HeadlessProgressStepKey,
} from "@babyjamjam/shared/types/eformsign";

export const CONTRACT_CREATION_PROGRESS_STEPS: readonly HeadlessProgressStep[] = [
    { key: "client-started", label: "전자문서 클라이언트 시작", errorLabel: "전자문서 클라이언트 시작 실패" },
    { key: "info-inserted", label: "이용자 정보 입력 완료", errorLabel: "이용자 정보 입력 실패" },
    { key: "creating", label: "전자문서 생성 중", errorLabel: "전자문서 생성 실패" },
    { key: "sent", label: "전자문서 전송 완료", errorLabel: "전자문서 전송 실패" },
];

export const CONTRACT_FINALIZE_PROGRESS_STEPS: readonly HeadlessProgressStep[] = [
    { key: "client-started", label: "전자문서 클라이언트 시작", errorLabel: "전자문서 클라이언트 시작 실패" },
    { key: "info-inserted", label: "서비스 종료일 적용중", errorLabel: "서비스 종료일 적용 실패" },
    { key: "creating", label: "전자문서 최종 확인중", errorLabel: "전자문서 최종 확인 실패" },
    { key: "sent", label: "전자문서 처리 완료", errorLabel: "전자문서 처리 실패" },
];

export const SERVICE_RECORD_FINALIZE_PROGRESS_STEPS: readonly HeadlessProgressStep[] =
    CONTRACT_FINALIZE_PROGRESS_STEPS.filter((step) => step.key !== "info-inserted");

export const INITIAL_HEADLESS_PROGRESS: HeadlessProgressState = {
    step: null,
    completed: false,
    failed: false,
};

export function createHeadlessProgressId(prefix = "headless"): string {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
        return crypto.randomUUID();
    }
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function isHeadlessProgressStepKey(
    value: string,
    steps: readonly HeadlessProgressStep[],
): value is HeadlessProgressStepKey {
    return steps.some((item) => item.key === value);
}

function getHeadlessProgressStepRank(
    step: HeadlessProgressStepKey | null | undefined,
    steps: readonly HeadlessProgressStep[],
): number {
    if (!step) return -1;
    return steps.findIndex((item) => item.key === step);
}

export function resolveNextHeadlessProgress(
    current: HeadlessProgressState,
    nextStep: HeadlessProgressStepKey,
    steps: readonly HeadlessProgressStep[],
): HeadlessProgressState {
    if (current.failed || current.completed) {
        return current;
    }

    const currentRank = getHeadlessProgressStepRank(current.step, steps);
    const nextRank = getHeadlessProgressStepRank(nextStep, steps);
    if (nextRank < 0 || nextRank <= currentRank) {
        return current;
    }

    return {
        step: nextStep,
        completed: nextStep === "sent",
        failed: false,
    };
}

export function resolveFailedHeadlessProgress(
    current: HeadlessProgressState,
    failedStep: string | undefined,
    steps: readonly HeadlessProgressStep[],
): HeadlessProgressState {
    if (current.failed || current.completed) {
        return current;
    }

    const step = failedStep && isHeadlessProgressStepKey(failedStep, steps)
        ? failedStep
        : current.step ?? "client-started";

    return {
        step,
        completed: false,
        failed: true,
    };
}

export function getSafeHeadlessFailureMessage(reason: string | undefined): string {
    if (!reason) return "백엔드 자동 처리에 실패했어요. 잠시 후 다시 시도해 주세요";
    if (/timed out|timeout/i.test(reason)) return "백엔드 자동 처리 시간이 초과됐어요";
    if (/chromium|browser|executable/i.test(reason)) return "백엔드 브라우저를 실행하지 못했어요";
    if (/missing document_id/i.test(reason)) return "전자문서 전송 응답에서 문서 ID를 받지 못했어요";
    return "백엔드 자동 처리에 실패했어요";
}
