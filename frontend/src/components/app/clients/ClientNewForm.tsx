"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronLeft } from "lucide-react";

import { EmployeeAutocomplete } from "@/components/app/clients/EmployeeAutocomplete";
import { EmployeeFormDialog } from "@/components/app/employees/EmployeeFormDialog";
import {
  FormChip,
  FormField,
  FormGrid,
  FormHelperText,
  FormNativeSelect,
  FormSection,
  FormTextInput,
  FormTextInputWithSuffix,
  type FormNativeSelectOption,
} from "@/components/app/ui/form-section";
import { SteppedWizard, type WizardStep } from "@/components/app/v3";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useCreateClient } from "@/hooks/useClients";
import type { Employee } from "@/hooks/useEmployees";
import { useVoucherPriceInfos } from "@/hooks/useVoucherData";
import { api } from "@/lib/api/client";
import type { CreateClientDto, ServiceStatus } from "@/lib/client/types";
import { SERVICE_STATUS_OPTIONS } from "@/lib/client/types";
import { getErrorMessage } from "@/lib/errors/prisma-error-mapper";
import { t } from "@/lib/i18n/translations";
import { useLocale } from "@/providers/LocaleProvider";
import { useClientDialogStore } from "@/stores/client-dialog-store";
import { useClientWizardStore } from "@/stores/client-wizard-store";
import voucherOptions from "@/components/app/messages/templates/json/voucher.json";

const PHONE_DUPLICATE_CHECK_MAX_RETRIES = 3;
const PHONE_DUPLICATE_CHECK_RETRY_DELAY_MS = 1000;

type VoucherOptionGroup = Record<string, { label: string }>;
type BooleanClientField = "voucherClient" | "careCenter" | "breastPump";

const voucherOptionGroups = voucherOptions.voucherOptions as Record<string, VoucherOptionGroup>;

