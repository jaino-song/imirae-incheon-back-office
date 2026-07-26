"use client";

import { ChevronDown } from "lucide-react";
import { useLocale } from "@/providers/LocaleProvider";
import { t } from "@/lib/i18n/translations";
import { cn } from "@/lib/utils";
import { DEFAULT_EMPLOYEE_GRADE, EMPLOYEE_GRADES } from "@/features/employees/grade";
import { Switch } from "@/components/ui/switch";
import { WORK_AREAS, formatWorkAreaLabel } from "./employee-form.constants";
import styles from "./EmployeeFormCard.module.css";

const GRADE_OPTIONS = [
  { value: EMPLOYEE_GRADES[2], label: "스탠다드" },
  { value: EMPLOYEE_GRADES[1], label: "베스트" },
  { value: EMPLOYEE_GRADES[0], label: "프리미엄" },
] as const;

export interface EmployeeFormCardData {
  name: string;
  workArea: string[];
  phone: string;
  grade: string;
  openToNextWork: boolean;
  birthday: string;
}

export interface EmployeeFormCardTouched {
  phone: boolean;
  workArea: boolean;
}

type PhoneHelperTone = "ok" | "err" | "pending";

interface EmployeeFormCardProps {
  /** Caller-context canonical base, e.g. `mobile_employees_form-dialog_card`. */
  "data-component": string;
  formData: EmployeeFormCardData;
  touched: EmployeeFormCardTouched;
  isPhoneValid: boolean;
  hasPhoneError?: boolean;
  phoneHelperMessage?: string | null;
  phoneHelperTone?: PhoneHelperTone | null;
  isWorkAreaValid: boolean;
  disabled?: boolean;
  assignmentLabel?: string;
  assignmentDescription?: string;
  onChange: <K extends keyof EmployeeFormCardData>(field: K, value: EmployeeFormCardData[K]) => void;
  onPhoneBlur: () => void;
  onWorkAreaTouched: () => void;
}

function formatPhoneNumber(value: string): string {
  const numbers = value.replace(/[^\d]/g, "");
  if (numbers.length <= 3) return numbers;
  if (numbers.length <= 7) return `${numbers.slice(0, 3)}-${numbers.slice(3)}`;
  return `${numbers.slice(0, 3)}-${numbers.slice(3, 7)}-${numbers.slice(7, 11)}`;
}

function parsePhoneNumber(value: string): string {
  return value.replace(/[^\d]/g, "");
}

