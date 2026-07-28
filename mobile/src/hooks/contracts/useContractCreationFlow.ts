"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import dayjs from "dayjs";
import { useQueryClient } from "@tanstack/react-query";

import { useFormStore } from "@/stores/form-store";
import { useEformsign } from "@/hooks/useEformsign";
import { useToast } from "@/hooks/use-toast";
import {
  useAllVoucherPrices,
  useAreaTemplates,
  useVoucherPriceInfos,
  useVoucherYears,
  type AreaTemplate,
  type VoucherPriceInfo,
} from "@/hooks/useVoucherData";
import { useAllClients, useCreateClient } from "@/hooks/useClients";
import { useEmployees, type Employee } from "@/hooks/useEmployees";
import { eformsignQueryKeys } from "@/hooks/useEformsignDocuments";
import { eformsignApi } from "@/services/api";
import type { EformsignDocumentOption } from "@/lib/eformsign/types";
import type { Client } from "@/lib/client/types";
import voucherOptionsJson from "@/components/app/messages/templates/json/voucher.json";
import {
  isStrictIsoDate,
  isoToYymmdd,
  normalizeIsoDate,
  todayIsoDate,
  yymmddToIso,
} from "@/lib/contracts/date-input";
import { buildContractAutoRegistrationPayload } from "@/lib/contracts/contract-auto-registration";
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
  type HeadlessProgressState,
  type HeadlessProgressEvent,
} from "@/lib/eformsign/headless-progress";

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
  startYear: string;
  startMonth: string;
  startDay: string;
  startDate: string;
  endYear: string;
  endMonth: string;
  endDay: string;
  endDate: string;
  paymentYear: string;
  paymentMonth: string;
  paymentDay: string;
  fullPrice: string;
  grant: string;
  actualPrice: string;
}

type VoucherOptionsJson = {
  voucherOptions: Record<string, Record<string, { label: string }>>;
};

type ClientWithBirthdayAliases = Client & Partial<Record<
  "birthDate" | "birth_date" | "dateOfBirth" | "customerBirthDate" | "customerDOB",
  string | null
>>;

export interface ContractCreationStepMeta {
  title: string;
  desc: string;
}

export interface ContractCreationOption<TValue extends string | number = string> {
  value: TValue;
  label: string;
}

export interface ContractCreationVoucherTypeOption extends ContractCreationOption {
  group: string;
}