const formatPhoneNumber = (value: string): string => {
  const digits = value.replace(/\D/g, "");
  if (digits.length <= 3) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7, 11)}`;
};

const formatPrice = (price: number | string): string => {
  if (!price && price !== 0) return "";
  const cleaned = typeof price === "string" ? price.replace(/,/g, "") : String(price);
  const num = parseInt(cleaned, 10);
  if (isNaN(num)) return "";
  return num.toLocaleString("ko-KR");
};

const parsePrice = (value: string | null | undefined): string => {
  if (!value) return "";
  return value.replace(/,/g, "");
};

const getPhoneDuplicateCheckFailedMessage = (locale: "ko" | "en"): string =>
  locale === "ko"
    ? "문제가 발생했어요. 새로고침 해주세요."
    : "Something went wrong. Please refresh and try again.";

const getPhoneDuplicateCheckPendingMessage = (locale: "ko" | "en"): string =>
  locale === "ko"
    ? "연락처 중복 확인 중입니다. 잠시만 기다려주세요."
    : "Checking for duplicate phone number. Please wait.";

const getVoucherTypeOptions = (): FormNativeSelectOption[] =>
  Object.entries(voucherOptionGroups).flatMap(([groupName, types]) =>
    Object.entries(types).map(([typeValue, typeData]) => ({
      value: typeValue,
      label: `${groupName} — ${typeData.label}`,
    })),
  );

export function ClientNewForm() {
  const router = useRouter();
  const locale = useLocale();
  const createClient = useCreateClient();
  const prefillName = useClientDialogStore((s) => s.prefillName);
  const clearPrefillName = useClientDialogStore((s) => s.clearPrefillName);

  const store = useClientWizardStore();
  const { currentStep, pricesManuallyEdited, setField, setCurrentStep, setPricesManuallyEdited, reset } = store;

  const [error, setError] = useState<string | null>(null);
  const [isEmployeeDialogOpen, setIsEmployeeDialogOpen] = useState(false);
  const [employeeDialogTarget, setEmployeeDialogTarget] = useState<"primary" | "secondary" | null>(null);
  const [isCheckingPhoneDuplicate, setIsCheckingPhoneDuplicate] = useState(false);
  const [isPhoneDuplicate, setIsPhoneDuplicate] = useState(false);
  const [hasPhoneDuplicateCheckFailed, setHasPhoneDuplicateCheckFailed] = useState(false);
  const [lastCheckedPhoneDigits, setLastCheckedPhoneDigits] = useState<string | null>(null);

  const phoneDigits = useMemo(() => store.phone.replace(/\D/g, ""), [store.phone]);
  const phoneInlineMessage = phoneDigits.length === 11
    ? hasPhoneDuplicateCheckFailed
      ? getPhoneDuplicateCheckFailedMessage(locale)
      : isPhoneDuplicate
        ? t(locale, "clients.form.error-phone-duplicate")
        : null
    : null;

  useEffect(() => {
    if (prefillName) {
      setField("name", prefillName);
      clearPrefillName();
    }
  }, [prefillName, clearPrefillName, setField]);

  const { data: voucherPriceInfos, isLoading: isPriceLoading } = useVoucherPriceInfos(store.type || "");

  const availableDurations = useMemo(() => {
    if (!voucherPriceInfos) return [];
    const durations = [...new Set(voucherPriceInfos.map((i) => Number(i.duration)))];
    return durations.sort((a, b) => a - b);
  }, [voucherPriceInfos]);

  const selectedPriceInfo = useMemo(() => {
    if (!voucherPriceInfos || !store.duration) return null;
    return voucherPriceInfos.find((i) => Number(i.duration) === store.duration);
  }, [voucherPriceInfos, store.duration]);

  const voucherTypeOptions = useMemo(
    () => [{ value: "", label: "선택하세요" }, ...getVoucherTypeOptions()],
    [],
  );

  const durationOptions = useMemo<FormNativeSelectOption[]>(
    () => [
      { value: "", label: "선택하세요" },
      ...availableDurations.map((duration) => ({
        value: String(duration),
        label: `${duration}일`,
      })),
    ],
    [availableDurations],
  );

  const serviceStatusOptions = useMemo<FormNativeSelectOption[]>(
    () => SERVICE_STATUS_OPTIONS.map((status) => ({
      value: status.value,
      label: status.label,
    })),
    [],
  );

  useEffect(() => {
    if (selectedPriceInfo && !pricesManuallyEdited) {
      setField("fullPrice", parsePrice(selectedPriceInfo.fullPrice));
      setField("grant", parsePrice(selectedPriceInfo.grant));
      setField("actualPrice", parsePrice(selectedPriceInfo.actualPrice));
    }
  }, [selectedPriceInfo, pricesManuallyEdited, setField]);

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
          const response = await api.get("/clients/check-phone", {
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

  const handleTypeChange = (newType: string) => {
    setField("type", newType);
    setField("duration", null);
    if (!pricesManuallyEdited) {
      setField("fullPrice", "");
      setField("grant", "");
      setField("actualPrice", "");
    }
  };

  const handlePriceChange = (field: "fullPrice" | "grant" | "actualPrice", value: string) => {
    setPricesManuallyEdited(true);
    setField(field, value);
    setError(null);
  };

  const validateStep = (step: number): boolean => {
    switch (step) {
      case 0:
        if (!store.name.trim()) {
          setError(t(locale, "clients.form.error-name-required"));
          return false;
        }
        if (phoneDigits.length !== 11) {
          setError(t(locale, "clients.form.error-phone-required"));
          return false;
        }
        if (phoneDigits.length === 11) {
          if (isCheckingPhoneDuplicate || lastCheckedPhoneDigits !== phoneDigits) {
            setError(getPhoneDuplicateCheckPendingMessage(locale));
            return false;
          }
          if (hasPhoneDuplicateCheckFailed) {
            setError(getPhoneDuplicateCheckFailedMessage(locale));
            return false;
          }
          if (isPhoneDuplicate) {
            setError(t(locale, "clients.form.error-phone-duplicate"));
            return false;
          }
        }
        return true;
      case 1:
        return true;
      case 2:
        return true;
      default:
        return true;
    }
  };

  const handleStepChange = (newStep: number) => {
    if (newStep > currentStep && !validateStep(currentStep)) return;
    setError(null);
    setCurrentStep(newStep);
  };

  const handleComplete = async () => {
    if (!validateStep(currentStep)) return;
    setError(null);

    try {
      const dto: CreateClientDto = {
        name: store.name,
        birthday: store.birthday || null,
        dueDate: store.dueDate || null,
        address: store.address || null,
        phone: store.phone || null,
        primaryEmployeeId: store.primaryEmployeeId,
        secondaryEmployeeId: store.secondaryEmployeeId,
        type: store.type || null,
        duration: store.duration || null,
        fullPrice: store.fullPrice || null,
        grant: store.grant || null,
        actualPrice: store.actualPrice || null,
        startDate: store.startDate || null,
        endDate: store.endDate || null,
        careCenter: store.careCenter,
        voucherClient: store.voucherClient,
        breastPump: store.breastPump,
        serviceStatus: store.serviceStatus || null,
      };
      const newClient = await createClient.mutateAsync(dto);
      reset();
      router.push(`/clients?id=${newClient.id}`);
    } catch (err: unknown) {
      setError(getErrorMessage(err, locale, "clients.form.error-save-failed"));
    }
  };

  const handleEmployeeCreated = (newEmployee: Employee) => {
    if (employeeDialogTarget === "primary") {
      setField("primaryEmployeeId", newEmployee.id);
    } else if (employeeDialogTarget === "secondary") {
      setField("secondaryEmployeeId", newEmployee.id);
    }
  };

  const flagOptions: Array<{ key: BooleanClientField; label: string }> = [
    { key: "voucherClient", label: t(locale, "clients.form.voucher-client") },
    { key: "careCenter", label: t(locale, "clients.form.care-center") },
    { key: "breastPump", label: t(locale, "clients.form.breast-pump") },
  ];

  const steps: WizardStep[] = [
    {
      label: "기본 정보",
      summaryTitle: store.name || undefined,
      content: (
        <FormSection
          data-component="desktop_clients-new_basic_step"
          title="기본 정보"
          bodyDataComponent="desktop_clients-new_basic_step-body"
        >
          <FormGrid data-component="desktop_clients-new_basic_grid">
            <FormField data-component="desktop_clients-new_basic_name-field" label={t(locale, "clients.form.name")} required>
              <FormTextInput
                data-component="desktop_clients-new_basic_name-input"
                type="text"
                value={store.name}
                onChange={(event) => {
                  setField("name", event.target.value);
                  setError(null);
                }}
                placeholder="홍길동"
              />
            </FormField>
            <FormField data-component="desktop_clients-new_basic_birthday-field" label={t(locale, "clients.form.birthday")}>
              <FormTextInput
                data-component="desktop_clients-new_basic_birthday-input"
                type="text"
                value={store.birthday}
                onChange={(event) => setField("birthday", event.target.value)}
                inputMode="numeric"
                placeholder="YYMMDD"
                maxLength={6}
              />
            </FormField>
            <FormField data-component="desktop_clients-new_basic_due-date-field" label={t(locale, "clients.form.due-date")}>
              <FormTextInput
                data-component="desktop_clients-new_basic_due-date-input"
                type="date"
                value={store.dueDate}
                onChange={(event) => setField("dueDate", event.target.value)}
              />
            </FormField>
            <FormField data-component="desktop_clients-new_basic_phone-field" label={t(locale, "clients.form.phone")} required>
              <FormTextInput
                data-component="desktop_clients-new_basic_phone-input"
                type="tel"
                value={store.phone}
                onChange={(event) => {
                  setField("phone", formatPhoneNumber(event.target.value));
                  setError(null);
                }}
                inputMode="numeric"
                placeholder="010-1234-5678"
                maxLength={13}
                error={Boolean(phoneInlineMessage)}
              />
              {phoneInlineMessage ? (
                <FormHelperText data-component="desktop_clients-new_basic_phone-error" tone="error">
                  {phoneInlineMessage}
                </FormHelperText>
              ) : null}
            </FormField>
            <FormField
              data-component="desktop_clients-new_basic_address-field"
              className="sm:col-span-2"
              label={t(locale, "clients.form.address")}
            >
              <FormTextInput
                data-component="desktop_clients-new_basic_address-input"
                type="text"
                value={store.address}
                onChange={(event) => setField("address", event.target.value)}
                placeholder="서울시 강남구..."
              />
            </FormField>
            {error ? (
              <div data-component="desktop_clients-new_basic_error" className="sm:col-span-2">
                <FormHelperText data-component="desktop_clients-new_basic_error-message" tone="error">
                  {error}
                </FormHelperText>
              </div>
            ) : null}
          </FormGrid>
        </FormSection>
      ),
    },
    {
      label: "서비스 설정",
      content: (
        <div data-component="desktop_clients-new_service_step" className="space-y-6">
          <FormSection data-component="desktop_clients-new_service_config-section" title="서비스 설정">
            <FormGrid data-component="desktop_clients-new_service_grid">
              <FormField data-component="desktop_clients-new_service_type-field" label={t(locale, "clients.form.voucher-type")}>
                <FormNativeSelect
                  options={voucherTypeOptions}
                  value={store.type}
                  onValueChange={handleTypeChange}
                  wrapDataComponent="desktop_clients-new_service_type-select-wrap"
                  selectDataComponent="desktop_clients-new_service_type-select"
                  iconDataComponent="desktop_clients-new_service_type-select-icon"
                />
              </FormField>
              <FormField data-component="desktop_clients-new_service_duration-field" label={t(locale, "clients.form.duration")}>
                <FormNativeSelect
                  options={durationOptions}
                  value={store.duration?.toString() || ""}
                  onValueChange={(value) => {
                    setField("duration", value ? Number(value) : null);
                    setPricesManuallyEdited(false);
                  }}
                  disabled={!store.type || isPriceLoading}
                  wrapDataComponent="desktop_clients-new_service_duration-select-wrap"
                  selectDataComponent="desktop_clients-new_service_duration-select"
                  iconDataComponent="desktop_clients-new_service_duration-select-icon"
                />
                {isPriceLoading ? (
                  <div data-component="desktop_clients-new_service_duration-loading" className="flex items-center gap-2">
                    <Spinner data-component="desktop_clients-new_service_duration-spinner" size="sm" />
                  </div>
                ) : null}
              </FormField>
            </FormGrid>
          </FormSection>

          <FormSection data-component="desktop_clients-new_service_employee-section" title="제공인력 배정">
            <FormGrid data-component="desktop_clients-new_service_employee-grid">
              <FormField
                data-component="desktop_clients-new_service_primary-employee-field"
                label={t(locale, "clients.form.primary-employee")}
              >
                <EmployeeAutocomplete
                  value={store.primaryEmployeeId}
                  onChange={(id) => setField("primaryEmployeeId", id)}
                  label=""
                  excludeIds={store.secondaryEmployeeId != null ? [store.secondaryEmployeeId] : []}
                  allowManualEntry
                  onManualEntry={() => {
                    setEmployeeDialogTarget("primary");
                    setIsEmployeeDialogOpen(true);
                  }}
                />
              </FormField>
              <FormField
                data-component="desktop_clients-new_service_secondary-employee-field"
                label={t(locale, "clients.form.secondary-employee")}
              >
                <EmployeeAutocomplete
                  value={store.secondaryEmployeeId}
                  onChange={(id) => setField("secondaryEmployeeId", id)}
                  label=""
                  excludeIds={store.primaryEmployeeId != null ? [store.primaryEmployeeId] : []}
                  allowManualEntry
                  onManualEntry={() => {
                    setEmployeeDialogTarget("secondary");
                    setIsEmployeeDialogOpen(true);
                  }}
                />
              </FormField>
            </FormGrid>
          </FormSection>

          <FormSection
            data-component="desktop_clients-new_service_pricing-section"
            headerDataComponent="desktop_clients-new_service_pricing-header"
            title={t(locale, "clients.form.section-pricing")}
            badge={
              selectedPriceInfo && !pricesManuallyEdited ? (
                <Badge data-component="desktop_clients-new_service_pricing-auto-badge" variant="info">
                  자동입력
                </Badge>
              ) : undefined
            }
          >
            <FormGrid data-component="desktop_clients-new_service_pricing-grid" className="md:grid-cols-3">
              <FormField data-component="desktop_clients-new_service_full-price-field" label={t(locale, "clients.form.full-price")}>
                <FormTextInputWithSuffix
                  data-component="desktop_clients-new_service_full-price-input-wrap"
                  inputDataComponent="desktop_clients-new_service_full-price-input"
                  suffixDataComponent="desktop_clients-new_service_full-price-suffix"
                  suffix="원"
                  value={formatPrice(store.fullPrice)}
                  onChange={(event) => handlePriceChange("fullPrice", event.target.value.replace(/,/g, ""))}
                  placeholder="0"
                  inputMode="numeric"
                />
              </FormField>
              <FormField data-component="desktop_clients-new_service_grant-field" label={t(locale, "clients.form.grant")}>
                <FormTextInputWithSuffix
                  data-component="desktop_clients-new_service_grant-input-wrap"
                  inputDataComponent="desktop_clients-new_service_grant-input"
                  suffixDataComponent="desktop_clients-new_service_grant-suffix"
                  suffix="원"
                  value={formatPrice(store.grant)}
                  onChange={(event) => handlePriceChange("grant", event.target.value.replace(/,/g, ""))}
                  placeholder="0"
                  inputMode="numeric"
                />
              </FormField>
              <FormField data-component="desktop_clients-new_service_actual-price-field" label={t(locale, "clients.form.actual-price")}>
                <FormTextInputWithSuffix
                  data-component="desktop_clients-new_service_actual-price-input-wrap"
                  inputDataComponent="desktop_clients-new_service_actual-price-input"
                  suffixDataComponent="desktop_clients-new_service_actual-price-suffix"
                  suffix="원"
                  value={formatPrice(store.actualPrice)}
                  onChange={(event) => handlePriceChange("actualPrice", event.target.value.replace(/,/g, ""))}
                  placeholder="0"
                  inputMode="numeric"
                />
              </FormField>
            </FormGrid>
          </FormSection>

          <FormSection data-component="desktop_clients-new_service_flags-field" title={t(locale, "clients.form.section-flags")}>
            <div data-component="desktop_clients-new_service_flags-options" className="flex flex-wrap gap-3">
              {flagOptions.map(({ key, label }) => (
                <FormChip
                  key={key}
                  data-component={`desktop_clients-new_service_flags-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}-chip`}
                  selected={store[key]}
                  onClick={() => setField(key, !store[key])}
                >
                  {store[key] ? <Check className="h-3.5 w-3.5" strokeWidth={2.5} /> : null}
                  {label}
                </FormChip>
              ))}
            </div>
          </FormSection>

          {error ? (
            <FormHelperText data-component="desktop_clients-new_service_error" tone="error">
              {error}
            </FormHelperText>
          ) : null}
        </div>
      ),
      summary: (
        <div data-component="desktop_clients-new_service_summary" className="flex flex-wrap gap-3">
          {store.type ? (
            <Badge data-component="desktop_clients-new_service_summary-type" variant="success">
              <Check className="h-4 w-4" strokeWidth={2} />
              {store.type}
            </Badge>
          ) : null}
          {store.duration ? (
            <Badge data-component="desktop_clients-new_service_summary-duration" variant="success">
              <Check className="h-4 w-4" strokeWidth={2} />
              {store.duration}일
            </Badge>
          ) : null}
          {store.actualPrice ? (
            <Badge data-component="desktop_clients-new_service_summary-price" variant="success">
              <Check className="h-4 w-4" strokeWidth={2} />
              {formatPrice(store.actualPrice)}원
            </Badge>
          ) : null}
        </div>
      ),
    },
    {
      label: "계약 정보",
      content: (
        <FormSection data-component="desktop_clients-new_contract_step" title="계약 정보">
          <FormGrid data-component="desktop_clients-new_contract_grid">
            <FormField data-component="desktop_clients-new_contract_status-field" label={t(locale, "clients.form.contract-status")}>
              <FormNativeSelect
                options={serviceStatusOptions}
                value={store.serviceStatus}
                onValueChange={(value) => setField("serviceStatus", value as ServiceStatus)}
                wrapDataComponent="desktop_clients-new_contract_status-select-wrap"
                selectDataComponent="desktop_clients-new_contract_status-select"
                iconDataComponent="desktop_clients-new_contract_status-select-icon"
              />
            </FormField>
            <div data-component="desktop_clients-new_contract_spacer" />
            <FormField data-component="desktop_clients-new_contract_start-date-field" label={t(locale, "clients.form.start-date")}>
              <FormTextInput
                data-component="desktop_clients-new_contract_start-date-input"
                type="date"
                value={store.startDate}
                onChange={(event) => setField("startDate", event.target.value)}
              />
            </FormField>
            <FormField data-component="desktop_clients-new_contract_end-date-field" label={t(locale, "clients.form.end-date")}>
              <FormTextInput
                data-component="desktop_clients-new_contract_end-date-input"
                type="date"
                value={store.endDate}
                onChange={(event) => setField("endDate", event.target.value)}
              />
            </FormField>
            {error ? (
              <div data-component="desktop_clients-new_contract_error" className="sm:col-span-2">
                <FormHelperText data-component="desktop_clients-new_contract_error-message" tone="error">
                  {error}
                </FormHelperText>
              </div>
            ) : null}
          </FormGrid>
        </FormSection>
      ),
    },
  ];

  return (
    <>
      <div
        data-component="desktop_clients-new_main_content"
        data-source-component="ClientNewForm"
        className="flex min-h-[calc(100dvh-6rem)] items-start justify-center py-6 md:py-8"
      >
        <div data-component="desktop_clients-new_main_content-inner" className="flex w-full flex-col">
          <Button
            data-component="desktop_clients-new_back_button"
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => router.push("/clients")}
            className="mb-4 self-start md:mb-6"
          >
            <ChevronLeft className="h-4 w-4" />
            고객 목록으로 돌아가기
          </Button>

          <div data-component="desktop_clients-new_stepper_shell">
            <SteppedWizard
              title={t(locale, "clients.form.add-title")}
              subtitle="고객 정보를 단계별로 입력해 주세요"
              steps={steps}
              currentStep={currentStep}
              onStepChange={handleStepChange}
              onComplete={handleComplete}
              completeLabel="등록"
              isSubmitting={createClient.isPending}
              isNextDisabled={
                currentStep === 0 &&
                (
                  phoneDigits.length !== 11 ||
                  isCheckingPhoneDuplicate ||
                  hasPhoneDuplicateCheckFailed ||
                  isPhoneDuplicate ||
                  lastCheckedPhoneDigits !== phoneDigits
                )
              }
            />
          </div>
        </div>
      </div>

      <EmployeeFormDialog
        open={isEmployeeDialogOpen}
        onClose={() => {
          setIsEmployeeDialogOpen(false);
          setEmployeeDialogTarget(null);
        }}
        onSuccess={handleEmployeeCreated}
      />
    </>
  );
}
