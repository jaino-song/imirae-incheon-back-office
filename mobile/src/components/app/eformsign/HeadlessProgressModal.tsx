"use client";

import type {
    HeadlessProgressState,
    HeadlessProgressStep,
} from "@/lib/eformsign/headless-progress";
import { cn } from "@/lib/utils";

import styles from "./HeadlessProgressModal.module.css";

interface HeadlessProgressModalProps {
    open: boolean;
    title?: string;
    subtitle?: string;
    steps: readonly HeadlessProgressStep[];
    progress: HeadlessProgressState;
    errorHint?: string | null;
    dataComponentPrefix?: string;
}

export function HeadlessProgressModal({
    open,
    title = "전자문서 처리 중",
    subtitle,
    steps,
    progress,
    errorHint,
    dataComponentPrefix,
}: HeadlessProgressModalProps) {
    if (!open) return null;

    const legacyBase = "headless-progress";
    const rootDataComponent = dataComponentPrefix
        ? `${dataComponentPrefix}_root`
        : `${legacyBase}-modal`;
    const sub = (suffix: string) =>
        dataComponentPrefix ? `${dataComponentPrefix}_${suffix}` : `${legacyBase}-${suffix}`;
    const currentIdx = progress.step
        ? steps.findIndex((s) => s.key === progress.step)
        : -1;

    const defaultSub = progress.failed
        ? "처리에 실패했습니다. 잠시 후 수동 입력 화면으로 전환됩니다."
        : progress.completed
            ? "완료되었습니다."
            : null;
    const progressSubtitle = subtitle ?? defaultSub;

    return (
        <div
            className={styles.progressModal}
            data-component={rootDataComponent}
            data-source-component="HeadlessProgressModal"
        >
            <div className={styles.progressCard} data-component={sub("card")}>
                <h2 className={styles.progressTitle} data-component={sub("title")}>{title}</h2>
                {progressSubtitle ? (
                    <p className={styles.progressSub} data-component={sub("subtitle")}>
                        {progressSubtitle}
                    </p>
                ) : null}
                <div className={styles.progressList} data-component={sub("list")}>
                    {steps.map((step, idx) => {
                        const isFailedHere = progress.failed && currentIdx === idx;
                        const isActive = !progress.failed && !progress.completed && currentIdx === idx;
                        const isDone =
                            (progress.completed && idx <= currentIdx) ||
                            (!progress.failed && currentIdx > idx);
                        const rowClass = isFailedHere
                            ? styles.failed
                            : isDone
                                ? styles.done
                                : isActive
                                    ? styles.active
                                    : "";
                        return (
                            <div
                                key={step.key}
                                className={cn(styles.progressRow, rowClass)}
                                data-component={sub(`step-${step.key}`)}
                            >
                                <div
                                    className={styles.progressIndicator}
                                    data-component={sub(`step-${step.key}-indicator`)}
                                >
                                    {isDone ? (
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                                            <polyline points="20 6 9 17 4 12" />
                                        </svg>
                                    ) : isFailedHere ? (
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                                            <line x1="18" y1="6" x2="6" y2="18" />
                                            <line x1="6" y1="6" x2="18" y2="18" />
                                        </svg>
                                    ) : null}
                                </div>
                                <span data-component={sub(`step-${step.key}-label`)}>
                                    {isFailedHere ? step.errorLabel : step.label}
                                </span>
                            </div>
                        );
                    })}
                </div>
                {errorHint ? (
                    <div className={styles.progressErrorHint} data-component={sub("error-hint")}>
                        {errorHint}
                    </div>
                ) : null}
            </div>
        </div>
    );
}