export interface ContractCreationFlow {
  steps: readonly ContractCreationStepMeta[];
  activeStep: number;
  activeStepMeta: ContractCreationStepMeta;
  clients: Client[];
  employees: Employee[];
  areaOptions: ContractCreationOption[];
  voucherYearOptions: ContractCreationOption<number>[];
  voucherTypeOptions: ContractCreationVoucherTypeOption[];
  durationOptions: ContractCreationOption[];
  selectedClient: Client | null;
  selectedEmployee: Employee | null;
  selectedEmployee2: Employee | null;
  selectedAreaOption: ContractCreationOption | null;
  selectedVoucherYearOption: ContractCreationOption<number> | null;
  selectedVoucherTypeOption: ContractCreationVoucherTypeOption | null;
  selectedDurationOption: ContractCreationOption | null;
  selectedPriceInfo: VoucherPriceInfo | null;
  form: {
    clientId: number | null;
    name: string;
    phone: string;
    birthday: string;
    address: string;
    area: string;
    employeeId: number | null;
    employeeName: string;
    employeePhone: string;
    showEmployee2: boolean;
    employee2Id: number | null;
    employee2Name: string;
    employee2Phone: string;
    voucherYear: number;
    voucherType: string;
    voucherDuration: string;
    fullPrice: string;
    grant: string;
    actualPrice: string;
    startDate: string;
    endDate: string;
    paymentDate: string;
    startDateInput: string;
    endDateInput: string;
    effectivePaymentDateInput: string;
  };
  state: {
    pricesManuallyEdited: boolean;
    isPriceLoading: boolean;
    shouldShowClientRegistrationToggle: boolean;
    shouldRegisterMissingClient: boolean;
    hasExistingContractRecord: boolean;
    isSubmitting: boolean;
    isEformsignModalOpen: boolean;
    isProgressModalOpen: boolean;
    isExistingContractConfirmOpen: boolean;
    creationProgress: HeadlessProgressState;
    progressErrorHint: string | null;
    isFirstStep: boolean;
    isLastStep: boolean;
    isCurrentStepValid: boolean;
    isPrimaryDisabled: boolean;
  };
  summary: {
    clientName: string;
    employeeName: string;
    voucherLabel: string;
    periodLabel: string;
    actualPriceLabel: string;
  };
  actions: {
    goBack: () => void;
    setActiveStep: (step: number) => void;
    completeStep: () => void;
    selectClient: (selectedClientId: number | null, client: Client | null) => void;
    changeClientName: (nextName: string) => void;
    useManualClient: (query: string) => void;
    changePhone: (value: string) => void;
    changeBirthday: (value: string) => void;
    changeAddress: (value: string) => void;
    changeArea: (option: ContractCreationOption | null) => void;
    selectEmployee: (selectedEmployeeId: number | null, employee: Employee | null) => void;
    selectEmployee2: (selectedEmployeeId: number | null, employee: Employee | null) => void;
    changeEmployeeName: (nextName: string) => void;
    changeEmployee2Name: (nextName: string) => void;
    useManualEmployee: (query?: string) => void;
    useManualEmployee2: (query?: string) => void;
    changeEmployeePhone: (value: string) => void;
    changeEmployee2Phone: (value: string) => void;
    toggleEmployee2: () => void;
    changeVoucherYear: (option: ContractCreationOption<number> | null) => void;
    changeVoucherType: (option: ContractCreationVoucherTypeOption | null) => void;
    changeDuration: (option: ContractCreationOption | null) => void;
    changePrice: (field: "fullPrice" | "grant" | "actualPrice", value: string) => void;
    changeStartDate: (value: string) => void;
    changeEndDate: (value: string) => void;
    changePaymentDate: (value: string) => void;
    toggleClientRegistration: () => void;
    setExistingContractConfirmOpen: (open: boolean) => void;
    cancelExistingContractConfirm: () => void;
    confirmExistingContractSubmit: () => void;
    closeSigningModal: () => void;
  };
}

