"use client";

import { useState, useMemo, useEffect, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import dayjs from "dayjs";
import { isAxiosError } from "axios";
import { useQueryClient } from "@tanstack/react-query";
import { getApiErrorMessage } from "@babyjamjam/shared";

import { useFormStore } from "@/stores/form-store";
import { useEformsign } from "@/hooks/useEformsign";
import { useNavigationPending } from "@/hooks/use-navigation-pending";
import { useVoucherYears, useVoucherPriceInfos, useAreaTemplates, useAllVoucherPrices } from "@/hooks";
import { useAllClients, useCreateClient, useDeleteClient, useUpdateClient } from "@/hooks/useClients";
import { useEmployees, type Employee } from "@/hooks/useEmployees";
import { eformsignQueryKeys } from "@/hooks/useEformsignDocuments";
import { eformsignApi } from "@/services/api";
import type { EformsignDocumentOption } from "@/lib/eformsign/types";
import type { Client } from "@/lib/client/types";

import { ClientAutocomplete } from "@/components/app/clients/ClientAutocomplete";
import { EmployeeAutocomplete } from "@/components/app/clients/EmployeeAutocomplete";

import voucherOptions from "@/components/app/messages/templates/json/voucher.json";
import { isStrictIsoDate, isoToYymmdd, normalizeIsoDate, todayIsoDate, yymmddToIso } from "@/lib/contracts/date-input";
import { calcEndDateBusinessDays } from "@/lib/date/business-days";
import { buildInitialSignRequestDocRecord } from "@/lib/eformsign/document-record";
import { formatKoreanPhoneNumber, normalizeKoreanPhoneDigits } from "@/lib/phone";
import {
  CONTRACT_CREATION_PROGRESS_STEPS,
  INITIAL_HEADLESS_PROGRESS,
  createHeadlessProgressId,
  getSafeHeadlessFailureMessage,
  isHeadlessProgressStepKey,
  resolveFailedHeadlessProgress,
  resolveNextHeadlessProgress,
  type HeadlessProgressEvent,
  type HeadlessProgressState,
} from "@/lib/eformsign/headless-progress";
import { HeadlessProgressModal } from "@/components/app/eformsign/HeadlessProgressModal";
import { MobileTwoButtonModal } from "@/components/app/ui/MobileTwoButtonModal";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import styles from "./page.module.css";

interface ContractDataDto {
  customerName: string;
  customerContact: string;
  customerDOB: string;
  customerAddress: string;
  caretaker1Name: string;
  caretaker1Contact: string;
  type: string;
  days: string;
  area: string;
  contractDuration: string;
  startYear: string; startMonth: string; startDay: string; startDate: string;
  endYear: string; endMonth: string; endDay: string; endDate: string;
  paymentYear: string; paymentMonth: string; paymentDay: string;
  fullPrice: string;
  grant: string;
  actualPrice: string;
}

const WIZARD_STEPS = [
  { title: "이용자 정보", desc: "기존 고객을 검색하거나 정보를 입력해주세요." },
  { title: "제공인력 정보", desc: "계약에 배정될 제공인력을 선택해주세요." },
  { title: "바우처 정보", desc: "바우처 유형과 기간, 요금을 확인해주세요." },
  { title: "계약 정보", desc: "서비스 기간과 본인부담금 수령 날짜를 입력해주세요." },
] as const;
const SUCCESS_REDIRECT_DELAY_MS = 3_000;
const AREA_TEMPLATE_DISPLAY_LABELS: Record<string, string> = {
  Namdonggu: "남동구",
  Seogu: "서구",
};

type HelperTone = "muted" | "ok" | "err" | "pending";

function getAreaTemplateDisplayLabel(areaId: string, templateName?: string | null): string {
  const mappedLabel = AREA_TEMPLATE_DISPLAY_LABELS[areaId];
  if (mappedLabel) return mappedLabel;

  return templateName?.replace(/\s*계약서.*$/, "").trim() || areaId;
}

function Field({
  dataComponent,
  label,
  required,
  children,
  helper,
  helperTone = "muted",
}: {
  dataComponent: string;
  label: ReactNode;
  required?: boolean;
  children: ReactNode;
  helper?: ReactNode;
  helperTone?: HelperTone;
}) {
  return (
    <div className={styles.formRow} data-component={dataComponent}>
      <label className={styles.formLabel} data-component={`${dataComponent}_label`}>
        {label}
        {required ? (
          <span className={styles.requiredMark} data-component={`${dataComponent}_required`}>*</span>
        ) : null}
      </label>
      {children}
      {helper ? (
        <div
          className={cn(styles.formHelper, styles[`helper_${helperTone}`])}
          data-component={`${dataComponent}_helper`}
        >
          {helper}
        </div>
      ) : null}
    </div>
  );
}

const formatPhoneNumber = formatKoreanPhoneNumber;

type ClientWithBirthdayAliases = Client & Partial<Record<
  "birthDate" | "birth_date" | "dateOfBirth" | "customerBirthDate" | "customerDOB",
  string | null
>>;

const clientBirthdayValue = (client: ClientWithBirthdayAliases | null | undefined): string | null | undefined =>
  client?.birthday ??
  client?.birthDate ??
  client?.birth_date ??
  client?.dateOfBirth ??
  client?.customerBirthDate ??
  client?.customerDOB;

const normalizeBirthdayInput = (value: string | null | undefined): string => {
  if (!value) return "";

  const isoValue = isoToYymmdd(value);
  if (isoValue) return isoValue;

  const digits = value.replace(/\D/g, "");
  if (digits.length === 6) return digits;
  if (digits.length === 8) return digits.slice(2);
  return digits.slice(0, 6);
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

const normalizeAmount = (value: string | number | null | undefined): string => {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\D/g, "");
};

const normalizeClientIdentityName = (value: string | null | undefined): string =>
  (value ?? "").trim().replace(/\s+/g, " ");

const normalizeClientIdentityPhone = (value: string | null | undefined): string =>
  normalizeKoreanPhoneDigits(value);

export default function ContractCreationPage() {
  const router = useRouter();
  const { isNavigationPending, startNavigation } = useNavigationPending();
  const queryClient = useQueryClient();
  const prefersReducedMotion = useReducedMotion();

  const createClientMutation = useCreateClient();
  const deleteClientMutation = useDeleteClient();
  const updateClientMutation = useUpdateClient();
  const { isLoaded: isEformsignLoaded, openDocument } = useEformsign();
  const { data: allClients } = useAllClients();
  const { data: voucherYears } = useVoucherYears();
  const { data: areaTemplates } = useAreaTemplates();
  const { data: employees } = useEmployees();

  const {
    clientId, isManualEntry, name, phone, birthday, address, dueDate, area,
    employeeId, employeeName, employeePhone,
    showEmployee2, employee2Id, employee2Phone,
    voucherType, voucherDuration, voucherYear,
    fullPrice, grant, actualPrice,
    startDate, endDate, paymentDate,
    preservePrefilledPrices,
    setClientId, setIsManualEntry, setName, setPhone, setBirthday, setAddress, setDueDate, setArea,
    setIsEmployeeManualEntry, setEmployeeSelection,
    setShowEmployee2, setIsEmployee2ManualEntry, setEmployee2Selection,
    setVoucherType, setVoucherDuration, setVoucherYear,
    setFullPrice, setGrant, setActualPrice,
    setStartDate, setEndDate, setPaymentDate,
    setPreservePrefilledPrices,
  } = useFormStore();

  const { data: voucherPriceInfos, isLoading: isPriceLoading } =
    useVoucherPriceInfos(voucherType || "", voucherYear || 0);
  const { data: allVoucherPrices } = useAllVoucherPrices(voucherYear || undefined);

  const [activeStep, setActiveStep] = useState(0);
  const [pricesManuallyEdited, setPricesManuallyEdited] = useState(false);
  const [floatingError, setFloatingError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isEformsignModalOpen, setIsEformsignModalOpen] = useState(false);
  const [isProgressModalOpen, setIsProgressModalOpen] = useState(false);
  const [isExistingContractConfirmOpen, setIsExistingContractConfirmOpen] = useState(false);
  const confirmationResolverRef = useRef<((approved: boolean) => void) | null>(null);
  const [confirmationMessage, setConfirmationMessage] = useState<string | null>(null);
  const requestConfirmation = (message: string): Promise<boolean> => {
    setConfirmationMessage(message);
    return new Promise((resolve) => {
      confirmationResolverRef.current = resolve;
    });
  };
  const resolveConfirmation = (approved: boolean) => {
    confirmationResolverRef.current?.(approved);
    confirmationResolverRef.current = null;
    setConfirmationMessage(null);
  };
  const [creationProgress, setCreationProgress] = useState<HeadlessProgressState>(INITIAL_HEADLESS_PROGRESS);
  const [progressErrorHint, setProgressErrorHint] = useState<string | null>(null);
  const progressSourceRef = useRef<EventSource | null>(null);
  const floatingErrorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedClientRef = useRef<Pick<Client, "id" | "name"> | null>(null);
  const defaultPaymentDate = useMemo(() => todayIsoDate(), []);
  const hasAppliedPaymentStepDefaultRef = useRef(false);

  // Local YYMMDD drafts so partial input doesn't trash the ISO store value
  const [startDateInput, setStartDateInput] = useState("");
  const [endDateInput, setEndDateInput] = useState("");
  const [paymentDateInput, setPaymentDateInput] = useState("");
  const isContractInfoStep = activeStep === WIZARD_STEPS.length - 1;
  const normalizedPaymentDate = normalizeIsoDate(paymentDate);
  const fallbackPaymentDate = normalizedPaymentDate || defaultPaymentDate;
  const shouldUseFallbackPaymentDate = isContractInfoStep && paymentDateInput.length === 0;
  const effectivePaymentDate = shouldUseFallbackPaymentDate ? fallbackPaymentDate : paymentDate;
  const effectivePaymentDateInput = shouldUseFallbackPaymentDate ? isoToYymmdd(fallbackPaymentDate) : paymentDateInput;

  useEffect(() => {
    if (!isContractInfoStep) {
      hasAppliedPaymentStepDefaultRef.current = false;
      return;
    }

    if (hasAppliedPaymentStepDefaultRef.current) return;
    hasAppliedPaymentStepDefaultRef.current = true;
    if (!normalizedPaymentDate) setPaymentDate(defaultPaymentDate);
  }, [defaultPaymentDate, isContractInfoStep, normalizedPaymentDate, setPaymentDate]);
  useEffect(() => { setStartDateInput(isoToYymmdd(startDate)); }, [startDate]);
  useEffect(() => { setEndDateInput(isoToYymmdd(endDate)); }, [endDate]);
  useEffect(() => { setPaymentDateInput(isoToYymmdd(paymentDate)); }, [paymentDate]);
  useEffect(() => {
    setArea("");
  }, [setArea]);
  useEffect(() => {
    if (clientId !== null && name.trim()) {
      selectedClientRef.current = { id: clientId, name };
    } else if (clientId === null) {
      selectedClientRef.current = null;
    }
  }, [clientId, name]);

  const handleDateInputChange = (
    setLocal: (v: string) => void,
    setStore: (v: string) => void,
    raw: string,
  ) => {
    const v = raw.replace(/\D/g, "").slice(0, 6);
    setLocal(v);
    if (v.length === 6) setStore(yymmddToIso(v));
    else if (v.length === 0) setStore("");
  };

  const availableDurations = useMemo(() => {
    if (!voucherPriceInfos) return [];
    const list = [...new Set(voucherPriceInfos.map((i) => String(i.duration)))];
    return list.sort((a, b) => Number(a) - Number(b));
  }, [voucherPriceInfos]);

  const selectedPriceInfo = useMemo(() => {
    if (!voucherPriceInfos || !voucherDuration) return null;
    return voucherPriceInfos.find((i) => String(i.duration) === voucherDuration) ?? null;
  }, [voucherPriceInfos, voucherDuration]);

  const selectableVoucherTypes = useMemo(() => {
    const values = Object.values(voucherOptions.voucherOptions).flatMap((types) => Object.keys(types));
    return new Set(values);
  }, []);
  const hasSelectableVoucherType = voucherType ? selectableVoucherTypes.has(voucherType) : false;

  const storedClientByIdentity = useMemo(() => {
    const targetName = normalizeClientIdentityName(name);
    const targetPhone = normalizeClientIdentityPhone(phone);
    if (!targetName || !targetPhone || !allClients) return null;

    return allClients.find((client) =>
      normalizeClientIdentityName(client.name) === targetName &&
      normalizeClientIdentityPhone(client.phone) === targetPhone,
    ) ?? null;
  }, [allClients, name, phone]);

  const storedClientByPhone = useMemo(() => {
    const targetPhone = normalizeClientIdentityPhone(phone);
    if (!targetPhone || !allClients) return null;

    return allClients.find((client) =>
      normalizeClientIdentityPhone(client.phone) === targetPhone,
    ) ?? null;
  }, [allClients, phone]);

  const clientWithExistingContract = useMemo(() => {
    if (clientId !== null) {
      return allClients?.find((client) => client.id === clientId) ?? null;
    }

    return storedClientByIdentity ?? storedClientByPhone ?? null;
  }, [allClients, clientId, storedClientByIdentity, storedClientByPhone]);
  const hasExistingContractRecord = Boolean(clientWithExistingContract?.eDocId);

  useEffect(() => {
    if (!allClients) return;

    const targetName = normalizeClientIdentityName(name);
    const currentPhoneDigits = normalizeClientIdentityPhone(phone);
    if (!currentPhoneDigits) return;

    const selectedClient = clientId !== null
      ? allClients.find((client) => client.id === clientId)
      : allClients.find((client) => (
        targetName &&
        normalizeClientIdentityName(client.name) === targetName &&
        (
          normalizeClientIdentityPhone(client.phone) === currentPhoneDigits ||
          (
            normalizeClientIdentityPhone(client.phone).length === currentPhoneDigits.length + 1 &&
            normalizeClientIdentityPhone(client.phone).startsWith(currentPhoneDigits)
          )
        )
      ));

    if (!selectedClient) return;

    if (selectedClient.phone) {
      const selectedPhoneDigits = normalizeClientIdentityPhone(selectedClient.phone);
      const selectedPhone = formatPhoneNumber(selectedClient.phone);

      if (
        selectedPhone &&
        selectedPhone !== phone &&
        currentPhoneDigits.length > 0 &&
        selectedPhoneDigits.length === currentPhoneDigits.length + 1 &&
        selectedPhoneDigits.startsWith(currentPhoneDigits)
      ) {
        setPhone(selectedPhone);
      }
    }

    const selectedBirthday = normalizeBirthdayInput(clientBirthdayValue(selectedClient));
    if (!birthday && selectedBirthday) {
      setBirthday(selectedBirthday);
    }
  }, [allClients, birthday, clientId, name, phone, setBirthday, setPhone]);

  useEffect(() => {
    if (!preservePrefilledPrices) return;
    if (fullPrice || grant || actualPrice) setPricesManuallyEdited(true);
    setPreservePrefilledPrices(false);
  }, [
    actualPrice,
    fullPrice,
    grant,
    preservePrefilledPrices,
    setPreservePrefilledPrices,
  ]);

  useEffect(() => {
    if (hasSelectableVoucherType || !fullPrice || !grant || !actualPrice) return;

    const normalizedFullPrice = normalizeAmount(fullPrice);
    const normalizedGrant = normalizeAmount(grant);
    const normalizedActualPrice = normalizeAmount(actualPrice);
    if (!normalizedFullPrice || !normalizedGrant || !normalizedActualPrice) return;

    const matches = (allVoucherPrices ?? []).filter((priceInfo) =>
      normalizeAmount(priceInfo.fullPrice) === normalizedFullPrice &&
      normalizeAmount(priceInfo.grant) === normalizedGrant &&
      normalizeAmount(priceInfo.actualPrice) === normalizedActualPrice,
    );
    const matchedPrice =
      matches.find((priceInfo) => String(priceInfo.duration) === voucherDuration) ??
      matches[0];
    const matchedType = matchedPrice?.type?.trim();

    if (!matchedPrice || !matchedType) return;

    setVoucherType(matchedType);
    setVoucherDuration(String(matchedPrice.duration));
    setPricesManuallyEdited(true);
  }, [
    actualPrice,
    allVoucherPrices,
    fullPrice,
    grant,
    setVoucherDuration,
    setVoucherType,
    hasSelectableVoucherType,
    voucherDuration,
  ]);

  useEffect(() => {
    if (!voucherType || voucherDuration || !voucherPriceInfos || voucherPriceInfos.length !== 1) return;
    const onlyDuration = String(voucherPriceInfos[0]?.duration ?? "");
    if (onlyDuration) setVoucherDuration(onlyDuration);
  }, [setVoucherDuration, voucherDuration, voucherPriceInfos, voucherType]);

  // Default voucher year to the most recent available
  useEffect(() => {
    if (!voucherYear && voucherYears && voucherYears.length > 0) {
      setVoucherYear(Math.max(...voucherYears));
    }
  }, [voucherYear, voucherYears, setVoucherYear]);

  // Auto-fill prices from voucher selection unless user edited manually
  useEffect(() => {
    if (selectedPriceInfo && !pricesManuallyEdited && !preservePrefilledPrices) {
      if (selectedPriceInfo.fullPrice != null) setFullPrice(String(selectedPriceInfo.fullPrice));
      if (selectedPriceInfo.grant != null) setGrant(String(selectedPriceInfo.grant));
      if (selectedPriceInfo.actualPrice != null) setActualPrice(String(selectedPriceInfo.actualPrice));
    }
  }, [
    selectedPriceInfo,
    pricesManuallyEdited,
    preservePrefilledPrices,
    setFullPrice,
    setGrant,
    setActualPrice,
  ]);

  // Business-day end date auto-calc from startDate + duration
  useEffect(() => {
    if (!startDate || !voucherDuration) return;
    const n = parseInt(voucherDuration, 10);
    if (!Number.isFinite(n) || n <= 0) return;
    const endIso = calcEndDateBusinessDays(startDate, n);
    if (endIso) setEndDate(endIso);
  }, [startDate, voucherDuration, setEndDate]);

  const showFloatingError = (message: string) => {
    setFloatingError(message);
    if (floatingErrorTimeoutRef.current) clearTimeout(floatingErrorTimeoutRef.current);
    floatingErrorTimeoutRef.current = setTimeout(() => {
      setFloatingError(null);
      floatingErrorTimeoutRef.current = null;
    }, 5000);
  };

  useEffect(() => () => {
    if (floatingErrorTimeoutRef.current) clearTimeout(floatingErrorTimeoutRef.current);
    progressSourceRef.current?.close();
  }, []);

  const handleClientSelect = (selectedClientId: number | null, client: Client | null) => {
    setClientId(selectedClientId);
    selectedClientRef.current = client;
    setEmployeeSelection(null, "", "");
    setEmployee2Selection(null, "", "");
    setShowEmployee2(false);
    if (client) {
      setName(client.name);
      setPhone(formatPhoneNumber(client.phone || ""));
      setBirthday(normalizeBirthdayInput(clientBirthdayValue(client)));
      setAddress(client.address || "");
      setDueDate(normalizeIsoDate(client.dueDate));
      setArea("");
      if (client.type) setVoucherType(client.type);
      if (client.duration) setVoucherDuration(client.duration.toString());
      if (client.fullPrice) setFullPrice(client.fullPrice);
      if (client.grant) setGrant(client.grant);
      if (client.actualPrice) setActualPrice(client.actualPrice);
      if (client.startDate) {
        const startNorm = normalizeIsoDate(client.startDate);
        setStartDate(startNorm);
        setPaymentDate(defaultPaymentDate);
      }
      if (client.endDate) setEndDate(normalizeIsoDate(client.endDate));
      if (client.primaryEmployee && employees) {
        const primaryEmp = employees.find((e) => e.id === client.primaryEmployee?.id);
        if (primaryEmp) {
          setEmployeeSelection(primaryEmp.id, primaryEmp.name, primaryEmp.phone);
          setIsEmployeeManualEntry(false);
        }
      }
      if (client.secondaryEmployee && employees) {
        const secondaryEmp = employees.find((e) => e.id === client.secondaryEmployee?.id);
        if (secondaryEmp) {
          setShowEmployee2(true);
          setEmployee2Selection(secondaryEmp.id, secondaryEmp.name, secondaryEmp.phone);
          setIsEmployee2ManualEntry(false);
        }
      }
      setIsManualEntry(false);
    } else {
      setName(""); setPhone(""); setBirthday(""); setAddress(""); setDueDate("");
      setVoucherType(""); setVoucherDuration("");
      setFullPrice(""); setGrant(""); setActualPrice("");
      setStartDate(""); setEndDate(""); setPaymentDate(defaultPaymentDate);
      setArea("");
      setEmployeeSelection(null, "", "");
      setEmployee2Selection(null, "", "");
      setShowEmployee2(false);
    }
    setPricesManuallyEdited(false);
  };

  const handleClientNameInputChange = (nextName: string) => {
    const isNameChanging = nextName !== name;
    setName(nextName);
    const matchesSelectedClient = clientId !== null && selectedClientRef.current?.name === nextName;
    const hasSelectedClientSnapshot = clientId !== null && selectedClientRef.current !== null;
    const willClearSelectedClient = hasSelectedClientSnapshot && !matchesSelectedClient;
    if (willClearSelectedClient) {
      setClientId(null);
      selectedClientRef.current = null;
      setArea("");
    } else if (isNameChanging && clientId === null && area) {
      setArea("");
    }
    setIsManualEntry(Boolean(nextName.trim()) && !matchesSelectedClient && (clientId === null || willClearSelectedClient));
  };

  const handleClientManualEntry = (query: string) => {
    setClientId(null);
    selectedClientRef.current = null;
    setName(query.trim() || name);
    setArea("");
    setIsManualEntry(true);
  };

  const handleEmployeeSelect = (selectedEmployeeId: number | null, employee: Employee | null) => {
    if (employee) {
      setEmployeeSelection(selectedEmployeeId, employee.name, employee.phone);
      setIsEmployeeManualEntry(false);
    } else {
      setEmployeeSelection(null, "", "");
      setIsEmployeeManualEntry(false);
    }
  };

  const handleEmployee2Select = (selectedEmployeeId: number | null, employee: Employee | null) => {
    if (employee) {
      setEmployee2Selection(selectedEmployeeId, employee.name, employee.phone);
      setIsEmployee2ManualEntry(false);
    } else {
      setEmployee2Selection(null, "", "");
      setIsEmployee2ManualEntry(false);
    }
  };

  const handleEmployee2VisibilityChange = (checked: boolean) => {
    setShowEmployee2(checked);
    if (!checked) {
      setEmployee2Selection(null, "", "");
    }
  };

  const handlePriceChange = (field: "fullPrice" | "grant" | "actualPrice", value: string) => {
    setPricesManuallyEdited(true);
    if (field === "fullPrice") setFullPrice(value);
    else if (field === "grant") setGrant(value);
    else setActualPrice(value);
  };

  const handleVoucherTypeChange = (next: string) => {
    setVoucherType(next);
    setVoucherDuration("");
    setFullPrice(""); setGrant(""); setActualPrice("");
    setPricesManuallyEdited(false);
  };

  const handleDurationChange = (next: string) => {
    setVoucherDuration(next);
    setPricesManuallyEdited(false);
  };


  const isStep1Valid = Boolean(
    (clientId !== null || (isManualEntry && name.trim() && phone.trim())) && area
  );
  const isEmployee1Valid = employeeId !== null;
  const isEmployee2Valid = !showEmployee2 || employee2Id !== null;
  const isStep2Valid = isEmployee1Valid && isEmployee2Valid;
  const isStep3Valid = Boolean(voucherType && voucherDuration && fullPrice && grant && actualPrice);
  const isStep4Valid = Boolean(
    startDate && isStrictIsoDate(startDate) &&
    endDate && isStrictIsoDate(endDate) &&
    effectivePaymentDate && isStrictIsoDate(effectivePaymentDate)
  );
  const isCurrentStepValid = [isStep1Valid, isStep2Valid, isStep3Valid, isStep4Valid][activeStep] ?? true;

  const getStepValidationMessage = (step: number): string | null => {
    if (step === 0 && !isStep1Valid) return "고객 정보와 계약서를 선택해 주세요.";
    if (step === 1 && !isStep2Valid) return "등록된 제공인력을 목록에서 선택해 주세요.";
    if (step === 2 && !isStep3Valid) return "바우처 유형/기간과 금액 정보를 입력해 주세요.";
    if (step === 3 && !isStep4Valid) return "계약 시작일, 종료일, 본인부담금 수령 날짜를 입력해 주세요.";
    return null;
  };

  const handleNext = () => {
    if (!isCurrentStepValid) {
      const msg = getStepValidationMessage(activeStep);
      if (msg) showFloatingError(msg);
      return;
    }
    if (activeStep === WIZARD_STEPS.length - 1) {
      if (hasExistingContractRecord) {
        setIsExistingContractConfirmOpen(true);
        return;
      }
      void handleSubmit();
      return;
    }
    setActiveStep((s) => s + 1);
  };

  const handlePrev = () => {
    if (activeStep === 0) return;
    setActiveStep((s) => s - 1);
  };

  const runIframeFallback = async (
    contractData: ContractDataDto,
    finalClientId: number,
    expiry: dayjs.Dayjs,
  ) => {
    if (!isEformsignLoaded) {
      showFloatingError("eformsign SDK가 아직 로드되지 않았습니다. 잠시 후 다시 시도해주세요.");
      return;
    }
    const documentOption: EformsignDocumentOption = await eformsignApi.generateDocument(
      contractData as unknown as Parameters<typeof eformsignApi.generateDocument>[0],
      finalClientId,
    );
    setIsEformsignModalOpen(true);
    setTimeout(() => {
      openDocument(documentOption, "eformsign_iframe", {
        onSuccess: async (response) => {
          if (finalClientId && response.document_id) {
            try {
              await eformsignApi.createDocRecord(buildInitialSignRequestDocRecord({
                documentId: response.document_id,
                clientId: finalClientId,
                stepRecipientName: name,
                stepRecipientSms: phone,
                expiredDate: expiry.add(30, "day").toISOString(),
                linkToClient: true,
              }));
            } catch (docError) {
              console.error("Failed to create eformsign doc record:", docError);
            }
          }
          queryClient.invalidateQueries({ queryKey: eformsignQueryKeys.documents() });
          startNavigation();
          setTimeout(() => {
            setIsEformsignModalOpen(false);
            router.push("/contracts");
          }, SUCCESS_REDIRECT_DELAY_MS);
        },
        onError: (response) => {
          showFloatingError(`문서 생성 실패: ${response.message}`);
          setIsEformsignModalOpen(false);
        },
        onAction: () => { /* noop */ },
      });
    }, 500);
  };

  const handleSubmit = async () => {
    if (employeeId === null || (showEmployee2 && employee2Id === null)) {
      setActiveStep(1);
      showFloatingError("등록된 제공인력을 목록에서 선택해 주세요.");
      return;
    }
    setIsSubmitting(true);
    setProgressErrorHint(null);

    let autoRegisteredClientId: number | null = null;
    try {
      // 1. Manual-entry client creation
      let finalClientId = clientId ?? storedClientByIdentity?.id ?? storedClientByPhone?.id ?? null;
      const assignment = {
        primaryEmployeeId: employeeId,
        secondaryEmployeeId: showEmployee2 ? employee2Id : null,
      };
      const clientData = {
        ...assignment,
        name,
        phone,
        birthday: birthday || undefined,
        address: address || null,
        dueDate: dueDate || startDate || undefined,
        type: voucherType || null,
        duration: Number(voucherDuration) || null,
        fullPrice: fullPrice || null,
        grant: grant || null,
        actualPrice: actualPrice || null,
        startDate: startDate || null,
        endDate: endDate || null,
        areaId: area || null,
      };
      if (!finalClientId && isManualEntry) {
        const autoRegistrationPayload = {
          ...clientData,
          careCenter: false,
          voucherClient: true,
          breastPump: false,
          source: "contract_auto_registration" as const,
        };
        let newClient;
        let reusedExistingClient = false;
        try {
          newClient = await createClientMutation.mutateAsync(autoRegistrationPayload);
        } catch (error) {
          if (!isAxiosError<{ message?: string; error?: string; clientId?: number }>(error) || error.response?.status !== 409) throw error;
          const conflict = error.response.data;
          if (!conflict.clientId) throw new Error(getApiErrorMessage(error, "고객 자동 등록에 실패했습니다."));
          const shouldReuse = await requestConfirmation("이미 같은 전화번호의 고객이 있습니다. 기존 고객으로 계약을 진행할까요?");
          if (!shouldReuse) return;
          reusedExistingClient = true;
          newClient = await createClientMutation.mutateAsync({ ...autoRegistrationPayload, reuseExistingClient: true });
        }
        finalClientId = newClient.id;
        if (!reusedExistingClient) autoRegisteredClientId = newClient.id;
        setClientId(newClient.id);
      }
      if (!finalClientId) {
        throw new Error("고객 정보를 먼저 선택하거나 등록해 주세요.");
      }
      if (clientId !== null || storedClientByIdentity || storedClientByPhone) {
        await updateClientMutation.mutateAsync({
          id: finalClientId,
          dto: clientData,
        });
      }

      // 2. Eformsign auth (cookies)
      const authResult = await eformsignApi.authenticate(Date.now(), undefined, { force: true });
      if (!authResult.success) throw new Error("Failed to authenticate");

      // 3. Build contract data
      const start = dayjs(startDate);
      const end = dayjs(endDate);
      const payment = dayjs(effectivePaymentDate);
      const contractData: ContractDataDto = {
        customerName: name,
        customerContact: phone,
        customerDOB: birthday,
        customerAddress: address,
        caretaker1Name: employeeName,
        caretaker1Contact: employeePhone,
        type: voucherType,
        days: voucherDuration,
        area,
        contractDuration: `${start.format("YYYY-MM-DD")} ~ ${end.format("YYYY-MM-DD")}`,
        startYear: start.format("YY"), startMonth: start.format("MM"), startDay: start.format("DD"), startDate,
        endYear: end.format("YY"), endMonth: end.format("MM"), endDay: end.format("DD"), endDate,
        paymentYear: payment.format("YY"), paymentMonth: payment.format("MM"), paymentDay: payment.format("DD"),
        fullPrice, grant, actualPrice,
      };

      // 4. Headless dispatch (primary path)
      const progressId = createHeadlessProgressId();
      let headlessOk = false;
      let headlessFailureReason: string | undefined;
      let headlessFailureStep: string | undefined;
      let headlessFallbackHint: string | undefined;
      let progressSource: EventSource | null = null;
      setCreationProgress({ step: "client-started", completed: false, failed: false });
      setIsProgressModalOpen(true);

      try {
        progressSource = new EventSource(
          `/api/eformsign-docs/dispatch-headless/progress?progressId=${encodeURIComponent(progressId)}`,
        );
        progressSourceRef.current = progressSource;
        progressSource.addEventListener("progress", (event) => {
          let data: HeadlessProgressEvent;
          try { data = JSON.parse((event as MessageEvent).data) as HeadlessProgressEvent; }
          catch { return; }
          if (data.step === "failed") {
            const errorHint = getSafeHeadlessFailureMessage(data.reason);
          setCreationProgress((current) => {
            const next = resolveFailedHeadlessProgress(
              current,
              data.failedStep,
              CONTRACT_CREATION_PROGRESS_STEPS,
            );
            if (next !== current) {
              setProgressErrorHint(errorHint);
            }
            return next;
          });
          headlessFailureReason = data.reason;
          headlessFailureStep = data.failedStep;
          return;
        }
          if (!isHeadlessProgressStepKey(data.step, CONTRACT_CREATION_PROGRESS_STEPS)) return;
          const nextStep = data.step;
          setCreationProgress((current) =>
            resolveNextHeadlessProgress(current, nextStep, CONTRACT_CREATION_PROGRESS_STEPS),
          );
        });

        const headless = await eformsignApi.dispatchHeadless(
          contractData as unknown as Parameters<typeof eformsignApi.dispatchHeadless>[0],
          finalClientId,
          progressId,
        );

        if (headless.ok) {
          headlessOk = true;
          startNavigation();
          setCreationProgress({ step: "sent", completed: true, failed: false });
          queryClient.invalidateQueries({ queryKey: eformsignQueryKeys.documents() });
          setTimeout(() => {
            setIsProgressModalOpen(false);
            router.push("/contracts");
          }, SUCCESS_REDIRECT_DELAY_MS);
          return;
        }

        if (headless.reason === "local_persist_failed" && headless.remoteDocumentId) {
          try {
            await eformsignApi.adoptDocument(headless.remoteDocumentId, finalClientId);
            startNavigation();
            setCreationProgress({ step: "sent", completed: true, failed: false });
            queryClient.invalidateQueries({ queryKey: eformsignQueryKeys.documents() });
            setTimeout(() => { setIsProgressModalOpen(false); router.push("/contracts"); }, SUCCESS_REDIRECT_DELAY_MS);
          } catch {
            setProgressErrorHint("문서는 생성되었으나 등록에 실패했습니다. 잠시 후 다시 시도해 주세요.");
          }
          return;
        }
        if (headless.reason === "remote_unconfirmed" || headless.fallbackHint === "manual_check" || headless.fallbackHint === "adopt-or-manual") {
          setProgressErrorHint("문서 생성 상태를 확인할 수 없습니다. 전자문서 목록에서 확인 후 다시 시도해 주세요.");
          return;
        }
        if (headless.reason === "duplicate_pending_document") {
          setProgressErrorHint("최근 생성된 진행 중 문서가 있습니다.");
          if (await requestConfirmation("최근 생성된 진행 중 문서가 있습니다. 그래도 새로 생성하시겠습니까?")) {
            const forced = await eformsignApi.dispatchHeadless(contractData as unknown as Parameters<typeof eformsignApi.dispatchHeadless>[0], finalClientId, progressId, true);
            if (forced.ok) {
              startNavigation();
              setCreationProgress({ step: "sent", completed: true, failed: false });
              queryClient.invalidateQueries({ queryKey: eformsignQueryKeys.documents() });
              setTimeout(() => { setIsProgressModalOpen(false); router.push("/contracts"); }, SUCCESS_REDIRECT_DELAY_MS);
            }
          }
          return;
        }

        headlessFailureReason = headless.reason;
        headlessFailureStep = headless.failedStep;
        headlessFallbackHint = headless.fallbackHint;
        console.warn("[contract-creation] headless dispatch returned ok=false", {
          reason: headless.reason,
          failedStep: headless.failedStep,
          durationMs: headless.durationMs,
        });
        const errorHint = getSafeHeadlessFailureMessage(headless.reason);
        setCreationProgress((current) => {
          const next = resolveFailedHeadlessProgress(
            current,
            headless.failedStep,
            CONTRACT_CREATION_PROGRESS_STEPS,
          );
          if (next !== current) {
            setProgressErrorHint(errorHint);
          }
          return next;
        });
      } catch (headlessError) {
        headlessFailureReason = headlessError instanceof Error ? headlessError.message : undefined;
        console.warn("[contract-creation] headless dispatch threw", headlessError);
        const errorHint = getSafeHeadlessFailureMessage(headlessFailureReason);
        setCreationProgress((current) => {
          const next = resolveFailedHeadlessProgress(
            current,
            undefined,
            CONTRACT_CREATION_PROGRESS_STEPS,
          );
          if (next !== current) {
            setProgressErrorHint(errorHint);
          }
          return next;
        });
      } finally {
        progressSource?.close();
        progressSourceRef.current = null;
      }

      // 5. Fallback to iframe modal if headless failed
      if (!headlessOk && headlessFallbackHint === "iframe") {
        console.warn("[contract-creation] falling back to iframe", {
          reason: headlessFailureReason,
          failedStep: headlessFailureStep,
        });
        if (headlessFailureReason) {
          showFloatingError(getSafeHeadlessFailureMessage(headlessFailureReason));
        }
        setIsProgressModalOpen(false);
        await runIframeFallback(contractData, finalClientId, end);
      }
    } catch (err: unknown) {
      setIsProgressModalOpen(false);
      const msg = err instanceof Error ? err.message : "계약서 생성 중 오류가 발생했습니다.";
      showFloatingError(autoRegisteredClientId ? `${msg} 방금 자동 등록된 고객이 남아 있습니다.` : msg);
      if (autoRegisteredClientId && (await requestConfirmation("방금 자동 등록된 고객이 남아 있습니다. 고객을 삭제할까요?"))) {
        try {
          await deleteClientMutation.mutateAsync(autoRegisteredClientId);
          setClientId(null);
        } catch (deleteError) {
          if (isAxiosError<{ message?: string }>(deleteError)) {
            showFloatingError(deleteError.response?.data.message || "고객 삭제에 실패했습니다.");
          }
        }
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const goBack = () => router.push("/contracts");
  const progress = ((activeStep + 1) / WIZARD_STEPS.length) * 100;
  const activeStepMeta = WIZARD_STEPS[activeStep];
  const isFirstStep = activeStep === 0;
  const isLastStep = isContractInfoStep;
  const isBusy = isSubmitting || isNavigationPending;
  const isPrimaryDisabled = isBusy || !isCurrentStepValid;

  return (
    <>
      <AnimatePresence>
        {floatingError && (
          <motion.div
            data-component="mobile_contracts-new_feedback_toast"
            className="fixed right-4 top-[calc(env(safe-area-inset-top)+4.75rem)] z-[1001] max-w-[320px] overflow-hidden rounded-2xl bg-v3-burgundy-light px-4 py-3 text-[0.8rem] font-semibold text-v3-burgundy shadow-[0_8px_24px_hsla(349,50%,45%,0.2)] md:top-4"
            initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.92, y: -6 }}
            animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
            exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.95, y: -4 }}
            transition={{ duration: prefersReducedMotion ? 0.16 : 0.28, ease: [0.22, 1, 0.36, 1] }}
          >
            <span className="relative z-[1]" data-component="mobile_contracts-new_feedback_toast_toast-message">
              {floatingError}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <div
        className={styles.pageRoot}
        data-component="mobile_contracts-new_screen_root"
        data-slot="contract-creation-screen"
      >
        <div className={styles.navPage} data-component="mobile_contracts-new_screen_root_page">
          <header className={styles.navbar} data-component="mobile_contracts-new_screen_root_page_root">
            <button
              data-component="mobile_contracts-new_screen_root_page_root_back-button"
              type="button"
              onClick={goBack}
              className={styles.navbarIconButton}
              aria-label="계약 목록으로 돌아가기"
            >
              <ChevronLeft aria-hidden="true" size={20} strokeWidth={2.5} />
            </button>
            <div className={styles.navbarTitle} data-component="mobile_contracts-new_screen_root_page_root_title">계약서 생성</div>
            <button
              data-component="mobile_contracts-new_screen_root_page_root_close-button"
              type="button"
              onClick={goBack}
              className={styles.navbarIconButton}
              aria-label="계약서 생성 닫기"
            >
              <X aria-hidden="true" size={20} strokeWidth={2.5} />
            </button>
          </header>

          <section className={styles.wizardContent} data-component="mobile_contracts-new_screen_root_page_root">
            <div className={styles.wizardHeader} data-component="mobile_contracts-new_screen_root_page_root_header">
              <div className={styles.progressRow} data-component="mobile_contracts-new_screen_root_page_root_header_progress-row">
                <div className={styles.progressTrack} data-component="mobile_contracts-new_screen_root_page_root_header_progress-row_progress-track" aria-hidden="true">
                  <div
                    className={styles.progressFill}
                    data-component="mobile_contracts-new_screen_root_page_root_header_progress-row_progress-track_progress-fill"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <div className={styles.stepCount} data-component="mobile_contracts-new_screen_root_page_root_header_progress-row_step-count">
                  <span>{activeStep + 1}</span> / {WIZARD_STEPS.length} 단계
                </div>
              </div>
              <h1 className={styles.stepTitle} data-component="mobile_contracts-new_screen_root_page_root_header_step-title">
                {activeStepMeta.title}
              </h1>
              <p className={styles.stepDesc} data-component="mobile_contracts-new_screen_root_page_root_header_step-description">
                {activeStepMeta.desc}
              </p>
            </div>

            <div className={styles.formScroll} data-component="mobile_contracts-new_screen_root_page_root_form-scroll">
              {activeStep === 0 ? (
                <>
                  <div className={styles.formCard} data-component="mobile_contracts-new_screen_root_page_root_form-scroll_card">
                    <div className={styles.formCardTitle} data-component="mobile_contracts-new_screen_root_page_root_form-scroll_card_card-title">
                      이용자 정보
                      <span className={styles.optionalBadge}>기존 고객 또는 직접 입력</span>
                    </div>
                    <Field dataComponent="mobile_contracts-new_client_name-field" label="이름" required>
                      <ClientAutocomplete
                        data-component="mobile_contracts-new_screen_root_page_root_form-scroll_card_autocomplete"
                        value={clientId}
                        onChange={handleClientSelect}
                        inputValue={name}
                        onInputValueChange={handleClientNameInputChange}
                        label=""
                        allowManualEntry
                        manualEntryLabel="직접 입력으로 진행"
                        manualEntryDescription="입력한 이름으로 새 계약을 작성합니다"
                        onManualEntry={handleClientManualEntry}
                      />
                    </Field>
                    <Field dataComponent="mobile_contracts-new_client_phone-field" label="연락처" required>
                      <input
                        data-component="mobile_contracts-new_screen_root_page_root_form-scroll_card_phone-input"
                        className={styles.formInput}
                        value={phone}
                        onChange={(e) => setPhone(formatPhoneNumber(e.target.value))}
                        type="tel"
                        inputMode="numeric"
                        maxLength={13}
                        placeholder="010-1234-5678"
                      />
                    </Field>
                    <div className={styles.formGrid2}>
                      <Field dataComponent="mobile_contracts-new_client_birthday-field" label="생년월일">
                        <input
                          data-component="mobile_contracts-new_screen_root_page_root_form-scroll_card_birthday-input"
                          className={styles.formInput}
                          value={birthday}
                          onChange={(e) => setBirthday(e.target.value.replace(/\D/g, "").slice(0, 6))}
                          inputMode="numeric"
                          maxLength={6}
                          placeholder="YYMMDD"
                        />
                      </Field>
                      <Field dataComponent="mobile_contracts-new_client_start-date-field" label="서비스 시작일">
                        <input
                          data-component="mobile_contracts-new_screen_root_page_root_form-scroll_card_start-date-input"
                          className={styles.formInput}
                          value={startDateInput}
                          onChange={(e) => handleDateInputChange(setStartDateInput, setStartDate, e.target.value)}
                          inputMode="numeric"
                          maxLength={6}
                          placeholder="YYMMDD"
                        />
                      </Field>
                    </div>
                    <Field dataComponent="mobile_contracts-new_client_address-field" label="주소">
                      <input
                        data-component="mobile_contracts-new_screen_root_page_root_form-scroll_card_address-input"
                        className={styles.formInput}
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
                        placeholder="서울시 강남구..."
                      />
                    </Field>
                  </div>

                  <div className={styles.formCard} data-component="mobile_contracts-new_screen_root_page_root_form-scroll_area-card">
                    <Field dataComponent="mobile_contracts-new_client_area-field" label="계약서 유형" required>
                      <div className={styles.selectWrap}>
                        <select
                          data-component="mobile_contracts-new_screen_root_page_root_form-scroll_area-card_area-select"
                          className={styles.formInput}
                          value={area}
                          onChange={(e) => setArea(e.target.value)}
                        >
                          <option value="">선택하세요</option>
                          {(areaTemplates ?? []).map((tpl) => (
                            <option key={tpl.areaId} value={tpl.areaId}>
                              {getAreaTemplateDisplayLabel(tpl.areaId, tpl.templateName)}
                            </option>
                          ))}
                        </select>
                      </div>
                    </Field>
                  </div>
                </>
              ) : null}

              {activeStep === 1 ? (
                <>
                  <div className={styles.formCard} data-component="mobile_contracts-new_screen_root_page_root_form-scroll_primary-card">
                    <div className={styles.formCardTitle} data-component="mobile_contracts-new_screen_root_page_root_form-scroll_primary-card_primary-card-title">
                      제공인력 1<span className={styles.requiredMark}>*</span>
                    </div>
                    <div className={styles.formRow} data-component="mobile_contracts-new_screen_root_page_root_form-scroll_primary-card_primary-autocomplete-field">
                      <EmployeeAutocomplete
                        data-component="mobile_contracts-new_screen_root_page_root_form-scroll_primary-card_primary-autocomplete-field_primary-autocomplete"
                        value={employeeId}
                        onChange={handleEmployeeSelect}
                        label=""
                        excludeIds={employee2Id != null ? [employee2Id] : []}
                      />
                    </div>
                    <Field dataComponent="mobile_contracts-new_employee_primary-phone-field" label="연락처" required>
                      <input
                        data-component="mobile_contracts-new_screen_root_page_root_form-scroll_primary-card_primary-phone-input"
                        className={styles.formInput}
                        value={employeePhone}
                        type="tel"
                        inputMode="numeric"
                        maxLength={13}
                        placeholder="010-1234-5678"
                        readOnly
                      />
                    </Field>
                  </div>

                  <div className={styles.formCard} data-component="mobile_contracts-new_screen_root_page_root_form-scroll_secondary-card">
                    <div
                      className={styles.toggleRow}
                      data-component="mobile_contracts-new_screen_root_page_root_form-scroll_secondary-card_secondary-toggle-row"
                      onClick={() => handleEmployee2VisibilityChange(!showEmployee2)}
                      role="button"
                      tabIndex={0}
                    >
                      <div className={styles.toggleText} data-component="mobile_contracts-new_screen_root_page_root_form-scroll_secondary-card_secondary-toggle-row_secondary-toggle-copy">
                        <div className={styles.toggleLabel} data-component="mobile_contracts-new_screen_root_page_root_form-scroll_secondary-card_secondary-toggle-row_secondary-toggle-copy_secondary-toggle-label">
                          제공인력 2 추가
                        </div>
                      </div>
                      <Switch
                        data-component="mobile_contracts-new_screen_root_page_root_form-scroll_secondary-card_secondary-toggle-row_secondary-toggle"
                        aria-label="제공인력 2 토글"
                        checked={showEmployee2}
                        onClick={(event) => event.stopPropagation()}
                        onCheckedChange={handleEmployee2VisibilityChange}
                      />
                    </div>
                    {showEmployee2 ? (
                      <>
                        <div className={styles.dashedDivider} />
                        <div className={styles.formCardTitle} data-component="mobile_contracts-new_screen_root_page_root_form-scroll_secondary-card_secondary-card-title">
                          제공인력 2<span className={styles.requiredMark}>*</span>
                        </div>
                        <div className={styles.formRow} data-component="mobile_contracts-new_screen_root_page_root_form-scroll_secondary-card_secondary-autocomplete-field">
                          <EmployeeAutocomplete
                            data-component="mobile_contracts-new_screen_root_page_root_form-scroll_secondary-card_secondary-autocomplete-field_secondary-autocomplete"
                            value={employee2Id}
                            onChange={handleEmployee2Select}
                            label=""
                            excludeIds={employeeId != null ? [employeeId] : []}
                          />
                        </div>
                        <Field dataComponent="mobile_contracts-new_employee_secondary-phone-field" label="연락처" required>
                          <input
                            data-component="mobile_contracts-new_screen_root_page_root_form-scroll_secondary-card_secondary-phone-input"
                            className={styles.formInput}
                            value={employee2Phone}
                            type="tel"
                            inputMode="numeric"
                            maxLength={13}
                            placeholder="010-1234-5678"
                            readOnly
                          />
                        </Field>
                      </>
                    ) : null}
                  </div>
                </>
              ) : null}

              {activeStep === 2 ? (
                <>
                  <div className={styles.formCard} data-component="mobile_contracts-new_screen_root_page_root_form-scroll_selection-card">
                    <div className={styles.formCardTitle} data-component="mobile_contracts-new_screen_root_page_root_form-scroll_selection-card_selection-card-title">
                      바우처 선택
                    </div>
                    <div className={styles.formGrid2}>
                      <Field dataComponent="mobile_contracts-new_voucher_year-field" label="연도" required>
                        <div className={styles.selectWrap}>
                          <select
                            data-component="mobile_contracts-new_screen_root_page_root_form-scroll_selection-card_year-select"
                            className={styles.formInput}
                            value={voucherYear || ""}
                            onChange={(e) => setVoucherYear(Number(e.target.value))}
                          >
                            <option value="">선택</option>
                            {(voucherYears ?? []).map((y) => (
                              <option key={y} value={y}>{y}</option>
                            ))}
                          </select>
                        </div>
                      </Field>
                      <Field dataComponent="mobile_contracts-new_voucher_type-field" label="바우처 유형" required>
                        <div className={styles.selectWrap}>
                          <select
                            data-component="mobile_contracts-new_screen_root_page_root_form-scroll_selection-card_type-select"
                            className={styles.formInput}
                            value={voucherType}
                            onChange={(e) => handleVoucherTypeChange(e.target.value)}
                          >
                            <option value="">선택하세요</option>
                            {Object.entries(voucherOptions.voucherOptions).map(([groupName, types]) => (
                              <optgroup key={groupName} label={groupName}>
                                {Object.entries(types).map(([typeValue, typeData]) => (
                                  <option key={typeValue} value={typeValue}>
                                    {typeData.label}
                                  </option>
                                ))}
                              </optgroup>
                            ))}
                          </select>
                        </div>
                      </Field>
                    </div>
                    <Field dataComponent="mobile_contracts-new_voucher_duration-field" label="기간" required>
                      <div className={cn(styles.selectWrap, isPriceLoading ? styles.loadingSelect : !voucherType && styles.disabledSelect)}>
                        <select
                          data-component="mobile_contracts-new_screen_root_page_root_form-scroll_selection-card_duration-select"
                          className={styles.formInput}
                          value={voucherDuration}
                          onChange={(e) => handleDurationChange(e.target.value)}
                          disabled={!voucherType || isPriceLoading}
                        >
                          <option value="">선택하세요</option>
                          {availableDurations.map((d) => (
                            <option key={d} value={d}>{d}일</option>
                          ))}
                        </select>
                      </div>
                    </Field>
                  </div>

                  <div className={styles.formCard} data-component="mobile_contracts-new_screen_root_page_root_form-scroll_price-card">
                    <div className={styles.formCardTitle} data-component="mobile_contracts-new_screen_root_page_root_form-scroll_price-card_price-card-title">
                      요금 정보
                      {selectedPriceInfo && !pricesManuallyEdited ? (
                        <span className={styles.autoBadge}>자동입력</span>
                      ) : null}
                    </div>
                    <Field dataComponent="mobile_contracts-new_voucher_full-price-field" label="총 서비스 금액" required>
                      <div className={styles.priceInput}>
                        <input
                          data-component="mobile_contracts-new_screen_root_page_root_form-scroll_price-card_full-price-input"
                          className={styles.formInput}
                          value={formatPrice(fullPrice)}
                          onChange={(e) => handlePriceChange("fullPrice", parsePrice(e.target.value))}
                          inputMode="numeric"
                          placeholder="0"
                        />
                        <span>원</span>
                      </div>
                    </Field>
                    <Field dataComponent="mobile_contracts-new_voucher_grant-field" label="정부지원금" required>
                      <div className={styles.priceInput}>
                        <input
                          data-component="mobile_contracts-new_screen_root_page_root_form-scroll_price-card_grant-input"
                          className={styles.formInput}
                          value={formatPrice(grant)}
                          onChange={(e) => handlePriceChange("grant", parsePrice(e.target.value))}
                          inputMode="numeric"
                          placeholder="0"
                        />
                        <span>원</span>
                      </div>
                    </Field>
                    <Field dataComponent="mobile_contracts-new_voucher_actual-price-field" label="본인부담금" required>
                      <div className={styles.priceInput}>
                        <input
                          data-component="mobile_contracts-new_screen_root_page_root_form-scroll_price-card_actual-price-input"
                          className={styles.formInput}
                          value={formatPrice(actualPrice)}
                          onChange={(e) => handlePriceChange("actualPrice", parsePrice(e.target.value))}
                          inputMode="numeric"
                          placeholder="0"
                        />
                        <span>원</span>
                      </div>
                    </Field>
                  </div>
                </>
              ) : null}

              {activeStep === 3 ? (
                <>
                  <div className={styles.formCard} data-component="mobile_contracts-new_screen_root_page_root_form-scroll_period-card">
                    <div className={styles.formCardTitle} data-component="mobile_contracts-new_screen_root_page_root_form-scroll_period-card_period-card-title">
                      서비스 기간
                    </div>
                    <div className={styles.formGrid2}>
                      <Field dataComponent="mobile_contracts-new_review_start-date-field" label="시작일" required>
                        <input
                          data-component="mobile_contracts-new_screen_root_page_root_form-scroll_period-card_start-date-input"
                          className={styles.formInput}
                          value={startDateInput}
                          onChange={(e) => handleDateInputChange(setStartDateInput, setStartDate, e.target.value)}
                          inputMode="numeric"
                          maxLength={6}
                          placeholder="YYMMDD"
                        />
                      </Field>
                      <Field dataComponent="mobile_contracts-new_review_end-date-field" label="종료일" required>
                        <input
                          data-component="mobile_contracts-new_screen_root_page_root_form-scroll_period-card_end-date-input"
                          className={styles.formInput}
                          value={endDateInput}
                          onChange={(e) => handleDateInputChange(setEndDateInput, setEndDate, e.target.value)}
                          inputMode="numeric"
                          maxLength={6}
                          placeholder="YYMMDD"
                        />
                      </Field>
                    </div>
                    <div className={styles.formHelper}>
                      시작일 + 바우처 기간으로 종료일이 자동 계산됩니다 (주말·공휴일 제외).
                    </div>
                  </div>

                  <div className={styles.formCard} data-component="mobile_contracts-new_screen_root_page_root_form-scroll_payment-card">
                    <div className={styles.formCardTitle} data-component="mobile_contracts-new_screen_root_page_root_form-scroll_payment-card_payment-card-title">
                      결제 정보
                    </div>
                    <Field dataComponent="mobile_contracts-new_review_payment-date-field" label="본인부담금 수령 날짜" required>
                      <input
                        data-component="mobile_contracts-new_screen_root_page_root_form-scroll_payment-card_payment-date-input"
                        className={styles.formInput}
                        value={effectivePaymentDateInput}
                        onChange={(e) => handleDateInputChange(setPaymentDateInput, setPaymentDate, e.target.value)}
                        inputMode="numeric"
                        maxLength={6}
                        placeholder="YYMMDD"
                      />
                    </Field>
                  </div>

                  <div className={styles.formCard} data-component="mobile_contracts-new_screen_root_page_root_form-scroll_summary-card">
                    <div className={styles.formCardTitle} data-component="mobile_contracts-new_screen_root_page_root_form-scroll_summary-card_summary-card-title">
                      최종 확인
                    </div>
                    <div className={styles.priceSummary} data-component="mobile_contracts-new_screen_root_page_root_form-scroll_summary-card_summary-list">
                      <div className={styles.priceSummaryRow}>
                        <span>고객</span>
                        <span className={styles.amount}>{name || "-"}</span>
                      </div>
                      <div className={styles.priceSummaryRow}>
                        <span>제공인력</span>
                        <span className={styles.amount}>{employeeName || "-"}</span>
                      </div>
                      <div className={styles.priceSummaryRow}>
                        <span>바우처</span>
                        <span className={styles.amount}>
                          {voucherType ? `${voucherType} · ${voucherDuration}일` : "-"}
                        </span>
                      </div>
                      <div className={styles.priceSummaryRow}>
                        <span>기간</span>
                        <span className={styles.amount}>
                          {startDate && endDate
                            ? `${dayjs(startDate).format("YYYY.MM.DD")} → ${dayjs(endDate).format("YYYY.MM.DD")}`
                            : "-"}
                        </span>
                      </div>
                      <div className={cn(styles.priceSummaryRow, styles.total)}>
                        <span>본인부담금</span>
                        <span className={styles.amount}>{actualPrice ? `${formatPrice(actualPrice)} 원` : "-"}</span>
                      </div>
                    </div>
                  </div>

                </>
              ) : null}
            </div>

            <div className={styles.wizardActions} data-component="mobile_contracts-new_screen_root_page_root_actions">
              <button
                data-component="mobile_contracts-new_screen_root_page_root_actions_previous-button"
                type="button"
                onClick={handlePrev}
                disabled={isFirstStep}
                className={cn(styles.wizardButton, styles.secondaryButton)}
              >
                이전
              </button>
              <button
                data-component="mobile_contracts-new_screen_root_page_root_actions_next-button"
                type="button"
                onClick={handleNext}
                disabled={isPrimaryDisabled}
                className={cn(styles.wizardButton, styles.primaryButton)}
              >
                {isBusy ? "생성 중..." : isLastStep ? "계약서 생성" : "다음"}
              </button>
            </div>
          </section>
        </div>
      </div>

      <HeadlessProgressModal
        open={isProgressModalOpen}
        title="전자문서 생성 중"
        steps={CONTRACT_CREATION_PROGRESS_STEPS}
        progress={creationProgress}
        errorHint={progressErrorHint}
        data-component="mobile_contracts-new_progress_modal"
      />

      <MobileTwoButtonModal
        data-component="mobile_contracts-new_confirmation_submit-modal"
        open={confirmationMessage !== null}
        title="계약서 생성 확인"
        description={confirmationMessage ?? ""}
        cancelLabel="취소"
        confirmLabel="확인"
        confirmVariant="default"
        actionOrder="cancel-confirm"
        onOpenChange={(open) => {
          if (!open) resolveConfirmation(false);
        }}
        onCancel={() => resolveConfirmation(false)}
        onConfirm={() => resolveConfirmation(true)}
      />

      <MobileTwoButtonModal
        data-component="mobile_contracts-new_confirmation_existing-contract-modal"
        open={isExistingContractConfirmOpen}
        title="계약서 재생성 확인"
        description="이전에 전송된 계약서가 있습니다. 그래도 새로 생성하시겠어요?"
        cancelLabel="취소"
        confirmLabel="생성"
        confirmVariant="default"
        actionOrder="cancel-confirm"
        loading={isBusy}
        onOpenChange={(open) => {
          if (!isBusy) setIsExistingContractConfirmOpen(open);
        }}
        onCancel={() => setIsExistingContractConfirmOpen(false)}
        onConfirm={() => {
          setIsExistingContractConfirmOpen(false);
          void handleSubmit();
        }}
      />

      {isEformsignModalOpen ? (
        <div className={styles.eformsignModal} data-component="mobile_contracts-new_signing_modal">
          <div className={styles.eformsignModalHeader} data-component="mobile_contracts-new_signing_modal_header">
            <span data-component="mobile_contracts-new_signing_modal_header_title">계약서 서명</span>
            <button
              data-component="mobile_contracts-new_signing_modal_header_close-button"
              type="button"
              onClick={() => setIsEformsignModalOpen(false)}
              className={styles.navbarIconButton}
              aria-label="닫기"
            >
              <X aria-hidden="true" size={20} strokeWidth={2.5} />
            </button>
          </div>
          <iframe
            id="eformsign_iframe"
            className={styles.eformsignIframe}
            data-component="mobile_contracts-new_signing_modal_iframe"
            title="eformsign"
          />
        </div>
      ) : null}

    </>
  );
}
