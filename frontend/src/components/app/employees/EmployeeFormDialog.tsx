"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { useLocale } from "@/providers/LocaleProvider";
import { t } from "@/lib/i18n/translations";
import { getErrorMessage } from "@/lib/errors/prisma-error-mapper";
import { cn } from "@/lib/utils";
import {
    Employee,
    CreateEmployeeDto,
    UpdateEmployeeDto,
    useCreateEmployee,
    useUpdateEmployee,
    employeeQueryKeys,
} from "@/hooks/useEmployees";
import { useEmployeePhoneDuplicateCheck } from "@/hooks/useEmployeePhoneDuplicateCheck";
import { useEmployeeDialogStore } from "@/stores/employee-dialog-store";
import {
    Dialog,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { FormDialogShell } from "@/components/app/ui/FormDialogShell";
import {
    APP_FORM_CONTROL_CLASS_NAME,
    FormField,
    FormGrid,
    FormHelperText,
    FormNativeSelect,
    FormSection,
    FormSwitchRow,
    FormTextInput,
} from "@/components/app/ui/form-section";
import {
    SteppedWizardPanelContent,
} from "@/components/app/v3/SteppedWizardPanelLayout";
import {
    DETAIL_PANEL_FOOTER_ACTIONS_CLASS_NAME,
    DETAIL_PANEL_FOOTER_CLASS_NAME,
    DETAIL_PANEL_FOOTER_PROGRESS_CLASS_NAME,
} from "@/components/app/v3/DetailPanel";
import {
    DEFAULT_EMPLOYEE_GRADE,
    formatWorkAreaLabel,
    GRADES,
    WORK_AREAS,
    normalizeEmployeeGrade,
} from "@/components/app/employees/employee-form.constants";

interface EmployeeFormDialogProps {
    open: boolean;
    onClose: () => void;
    employee?: Employee | null;
    onSuccess?: (employee: Employee) => void;
}

interface EmployeeFormPanelProps extends Omit<EmployeeFormDialogProps, "open"> {
    open?: boolean;
    renderLayout?: (slots: { content: ReactNode; footer: ReactNode }) => ReactNode;
}

interface FormData {
    name: string;
    workArea: string[];
    phone: string;
    grade: string;
    openToNextWork: boolean;
    birthday: string;
}

const initialFormData: FormData = {
    name: "",
    workArea: [],
    phone: "",
    grade: DEFAULT_EMPLOYEE_GRADE,
    openToNextWork: true,
    birthday: "",
};

const GRADE_OPTIONS = [
    { value: GRADES[2], label: GRADES[2] },
    { value: GRADES[1], label: GRADES[1] },
    { value: GRADES[0], label: GRADES[0] },
] as const;

const WORK_AREA_OPTIONS = WORK_AREAS.map((area) => ({
    value: area,
    label: formatWorkAreaLabel(area),
}));

const PANEL_CONTENT_CLASS_NAME = "h-auto min-h-full";
const PANEL_FIELDS_CLASS_NAME = "grid w-full grid-cols-1 gap-[calc(16px*var(--glint-ui-scale,1))] pb-[calc(24px*var(--glint-ui-scale,1))] md:grid-cols-2";

interface WorkAreaMultiSelectProps {
    id: string;
    value: string[];
    onChange: (value: string[]) => void;
    onTouched: () => void;
    invalid: boolean;
    errorId?: string;
    dataComponentPrefix: string;
}

function summarizeWorkAreas(value: string[]): string {
    const labels = value.map(formatWorkAreaLabel);

    if (labels.length === 0) return "근무 지역 선택";
    if (labels.length <= 2) return labels.join(", ");
    return `${labels[0]} 외 ${labels.length - 1}곳`;
}

function WorkAreaMultiSelect({
    id,
    value,
    onChange,
    onTouched,
    invalid,
    errorId,
    dataComponentPrefix,
}: WorkAreaMultiSelectProps) {
    const [open, setOpen] = useState(false);
    const selectedSummary = summarizeWorkAreas(value);
    const configuredWorkAreas = new Set<string>(WORK_AREAS);
    const selectableOptions = [
        ...WORK_AREA_OPTIONS,
        ...value
            .filter((area) => !configuredWorkAreas.has(area))
            .map((area) => ({ value: area, label: formatWorkAreaLabel(area) })),
    ];

    const handleOpenChange = (nextOpen: boolean) => {
        setOpen(nextOpen);
        if (!nextOpen) {
            onTouched();
        }
    };

    const setAreaChecked = (area: string, checked: boolean) => {
        const selectedAreas = new Set(value);

        if (checked) {
            selectedAreas.add(area);
        } else {
            selectedAreas.delete(area);
        }

        onChange(
            selectableOptions
                .map((option) => option.value)
                .filter((option) => selectedAreas.has(option)),
        );
    };

    return (
        <Popover open={open} onOpenChange={handleOpenChange}>
            <div data-component={`${dataComponentPrefix}-select-wrap`}>
                <PopoverTrigger asChild>
                    <button
                        id={id}
                        type="button"
                        role="combobox"
                        aria-expanded={open}
                        aria-controls={`${id}-options`}
                        aria-label={`근무 지역 선택: ${selectedSummary}`}
                        aria-invalid={invalid || undefined}
                        aria-describedby={errorId}
                        data-component={`${dataComponentPrefix}-select`}
                        className={cn(
                            APP_FORM_CONTROL_CLASS_NAME,
                            "box-border items-center justify-between gap-2 py-0 text-left",
                            value.length === 0 && "text-v3-text-muted",
                            invalid && "border-v3-burgundy focus-visible:border-v3-burgundy",
                        )}
                    >
                        <span className="min-w-0 flex-1 truncate">{selectedSummary}</span>
                        <ChevronDown
                            className={cn(
                                "h-[calc(16px*var(--glint-ui-scale,1))] w-[calc(16px*var(--glint-ui-scale,1))] shrink-0 text-v3-text-muted transition-transform",
                                open && "rotate-180",
                            )}
                            strokeWidth={2.2}
                            data-component={`${dataComponentPrefix}-select-icon`}
                            aria-hidden="true"
                        />
                    </button>
                </PopoverTrigger>
            </div>

            <PopoverContent
                align="start"
                sideOffset={6}
                avoidCollisions
                data-component={`${dataComponentPrefix}-select-popover`}
                className="w-[var(--radix-popover-trigger-width)] min-w-[240px] rounded-[13px] border-[1.35px] border-v3-border bg-white p-0 shadow-lg"
            >
                <div
                    data-component={`${dataComponentPrefix}-select-head`}
                    className="flex items-center justify-between gap-3 border-b border-v3-border px-3.5 py-2.5"
                >
                    <span className="text-[calc(11.2px*var(--glint-ui-scale,1))] font-semibold text-v3-text-muted">
                        {value.length}개 지역 선택
                    </span>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => onChange(selectableOptions.map((option) => option.value))}
                            className="text-[calc(11.2px*var(--glint-ui-scale,1))] font-semibold text-v3-primary hover:text-v3-primary/80"
                            data-component={`${dataComponentPrefix}-select-all`}
                        >
                            전체 선택
                        </button>
                        <button
                            type="button"
                            onClick={() => onChange([])}
                            disabled={value.length === 0}
                            className="text-[calc(11.2px*var(--glint-ui-scale,1))] font-semibold text-v3-text-muted hover:text-v3-dark disabled:cursor-not-allowed disabled:opacity-45"
                            data-component={`${dataComponentPrefix}-clear`}
                        >
                            선택 해제
                        </button>
                    </div>
                </div>

                <div
                    id={`${id}-options`}
                    role="group"
                    aria-label="근무 지역 목록"
                    data-component={`${dataComponentPrefix}-options`}
                    className="grid max-h-[280px] gap-0.5 overflow-y-auto p-2"
                >
                    {selectableOptions.map((option, index) => {
                        const checkboxId = `${id}-option-${index}`;
                        const isSelected = value.includes(option.value);

                        return (
                            <label
                                key={option.value}
                                htmlFor={checkboxId}
                                className="flex min-h-[36px] cursor-pointer items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-[calc(12px*var(--glint-ui-scale,1))] font-medium text-v3-dark hover:bg-v3-primary/5"
                            >
                                <Checkbox
                                    id={checkboxId}
                                    checked={isSelected}
                                    onCheckedChange={(checked) => setAreaChecked(option.value, checked === true)}
                                    className="h-4 w-4 rounded-[4px] border-v3-border data-[state=checked]:border-v3-primary data-[state=checked]:bg-v3-primary"
                                    data-component={`${dataComponentPrefix}-option-${index}`}
                                />
                                <span>{option.label}</span>
                            </label>
                        );
                    })}
                </div>

                <div className="border-t border-v3-border p-2.5">
                    <Button
                        type="button"
                        size="sm"
                        onClick={() => handleOpenChange(false)}
                        className="w-full"
                        data-component={`${dataComponentPrefix}-done`}
                    >
                        완료
                    </Button>
                </div>
            </PopoverContent>
        </Popover>
    );
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

const getPhoneDuplicateCheckFailedMessage = (locale: "ko" | "en"): string =>
    locale === "ko"
        ? "문제가 발생했어요. 새로고침 해주세요."
        : "Something went wrong. Please refresh and try again.";

const getPhoneDuplicateCheckPendingMessage = (locale: "ko" | "en"): string =>
    locale === "ko"
        ? "연락처 중복 확인 중입니다. 잠시만 기다려주세요."
        : "Checking for duplicate phone number. Please wait.";

const getPhoneAvailableMessage = (locale: "ko" | "en"): string =>
    locale === "ko" ? "등록 가능한 번호입니다." : "This phone number is available.";

export function EmployeeFormPanel({
    open = true,
    onClose,
    employee,
    onSuccess,
    renderLayout,
}: EmployeeFormPanelProps) {
    return (
        <EmployeeFormContent
            surface="panel"
            open={open}
            onClose={onClose}
            employee={employee}
            onSuccess={onSuccess}
            renderLayout={renderLayout}
        />
    );
}

export function EmployeeFormDialog({ open, onClose, employee, onSuccess }: EmployeeFormDialogProps) {
    return (
        <EmployeeFormContent
            surface="dialog"
            open={open}
            onClose={onClose}
            employee={employee}
            onSuccess={onSuccess}
        />
    );
}

function EmployeeFormContent({
    surface,
    open,
    onClose,
    employee,
    onSuccess,
    renderLayout,
}: EmployeeFormDialogProps & Pick<EmployeeFormPanelProps, "renderLayout"> & { surface: "dialog" | "panel" }) {
    const locale = useLocale();
    const queryClient = useQueryClient();
    const [formData, setFormData] = useState<FormData>(initialFormData);
    const [touched, setTouched] = useState({
        phone: false,
        workArea: false,
    });
    const [error, setError] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const createMutation = useCreateEmployee();
    const updateMutation = useUpdateEmployee();
    const prefillName = useEmployeeDialogStore((state) => state.prefillName);

    const {
        phoneDigits,
        isCheckingPhoneDuplicate,
        isPhoneDuplicate,
        hasPhoneDuplicateCheckFailed,
        lastCheckedPhoneDigits,
        isUsingOriginalPhone,
        isPhoneCheckReady,
    } = useEmployeePhoneDuplicateCheck({
        phone: formData.phone,
        originalPhone: employee?.phone,
        enabled: open,
    });

    // 중복 검사는 서버를 직접 조회하지만 제공인력 목록은 창별 캐시를 쓴다.
    // 그래서 "이미 등록됨"인데 목록에는 안 보이는 상태가 생긴다. 이때 목록을 맞춰준다.
    useEffect(() => {
        if (!isPhoneDuplicate) return;
        void queryClient.refetchQueries({ queryKey: employeeQueryKeys.all });
    }, [isPhoneDuplicate, queryClient]);

    const isEditMode = !!employee;
    const isLoading = isSubmitting || createMutation.isPending || updateMutation.isPending;
    const isPhoneFormatValid = phoneDigits.length === 11;
    const isPhoneValid = isPhoneFormatValid && isPhoneCheckReady;
    const phoneInlineMessage = isPhoneFormatValid
        ? isUsingOriginalPhone || isPhoneCheckReady
            ? getPhoneAvailableMessage(locale)
            : isCheckingPhoneDuplicate
                ? getPhoneDuplicateCheckPendingMessage(locale)
                : hasPhoneDuplicateCheckFailed
                    ? getPhoneDuplicateCheckFailedMessage(locale)
                    : lastCheckedPhoneDigits !== phoneDigits
                        ? getPhoneDuplicateCheckPendingMessage(locale)
                        : isPhoneDuplicate
                            ? t(locale, "employees.form.error-phone-duplicate")
                            : null
        : null;
    const hasPhoneStatusError =
        isPhoneFormatValid &&
        !isUsingOriginalPhone &&
        (hasPhoneDuplicateCheckFailed ||
            (lastCheckedPhoneDigits === phoneDigits && isPhoneDuplicate));
    const isWorkAreaValid = formData.workArea.length > 0;
    const isFormValid = !!formData.name.trim() && isPhoneValid && isWorkAreaValid;
    const requiredFieldProgressText = `필수 항목 4개 중 ${
        [
            Boolean(formData.name.trim()),
            isPhoneValid,
            Boolean(formData.grade),
            isWorkAreaValid,
        ].filter(Boolean).length
    }개 입력됨`;

    useEffect(() => {
        if (!open) {
            return;
        }

        let cancelled = false;
        const nextFormData = employee
            ? {
                name: employee.name,
                workArea: employee.workArea,
                phone: employee.phone,
                grade: normalizeEmployeeGrade(employee.grade),
                openToNextWork: employee.openToNextWork,
                birthday: employee.birthday ?? "",
            }
            : {
                ...initialFormData,
                name: prefillName || "",
            };

        queueMicrotask(() => {
            if (cancelled) {
                return;
            }

            setFormData(nextFormData);
            setTouched({ phone: false, workArea: false });
            setError(null);
        });

        return () => {
            cancelled = true;
        };
    }, [employee, open, prefillName]);

    const handleChange = <K extends keyof FormData>(field: K, value: FormData[K]) => {
        setFormData((prev) => ({ ...prev, [field]: value }));
    };

    const handleSubmit = async () => {
        setTouched({ phone: true, workArea: true });
        setError(null);

        if (!formData.name.trim() || !isPhoneValid || !isWorkAreaValid) {
            return;
        }

        setIsSubmitting(true);
        try {
            if (isEditMode && employee) {
                const dto: UpdateEmployeeDto = {
                    name: formData.name,
                    workArea: formData.workArea,
                    phone: parsePhoneNumber(formData.phone),
                    grade: formData.grade,
                    openToNextWork: formData.openToNextWork,
                    birthday: formData.birthday,
                };

                const updatedEmployee = await updateMutation.mutateAsync({ id: employee.id, dto });

                if (updatedEmployee && ("code" in updatedEmployee || "statusCode" in updatedEmployee)) {
                    setError(getErrorMessage(updatedEmployee, locale, "employees.form.error-update-failed"));
                    return;
                }

                await queryClient.refetchQueries({ queryKey: employeeQueryKeys.all });
                onSuccess?.(updatedEmployee);
            } else {
                const dto: CreateEmployeeDto = {
                    name: formData.name,
                    workArea: formData.workArea,
                    phone: parsePhoneNumber(formData.phone),
                    grade: formData.grade,
                    openToNextWork: formData.openToNextWork,
                    birthday: formData.birthday,
                };

                const newEmployee = await createMutation.mutateAsync(dto);

                if (newEmployee && ("code" in newEmployee || "statusCode" in newEmployee)) {
                    setError(getErrorMessage(newEmployee, locale, "employees.form.error-create-failed"));
                    return;
                }

                await queryClient.refetchQueries({ queryKey: employeeQueryKeys.all });
                onSuccess?.(newEmployee);
            }

            onClose();
        } catch (submitError: unknown) {
            console.error("[EmployeeFormDialog] Failed to save employee:", submitError);
            setError(getErrorMessage(submitError, locale, "employees.form.error-save-failed"));
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleClose = () => {
        setFormData(initialFormData);
        setTouched({ phone: false, workArea: false });
        setError(null);
        onClose();
    };

    const dialogFooter = (
        <div className="ml-auto flex w-full flex-col-reverse gap-2 sm:w-[300px] sm:flex-row sm:justify-end">
            <Button
                variant="neutral"
                size="sm"
                onClick={handleClose}
                disabled={isLoading}
                data-component="desktop_employees_form-dialog_cancel"
                className="w-full sm:flex-1"
            >
                {t(locale, "common.cancel")}
            </Button>
            <Button
                variant="positive"
                size="sm"
                onClick={handleSubmit}
                disabled={isLoading || !isFormValid}
                data-component="desktop_employees_form-dialog_submit"
                className="w-full sm:flex-1"
            >
                {isLoading ? (
                    <Spinner className="h-4 w-4" />
                ) : isEditMode ? (
                    t(locale, "common.save")
                ) : (
                    t(locale, "common.create")
                )}
            </Button>
        </div>
    );

    const panelFooter = (
        <div className="flex w-full flex-wrap items-center justify-between gap-[calc(12px*var(--glint-ui-scale,1))]">
            <span className={DETAIL_PANEL_FOOTER_PROGRESS_CLASS_NAME}>{requiredFieldProgressText}</span>
            <div className={DETAIL_PANEL_FOOTER_ACTIONS_CLASS_NAME}>
                <Button
                    type="button"
                    variant="neutral"
                    size="sm"
                    onClick={handleClose}
                    disabled={isLoading}
                    data-component="desktop_employees_form-panel_cancel"
                    className="min-w-[calc(132px*var(--glint-ui-scale,1))]"
                >
                    {t(locale, "common.cancel")}
                </Button>
                <Button
                    type="button"
                    variant="positive"
                    size="sm"
                    onClick={handleSubmit}
                    disabled={isLoading || !isFormValid}
                    data-component="desktop_employees_form-panel_submit"
                    className="min-w-[calc(132px*var(--glint-ui-scale,1))]"
                >
                    {isLoading ? (
                        <Spinner className="h-4 w-4" />
                    ) : isEditMode ? (
                        t(locale, "common.save")
                    ) : (
                        t(locale, "common.create")
                    )}
                </Button>
            </div>
        </div>
    );

    const feedback = error ? (
        <Alert
            variant="destructive"
            data-component="desktop_employees_form-dialog_error"
            className="rounded-[18px] border-none bg-v3-burgundy-light px-4 py-3 text-v3-burgundy [&>svg]:text-v3-burgundy"
        >
            <AlertDescription>{error}</AlertDescription>
        </Alert>
    ) : null;

    const formSections = (
        <>
            <FormSection
                data-component="desktop_employees_form-dialog_section-basic"
                title={t(locale, "employees.form.section-basic")}
                description="제공인력의 기본 정보를 입력해 주세요."
                headerDataComponent="desktop_employees_form-dialog_section-basic-head"
                titleDataComponent="desktop_employees_form-dialog_section-basic-title"
                descriptionDataComponent="desktop_employees_form-dialog_section-basic-caption"
            >
                <FormGrid data-component="desktop_employees_form-dialog_section-basic_grid">
                    <FormField
                        data-component="desktop_employees_form-dialog_section-basic_grid_field-name"
                        htmlFor="name"
                        label={t(locale, "employees.form.name")}
                        required
                    >
                        <FormTextInput
                            id="name"
                            value={formData.name}
                            onChange={(e) => handleChange("name", e.target.value)}
                            placeholder="홍길동"
                        />
                    </FormField>

                    <FormField
                        data-component="desktop_employees_form-dialog_section-basic_grid_field-phone"
                        htmlFor="phone"
                        label={t(locale, "employees.form.phone")}
                        required
                        labelAccessory={phoneInlineMessage ? (
                            <FormHelperText
                                id="employees-form-dialog-phone-helper"
                                data-component="desktop_employees_form-dialog_section-basic_grid_field-phone_helper"
                                tone={hasPhoneStatusError ? "error" : "default"}
                                className={cn("m-0 text-right", isPhoneCheckReady && "text-v3-green")}
                                aria-live="polite"
                            >
                                {phoneInlineMessage}
                            </FormHelperText>
                        ) : null}
                    >
                        <FormTextInput
                            id="phone"
                            type="tel"
                            inputMode="numeric"
                            placeholder="010-1234-5678"
                            value={formatPhoneNumber(formData.phone)}
                            onChange={(e) => handleChange("phone", parsePhoneNumber(e.target.value))}
                            onBlur={() => setTouched((prev) => ({ ...prev, phone: true }))}
                            maxLength={13}
                            error={(touched.phone && !isPhoneFormatValid) || hasPhoneStatusError}
                            aria-describedby={phoneInlineMessage
                                ? "employees-form-dialog-phone-helper"
                                : touched.phone && !isPhoneFormatValid
                                    ? "employees-form-dialog-field-phone-error"
                                    : undefined}
                        />
                        {touched.phone && !isPhoneFormatValid && (
                            <FormHelperText
                                id="employees-form-dialog-field-phone-error"
                                tone="error"
                                data-component="desktop_employees_form-dialog_section-basic_grid_field-phone_error"
                            >
                                {t(locale, "employees.form.phone-required")}
                            </FormHelperText>
                        )}
                    </FormField>

                    <FormField
                        data-component="desktop_employees_form-dialog_section-basic_grid_field-birthday"
                        htmlFor="birthday"
                        label="생년월일 (YYMMDD)"
                    >
                        <FormTextInput
                            id="birthday"
                            value={formData.birthday}
                            onChange={(e) => handleChange("birthday", e.target.value)}
                            placeholder="YYMMDD"
                            maxLength={6}
                            inputMode="numeric"
                        />
                    </FormField>
                </FormGrid>
            </FormSection>

            <FormSection
                data-component="desktop_employees_form-dialog_section-work"
                title={t(locale, "employees.form.section-work")}
                description="필요한 범위만 선택하고 나중에 수정할 수 있습니다."
                headerDataComponent="desktop_employees_form-dialog_section-work-head"
                titleDataComponent="desktop_employees_form-dialog_section-work-title"
                descriptionDataComponent="desktop_employees_form-dialog_section-work-caption"
            >
                <FormGrid data-component="desktop_employees_form-dialog_section-work_grid">
                    <FormField
                        data-component="desktop_employees_form-dialog_section-work_grid_field-grade"
                        htmlFor="employee-form-grade"
                        label={t(locale, "employees.form.grade")}
                        required
                    >
                        <FormNativeSelect
                            id="employee-form-grade"
                            value={formData.grade}
                            options={GRADE_OPTIONS}
                            onValueChange={(value) => handleChange("grade", value)}
                            wrapDataComponent="desktop_employees_form-dialog_section-work_grid_field-grade_select-wrap"
                            selectDataComponent="desktop_employees_form-dialog_section-work_grid_field-grade_select"
                            iconDataComponent="desktop_employees_form-dialog_section-work_grid_field-grade_select-icon"
                        />
                    </FormField>

                    <FormField
                        data-component="desktop_employees_form-dialog_section-work_grid_field-work-area"
                        htmlFor="employee-form-work-area"
                        label={t(locale, "employees.form.work-area")}
                        required
                        labelAccessory={touched.workArea && !isWorkAreaValid ? (
                            <FormHelperText
                                id="employee-form-work-area-error"
                                tone="error"
                                data-component="desktop_employees_form-dialog_section-work_grid_field-work-area_error"
                                className="m-0 text-right"
                            >
                                {t(locale, "employees.form.work-area-required")}
                            </FormHelperText>
                        ) : null}
                    >
                        <WorkAreaMultiSelect
                            id="employee-form-work-area"
                            value={formData.workArea}
                            onChange={(value) => handleChange("workArea", value)}
                            onTouched={() => setTouched((prev) => ({ ...prev, workArea: true }))}
                            invalid={touched.workArea && !isWorkAreaValid}
                            errorId={touched.workArea && !isWorkAreaValid ? "employee-form-work-area-error" : undefined}
                            dataComponentPrefix="employees-form-dialog-field-work-area"
                        />
                    </FormField>
                </FormGrid>

                <FormField data-component="desktop_employees_form-dialog_section-work_field-open-status" label="다음 배정 가능 여부">
                    <FormSwitchRow
                        data-component="desktop_employees_form-dialog_section-work_field-open-status_control"
                        title="다음 근무 배정 가능"
                        description="고객 생성 완료 후 배정 후보에 표시합니다."
                        checked={formData.openToNextWork}
                        onToggle={() => handleChange("openToNextWork", !formData.openToNextWork)}
                        buttonAriaLabel="다음 근무 배정 가능"
                        copyDataComponent="desktop_employees_form-dialog_field-open-status-copy"
                        titleDataComponent="desktop_employees_form-dialog_field-open-status-title"
                        descriptionDataComponent="desktop_employees_form-dialog_field-open-status-description"
                        buttonDataComponent="desktop_employees_form-dialog_field-open-status-switch"
                        thumbDataComponent="desktop_employees_form-dialog_field-open-status-switch-thumb"
                    />
                </FormField>

            </FormSection>
        </>
    );

    const dialogContent = (
        <div data-component="desktop_employees_form-dialog_content" className="space-y-5">
            {feedback}
            {formSections}
        </div>
    );

    const panelFields = (
        <>
            <FormField
                data-component="desktop_employees_form-panel_name-field"
                htmlFor="employee-panel-name"
                label={
                    <>
                        {t(locale, "employees.form.name")}
                        <span className="ml-1 text-v3-burgundy">*</span>
                    </>
                }
            >
                <FormTextInput
                    id="employee-panel-name"
                    value={formData.name}
                    onChange={(event) => handleChange("name", event.target.value)}
                    placeholder="홍길동"
                    data-component="desktop_employees_form-panel_name-field_input"
                />
            </FormField>

            <FormField
                data-component="desktop_employees_form-panel_phone-field"
                htmlFor="employee-panel-phone"
                label={
                    <>
                        {t(locale, "employees.form.phone")}
                        <span className="ml-1 text-v3-burgundy">*</span>
                    </>
                }
                labelAccessory={phoneInlineMessage ? (
                    <FormHelperText
                        id="employees-form-panel-phone-helper"
                        data-component="desktop_employees_form-panel_phone-field_helper"
                        tone={hasPhoneStatusError ? "error" : "default"}
                        className={cn("m-0 text-right", isPhoneCheckReady && "text-v3-green")}
                        aria-live="polite"
                    >
                        {phoneInlineMessage}
                    </FormHelperText>
                ) : null}
            >
                <FormTextInput
                    id="employee-panel-phone"
                    type="tel"
                    inputMode="numeric"
                    value={formatPhoneNumber(formData.phone)}
                    onChange={(event) => handleChange("phone", parsePhoneNumber(event.target.value))}
                    onBlur={() => setTouched((prev) => ({ ...prev, phone: true }))}
                    maxLength={13}
                    placeholder="010-1234-5678"
                    error={(touched.phone && !isPhoneFormatValid) || hasPhoneStatusError}
                    aria-describedby={phoneInlineMessage
                        ? "employees-form-panel-phone-helper"
                        : touched.phone && !isPhoneFormatValid
                            ? "employees-form-panel-phone-error"
                            : undefined}
                    data-component="desktop_employees_form-panel_phone-field_input"
                />
                {touched.phone && !isPhoneFormatValid && (
                    <FormHelperText
                        id="employees-form-panel-phone-error"
                        tone="error"
                        data-component="desktop_employees_form-panel_phone-field_error"
                    >
                        {t(locale, "employees.form.phone-required")}
                    </FormHelperText>
                )}
            </FormField>

            <FormField
                data-component="desktop_employees_form-panel_birthday-field"
                htmlFor="employee-panel-birthday"
                label="생년월일 (YYMMDD)"
            >
                <FormTextInput
                    id="employee-panel-birthday"
                    value={formData.birthday}
                    onChange={(event) => handleChange("birthday", event.target.value)}
                    placeholder="YYMMDD"
                    maxLength={6}
                    data-component="desktop_employees_form-panel_birthday-field_input"
                />
            </FormField>

            <FormField
                data-component="desktop_employees_form-panel_grade-field"
                htmlFor="employee-panel-grade"
                label={
                    <>
                    {t(locale, "employees.form.grade")}
                    <span className="ml-1 text-v3-burgundy">*</span>
                    </>
                }
            >
                <FormNativeSelect
                    id="employee-panel-grade"
                    value={formData.grade}
                    options={GRADE_OPTIONS}
                    onValueChange={(value) => handleChange("grade", value)}
                    wrapDataComponent="desktop_employees_form-panel_grade-field_select-wrap"
                    selectDataComponent="desktop_employees_form-panel_grade-field_select"
                    iconDataComponent="desktop_employees_form-panel_grade-field_select-icon"
                />
            </FormField>

            <FormField
                data-component="desktop_employees_form-panel_work-area-field"
                htmlFor="employee-panel-work-area"
                label={
                    <>
                    {t(locale, "employees.form.work-area")}
                    <span className="ml-1 text-v3-burgundy">*</span>
                    </>
                }
                labelAccessory={touched.workArea && !isWorkAreaValid ? (
                    <FormHelperText
                        id="employee-panel-work-area-error"
                        tone="error"
                        data-component="desktop_employees_form-panel_work-area-field_error"
                        className="m-0 text-right"
                    >
                        {t(locale, "employees.form.work-area-required")}
                    </FormHelperText>
                ) : null}
            >
                <WorkAreaMultiSelect
                    id="employee-panel-work-area"
                    value={formData.workArea}
                    onChange={(value) => handleChange("workArea", value)}
                    onTouched={() => setTouched((prev) => ({ ...prev, workArea: true }))}
                    invalid={touched.workArea && !isWorkAreaValid}
                    errorId={touched.workArea && !isWorkAreaValid ? "employee-panel-work-area-error" : undefined}
                    dataComponentPrefix="employees-form-panel-work-area"
                />
            </FormField>

            <FormSwitchRow
                data-component="desktop_employees_form-panel_open-status-field"
                className="self-end h-[calc(38px*var(--glint-ui-scale,1))] min-h-[calc(38px*var(--glint-ui-scale,1))] rounded-[13px] border-[1.35px] px-[calc(14px*var(--glint-ui-scale,1))] py-0"
                title={t(locale, "employees.form.open-to-next-work")}
                checked={formData.openToNextWork}
                onToggle={() => handleChange("openToNextWork", !formData.openToNextWork)}
                buttonAriaLabel={t(locale, "employees.form.open-to-next-work")}
                buttonDataComponent="desktop_employees_form-panel_open-status-switch"
                thumbDataComponent="desktop_employees_form-panel_open-status-switch-thumb"
            />
        </>
    );

    const panelContent = (
        <SteppedWizardPanelContent
            dataComponent="desktop_employees_form-panel_content"
            stepContentDataComponent="desktop_employees_form-panel_fields"
            className={PANEL_CONTENT_CLASS_NAME}
            stepContentClassName={PANEL_FIELDS_CLASS_NAME}
            feedback={feedback}
        >
            {panelFields}
        </SteppedWizardPanelContent>
    );

    if (surface === "panel") {
        if (!open) return null;

        return renderLayout ? (
            <>{renderLayout({ content: panelContent, footer: panelFooter })}</>
        ) : (
            <div data-component="desktop_employees_form-panel" className="flex h-full min-h-0 flex-col">
                <div data-component="desktop_employees_form-panel_content-fallback" className="min-h-0 flex-1 overflow-y-auto">
                    {panelContent}
                </div>
                <footer data-component="desktop_employees_form-panel_footer" data-slot="detail-panel-footer" className={DETAIL_PANEL_FOOTER_CLASS_NAME}>
                    {panelFooter}
                </footer>
            </div>
        );
    }

    return (
        <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
            <FormDialogShell
                dataComponent="desktop_employees_form-dialog"
                title={
                    isEditMode
                        ? t(locale, "employees.form.edit-title")
                        : t(locale, "employees.form.create-title")
                }
                footer={dialogFooter}
            >
                {dialogContent}
            </FormDialogShell>
        </Dialog>
    );
}
