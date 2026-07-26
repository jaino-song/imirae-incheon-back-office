"use client";
import dayjs from "dayjs";
import { isAxiosError } from "axios";
import "dayjs/locale/ko";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { getApiErrorMessage } from "@babyjamjam/shared";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n/translations";
import { useFormStore } from "@/stores/form-store";
import { useLocale } from "@/providers/LocaleProvider";
import { eformsignApi } from "@/services/api";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { Button } from "@/components/ui/button";
import { Input, V3_INPUT_CONTROL_CLASS_NAME } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { WizardStep } from "@/components/app/v3";
import { NotificationOneButtonModal } from "@/components/app/ui/NotificationOneButtonModal";
import { TwoButtonModal } from "@/components/app/ui/TwoButtonModal";
import { FormNativeSelect } from "@/components/app/ui/form-section";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCallback, useState, useEffect, useRef, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useEformsign } from "@/hooks/useEformsign";
import { useGetAuthUser } from "@/hooks/useGetAuthUser";
import type { EformsignDocumentOption } from "@/lib/eformsign/types";
import {
  HeadlessProgressStepper,
  type HeadlessProgressEvent,
  type HeadlessProgressState,
  type HeadlessProgressStep,
  type HeadlessProgressStepKey,
} from "@/components/app/eformsign/HeadlessProgressStepper";

import { formatIsoDateInput } from "@/lib/date/format-iso-input";

// 한국 공휴일 (대체공휴일 포함). 발급 가능 연도 기준 2026~2027 hardcode — 매년 갱신 필요.
// 출처: 공공데이터포털 특일정보 / 인사혁신처 공고. 음력 기반 명절은 다음 양력 변환:
// - 설날 2026: 2/16(월),17(화),18(수); 2027: 2/6(토),7(일),8(월) + 대체 2/9(화)
// - 추석 2026: 9/24(목),25(금),26(토) + 대체 9/28(월); 2027: 9/14(화),15(수),16(목)
// - 부처님오신날 2026: 5/24(일) + 대체 5/25(월); 2027: 5/13(목)
const KR_HOLIDAYS = new Set<string>([
  // 2026
  "2026-01-01", // 신정
  "2026-02-16", "2026-02-17", "2026-02-18", // 설날
  "2026-03-01", // 삼일절
  "2026-03-02", // 삼일절 대체 (일요일)
  "2026-05-05", // 어린이날
  "2026-05-24", "2026-05-25", // 부처님오신날 + 대체
  "2026-06-06", // 현충일
  "2026-08-15", // 광복절
  "2026-08-17", // 광복절 대체 (토요일)
  "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-28", // 추석 + 대체
  "2026-10-03", "2026-10-05", // 개천절 + 대체 (토요일)
  "2026-10-09", // 한글날
  "2026-12-25", // 크리스마스
  // 2027
  "2027-01-01", // 신정
  "2027-02-06", "2027-02-07", "2027-02-08", "2027-02-09", // 설날 + 대체
  "2027-03-01", // 삼일절
  "2027-05-05", // 어린이날
  "2027-05-13", // 부처님오신날
  "2027-06-06", "2027-06-07", // 현충일 + 대체 (일요일)
  "2027-08-15", "2027-08-16", // 광복절 + 대체 (일요일)
  "2027-09-14", "2027-09-15", "2027-09-16", // 추석
  "2027-10-03", "2027-10-04", // 개천절 + 대체 (일요일)
  "2027-10-09", // 한글날
  "2027-12-25",
]);

function isBusinessDayKr(iso: string): boolean {
  // iso = "YYYY-MM-DD". new Date(iso) parses as UTC midnight; getUTCDay() returns DOW (0=Sun, 6=Sat).
  if (!iso) return false;
  const d = new Date(iso + "T00:00:00Z");
  const dow = d.getUTCDay();
  if (dow === 0 || dow === 6) return false;
  return !KR_HOLIDAYS.has(iso);
}