export const CONTRACT_CREATION_STEPS = [
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

const VOUCHER_OPTIONS = voucherOptionsJson as VoucherOptionsJson;

const formatPhoneNumber = formatKoreanPhoneNumber;

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

export const formatContractCreationPrice = (price: number | string): string => {
  if (!price && price !== 0) return "";
  const cleaned = typeof price === "string" ? price.replace(/,/g, "") : String(price);
  const num = parseInt(cleaned, 10);
  if (Number.isNaN(num)) return "";
  return num.toLocaleString("ko-KR");
};

export const parseContractCreationPrice = (value: string | null | undefined): string => {
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

const getAreaTemplateDisplayLabel = (areaId: string, templateName?: string | null): string => {
  const mappedLabel = AREA_TEMPLATE_DISPLAY_LABELS[areaId];
  if (mappedLabel) return mappedLabel;

  return templateName?.replace(/\s*계약서.*$/, "").trim() || areaId;
};

const toAreaOptions = (areaTemplates: AreaTemplate[] | undefined): ContractCreationOption[] =>
  (areaTemplates ?? []).map((template) => ({
    value: template.areaId,
    label: getAreaTemplateDisplayLabel(template.areaId, template.templateName),
  }));

const toVoucherTypeOptions = (): ContractCreationVoucherTypeOption[] =>
  Object.entries(VOUCHER_OPTIONS.voucherOptions).flatMap(([group, types]) =>
    Object.entries(types).map(([value, typeData]) => ({
      value,
      label: typeData.label,
      group,
    })),
  );

export function useContractCreationFlow(): ContractCreationFlow {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const createClientMutation = useCreateClient();
  const { isLoaded: isEformsignLoaded, openDocument } = useEformsign();
  const { data: allClients } = useAllClients();
  const { data: voucherYears } = useVoucherYears();
  const { data: areaTemplates } = useAreaTemplates();
  const { data: employees } = useEmployees();

  const {
    clientId, isManualEntry, name, phone, birthday, address, dueDate, area,
    employeeId, isEmployeeManualEntry, employeeName, employeePhone,
    showEmployee2, employee2Id, isEmployee2ManualEntry, employee2Name, employee2Phone,
    voucherType, voucherDuration, voucherYear,
    fullPrice, grant, actualPrice,
    startDate, endDate, paymentDate,
    preservePrefilledPrices,
    setClientId, setIsManualEntry, setName, setPhone, setBirthday, setAddress, setDueDate, setArea,
    setIsEmployeeManualEntry, setEmployeeName, setEmployeePhone, setEmployeeSelection,
    setShowEmployee2, setIsEmployee2ManualEntry, setEmployee2Name, setEmployee2Phone, setEmployee2Selection,
    setVoucherType, setVoucherDuration, setVoucherYear,
    setFullPrice, setGrant, setActualPrice,
    setStartDate, setEndDate, setPaymentDate,
    setPreservePrefilledPrices,
  } = useFormStore();

  const { data: voucherPriceInfos, isLoading: isPriceLoading } =
    useVoucherPriceInfos(voucherType || "", voucherYear || 0);
  const { data: allVoucherPrices } = useAllVoucherPrices(voucherYear || undefined);

  const [activeStep, setActiveStepState] = useState(0);
  const [pricesManuallyEdited, setPricesManuallyEdited] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isEformsignModalOpen, setIsEformsignModalOpen] = useState(false);
  const [isProgressModalOpen, setIsProgressModalOpen] = useState(false);
  const [isExistingContractConfirmOpen, setIsExistingContractConfirmOpen] = useState(false);
  const [shouldRegisterMissingClient, setShouldRegisterMissingClient] = useState(true);
  const [creationProgress, setCreationProgress] = useState<HeadlessProgressState>(INITIAL_HEADLESS_PROGRESS);
  const [progressErrorHint, setProgressErrorHint] = useState<string | null>(null);
  const progressSourceRef = useRef<EventSource | null>(null);
  const selectedClientRef = useRef<Pick<Client, "id" | "name"> | null>(null);
  const selectedEmployeeRef = useRef<Pick<Employee, "id" | "name"> | null>(null);
  const selectedEmployee2Ref = useRef<Pick<Employee, "id" | "name"> | null>(null);
  const defaultPaymentDate = useMemo(() => todayIsoDate(), []);
  const hasAppliedPaymentStepDefaultRef = useRef(false);

  const [startDateInput, setStartDateInput] = useState("");
  const [endDateInput, setEndDateInput] = useState("");
  const [paymentDateInput, setPaymentDateInput] = useState("");
  const isContractInfoStep = activeStep === CONTRACT_CREATION_STEPS.length - 1;
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
  useEffect(() => { setArea(""); }, [setArea]);

  useEffect(() => {
    if (clientId !== null && name.trim()) {
      selectedClientRef.current = { id: clientId, name };
    } else if (clientId === null) {
      selectedClientRef.current = null;
    }
  }, [clientId, name]);

  useEffect(() => {
    if (employeeId !== null && employeeName.trim()) {
      selectedEmployeeRef.current = { id: employeeId, name: employeeName };
    } else if (employeeId === null) {
      selectedEmployeeRef.current = null;
    }
  }, [employeeId, employeeName]);

  useEffect(() => {
    if (employee2Id !== null && employee2Name.trim()) {
      selectedEmployee2Ref.current = { id: employee2Id, name: employee2Name };
    } else if (employee2Id === null) {
      selectedEmployee2Ref.current = null;
    }
  }, [employee2Id, employee2Name]);

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

  const voucherTypeOptions = useMemo(() => toVoucherTypeOptions(), []);
  const selectableVoucherTypes = useMemo(() => new Set(voucherTypeOptions.map((option) => option.value)), [voucherTypeOptions]);
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

  const shouldShowClientRegistrationToggle = Boolean(
    activeStep === 3 &&
    clientId === null &&
    name.trim() &&
    phone.trim() &&
    !storedClientByIdentity &&
    !storedClientByPhone,
  );

  const clientWithExistingContract = useMemo(() => {
    if (clientId !== null) {
      return allClients?.find((client) => client.id === clientId) ?? null;
    }

    return storedClientByIdentity ?? storedClientByPhone ?? null;
  }, [allClients, clientId, storedClientByIdentity, storedClientByPhone]);

  const hasExistingContractRecord = Boolean(clientWithExistingContract?.eDocId);

  useEffect(() => {
    if (shouldShowClientRegistrationToggle) {
      setShouldRegisterMissingClient(true);
    }
  }, [name, phone, shouldShowClientRegistrationToggle]);

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

  useEffect(() => {
    if (!voucherYear && voucherYears && voucherYears.length > 0) {
      setVoucherYear(Math.max(...voucherYears));
    }
  }, [voucherYear, voucherYears, setVoucherYear]);

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

  useEffect(() => {
    if (!startDate || !voucherDuration) return;
    const n = parseInt(voucherDuration, 10);
    if (!Number.isFinite(n) || n <= 0) return;
    const endIso = calcEndDateBusinessDays(startDate, n);
    if (endIso) setEndDate(endIso);
  }, [startDate, voucherDuration, setEndDate]);

  const showErrorToast = (message: string) => {
    toast({ variant: "destructive", description: message });
  };

  useEffect(() => () => {
    progressSourceRef.current?.close();
  }, []);

  const handleClientSelect = (selectedClientId: number | null, client: Client | null) => {
    setClientId(selectedClientId);
    selectedClientRef.current = client;
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
      selectedEmployeeRef.current = { id: employee.id, name: employee.name };
      setEmployeeSelection(selectedEmployeeId, employee.name, employee.phone);
      setIsEmployeeManualEntry(false);
    } else {
      selectedEmployeeRef.current = null;
      setEmployeeSelection(null, "", "");
      setIsEmployeeManualEntry(false);
    }
  };

  const handleEmployee2Select = (selectedEmployeeId: number | null, employee: Employee | null) => {
    if (employee) {
      selectedEmployee2Ref.current = { id: employee.id, name: employee.name };
      setEmployee2Selection(selectedEmployeeId, employee.name, employee.phone);
      setIsEmployee2ManualEntry(false);
    } else {
      selectedEmployee2Ref.current = null;
      setEmployee2Selection(null, "", "");
      setIsEmployee2ManualEntry(false);
    }
  };

  const handleEmployeeNameInputChange = (nextName: string) => {
    setEmployeeName(nextName);
    const matchesSelectedEmployee = employeeId !== null && selectedEmployeeRef.current?.name === nextName;
    const hasSelectedEmployeeSnapshot = employeeId !== null && selectedEmployeeRef.current !== null;
    const willClearSelectedEmployee = hasSelectedEmployeeSnapshot && !matchesSelectedEmployee;
    if (willClearSelectedEmployee) {
      setEmployeeSelection(null, nextName, employeePhone);
      selectedEmployeeRef.current = null;
    }
    setIsEmployeeManualEntry(
      Boolean(nextName.trim()) && !matchesSelectedEmployee && (employeeId === null || willClearSelectedEmployee),
    );
  };

  const handleEmployeeManualEntry = (query?: string) => {
    const nextName = query?.trim() || employeeName;
    setEmployeeSelection(null, nextName, employeePhone);
    selectedEmployeeRef.current = null;
    setIsEmployeeManualEntry(Boolean(nextName));
  };

  const handleEmployee2NameInputChange = (nextName: string) => {
    setEmployee2Name(nextName);
    const matchesSelectedEmployee = employee2Id !== null && selectedEmployee2Ref.current?.name === nextName;
    const hasSelectedEmployeeSnapshot = employee2Id !== null && selectedEmployee2Ref.current !== null;
    const willClearSelectedEmployee = hasSelectedEmployeeSnapshot && !matchesSelectedEmployee;
    if (willClearSelectedEmployee) {
      setEmployee2Selection(null, nextName, employee2Phone);
      selectedEmployee2Ref.current = null;
    }
    setIsEmployee2ManualEntry(
      Boolean(nextName.trim()) && !matchesSelectedEmployee && (employee2Id === null || willClearSelectedEmployee),
    );
  };

  const handleEmployee2ManualEntry = (query?: string) => {
    const nextName = query?.trim() || employee2Name;
    setEmployee2Selection(null, nextName, employee2Phone);
    selectedEmployee2Ref.current = null;
    setIsEmployee2ManualEntry(Boolean(nextName));
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
    (clientId !== null || (isManualEntry && name.trim() && phone.trim())) && area,
  );
  const isEmployee1Valid = Boolean(
    employeeName.trim() && employeePhone.trim() && (employeeId !== null || isEmployeeManualEntry),
  );
  const isEmployee2Valid = Boolean(
    !showEmployee2 ||
      (employee2Name.trim() && employee2Phone.trim() && (employee2Id !== null || isEmployee2ManualEntry)),
  );
  const isStep2Valid = isEmployee1Valid && isEmployee2Valid;
  const isStep3Valid = Boolean(voucherType && voucherDuration && fullPrice && grant && actualPrice);
  const isStep4Valid = Boolean(
    startDate && isStrictIsoDate(startDate) &&
    endDate && isStrictIsoDate(endDate) &&
    effectivePaymentDate && isStrictIsoDate(effectivePaymentDate),
  );
  const isCurrentStepValid = [isStep1Valid, isStep2Valid, isStep3Valid, isStep4Valid][activeStep] ?? true;

  const getStepValidationMessage = (step: number): string | null => {
    if (step === 0 && !isStep1Valid) return "고객 정보와 계약서를 선택해 주세요.";
    if (step === 1 && !isStep2Valid) return "제공인력 정보를 모두 입력해 주세요.";
    if (step === 2 && !isStep3Valid) return "바우처 유형/기간과 금액 정보를 입력해 주세요.";
    if (step === 3 && !isStep4Valid) return "계약 시작일, 종료일, 본인부담금 수령 날짜를 입력해 주세요.";
    return null;
  };

  const setActiveStep = (step: number) => {
    if (step > activeStep && !isCurrentStepValid) {
      const msg = getStepValidationMessage(activeStep);
      if (msg) showErrorToast(msg);
      return;
    }
    setActiveStepState(step);
  };

  const runIframeFallback = async (
    contractData: ContractDataDto,
    finalClientId: number,
    expiry: dayjs.Dayjs,
  ) => {
    if (!isEformsignLoaded) {
      showErrorToast("eformsign SDK가 아직 로드되지 않았습니다. 잠시 후 다시 시도해주세요.");
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
          queryClient.invalidateQueries({ queryKey: eformsignQueryKeys.allDocuments() });
          setTimeout(() => {
            setIsEformsignModalOpen(false);
            router.push("/contracts");
          }, SUCCESS_REDIRECT_DELAY_MS);
        },
        onError: (response) => {
          showErrorToast(`문서 생성 실패: ${response.message}`);
          setIsEformsignModalOpen(false);
        },
        onAction: () => { /* noop */ },
      });
    }, 500);
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setProgressErrorHint(null);

    try {
      let finalClientId = clientId ?? storedClientByIdentity?.id ?? storedClientByPhone?.id ?? null;
      if (!finalClientId && isManualEntry && shouldRegisterMissingClient) {
        const newClient = await createClientMutation.mutateAsync(buildContractAutoRegistrationPayload({
          name,
          phone,
          birthday: birthday || undefined,
          address: address || undefined,
          dueDate: dueDate || startDate || undefined,
          startDate,
          endDate,
          primaryEmployeeId: employeeId,
          secondaryEmployeeId: showEmployee2 ? employee2Id : null,
        }));
        finalClientId = newClient.id;
        setClientId(newClient.id);
      }
      if (!finalClientId) {
        throw new Error("고객 정보를 먼저 선택하거나 등록해 주세요.");
      }

      const authResult = await eformsignApi.authenticate(Date.now(), undefined, { force: true });
      if (!authResult.success) throw new Error("Failed to authenticate");

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

      const progressId = createHeadlessProgressId();
      let headlessOk = false;
      let headlessFailureReason: string | undefined;
      let headlessFailureStep: string | undefined;
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
          setCreationProgress({ step: "sent", completed: true, failed: false });
          queryClient.invalidateQueries({ queryKey: eformsignQueryKeys.allDocuments() });
          setTimeout(() => {
            setIsProgressModalOpen(false);
            router.push("/contracts");
          }, SUCCESS_REDIRECT_DELAY_MS);
          return;
        }

        headlessFailureReason = headless.reason;
        headlessFailureStep = headless.failedStep;
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

      if (!headlessOk) {
        console.warn("[contract-creation] falling back to iframe", {
          reason: headlessFailureReason,
          failedStep: headlessFailureStep,
        });
        if (headlessFailureReason) {
          showErrorToast(getSafeHeadlessFailureMessage(headlessFailureReason));
        }
        setIsProgressModalOpen(false);
        await runIframeFallback(contractData, finalClientId, end);
      }
    } catch (err: unknown) {
      setIsProgressModalOpen(false);
      const msg = err instanceof Error ? err.message : "계약서 생성 중 오류가 발생했습니다.";
      showErrorToast(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const completeStep = () => {
    if (!isCurrentStepValid) {
      const msg = getStepValidationMessage(activeStep);
      if (msg) showErrorToast(msg);
      return;
    }
    if (hasExistingContractRecord) {
      setIsExistingContractConfirmOpen(true);
      return;
    }
    void handleSubmit();
  };

  const areaOptions = useMemo(() => toAreaOptions(areaTemplates), [areaTemplates]);
  const voucherYearOptions = useMemo(
    () => (voucherYears ?? []).map((year) => ({ value: year, label: String(year) })),
    [voucherYears],
  );
  const durationOptions = useMemo(
    () => availableDurations.map((duration) => ({ value: duration, label: `${duration}일` })),
    [availableDurations],
  );
  const clients = allClients ?? [];
  const employeeList = employees ?? [];
  const selectedClient = clientId !== null ? clients.find((client) => client.id === clientId) ?? null : null;
  const selectedEmployee = employeeId !== null ? employeeList.find((employee) => employee.id === employeeId) ?? null : null;
  const selectedEmployee2 = employee2Id !== null ? employeeList.find((employee) => employee.id === employee2Id) ?? null : null;
  const selectedAreaOption = areaOptions.find((option) => option.value === area) ?? null;
  const selectedVoucherYearOption = voucherYearOptions.find((option) => option.value === voucherYear) ?? null;
  const selectedVoucherTypeOption = voucherTypeOptions.find((option) => option.value === voucherType) ?? null;
  const selectedDurationOption = durationOptions.find((option) => option.value === voucherDuration) ?? null;
  const isFirstStep = activeStep === 0;
  const isLastStep = isContractInfoStep;
  const isPrimaryDisabled = isSubmitting || !isCurrentStepValid;

  return {
    steps: CONTRACT_CREATION_STEPS,
    activeStep,
    activeStepMeta: CONTRACT_CREATION_STEPS[activeStep],
    clients,
    employees: employeeList,
    areaOptions,
    voucherYearOptions,
    voucherTypeOptions,
    durationOptions,
    selectedClient,
    selectedEmployee,
    selectedEmployee2,
    selectedAreaOption,
    selectedVoucherYearOption,
    selectedVoucherTypeOption,
    selectedDurationOption,
    selectedPriceInfo,
    form: {
      clientId,
      name,
      phone,
      birthday,
      address,
      area,
      employeeId,
      employeeName,
      employeePhone,
      showEmployee2,
      employee2Id,
      employee2Name,
      employee2Phone,
      voucherYear,
      voucherType,
      voucherDuration,
      fullPrice,
      grant,
      actualPrice,
      startDate,
      endDate,
      paymentDate,
      startDateInput,
      endDateInput,
      effectivePaymentDateInput,
    },
    state: {
      pricesManuallyEdited,
      isPriceLoading,
      shouldShowClientRegistrationToggle,
      shouldRegisterMissingClient,
      hasExistingContractRecord,
      isSubmitting,
      isEformsignModalOpen,
      isProgressModalOpen,
      isExistingContractConfirmOpen,
      creationProgress,
      progressErrorHint,
      isFirstStep,
      isLastStep,
      isCurrentStepValid,
      isPrimaryDisabled,
    },
    summary: {
      clientName: name || "-",
      employeeName: employeeName || "-",
      voucherLabel: voucherType ? `${voucherType} · ${voucherDuration}일` : "-",
      periodLabel: startDate && endDate
        ? `${dayjs(startDate).format("M/D")} → ${dayjs(endDate).format("M/D")}`
        : "-",
      actualPriceLabel: actualPrice ? `${formatContractCreationPrice(actualPrice)} 원` : "-",
    },
    actions: {
      goBack: () => router.push("/contracts"),
      setActiveStep,
      completeStep,
      selectClient: handleClientSelect,
      changeClientName: handleClientNameInputChange,
      useManualClient: handleClientManualEntry,
      changePhone: (value) => setPhone(formatPhoneNumber(value)),
      changeBirthday: (value) => setBirthday(value.replace(/\D/g, "").slice(0, 6)),
      changeAddress: setAddress,
      changeArea: (option) => setArea(option?.value ?? ""),
      selectEmployee: handleEmployeeSelect,
      selectEmployee2: handleEmployee2Select,
      changeEmployeeName: handleEmployeeNameInputChange,
      changeEmployee2Name: handleEmployee2NameInputChange,
      useManualEmployee: handleEmployeeManualEntry,
      useManualEmployee2: handleEmployee2ManualEntry,
      changeEmployeePhone: (value) => setEmployeePhone(formatPhoneNumber(value)),
      changeEmployee2Phone: (value) => setEmployee2Phone(formatPhoneNumber(value)),
      toggleEmployee2: () => {
        if (showEmployee2) {
          setShowEmployee2(false);
          setEmployee2Selection(null, "", "");
        } else {
          setShowEmployee2(true);
        }
      },
      changeVoucherYear: (option) => setVoucherYear(option?.value ?? 0),
      changeVoucherType: (option) => handleVoucherTypeChange(option?.value ?? ""),
      changeDuration: (option) => handleDurationChange(option?.value ?? ""),
      changePrice: handlePriceChange,
      changeStartDate: (value) => handleDateInputChange(setStartDateInput, setStartDate, value),
      changeEndDate: (value) => handleDateInputChange(setEndDateInput, setEndDate, value),
      changePaymentDate: (value) => handleDateInputChange(setPaymentDateInput, setPaymentDate, value),
      toggleClientRegistration: () => setShouldRegisterMissingClient((current) => !current),
      setExistingContractConfirmOpen: (open) => {
        if (!isSubmitting) setIsExistingContractConfirmOpen(open);
      },
      cancelExistingContractConfirm: () => setIsExistingContractConfirmOpen(false),
      confirmExistingContractSubmit: () => {
        setIsExistingContractConfirmOpen(false);
        void handleSubmit();
      },
      closeSigningModal: () => setIsEformsignModalOpen(false),
    },
  };
}