export function EmployeeFormCard({
  "data-component": dataComponent,
  formData,
  touched,
  isPhoneValid,
  hasPhoneError = false,
  phoneHelperMessage,
  phoneHelperTone,
  isWorkAreaValid,
  disabled = false,
  assignmentLabel,
  assignmentDescription = "등록 완료 후 선택값으로 자동 입력됩니다",
  onChange,
  onPhoneBlur,
  onWorkAreaTouched,
}: EmployeeFormCardProps) {
  const sub = (suffix: string) => `${dataComponent}_${suffix}`;
  const locale = useLocale();

  const setField = <K extends keyof EmployeeFormCardData>(field: K, value: EmployeeFormCardData[K]) => {
    onChange(field, value);
  };

  const toggleWorkArea = (area: string) => {
    const nextAreas = formData.workArea.includes(area)
      ? formData.workArea.filter((selectedArea) => selectedArea !== area)
      : [...formData.workArea, area];

    setField("workArea", nextAreas);
  };
  const phoneRequiredMessage = touched.phone && !isPhoneValid ? t(locale, "employees.form.phone-required") : null;
  const visiblePhoneHelperMessage = phoneRequiredMessage ?? phoneHelperMessage;
  const visiblePhoneHelperTone = phoneRequiredMessage ? "err" : phoneHelperTone;

  return (
    <div className={styles.cardStack} data-component={dataComponent}>
      {assignmentLabel ? (
        <div className={styles.contextStrip} data-component={sub("assignment")}>
          <div>
            <strong className={styles.contextTitle}>{assignmentLabel}</strong>
            <span className={styles.contextDescription}>{assignmentDescription}</span>
          </div>
          <span className={styles.contextBadge}>신규 등록</span>
        </div>
      ) : null}

      <section className={styles.formSection} data-component={sub("section-basic")}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>{t(locale, "employees.form.section-basic")}</h2>
        </div>

        <div className={styles.field} data-component={sub("section-basic_field-name")}>
          <label className={styles.label} htmlFor="employee-form-name">
            {t(locale, "employees.form.name")}
            <span className={styles.required}>*</span>
          </label>
          <input
            id="employee-form-name"
            className={styles.control}
            value={formData.name}
            onChange={(event) => setField("name", event.target.value)}
            placeholder="홍길동"
            disabled={disabled}
          />
        </div>

        <div className={styles.field} data-component={sub("section-basic_field-phone")}>
          <div className={styles.labelRow} data-component={sub("section-basic_field-phone_label-row")}>
            <label className={styles.label} htmlFor="employee-form-phone">
              {t(locale, "employees.form.phone")}
              <span className={styles.required}>*</span>
            </label>
            {visiblePhoneHelperMessage ? (
              <span
                className={cn(
                  styles.inlineHelper,
                  visiblePhoneHelperTone === "ok" && styles.inlineHelperOk,
                  visiblePhoneHelperTone === "err" && styles.inlineHelperErr,
                  visiblePhoneHelperTone === "pending" && styles.inlineHelperPending,
                )}
                data-component={sub("section-basic_field-phone_helper")}
              >
                {visiblePhoneHelperTone === "ok" ? "✓ " : null}
                {visiblePhoneHelperMessage}
              </span>
            ) : null}
          </div>
          <input
            id="employee-form-phone"
            className={cn(styles.control, (hasPhoneError || (touched.phone && !isPhoneValid)) && styles.controlError)}
            value={formatPhoneNumber(formData.phone)}
            onChange={(event) => setField("phone", parsePhoneNumber(event.target.value))}
            onBlur={onPhoneBlur}
            placeholder="010-1234-5678"
            maxLength={13}
            inputMode="tel"
            aria-invalid={hasPhoneError || (touched.phone && !isPhoneValid)}
            disabled={disabled}
          />
        </div>

        <div className={styles.field} data-component={sub("section-basic_field-birthday")}>
          <label className={styles.label} htmlFor="employee-form-birthday">
            생년월일
          </label>
          <input
            id="employee-form-birthday"
            className={styles.control}
            value={formData.birthday}
            onChange={(event) => setField("birthday", event.target.value.replace(/[^\d]/g, ""))}
            placeholder="YYMMDD"
            maxLength={6}
            inputMode="numeric"
            disabled={disabled}
          />
        </div>
      </section>

      <section className={styles.formSection} data-component={sub("section-work")}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>{t(locale, "employees.form.section-work")}</h2>
        </div>

        <div className={styles.field} data-component={sub("section-work_field-grade")}>
          <label className={styles.label} htmlFor="employee-form-grade">
            {t(locale, "employees.form.grade")}
            <span className={styles.required}>*</span>
          </label>
          <div className={styles.selectWrap}>
            <select
              id="employee-form-grade"
              className={styles.select}
              value={formData.grade || DEFAULT_EMPLOYEE_GRADE}
              onChange={(event) => setField("grade", event.target.value)}
              disabled={disabled}
            >
              {GRADE_OPTIONS.map((grade) => (
                <option key={grade.value} value={grade.value}>
                  {grade.label}
                </option>
              ))}
            </select>
            <ChevronDown className={styles.selectIcon} aria-hidden="true" strokeWidth={2.2} />
          </div>
        </div>

        <div className={styles.field}>
          <div className={styles.label}>
            {t(locale, "employees.form.work-area")}
            <span className={styles.required}>*</span>
          </div>
          <div
            className={styles.chipGrid}
            data-component={sub("section-work_field-work-area_options")}
            onBlur={onWorkAreaTouched}
          >
            {WORK_AREAS.map((area) => {
              const isSelected = formData.workArea.includes(area);

              return (
                <button
                  key={area}
                  type="button"
                  className={cn(styles.chip, isSelected && styles.chipSelected)}
                  onClick={() => toggleWorkArea(area)}
                  aria-pressed={isSelected}
                  disabled={disabled}
                >
                  {formatWorkAreaLabel(area)}
                </button>
              );
            })}
          </div>
          {touched.workArea && !isWorkAreaValid ? (
            <p className={styles.errorText}>{t(locale, "employees.form.work-area-required")}</p>
          ) : null}
        </div>

        <div className={styles.field} data-component={sub("section-work_field-open-status")}>
          <div className={styles.label}>{t(locale, "employees.form.open-to-next-work")}</div>
          <div className={styles.switchRow}>
            <div>
              <strong className={styles.switchTitle}>다음 근무 배정 가능</strong>
              <span className={styles.switchDescription}>고객 생성 완료 후 배정 후보에 표시합니다.</span>
            </div>
            <Switch
              data-component={sub("section-work_field-open-status_switch")}
              thumbDataComponent="employees-form-dialog-open-status-switch-thumb"
              checked={formData.openToNextWork}
              onCheckedChange={(checked) => setField("openToNextWork", checked)}
              aria-label="다음 근무 배정 가능"
              disabled={disabled}
            />
          </div>
        </div>
      </section>
    </div>
  );
}
