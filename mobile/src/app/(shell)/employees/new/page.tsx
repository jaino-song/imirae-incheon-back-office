"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, ChevronLeft, X } from "lucide-react";

import { formatWorkAreaLabel, GRADES, WORK_AREAS } from "@/components/app/employees/employee-form.constants";
import { useCreateEmployee } from "@/hooks/useEmployees";
import { useNavigationPending } from "@/hooks/use-navigation-pending";
import { api } from "@/lib/api/client";
import { getErrorMessage } from "@/lib/errors/api-error-mapper";
import { t } from "@/lib/i18n/translations";
import { cn } from "@/lib/utils";
import { useLocale } from "@/providers/LocaleProvider";
import { useEmployeeDialogStore } from "@/stores/employee-dialog-store";
import { useEmployeeWizardStore } from "@/stores/employee-wizard-store";

import styles from "./page.module.css";

const PHONE_DUPLICATE_CHECK_MAX_RETRIES = 3;
const PHONE_DUPLICATE_CHECK_RETRY_DELAY_MS = 1000;
const TOTAL_STEPS = 2;

const GRADE_STARS: Record<string, string> = {
  "프리미엄": "★★★",
  "베스트": "★★",
  "스탠다드": "★",
};

const WORK_AREA_DISPLAY_ORDER = [
  "인천 부평구",
  "인천 계양구",
  "인천 연수구",
  "인천 남동구",
  "인천 미추홀구",
  "인천 서구",
  "인천 중구",
  "인천 동구",
] as const;

const ORDERED_WORK_AREAS = WORK_AREA_DISPLAY_ORDER.filter((area) =>
  (WORK_AREAS as readonly string[]).includes(area)
);