// startISO를 1일차로 카운트하되, 시작일이 비영업일이면 다음 영업일부터 1일차.
// 반환: N번째 영업일의 ISO 문자열.
function calcEndDateBusinessDays(startISO: string, n: number): string {
  if (!startISO || !Number.isFinite(n) || n <= 0) return "";
  const startMatch = startISO.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!startMatch) return "";
  const cursor = new Date(startISO + "T00:00:00Z");
  let counted = 0;
  // 안전 가드: 충분한 상한 (영업일 30일은 달력 60일 안에 끝남, 여유 2x)
  for (let i = 0; i < 365 && counted < n; i++) {
    const iso = cursor.toISOString().slice(0, 10);
    if (isBusinessDayKr(iso)) {
      counted++;
      if (counted === n) return iso;
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return "";
}

function formatYymmddInput(value: string): string {
  return value.replace(/\D/g, "").slice(0, 6);
}

function formatIsoDateToYymmdd(value: string): string {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return formatYymmddInput(value);

  return `${match[1].slice(2)}${match[2]}${match[3]}`;
}

function parseYymmddInputToIso(value: string): string | null {
  const digits = formatYymmddInput(value);
  if (digits.length !== 6) return null;

  const year = 2000 + Number(digits.slice(0, 2));
  const month = Number(digits.slice(2, 4));
  const day = Number(digits.slice(4, 6));
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseOptionalInteger(value: string): number | null {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function hasPositivePrice(value: string): boolean {
  const parsed = Number.parseInt(parsePrice(value), 10);
  return Number.isFinite(parsed) && parsed > 0;
}

function isFutureDate(value: string): boolean {
  const parsed = dayjs(value, "YYYY-MM-DD", true);
  if (!parsed.isValid()) return false;
  return parsed.startOf("day").isAfter(dayjs().startOf("day"));
}

const AREA_TEMPLATE_DISPLAY_LABELS: Record<string, string> = {
  Namdonggu: "남동구",
  Seogu: "서구",
};

function getAreaTemplateDisplayLabel(areaId: string, templateName?: string | null): string {
  const mappedLabel = AREA_TEMPLATE_DISPLAY_LABELS[areaId];
  if (mappedLabel) return mappedLabel;

  return templateName?.replace(/\s*계약서.*$/, "").trim() || areaId;
}
import { eformsignQueryKeys } from "@/hooks/useEformsignDocuments";
import { useVoucherPriceInfos, useVoucherYears, useAreaTemplates } from "@/hooks";
import voucherOptions from "@/components/app/messages/templates/json/voucher.json";
import { ContactInput } from "@/components/app/messages/forms/form-components/ContactInput";
import { TitleTextInputMolecule } from "@/components/app/messages/forms/form-components/TitleTextInputMolecule";
import { ContractClientSelector } from "@/components/app/contracts/ContractClientSelector";
import { ContractEmployeeSelector } from "@/components/app/contracts/ContractEmployeeSelector";
import { useCreateClient, useDeleteClient, useUpdateClient } from "@/hooks/useClients";
import { useEmployees } from "@/hooks/useEmployees";
import type { Client } from "@/lib/client/types";
import type { Employee } from "@/hooks/useEmployees";
import {
  SteppedWizardPanelContent,
} from "@/components/app/v3/SteppedWizardPanelLayout";
import {
  DETAIL_PANEL_FOOTER_ACTIONS_CLASS_NAME,
  DETAIL_PANEL_FOOTER_CLASS_NAME,
  DETAIL_PANEL_FOOTER_PROGRESS_CLASS_NAME,
} from "@/components/app/v3/DetailPanel";

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
  receiptYear: string;
  receiptMonth: string;
  receiptDay: string;
  fullPrice: string;
  grant: string;
  actualPrice: string;
  issuerPhone?: string;
}

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

const COMPLETED_PILL =
  "inline-flex items-center gap-1.5 px-3 py-2 rounded-2xl bg-v3-green-light border-[1.5px] border-[hsl(137,40%,85%)] text-[0.85rem] font-semibold text-v3-dark";

const INPUT_CLS = "bg-white";

const LABEL_CLS = "text-[calc(12px*var(--glint-ui-scale,1))] font-semibold leading-[1.3] text-v3-text-muted";
const PANEL_GRID_CLASS_NAME =
  "grid w-full grid-cols-1 gap-[calc(16px*var(--glint-ui-scale,1))] pb-[calc(24px*var(--glint-ui-scale,1))] md:grid-cols-2";
const PANEL_THREE_COLUMN_GRID_CLASS_NAME =
  "grid w-full grid-cols-1 gap-[calc(16px*var(--glint-ui-scale,1))] md:grid-cols-3";

const SELECT_CLS =
  cn(
    V3_INPUT_CONTROL_CLASS_NAME,
    "w-full focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
  );

export interface ContractCreationFormLayoutParts {
  content: ReactNode;
  footer: ReactNode;
  footerClassName?: string;
}

export interface ContractCreationFormProps {
  onClose?: () => void;
  onSuccess?: () => void;
  onSessionStateChange?: (hasSession: boolean) => void;
  activeStep?: number;
  onActiveStepChange?: (step: number) => void;
  contentClassName?: string;
  stepContentClassName?: string;
  footerClassName?: string;
  renderLayout?: (parts: ContractCreationFormLayoutParts) => ReactNode;
}

const CONTRACT_CREATION_PROGRESS_STEPS: readonly HeadlessProgressStep[] = [
  { key: "client-started", label: "전자문서 클라이언트 시작", errorLabel: "전자문서 클라이언트 시작 실패" },
  { key: "info-inserted", label: "이용자 정보 입력 완료", errorLabel: "이용자 정보 입력 실패" },
  { key: "creating", label: "전자문서 생성 중", errorLabel: "전자문서 생성 실패" },
  { key: "sent", label: "전자문서 전송 완료", errorLabel: "전자문서 전송 실패" },
];

export const CONTRACT_CREATION_STEPPER_STEPS = [
  { label: "이용자\n정보" },
  { label: "제공인력\n정보" },
  { label: "바우처\n정보" },
  { label: "계약\n정보" },
  { label: "전자문서 생성" },
] as const;

const CONTRACT_INFO_STEP_INDEX = 3;
const CONTRACT_CREATION_PROCESSING_STEP_INDEX = 4;
const CONTRACT_CREATION_MANUAL_HELP = "수동으로 입력해 주세요";

interface ContractCreationRunOptions {
  mode?: "auto" | "manual";
}

const INITIAL_CREATION_PROGRESS: HeadlessProgressState = {
  step: null,
  completed: false,
  failed: false,
};

function isHeadlessProgressStepKey(value: string): value is HeadlessProgressStepKey {
  return CONTRACT_CREATION_PROGRESS_STEPS.some((item) => item.key === value);
}

function createHeadlessProgressId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `contract-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getSafeHeadlessFailureMessage(reason: string | undefined): string {
  if (!reason) {
    return "백엔드 자동 처리에 실패했습니다. 재시도하거나 수동 입력을 사용해 주세요.";
  }
  if (/timed out|timeout/i.test(reason)) {
    return "백엔드 자동 처리 시간이 초과되었습니다. 재시도하거나 수동 입력을 사용해 주세요.";
  }
  if (/chromium|browser|executable/i.test(reason)) {
    return "백엔드 브라우저 실행에 실패했습니다. 수동 입력으로 진행해 주세요.";
  }
  if (/missing document_id/i.test(reason)) {
    return "전자문서 전송 응답에서 문서 ID를 받지 못했습니다. 재시도하거나 수동 입력을 사용해 주세요.";
  }
  return "백엔드 자동 처리에 실패했습니다. 재시도하거나 수동 입력을 사용해 주세요.";
}

export const ContractCreationForm = ({
  onClose,
  onSuccess,
  onSessionStateChange,
  activeStep: controlledActiveStep,
  onActiveStepChange,
  contentClassName,
  stepContentClassName,
  footerClassName,
  renderLayout,
}: ContractCreationFormProps = {}) => {
  const router = useRouter();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const { data: authUser } = useGetAuthUser();
  const [internalActiveStep, setInternalActiveStep] = useState(0);
  const activeStep = controlledActiveStep ?? internalActiveStep;
  const setActiveStep = useCallback(
    (nextStep: number) => {
      if (controlledActiveStep === undefined) {
        setInternalActiveStep(nextStep);
      }
      onActiveStepChange?.(nextStep);
    },
    [controlledActiveStep, onActiveStepChange],
  );
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isCreationSuccessOpen, setIsCreationSuccessOpen] = useState(false);
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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [allowIframeFallback, setAllowIframeFallback] = useState(false);
  const [creationProgress, setCreationProgress] = useState<HeadlessProgressState>(INITIAL_CREATION_PROGRESS);
  const [dueDateInput, setDueDateInput] = useState("");
  const [startDateInput, setStartDateInput] = useState("");
  const [endDateInput, setEndDateInput] = useState("");
  const [paymentDateInput, setPaymentDateInput] = useState("");

  const { isLoaded: isEformsignLoaded, isLoading: isEformsignLoading, error: eformsignError, openDocument } =
    useEformsign();

  const handleCreationSuccessAcknowledged = () => {
    if (!isCreationSuccessOpen) return;
    setIsCreationSuccessOpen(false);
    onSuccess?.();
  };

  const {
    clientId,
    name,
    phone,
    birthday,
    address,
    dueDate,
    employeeId,
    employeeName,
    employeePhone,
    showEmployee2,
    employee2Id,
    employee2Name,
    employee2Phone,
    startDate,
    endDate,
    paymentDate,
    fullPrice,
    grant,
    actualPrice,
    voucherType,
    voucherDuration,
    voucherYear,
    area,
    setClientId,
    setName,
    setPhone,
    setBirthday,
    setAddress,
    setDueDate,
    setIsEmployeeManualEntry,
    setEmployeePhone,
    setEmployeeSelection,
    resetEmployeeFields,
    setShowEmployee2,
    setIsEmployee2ManualEntry,
    setEmployee2Phone,
    setEmployee2Selection,
    resetEmployee2Fields,
    setStartDate,
    setEndDate,
    setPaymentDate,
    setFullPrice,
    setGrant,
    setActualPrice,
    setVoucherType,
    setVoucherDuration,
    setVoucherYear,
    setArea,
    resetAll,
  } = useFormStore();

  // Sync display inputs when external date state changes (e.g., client autofill).
  useEffect(() => { setDueDateInput(formatIsoDateToYymmdd(dueDate)); }, [dueDate]);
  useEffect(() => { setStartDateInput(startDate); }, [startDate]);
  useEffect(() => { setEndDateInput(endDate); }, [endDate]);
  useEffect(() => { setPaymentDateInput(paymentDate); }, [paymentDate]);

  const handleDueDateInputChange = useCallback((value: string) => {
    const nextInput = formatYymmddInput(value);
    const nextIsoDate = parseYymmddInputToIso(nextInput);

    setDueDateInput(nextInput);

    if (nextInput.length === 0) {
      setDueDate("");
      return;
    }

    if (nextIsoDate) {
      setDueDate(nextIsoDate);
    }
  }, [setDueDate]);

  // 시작일과 서비스 기간이 모두 정해지면 평일(주말+한국 공휴일 제외) 기준으로 종료일 자동 계산.
  // 사용자가 종료일을 수동 편집해도 startDate/voucherDuration이 다시 바뀌어야만 덮어쓴다.
  useEffect(() => {
    if (!startDate || !voucherDuration) return;
    const n = parseInt(voucherDuration, 10);
    if (!Number.isFinite(n) || n <= 0) return;
    const computed = calcEndDateBusinessDays(startDate, n);
    if (computed) setEndDate(computed);
  }, [startDate, voucherDuration, setEndDate]);

  const isProcessingStep = activeStep === CONTRACT_CREATION_PROCESSING_STEP_INDEX;
  const hasCreationSession = isProcessingStep && creationProgress.step !== null;
  const hasProcessingFailure = hasCreationSession && creationProgress.failed;
  const hasProcessingSuccess = hasCreationSession && creationProgress.completed;

  useEffect(() => {
    onSessionStateChange?.(hasCreationSession);
  }, [hasCreationSession, onSessionStateChange]);

  const { data: voucherPriceInfos = [], isLoading: isVoucherPriceInfosLoading } = useVoucherPriceInfos(
    voucherType,
    voucherYear
  );
  const { data: areaTemplates = [], isLoading: isAreaTemplatesLoading } = useAreaTemplates();
  const { data: voucherYears = [], isLoading: isVoucherYearsLoading } = useVoucherYears();
  const { data: employees } = useEmployees();
  const createClientMutation = useCreateClient();
  const deleteClientMutation = useDeleteClient();
  const updateClientMutation = useUpdateClient();
  const stepLabels = t(locale, "contract-msg.pagination-steps") as unknown as string[];

  const handleVoucherYearChange = (value: number) => {
    setVoucherYear(value);
    setVoucherType("");
    setVoucherDuration("");
    setFullPrice("");
    setGrant("");
    setActualPrice("");
  };

  const handleVoucherTypeChange = (value: string) => {
    setVoucherType(value);
    setVoucherDuration("");
    setFullPrice("");
    setGrant("");
    setActualPrice("");
  };

  const handleDurationChange = (duration: string) => {
    const selectedVoucher = voucherPriceInfos.find((v) => v.duration === duration);
    if (selectedVoucher) {
      setVoucherDuration(duration);
      setFullPrice(selectedVoucher.fullPrice?.toString() ?? "");
      setGrant(selectedVoucher.grant?.toString() ?? "");
      setActualPrice(selectedVoucher.actualPrice?.toString() ?? "");
    }
  };

  const handleDialogClose = () => {
    setIsDialogOpen(false);
  };

  const resetCreationSession = () => {
    setIsDialogOpen(false);
    setIsSubmitting(false);
    setSubmitError(null);
    setAllowIframeFallback(false);
    setCreationProgress(INITIAL_CREATION_PROGRESS);
  };

  const handleCancel = () => {
    resetAll();
    setDueDateInput("");
    resetCreationSession();
    setActiveStep(0);
    onSessionStateChange?.(false);
    if (onClose) onClose();
    else router.push("/contracts");
  };

  const handleStartNewContractCreation = () => {
    resetAll();
    setDueDateInput("");
    resetCreationSession();
    setActiveStep(0);
    onSessionStateChange?.(false);
  };

  const handleClientSelect = (selectedClientId: number | null, client: Client | null) => {
    setClientId(selectedClientId);
    resetEmployeeFields();
    resetEmployee2Fields();

    if (client) {
      setName(client.name);
      setPhone(client.phone || "");
      setBirthday(client.birthday || "");
      setAddress(client.address || "");
      setDueDate(client.dueDate || "");
      setDueDateInput(formatIsoDateToYymmdd(client.dueDate || ""));

      if (client.type) {
        setVoucherType(client.type);
      }
      if (client.duration) {
        setVoucherDuration(client.duration.toString());
      }
      if (client.fullPrice) {
        setFullPrice(client.fullPrice);
      }
      if (client.grant) {
        setGrant(client.grant);
      }
      if (client.actualPrice) {
        setActualPrice(client.actualPrice);
      }
      if (client.startDate) {
        setStartDate(client.startDate);
        setPaymentDate(client.startDate);
      }
      if (client.endDate) {
        setEndDate(client.endDate);
      }

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
    } else {
      setName("");
      setPhone("");
      setBirthday("");
      setAddress("");
      setDueDate("");
      setDueDateInput("");
      setVoucherType("");
      setVoucherDuration("");
      setFullPrice("");
      setGrant("");
      setActualPrice("");
      setStartDate("");
      setEndDate("");
      resetEmployeeFields();
      resetEmployee2Fields();
    }
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

  const handleToggleShowEmployee2 = () => {
    if (showEmployee2) {
      resetEmployee2Fields();
    } else {
      setShowEmployee2(true);
    }
  };

  const markCreationProgressFailed = () => {
    setCreationProgress((current) => ({
      step: current.step ?? "client-started",
      completed: false,
      failed: true,
    }));
  };

  const handleContractCreation = async ({ mode = "auto" }: ContractCreationRunOptions = {}) => {
    const shouldAttemptHeadless = mode !== "manual" && isFeatureEnabled("headlessDispatch");

    if (employeeId === null || (showEmployee2 && employee2Id === null)) {
      setSubmitError("등록된 제공인력을 목록에서 선택해 주세요.");
      setActiveStep(1);
      return;
    }

    if (!shouldAttemptHeadless && !isEformsignLoaded) {
      setSubmitError("eformsign SDK가 아직 로드되지 않았습니다. 잠시 후 다시 시도해주세요.");
      setActiveStep(CONTRACT_INFO_STEP_INDEX);
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);
    setIsDialogOpen(false);
    setCreationProgress(INITIAL_CREATION_PROGRESS);

    let autoRegisteredClientId: number | null = null;
    try {
      let finalClientId = clientId;
      const normalizedDueDate = parseYymmddInputToIso(dueDateInput) ?? "";
      const assignment = {
        primaryEmployeeId: employeeId,
        secondaryEmployeeId: showEmployee2 ? employee2Id : null,
      };

      if (!clientId) {
        const autoRegistrationPayload = {
          name,
          phone,
          birthday: birthday || undefined,
          address: address || undefined,
          dueDate: normalizedDueDate || undefined,
          ...assignment,
          type: voucherType || null,
          duration: parseOptionalInteger(voucherDuration),
          fullPrice: fullPrice || null,
          grant: grant || null,
          actualPrice: actualPrice || null,
          startDate: startDate || null,
          endDate: endDate || null,
          careCenter: null,
          voucherClient: hasPositivePrice(grant),
          breastPump: false,
          serviceStatus: isFutureDate(startDate) ? "waiting" as const : null,
          areaId: area || null,
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
      } else {
        await updateClientMutation.mutateAsync({
          id: clientId,
          dto: {
            ...assignment,
            name,
            phone,
            birthday: birthday || undefined,
            address: address || null,
            dueDate: normalizedDueDate || undefined,
            type: voucherType || null,
            duration: parseOptionalInteger(voucherDuration),
            fullPrice: fullPrice || null,
            grant: grant || null,
            actualPrice: actualPrice || null,
            startDate: startDate || null,
            endDate: endDate || null,
            voucherClient: hasPositivePrice(grant),
            areaId: area || null,
          },
        });
      }
      if (finalClientId === null) {
        throw new Error("고객 정보를 먼저 선택하거나 등록해 주세요.");
      }

      const executionTime = Date.now();
      const authResult = await eformsignApi.authenticate(executionTime);

      if (!authResult.success) {
        throw new Error("Failed to authenticate");
      }

      const start = dayjs(startDate);
      const end = endDate ? dayjs(endDate) : null;
      const payment = dayjs(paymentDate);
      const today = dayjs();

      const contractData: ContractDataDto = {
        customerName: name,
        customerContact: phone,
        customerDOB: birthday,
        customerAddress: address,
        // inputOutsiderNumber (이용자 연락처) prefill 용 — 현재 로그인 계정의 phone 사용
        issuerPhone: authUser?.phone ?? undefined,
        caretaker1Name: employeeName,
        caretaker1Contact: employeePhone,
        type: voucherType,
        days: voucherDuration,
        area,
        contractDuration: end
          ? `${start.format("YYYY-MM-DD")} ~ ${end.format("YYYY-MM-DD")}`
          : `${start.format("YYYY-MM-DD")} ~`,
        startYear: start.format("YY"),
        startMonth: start.format("MM"),
        startDay: start.format("DD"),
        startDate,
        endYear: end ? end.format("YY") : "",
        endMonth: end ? end.format("MM") : "",
        endDay: end ? end.format("DD") : "",
        endDate,
        paymentYear: payment.format("YY"),
        paymentMonth: payment.format("MM"),
        paymentDay: payment.format("DD"),
        receiptYear: today.format("YY"),
        receiptMonth: today.format("MM"),
        receiptDay: today.format("DD"),
        fullPrice,
        grant,
        actualPrice,
      };

      // BJJ-90: when the flag is on, drive the iframe gate sequence on the
      // backend via Playwright. Failures stay on the processing step so the
      // user can retry the backend run or choose the manual iframe fallback.
      if (shouldAttemptHeadless) {
        const progressId = createHeadlessProgressId();
        let progressSource: EventSource | null = null;

        try {
          setCreationProgress({ step: "client-started", completed: false, failed: false });
          progressSource = new EventSource(
            `/api/eformsign-docs/dispatch-headless/progress?progressId=${encodeURIComponent(progressId)}`,
          );
          progressSource.addEventListener("progress", (event) => {
            let data: HeadlessProgressEvent;
            try {
              data = JSON.parse(event.data) as HeadlessProgressEvent;
            } catch {
              return;
            }
            if (data.step === "failed") {
              setSubmitError(getSafeHeadlessFailureMessage(data.reason));
              setCreationProgress((current) => ({
                step: data.failedStep && isHeadlessProgressStepKey(data.failedStep)
                  ? data.failedStep
                  : current.step ?? "client-started",
                completed: false,
                failed: true,
              }));
              return;
            }
            if (!isHeadlessProgressStepKey(data.step)) return;
            const nextStep = data.step;
            setCreationProgress((current) =>
              current.failed
                ? current
                : {
                  step: nextStep,
                  completed: nextStep === "sent",
                  failed: false,
                },
            );
          });

          const headless = await eformsignApi.dispatchHeadless(
            contractData,
            finalClientId,
            progressId,
          );

          if (headless.ok) {
            setCreationProgress({ step: "sent", completed: true, failed: false });
            queryClient.invalidateQueries({ queryKey: eformsignQueryKeys.documents() });
            setIsCreationSuccessOpen(true);
            return;
          }

          if (headless.reason === "local_persist_failed" && headless.remoteDocumentId) {
            try {
              await eformsignApi.adoptDocument(headless.remoteDocumentId, finalClientId);
              setCreationProgress({ step: "sent", completed: true, failed: false });
              queryClient.invalidateQueries({ queryKey: eformsignQueryKeys.documents() });
              setIsCreationSuccessOpen(true);
            } catch {
              setSubmitError("문서는 생성되었으나 등록에 실패했습니다. 잠시 후 다시 시도해 주세요.");
              markCreationProgressFailed();
            }
            return;
          }
          if (headless.reason === "remote_unconfirmed" || headless.fallbackHint === "adopt-or-manual" || headless.fallbackHint === "manual_check") {
            setSubmitError("문서 생성 상태를 확인할 수 없습니다. 전자문서 목록에서 확인 후 다시 시도해 주세요.");
            markCreationProgressFailed();
            return;
          }
          if (headless.reason === "duplicate_pending_document") {
            setSubmitError("최근 생성된 진행 중 문서가 있습니다.");
            markCreationProgressFailed();
            if (await requestConfirmation("최근 생성된 진행 중 문서가 있습니다. 그래도 새로 생성하시겠습니까?")) {
              const forced = await eformsignApi.dispatchHeadless(contractData, finalClientId, progressId, true);
              if (forced.ok) {
                setCreationProgress({ step: "sent", completed: true, failed: false });
                queryClient.invalidateQueries({ queryKey: eformsignQueryKeys.documents() });
                setIsCreationSuccessOpen(true);
              }
            }
            return;
          }

          console.warn(
            "[contract-creation] headless dispatch returned ok=false",
            headless.reason,
          );
          setAllowIframeFallback(headless.fallbackHint === "iframe");
          setSubmitError(getSafeHeadlessFailureMessage(headless.reason));
          setCreationProgress((current) => ({
            step: headless.failedStep && isHeadlessProgressStepKey(headless.failedStep)
              ? headless.failedStep
              : current.step ?? "client-started",
            completed: false,
            failed: true,
          }));
          return;
        } catch (headlessError) {
          console.warn(
            "[contract-creation] headless dispatch threw",
            headlessError,
          );
          setSubmitError(getSafeHeadlessFailureMessage(headlessError instanceof Error ? headlessError.message : undefined));
          markCreationProgressFailed();
          return;
        } finally {
          progressSource?.close();
        }
      }

      if (!isEformsignLoaded) {
        setSubmitError("eformsign SDK가 아직 로드되지 않았습니다. 잠시 후 다시 시도해주세요.");
        setActiveStep(CONTRACT_INFO_STEP_INDEX);
        return;
      }

      const documentOption: EformsignDocumentOption = await eformsignApi.generateDocument(
        contractData,
        finalClientId
      );

      setIsDialogOpen(true);
      setCreationProgress({ step: "client-started", completed: false, failed: false });

      setTimeout(() => {
        openDocument(documentOption, "eformsign_iframe", {
          onSuccess: async (response) => {
            setCreationProgress({ step: "creating", completed: false, failed: false });
            if (finalClientId && response.document_id) {
              try {
                await eformsignApi.createDocRecord({
                  documentId: response.document_id,
                  clientId: finalClientId,
                  statusType: "060",
                  statusDetail: "대기",
                  stepType: "01",
                  stepIndex: "1",
                  stepName: "서명 요청",
                  stepRecipientType: "01",
                  stepRecipientName: name,
                  stepRecipientSms: phone,
                  expiredDate: (end ?? start.add(60, "day")).add(30, "day").toISOString(),
                  linkToClient: true,
                  documentKind: "contract",
                  templateId: documentOption.mode.template_id ?? null,
                });
              } catch (docError) {
                console.error("Failed to create eformsign doc record:", docError);
              }
            }

            setCreationProgress({ step: "sent", completed: true, failed: false });
            queryClient.invalidateQueries({ queryKey: eformsignQueryKeys.documents() });
            setIsDialogOpen(false);
            setIsCreationSuccessOpen(true);
          },
          onError: (response) => {
            console.error("Document creation failed:", response);
            markCreationProgressFailed();
            setSubmitError(`문서 생성 실패: ${response.message}`);
            setIsDialogOpen(false);
          },
          onAction: () => {
            setCreationProgress((current) =>
              current.step === "client-started" && !current.completed && !current.failed
                ? { step: "info-inserted", completed: false, failed: false }
                : current,
            );
          },
        });
      }, 500);
    } catch (error) {
      if (autoRegisteredClientId) {
        const baseMessage = error instanceof Error ? error.message : "계약서 생성 중 오류가 발생했습니다.";
        setSubmitError(`${baseMessage} 방금 자동 등록된 고객이 남아 있습니다.`);
        if (await requestConfirmation("방금 자동 등록된 고객이 남아 있습니다. 고객을 삭제할까요?")) {
          try {
            await deleteClientMutation.mutateAsync(autoRegisteredClientId);
            setClientId(null);
          } catch (deleteError) {
            if (isAxiosError<{ message?: string }>(deleteError)) {
              setSubmitError(deleteError.response?.data.message || "고객 삭제에 실패했습니다.");
            }
          }
        }
      }
      console.error("Error creating contract:", error);
      setIsDialogOpen(false);
      setActiveStep(CONTRACT_INFO_STEP_INDEX);
      markCreationProgressFailed();
      if (!autoRegisteredClientId) {
        setSubmitError(error instanceof Error ? error.message : "계약서 생성 중 오류가 발생했습니다.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const isStep1Valid = Boolean(name.trim() && phone.trim() && area);
  const isEmployee1Valid = employeeId !== null;
  const isEmployee2Valid = !showEmployee2 || employee2Id !== null;
  const isStep2Valid = isEmployee1Valid && isEmployee2Valid;
  const isStep3Valid = Boolean(voucherType && voucherDuration && fullPrice && grant && actualPrice);
  // endDate는 이용자 서명 후 직원이 Step 3에서 사후 입력하므로 발급 시점에는 옵셔널.
  const isStep4Valid = Boolean(startDate && paymentDate);
  const isCurrentStepValid = [isStep1Valid, isStep2Valid, isStep3Valid, isStep4Valid][activeStep] ?? true;
  const requiredFieldProgressText = `필수 항목 11개 중 ${
    [
      Boolean(name.trim()),
      Boolean(phone.trim()),
      Boolean(area),
      isEmployee1Valid,
      Boolean(voucherType),
      Boolean(voucherDuration),
      Boolean(fullPrice),
      Boolean(grant),
      Boolean(actualPrice),
      Boolean(startDate),
      Boolean(paymentDate),
    ].filter(Boolean).length
  }개 입력됨`;
  const canSelectVoucherDuration = Boolean(voucherType && voucherPriceInfos.length > 0);
  const hasVoucherPricingSelection = Boolean(voucherType && voucherDuration);

  const handleStepChange = (nextStep: number) => {
    if (nextStep > activeStep) {
      const validationMessage = getStepValidationMessage(activeStep);
      if (validationMessage) {
        setSubmitError(validationMessage);
        return;
      }
    }
    setSubmitError(null);
    setActiveStep(nextStep);
  };

  const getStepValidationMessage = (step: number): string | null => {
    if (step === 0 && !isStep1Valid) {
      return "고객 정보와 계약서를 선택해 주세요.";
    }
    if (step === 1 && !isStep2Valid) {
      return "제공인력 정보를 모두 입력해 주세요.";
    }
    if (step === 2 && !isStep3Valid) {
      return "바우처 유형/기간과 금액 정보를 입력해 주세요.";
    }
    if (step === 3 && !isStep4Valid) {
      return "계약 시작일, 결제일을 입력해 주세요.";
    }
    return null;
  };

  const handleWizardComplete = () => {
    const validationMessage = getStepValidationMessage(CONTRACT_INFO_STEP_INDEX);
    if (validationMessage) {
      setSubmitError(validationMessage);
      return;
    }
    setActiveStep(CONTRACT_CREATION_PROCESSING_STEP_INDEX);
    void handleContractCreation();
  };

  const handleRetryContractCreation = () => {
    setActiveStep(CONTRACT_CREATION_PROCESSING_STEP_INDEX);
    void handleContractCreation();
  };

  const handleManualContractCreation = () => {
    setActiveStep(CONTRACT_CREATION_PROCESSING_STEP_INDEX);
    void handleContractCreation({ mode: "manual" });
  };

  const wizardSteps: WizardStep[] = [
    {
      label: stepLabels[0] ?? "이용자 정보",
      content: (
        <div className={PANEL_GRID_CLASS_NAME}>
          <ContractClientSelector
            value={clientId}
            onChange={handleClientSelect}
            label="산모님 성함"
            placeholder="새로 입력 또는 기존 고객 선택"
            manualValue={name}
            onManualValueChange={setName}
          />

          <ContactInput
            phone={phone}
            setPhone={setPhone}
            label={t(locale, "contract-msg.phone-label")}
            placeholder={t(locale, "contract-msg.phone-placeholder")}
          />
          <TitleTextInputMolecule
            label={t(locale, "contract-msg.birthday-label")}
            value={birthday}
            onValueChange={setBirthday}
            placeholder="YYMMDD"
            dataComponent="desktop_contracts_creation_client-birthday-input"
          />
          <TitleTextInputMolecule
            label={t(locale, "contract-msg.address-label")}
            value={address}
            onValueChange={setAddress}
            placeholder={t(locale, "contract-msg.address-placeholder")}
            dataComponent="desktop_contracts_creation_client-address-input"
          />
          <TitleTextInputMolecule
            type="text"
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            label={t(locale, "clients.form.due-date")}
            value={dueDateInput}
            onValueChange={handleDueDateInputChange}
            placeholder="YYMMDD"
            dataComponent="desktop_contracts_creation_client-due-date-input"
          />

          <div className="grid gap-[calc(7px*var(--glint-ui-scale,1))]" data-component="desktop_contracts_creation_doc-type-field">
            <Label className={LABEL_CLS} data-component="desktop_contracts_creation_doc-type-field_label">
              {t(locale, "contract-msg.doc-type-label")}
              <span className="text-destructive ml-1">*</span>
            </Label>
            <Select
              value={area}
              onValueChange={setArea}
              disabled={isAreaTemplatesLoading}
              data-component="desktop_contracts_creation_doc-type-field_select"
            >
              <SelectTrigger
                aria-label={t(locale, "contract-msg.doc-type-label")}
                className="w-full"
                data-component="desktop_contracts_creation_doc-type-field_select_trigger"
              >
                <SelectValue placeholder={t(locale, "contract-msg.doc-type-label")} />
              </SelectTrigger>
              <SelectContent data-component="desktop_contracts_creation_doc-type-field_select_dropdown">
                {areaTemplates.map((template) => (
                  <SelectItem
                    key={template.areaId}
                    value={template.areaId}
                    data-component="desktop_contracts_creation_doc-type-field_select_dropdown_option"
                  >
                    {getAreaTemplateDisplayLabel(template.areaId, template.templateName)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      ),
      summary: (
        <div className="flex gap-3 flex-wrap">
          {name && (
            <span className={COMPLETED_PILL}>
              <Check className="w-4 h-4 text-v3-green" strokeWidth={2} />
              {name}
            </span>
          )}
          {phone && (
            <span className={COMPLETED_PILL}>
              <Check className="w-4 h-4 text-v3-green" strokeWidth={2} />
              {phone}
            </span>
          )}
          {area && (
            <span className={COMPLETED_PILL}>
              <Check className="w-4 h-4 text-v3-green" strokeWidth={2} />
              {getAreaTemplateDisplayLabel(
                area,
                areaTemplates.find((template) => template.areaId === area)?.templateName,
              )}
            </span>
          )}
        </div>
      ),
    },
    {
      label: stepLabels[1] ?? "제공인력 정보",
      content: (
        <div className="grid gap-[calc(18px*var(--glint-ui-scale,1))]">
          <div className={PANEL_GRID_CLASS_NAME}>
            <ContractEmployeeSelector
              value={employeeId}
              onChange={handleEmployeeSelect}
              label={t(locale, "contract-msg.employee-select-label")}
              required
              excludeIds={employee2Id !== null ? [employee2Id] : []}
            />
            <ContactInput
              phone={employeePhone}
              setPhone={setEmployeePhone}
              label={t(locale, "contract-msg.employee-phone-label")}
              placeholder={t(locale, "contract-msg.employee-phone-placeholder")}
              disabled
            />
          </div>

          <Separator className="my-1" />
          <div className="flex items-center gap-[calc(8px*var(--glint-ui-scale,1))]">
            <Checkbox id="add-employee2" checked={showEmployee2} onCheckedChange={handleToggleShowEmployee2} />
            <Label htmlFor="add-employee2" className="cursor-pointer">
              {t(locale, "contract-msg.add-employee2-toggle")}
            </Label>
          </div>

          {showEmployee2 && (
            <div className={PANEL_GRID_CLASS_NAME}>
              <ContractEmployeeSelector
                value={employee2Id}
                onChange={handleEmployee2Select}
                label={t(locale, "contract-msg.employee2-select-label")}
                excludeIds={employeeId !== null ? [employeeId] : []}
              />
              <ContactInput
                phone={employee2Phone}
                setPhone={setEmployee2Phone}
                label={t(locale, "contract-msg.employee2-phone-label")}
                placeholder={t(locale, "contract-msg.employee-phone-placeholder")}
                disabled
              />
            </div>
          )}
        </div>
      ),
      summary: (
        <div className="flex gap-3 flex-wrap">
          {(employeeName || employeeId !== null) && (
            <span className={COMPLETED_PILL}>
              <Check className="w-4 h-4 text-v3-green" strokeWidth={2} />
              {employeeName || `ID ${employeeId}`}
            </span>
          )}
          {showEmployee2 && (employee2Name || employee2Id !== null) && (
            <span className={COMPLETED_PILL}>
              <Check className="w-4 h-4 text-v3-green" strokeWidth={2} />
              {employee2Name || `ID ${employee2Id}`}
            </span>
          )}
        </div>
      ),
    },
    {
      label: stepLabels[2] ?? "바우처 정보",
      content: (
        <div className="grid gap-[calc(18px*var(--glint-ui-scale,1))]">
          <div className={PANEL_THREE_COLUMN_GRID_CLASS_NAME}>
            <div className="space-y-2 flex-1 min-w-0">
              <Label className={LABEL_CLS}>{t(locale, "price-info-msg.voucher-year-label")}</Label>
              <FormNativeSelect
                className={SELECT_CLS}
                value={String(voucherYear)}
                onValueChange={(value) => handleVoucherYearChange(Number(value))}
                disabled={isVoucherYearsLoading}
                options={voucherYears.map((year) => ({ value: String(year), label: `${year}년` }))}
              />
            </div>

            <div className="space-y-2 flex-1 min-w-0">
              <Label className={LABEL_CLS}>{t(locale, "price-info-msg.voucher-type-label")}</Label>
              <div className="relative">
                <FormNativeSelect
                  className={SELECT_CLS}
                  value={voucherType}
                  onValueChange={handleVoucherTypeChange}
                  hideIcon={isVoucherPriceInfosLoading}
                  placeholder={t(locale, "price-info-msg.voucher-type-label")}
                  options={Object.entries(voucherOptions.voucherOptions).map(([groupName, types]) => ({
                    label: groupName,
                    options: Object.entries(types).map(([typeValue, typeData]) => ({
                      value: typeValue,
                      label: typeData.label,
                    })),
                  }))}
                />
                {isVoucherPriceInfosLoading && (
                  <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2">
                    <Spinner className="h-4 w-4 text-primary" />
                  </span>
                )}
              </div>
            </div>

            <div className="space-y-2 flex-1 min-w-0">
              <Label className={LABEL_CLS}>{t(locale, "price-info-msg.duration-label")}</Label>
              <FormNativeSelect
                className={SELECT_CLS}
                value={voucherDuration}
                onValueChange={handleDurationChange}
                disabled={!canSelectVoucherDuration || isVoucherPriceInfosLoading}
                placeholder={t(locale, "price-info-msg.duration-label")}
                options={voucherPriceInfos.map((v) => ({
                  value: String(v.duration),
                  label: `${v.duration}일`,
                }))}
              />
            </div>
          </div>

          <div
            data-component="desktop_contracts_creation_price-fields"
            className={cn(PANEL_THREE_COLUMN_GRID_CLASS_NAME, "animate-v3-slide-up")}
          >
            <div className="space-y-2">
              <Label className={LABEL_CLS}>{t(locale, "contract-msg.full-price-label")}</Label>
              <div className="relative">
                <Input
                  variant="v3"
                  value={formatPrice(hasVoucherPricingSelection ? fullPrice : "")}
                  onChange={(e) => setFullPrice(parsePrice(e.target.value))}
                  placeholder="0"
                  disabled={!hasVoucherPricingSelection}
                  className={`${INPUT_CLS} pr-12`}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">원</span>
              </div>
            </div>
            <div className="space-y-2">
              <Label className={LABEL_CLS}>{t(locale, "contract-msg.grant-label")}</Label>
              <div className="relative">
                <Input
                  variant="v3"
                  value={formatPrice(hasVoucherPricingSelection ? grant : "")}
                  onChange={(e) => setGrant(parsePrice(e.target.value))}
                  placeholder="0"
                  disabled={!hasVoucherPricingSelection}
                  className={`${INPUT_CLS} pr-12`}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">원</span>
              </div>
            </div>
            <div className="space-y-2">
              <Label className={LABEL_CLS}>{t(locale, "contract-msg.actual-price-label")}</Label>
              <div className="relative">
                <Input
                  variant="v3"
                  value={formatPrice(hasVoucherPricingSelection ? actualPrice : "")}
                  onChange={(e) => setActualPrice(parsePrice(e.target.value))}
                  placeholder="0"
                  disabled={!hasVoucherPricingSelection}
                  className={`${INPUT_CLS} pr-12`}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">원</span>
              </div>
            </div>
          </div>
        </div>
      ),
      summary: (
        <div className="flex gap-3 flex-wrap">
          {voucherType && (
            <span className={COMPLETED_PILL}>
              <Check className="w-4 h-4 text-v3-green" strokeWidth={2} />
              {voucherType}
            </span>
          )}
          {voucherDuration && (
            <span className={COMPLETED_PILL}>
              <Check className="w-4 h-4 text-v3-green" strokeWidth={2} />
              {voucherDuration}일
            </span>
          )}
          {hasVoucherPricingSelection && actualPrice && (
            <span className={COMPLETED_PILL}>
              <Check className="w-4 h-4 text-v3-green" strokeWidth={2} />
              {formatPrice(actualPrice)}원
            </span>
          )}
        </div>
      ),
    },
    {
      label: stepLabels[3] ?? "계약 정보",
      content: (
        <div className={PANEL_THREE_COLUMN_GRID_CLASS_NAME}>
          <div className="space-y-2 flex-1 min-w-0">
            <Label className={LABEL_CLS}>{t(locale, "contract-msg.start-date-label")}</Label>
            <Input
              variant="v3"
              type="text"
              inputMode="numeric"
              pattern="\d{4}-\d{2}-\d{2}"
              maxLength={10}
              placeholder="YYYY-MM-DD"
              value={startDateInput}
              onChange={(e) => {
                const formatted = formatIsoDateInput(e.target.value);
                setStartDateInput(formatted);
                if (formatted.length === 10) setStartDate(formatted);
                else if (formatted.length === 0) setStartDate("");
              }}
              className={INPUT_CLS}
            />
          </div>
          <div className="space-y-2 flex-1 min-w-0">
            <Label className={LABEL_CLS}>{t(locale, "contract-msg.end-date-label")}</Label>
            <Input
              variant="v3"
              type="text"
              inputMode="numeric"
              pattern="\d{4}-\d{2}-\d{2}"
              maxLength={10}
              placeholder="YYYY-MM-DD"
              value={endDateInput}
              onChange={(e) => {
                const formatted = formatIsoDateInput(e.target.value);
                setEndDateInput(formatted);
                if (formatted.length === 10) setEndDate(formatted);
                else if (formatted.length === 0) setEndDate("");
              }}
              className={INPUT_CLS}
            />
          </div>
          <div className="space-y-2 flex-1 min-w-0">
            <Label className={LABEL_CLS}>{t(locale, "contract-msg.payment-date-label")}</Label>
            <Input
              variant="v3"
              type="text"
              inputMode="numeric"
              pattern="\d{4}-\d{2}-\d{2}"
              maxLength={10}
              placeholder="YYYY-MM-DD"
              value={paymentDateInput}
              onChange={(e) => {
                const formatted = formatIsoDateInput(e.target.value);
                setPaymentDateInput(formatted);
                if (formatted.length === 10) setPaymentDate(formatted);
                else if (formatted.length === 0) setPaymentDate("");
              }}
              className={INPUT_CLS}
            />
          </div>
        </div>
      ),
      summary: (
        <div className="flex gap-3 flex-wrap">
          {startDate && (
            <span className={COMPLETED_PILL}>
              <Check className="w-4 h-4 text-v3-green" strokeWidth={2} />
              {startDate} ~ {endDate || "(직원 입력 예정)"}
            </span>
          )}
          {paymentDate && (
            <span className={COMPLETED_PILL}>
              <Check className="w-4 h-4 text-v3-green" strokeWidth={2} />
              결제일 {paymentDate}
            </span>
          )}
        </div>
      ),
    },
    {
      label: "전자문서 생성",
      content: (
        <div className="flex h-full w-full items-center justify-center py-2">
          <HeadlessProgressStepper
            steps={CONTRACT_CREATION_PROGRESS_STEPS}
            progress={creationProgress}
            ariaLabel="전자계약서 생성 진행 상태"
            dataComponentPrefix="contract-creation-processing"
            testIdPrefix="contract-creation-progress"
            errorHint={CONTRACT_CREATION_MANUAL_HELP}
            spinnerClassName="contract-creation-processing-spinner"
            className="w-full max-w-[22rem]"
          />
        </div>
      ),
    },
  ];

  const content = (
    <SteppedWizardPanelContent
      dataComponent="desktop_contracts_creation_form"
      className={contentClassName}
      stepContentClassName={cn(stepContentClassName, isProcessingStep && "flex min-h-0 flex-1")}
      feedback={
        <>
          {(submitError || eformsignError) && (
            <Alert variant="destructive" data-component="desktop_messages_sections_contract-form-error">
              <AlertDescription>{submitError || eformsignError}</AlertDescription>
            </Alert>
          )}

          {isEformsignLoading && (
            <Alert data-component="desktop_messages_sections_contract-form-loading">
              <AlertDescription>eformsign SDK를 로드하는 중입니다...</AlertDescription>
            </Alert>
          )}
        </>
      }
    >
      {wizardSteps[activeStep]?.content}
    </SteppedWizardPanelContent>
  );

  const footer = (
    <div className="flex w-full flex-wrap items-center justify-between gap-[calc(12px*var(--glint-ui-scale,1))]">
      <span className={DETAIL_PANEL_FOOTER_PROGRESS_CLASS_NAME}>{requiredFieldProgressText}</span>
      <div className={DETAIL_PANEL_FOOTER_ACTIONS_CLASS_NAME}>
        {activeStep === 0 && !hasProcessingSuccess ? (
          <Button
            type="button"
            variant="neutral"
            size="sm"
            onClick={handleCancel}
            disabled={hasCreationSession && !hasProcessingFailure}
            className="min-w-[calc(132px*var(--glint-ui-scale,1))]"
          >
            취소
          </Button>
        ) : (
          null
        )}
        {activeStep > 0 && !isProcessingStep && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="contract-creation-back"
            onClick={() => handleStepChange(activeStep - 1)}
            className="min-w-[calc(132px*var(--glint-ui-scale,1))]"
          >
            이전
          </Button>
        )}
        {activeStep < CONTRACT_INFO_STEP_INDEX ? (
          <Button
            type="button"
            size="sm"
            data-testid="contract-creation-next"
            onClick={() => handleStepChange(activeStep + 1)}
            disabled={!isCurrentStepValid}
            className="min-w-[calc(132px*var(--glint-ui-scale,1))]"
          >
            다음
          </Button>
        ) : activeStep === CONTRACT_INFO_STEP_INDEX ? (
          <Button
            type="button"
            size="sm"
            data-testid="contract-creation-submit"
            onClick={handleWizardComplete}
            disabled={!isStep1Valid || !isStep2Valid || !isStep3Valid || !isStep4Valid || isSubmitting}
            className="min-w-[calc(132px*var(--glint-ui-scale,1))]"
          >
            {isSubmitting ? "처리 중..." : t(locale, "contract-msg.contract-creation")}
          </Button>
        ) : hasProcessingSuccess ? (
          <Button
            type="button"
            size="sm"
            data-testid="contract-creation-new-send"
            data-component="desktop_contracts_creation_new-send"
            onClick={handleStartNewContractCreation}
            className="min-w-[calc(132px*var(--glint-ui-scale,1))]"
          >
            새 전자문서 발송
          </Button>
        ) : hasProcessingFailure ? (
          <>
            {allowIframeFallback ? <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="contract-creation-manual"
              onClick={handleManualContractCreation}
              disabled={isSubmitting}
              className="min-w-[calc(132px*var(--glint-ui-scale,1))]"
            >
              수동 입력
            </Button> : null}
            <Button
              type="button"
              size="sm"
              data-testid="contract-creation-retry"
              onClick={handleRetryContractCreation}
              disabled={isSubmitting}
              className="min-w-[calc(132px*var(--glint-ui-scale,1))]"
            >
              {isSubmitting ? "재시도 중..." : "재시도"}
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );

  return (
    <>
      {renderLayout ? renderLayout({ content, footer, footerClassName }) : (
        <>
          {content}
          <footer
            data-component="desktop_contracts_creation_form_footer"
            data-slot="detail-panel-footer"
            className={cn(DETAIL_PANEL_FOOTER_CLASS_NAME, footerClassName)}
          >
            {footer}
          </footer>
        </>
      )}

      <Dialog open={isDialogOpen} onOpenChange={(open: boolean) => !open && handleDialogClose()}>
        <DialogContent
          data-component="desktop_messages_sections_contract-form-dialog"
          // Mobile: full-screen. Desktop (lg+): keep the manual eformsign canvas near A4 portrait.
          className="max-w-full w-screen h-screen p-0 gap-0 flex flex-col lg:w-[820px] lg:max-w-[95vw] lg:h-[1102px] lg:max-h-[95vh] lg:rounded-lg"
        >
          <DialogHeader className="px-4 py-2 flex flex-row items-center justify-between border-b shrink-0">
            <DialogTitle>계약서 작성</DialogTitle>
            <DialogDescription className="sr-only">
              전자문서 작성 화면과 생성 진행 상태를 표시합니다.
            </DialogDescription>
            <Button type="button" variant="ghost" size="icon" onClick={handleDialogClose} className="h-8 w-8">
              <X className="h-4 w-4" />
            </Button>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-hidden">
            <iframe id="eformsign_iframe" className="w-full h-full border-none" title="eformsign Document" />
          </div>
        </DialogContent>
      </Dialog>

      <NotificationOneButtonModal
        open={isCreationSuccessOpen}
        onOpenChange={(open) => {
          if (!open) handleCreationSuccessAcknowledged();
        }}
        dataComponent="desktop_contracts_creation_success-notification"
        title="계약서가 성공적으로 생성되었습니다."
        description="전자문서 생성과 전송이 완료되었습니다."
        onAcknowledge={handleCreationSuccessAcknowledged}
      />
      <TwoButtonModal
        open={confirmationMessage !== null}
        onOpenChange={(open) => {
          if (!open) resolveConfirmation(false);
        }}
        dataComponent="desktop_contracts_creation_confirmation"
        title="계약서 생성 확인"
        description={confirmationMessage ?? ""}
        isDescriptionVisuallyHidden={false}
        approvalLabel="확인"
        onApprove={() => resolveConfirmation(true)}
      />
    </>
  );
};