function formatPhoneNumber(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length <= 3) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7, 11)}`;
}

const getPhoneDuplicateCheckFailedMessage = (locale: "ko" | "en"): string =>
  locale === "ko"
    ? "문제가 발생했어요. 새로고침 해주세요."
    : "Something went wrong. Please refresh and try again.";

const getPhoneDuplicateCheckPendingMessage = (locale: "ko" | "en"): string =>
  locale === "ko"
    ? "연락처 중복 확인 중입니다. 잠시만 기다려주세요."
    : "Checking for duplicate phone number. Please wait.";

function sanitizeReturnTo(path: string | null): string | null {
  if (!path) return null;
  if (!path.startsWith("/") || path.startsWith("//")) return null;
  return path;
}

function buildReturnUrl(basePath: string, params: Record<string, string | null>) {
  const [pathname, queryString] = basePath.split("?", 2);
  const nextParams = new URLSearchParams(queryString ?? "");

  Object.entries(params).forEach(([key, value]) => {
    if (value) {
      nextParams.set(key, value);
    }
  });

  const query = nextParams.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export default function NewEmployeePage() {
  const router = useRouter();
  const { isNavigationPending, startNavigation } = useNavigationPending();
  const searchParams = useSearchParams();
  const locale = useLocale();
  const createEmployee = useCreateEmployee();
  const prefillName = useEmployeeDialogStore((state) => state.prefillName);
  const clearPrefillName = useEmployeeDialogStore((state) => state.clearPrefillName);
  const store = useEmployeeWizardStore();
  const { currentStep, setField, setCurrentStep, reset } = store;

  const [error, setError] = useState<string | null>(null);
  const [isCheckingPhoneDuplicate, setIsCheckingPhoneDuplicate] = useState(false);
  const [isPhoneDuplicate, setIsPhoneDuplicate] = useState(false);
  const [hasPhoneDuplicateCheckFailed, setHasPhoneDuplicateCheckFailed] = useState(false);
  const [lastCheckedPhoneDigits, setLastCheckedPhoneDigits] = useState<string | null>(null);

  const phoneDigits = useMemo(() => store.phone.replace(/\D/g, ""), [store.phone]);
  const showPhoneValidationError =
    phoneDigits.length === 11 && (isPhoneDuplicate || hasPhoneDuplicateCheckFailed);
  const phoneInlineMessage = phoneDigits.length === 11
    ? hasPhoneDuplicateCheckFailed
      ? getPhoneDuplicateCheckFailedMessage(locale)
      : isPhoneDuplicate
        ? t(locale, "employees.form.error-phone-duplicate")
        : null
    : null;
  const phoneHelperTone = hasPhoneDuplicateCheckFailed || isPhoneDuplicate
    ? "err"
    : isCheckingPhoneDuplicate
      ? "pending"
      : phoneDigits.length === 11 && lastCheckedPhoneDigits === phoneDigits
        ? "ok"
        : "default";
  const phoneHelperMessage = isCheckingPhoneDuplicate
    ? getPhoneDuplicateCheckPendingMessage(locale)
    : phoneInlineMessage
      ? phoneInlineMessage
      : phoneDigits.length === 11 && lastCheckedPhoneDigits === phoneDigits
        ? "등록 가능한 번호입니다."
        : null;

  const returnTo = useMemo(
    () => sanitizeReturnTo(searchParams.get("returnTo")),
    [searchParams]
  );
  const target = searchParams.get("target");

  useEffect(() => {
    if (prefillName && !store.name) {
      setField("name", prefillName);
      clearPrefillName();
    }
  }, [clearPrefillName, prefillName, setField, store.name]);

  useEffect(() => {
    if (phoneDigits.length !== 11) {
      return;
    }

    const abortController = new AbortController();

    const waitForRetryDelay = () =>
      new Promise<void>((resolve) => {
        const finish = () => {
          abortController.signal.removeEventListener("abort", handleAbort);
          resolve();
        };

        const timeoutId = setTimeout(finish, PHONE_DUPLICATE_CHECK_RETRY_DELAY_MS);

        const handleAbort = () => {
          clearTimeout(timeoutId);
          finish();
        };

        if (abortController.signal.aborted) {
          handleAbort();
          return;
        }

        abortController.signal.addEventListener("abort", handleAbort, { once: true });
      });

    const checkPhoneDuplicate = async () => {
      setIsCheckingPhoneDuplicate(true);
      setIsPhoneDuplicate(false);
      setHasPhoneDuplicateCheckFailed(false);
      setLastCheckedPhoneDigits(null);

      let attempt = 0;

      while (!abortController.signal.aborted && attempt <= PHONE_DUPLICATE_CHECK_MAX_RETRIES) {
        try {
          const response = await api.get("/employees/check-phone", {
            params: { phone: phoneDigits },
            signal: abortController.signal,
          });

          if (!abortController.signal.aborted) {
            setIsPhoneDuplicate(response.data?.exists === true);
            setHasPhoneDuplicateCheckFailed(false);
            setLastCheckedPhoneDigits(phoneDigits);
          }
          return;
        } catch {
          if (abortController.signal.aborted) {
            return;
          }

          attempt += 1;
          if (attempt > PHONE_DUPLICATE_CHECK_MAX_RETRIES) {
            setIsPhoneDuplicate(false);
            setHasPhoneDuplicateCheckFailed(true);
            return;
          }

          await waitForRetryDelay();
        }
      }
    };

    void checkPhoneDuplicate().finally(() => {
      if (!abortController.signal.aborted) {
        setIsCheckingPhoneDuplicate(false);
      }
    });

    return () => {
      abortController.abort();
      setIsCheckingPhoneDuplicate(false);
    };
  }, [phoneDigits]);

  const validateStep = (step: number): boolean => {
    switch (step) {
      case 0:
        if (!store.name.trim()) {
          setError(
            locale === "ko"
              ? `${t(locale, "employees.form.name")}을 입력해주세요.`
              : `Please enter ${t(locale, "employees.form.name").toLowerCase()}.`
          );
          return false;
        }
        if (!store.phone.trim()) {
          setError(t(locale, "employees.form.phone-required"));
          return false;
        }
        if (phoneDigits.length !== 11) {
          setError(t(locale, "employees.form.phone-required"));
          return false;
        }
        if (isCheckingPhoneDuplicate || lastCheckedPhoneDigits !== phoneDigits) {
          setError(getPhoneDuplicateCheckPendingMessage(locale));
          return false;
        }
        if (hasPhoneDuplicateCheckFailed) {
          setError(getPhoneDuplicateCheckFailedMessage(locale));
          return false;
        }
        if (isPhoneDuplicate) {
          setError(t(locale, "employees.form.error-phone-duplicate"));
          return false;
        }
        return true;
      case 1:
        if (store.workArea.length === 0) {
          setError(t(locale, "employees.form.work-area-required"));
          return false;
        }
        return true;
      default:
        return true;
    }
  };

  const activeStep = Math.min(Math.max(currentStep, 0), TOTAL_STEPS - 1);
  const isFirstStep = activeStep === 0;
  const isLastStep = activeStep === TOTAL_STEPS - 1;
  const progress = ((activeStep + 1) / TOTAL_STEPS) * 100;
  const activeStepTitle = activeStep === 0 ? "기본 정보" : "근무 정보";
  const activeStepDescription =
    activeStep === 0
      ? "제공인력님의 기본 정보를 입력해주세요."
      : "근무 지역과 다음 배정 가능 여부를 선택해주세요.";
  const selectedSummary = [store.name.trim(), store.grade].filter(Boolean);
  const isNextButtonDisabled =
    createEmployee.isPending ||
    isNavigationPending ||
    (
      activeStep === 0 &&
      (
        !store.name.trim() ||
        phoneDigits.length !== 11 ||
        isCheckingPhoneDuplicate ||
        hasPhoneDuplicateCheckFailed ||
        isPhoneDuplicate ||
        lastCheckedPhoneDigits !== phoneDigits
      )
    );

  const handleStepChange = (nextStep: number) => {
    if (nextStep > currentStep && !validateStep(currentStep)) {
      return;
    }

    setError(null);
    setCurrentStep(nextStep);
  };

  const handleComplete = async () => {
    if (!validateStep(currentStep)) {
      return;
    }

    setError(null);

    try {
      const newEmployee = await createEmployee.mutateAsync({
        name: store.name.trim(),
        workArea: store.workArea,
        phone: store.phone.replace(/\D/g, ""),
        grade: store.grade,
        openToNextWork: store.openToNextWork,
      });

      reset();

      if (returnTo) {
        const safeTarget = target === "primary" || target === "secondary" ? target : null;
        startNavigation();
        router.push(
          buildReturnUrl(returnTo, {
            employeeCreatedId: String(newEmployee.id),
            target: safeTarget,
          })
        );
        return;
      }

      startNavigation();
      router.push(`/employees?id=${newEmployee.id}`);
    } catch (err: unknown) {
      setError(getErrorMessage(err, locale, "employees.form.error-create-failed"));
    }
  };

  const handleExit = () => {
    reset();
    router.push(returnTo ?? "/employees");
  };

  const handleNext = () => {
    if (isLastStep) {
      void handleComplete();
      return;
    }

    handleStepChange(activeStep + 1);
  };

  const handlePrev = () => {
    if (!isFirstStep) {
      handleStepChange(activeStep - 1);
    }
  };

  return (
    <div
      className={styles.page}
      data-component="mobile_employees-new_screen_root"
      data-slot="employees-new-page-shell"
    >
      <div className={styles.navbar} data-component="mobile_employees-new_screen_root_navbar">
        <button
          className={styles.navbarIconButton}
          type="button"
          onClick={handleExit}
          aria-label={returnTo ? "이전 화면으로 돌아가기" : "직원 목록으로 돌아가기"}
        >
          <ChevronLeft aria-hidden="true" size={20} strokeWidth={2.5} />
        </button>
        <div className={styles.navbarTitle} data-component="mobile_employees-new_screen_root_navbar_title">
          {t(locale, "employees.form.create-title")}
        </div>
        <button
          className={styles.navbarIconButton}
          type="button"
          onClick={handleExit}
          aria-label="닫기"
        >
          <X aria-hidden="true" size={20} strokeWidth={2.5} />
        </button>
      </div>

      <div className={styles.wizardContent} data-component="mobile_employees-new_screen_root_wizard">
        <div className={styles.wizardHeader} data-component="mobile_employees-new_screen_root_wizard_header">
          <div className={styles.progressRow} data-component="mobile_employees-new_screen_root_wizard_header_progress-row">
            <div className={styles.progressTrack} data-component="mobile_employees-new_screen_root_wizard_header_progress-row_progress-track">
              <div
                className={styles.progressFill}
                data-component="mobile_employees-new_screen_root_wizard_header_progress-row_progress-track_progress-fill"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className={styles.stepCount} data-component="mobile_employees-new_screen_root_wizard_header_progress-row_step-count">
              <span>{activeStep + 1}</span> / {TOTAL_STEPS} 단계
            </div>
          </div>
          <div className={styles.stepTitle} data-component="mobile_employees-new_screen_root_wizard_header_step-title">{activeStepTitle}</div>
          <div className={styles.stepDescription} data-component="mobile_employees-new_screen_root_wizard_header_step-description">
            {activeStepDescription}
          </div>
        </div>

        {activeStep === 1 && selectedSummary.length > 0 && (
          <div className={styles.summaryPills} data-component="mobile_employees-new_screen_root_wizard_summary-pills">
            {selectedSummary.map((summary) => (
              <span className={styles.summaryPill} key={summary}>
                {summary}
              </span>
            ))}
          </div>
        )}

        <div
          className={cn(styles.formScroll, activeStep === 0 ? styles.activeStep : styles.hiddenStep)}
          data-component="mobile_employees-new_screen_root_wizard_basic-step"
        >
          <div className={styles.formCard} data-component="mobile_employees-new_screen_root_wizard_basic-step_basic-card">
            <div className={styles.formRow} data-component="mobile_employees-new_screen_root_wizard_basic-step_basic-card_name-field">
              <label htmlFor="employee-name" className={styles.formLabel}>
                {t(locale, "employees.form.name")} <span className={styles.required}>*</span>
              </label>
              <input
                id="employee-name"
                className={styles.formInput}
                value={store.name}
                onChange={(event) => {
                  setField("name", event.target.value);
                  setError(null);
                }}
                placeholder="홍길동"
                aria-required="true"
                required
              />
            </div>

            <div className={styles.formRow} data-component="mobile_employees-new_screen_root_wizard_basic-step_basic-card_phone-field">
              <label htmlFor="employee-phone" className={styles.formLabel}>
                {t(locale, "employees.form.phone")} <span className={styles.required}>*</span>
              </label>
              <input
                id="employee-phone"
                className={cn(styles.formInput, showPhoneValidationError && styles.formInputError)}
                value={store.phone}
                onChange={(event) => {
                  setField("phone", formatPhoneNumber(event.target.value));
                  setError(null);
                }}
                placeholder="010-1234-5678"
                type="tel"
                inputMode="numeric"
                maxLength={13}
                aria-invalid={showPhoneValidationError}
                aria-required="true"
                required
              />
              {phoneHelperMessage && (
                <div
                  className={cn(styles.formHelper, styles[phoneHelperTone])}
                  data-component="mobile_employees-new_screen_root_wizard_basic-step_basic-card_phone-field_helper"
                >
                  {phoneHelperTone === "ok" ? "✓ " : ""}
                  {phoneHelperMessage}
                </div>
              )}
            </div>
          </div>

          <div className={styles.formCard} data-component="mobile_employees-new_screen_root_wizard_basic-step_grade-card">
            <div className={styles.cardTitle} data-component="mobile_employees-new_screen_root_wizard_basic-step_grade-card_title">
              {t(locale, "employees.form.grade")} <span className={styles.required}>*</span>
            </div>
            <div className={styles.gradeRow} data-component="mobile_employees-new_screen_root_wizard_basic-step_grade-card_grade-field">
              {GRADES.map((grade) => {
                const isSelected = store.grade === grade;

                return (
                  <button
                    className={cn(styles.gradeChip, isSelected && styles.selected)}
                    type="button"
                    key={grade}
                    onClick={() => {
                      setField("grade", grade);
                      setError(null);
                    }}
                    aria-pressed={isSelected}
                  >
                    <span className={styles.gradeName}>{grade}</span>
                    <span className={styles.gradeSub}>{GRADE_STARS[grade] ?? "★"}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {error && activeStep === 0 && (
            <div className={styles.errorBox} data-component="mobile_employees-new_screen_root_wizard_basic-step_error">
              {error}
            </div>
          )}
        </div>

        <div
          className={cn(styles.formScroll, activeStep === 1 ? styles.activeStep : styles.hiddenStep)}
          data-component="mobile_employees-new_screen_root_wizard_work-step"
        >
          <div className={styles.formCard} data-component="mobile_employees-new_screen_root_wizard_work-step_work-area-card">
            <div className={styles.cardTitle} data-component="mobile_employees-new_screen_root_wizard_work-step_work-area-card_title">
              {t(locale, "employees.form.work-area")} <span className={styles.required}>*</span>
            </div>
            <div className={styles.areaRow} data-component="mobile_employees-new_screen_root_wizard_work-step_work-area-card_options">
              {ORDERED_WORK_AREAS.map((area) => {
                const isSelected = store.workArea.includes(area);

                return (
                  <button
                    key={area}
                    type="button"
                    onClick={() => {
                      setField(
                        "workArea",
                        isSelected
                          ? store.workArea.filter((selectedArea) => selectedArea !== area)
                          : [...store.workArea, area]
                      );
                      setError(null);
                    }}
                    className={cn(styles.areaChip, isSelected && styles.selected)}
                    aria-pressed={isSelected}
                  >
                    {formatWorkAreaLabel(area)}
                  </button>
                );
              })}
            </div>
            <div className={styles.formHelper} data-component="mobile_employees-new_screen_root_wizard_work-step_work-area-card_helper">
              {store.workArea.length}개 지역 선택됨 · 복수 선택 가능
            </div>
          </div>

          <div className={styles.formCard} data-component="mobile_employees-new_screen_root_wizard_work-step_open-status-card">
            <div className={styles.cardTitle} data-component="mobile_employees-new_screen_root_wizard_work-step_open-status-card_title">
              {t(locale, "employees.form.open-to-next-work")}
            </div>
            <div className={styles.openRow} data-component="mobile_employees-new_screen_root_wizard_work-step_open-status-card_options">
              {[
                { value: true, label: "배정 가능", tone: "ok" },
                { value: false, label: "배정 불가", tone: "no" },
              ].map((option) => {
                const isSelected = store.openToNextWork === option.value;

                return (
                  <button
                    className={cn(
                      styles.openChip,
                      isSelected && styles.selected,
                      isSelected && styles[option.tone]
                    )}
                    type="button"
                    key={String(option.value)}
                    onClick={() => {
                      setField("openToNextWork", option.value);
                      setError(null);
                    }}
                    aria-pressed={isSelected}
                  >
                    <span className={styles.openIcon}>
                      {option.value ? (
                        <Check aria-hidden="true" size={16} strokeWidth={2.8} />
                      ) : (
                        <X aria-hidden="true" size={16} strokeWidth={2.8} />
                      )}
                    </span>
                    <span className={styles.openLabel}>{option.label}</span>
                  </button>
                );
              })}
            </div>
            <div className={styles.formHelper} data-component="mobile_employees-new_screen_root_wizard_work-step_open-status-card_helper">
              새로운 고객 매칭에 노출될지 여부입니다. 언제든 변경할 수 있습니다.
            </div>
          </div>

          {error && activeStep === 1 && (
            <div className={styles.errorBox} data-component="mobile_employees-new_screen_root_wizard_work-step_error">
              {error}
            </div>
          )}
        </div>

        <div className={styles.actions} data-component="mobile_employees-new_screen_root_wizard_actions">
          <button
            className={cn(styles.actionButton, styles.secondary)}
            type="button"
            onClick={handlePrev}
            disabled={isFirstStep}
          >
            이전
          </button>
          <button
            className={cn(styles.actionButton, styles.primary)}
            type="button"
            onClick={handleNext}
            disabled={isNextButtonDisabled}
          >
            {createEmployee.isPending || isNavigationPending ? "등록 중..." : isLastStep ? "✓ 등록" : "다음 →"}
          </button>
        </div>
      </div>
    </div>
  );
}
