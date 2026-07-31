"use client";

import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { isAxiosError } from "axios";
import { useMutation } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { X } from "lucide-react";

import { useMessagesPermissionGuard } from "@/app/(shell)/messages/MessagesPermissionGuard";
import { ClientAutocomplete } from "@/components/app/clients/ClientAutocomplete";
import { MessageSectionNav } from "@/components/app/mobile-redesign/MessageSectionNav";
import { ListCard } from "@/components/app/mobile-redesign/primitives";
import { MsgField } from "@/components/app/messages/templates/MsgField";
import { Input } from "@/components/app/v3/Input";
import bankAccountJSON from "@/components/app/messages/templates/json/bank-account.json";
import voucherOptions from "@/components/app/messages/templates/json/voucher.json";
import { greetingMsgTemplate } from "@/components/app/messages/templates/messageTemplate/greetingMsg";
import { infoMsgTemplate } from "@/components/app/messages/templates/messageTemplate/infoMsg";
import { priceInfoMsgTemplate } from "@/components/app/messages/templates/messageTemplate/priceInfoMsg";
import { reminderMsgTemplate } from "@/components/app/messages/templates/messageTemplate/reminderMsg";
import { serviceInfoMsgTemplate } from "@/components/app/messages/templates/messageTemplate/serviceInfoMsg";
import { surveyMsgTemplate } from "@/components/app/messages/templates/messageTemplate/surveyMsg";
import { thanksMsgTemplate } from "@/components/app/messages/templates/messageTemplate/thanksMsg";
import { Alert } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSystemTemplate } from "@/features/system-templates/hooks";
import type { CustomVariable, TemplateVariable } from "@/features/system-templates/types";
import { useBankAccountInfos, useVoucherPriceInfos, type BankAccountInfo } from "@/hooks";
import { useAllClients } from "@/hooks/useClients";
import { useMessageTemplates } from "@/hooks/use-message-templates";
import type { Client } from "@/lib/client/types";
import { api } from "@/lib/api/client";
import { normalizeIsoDate, yymmddToIso } from "@/lib/contracts/date-input";
import { formatKoreanPhoneNumber, normalizeKoreanPhoneDigits } from "@/lib/phone";
import "@/components/app/mobile-redesign/redesign.css";
import { parsePositiveIntQueryParam } from "@/lib/query-params";
import { extractVariables, renderTemplate } from "@/lib/template-utils";
import { cn } from "@/lib/utils";
import type { SendMessageDeliverySmsResponse } from "@babyjamjam/shared/types/message";

import styles from "./page.module.css";

type SendResponse = SendMessageDeliverySmsResponse;

interface RecipientChip {
  id: string;
  clientId: number | null;
  name: string;
  phone: string;
  initial: string;
  tone: "primary" | "orange";
}

interface TemplateOption {
  id: string;
  name: string;
  body: string;
  variables: TemplateInputVariable[];
}

interface TemplateInputVariable {
  key: string;
  label: string;
  required: boolean;
  type?: TemplateVariable["type"];
}

interface NewMessageFormProps {
  initialBody: string;
  initialTemplateId: string;
  initialClientId: number | null;
  initialClient: Client | null;
}

const PHONE_REGEX = /^[0-9,\-\s]+$/;
const SINGLE_PHONE_REGEX = /^[0-9-]+$/;
const MAX_BODY = 2000;
const SMS_BYTE_LIMIT = 90;
const MAX_LMS_TITLE_BYTES = 44;
const MAX_RECIPIENTS = 50;
const RECIPIENT_REQUIRED_MESSAGE = "수신자를 선택하거나 전화번호를 Enter로 추가해 주세요.";
const DUPLICATE_RECIPIENT_MESSAGE = "이미 추가된 수신자입니다.";
const INVALID_PHONE_ENTRY_MESSAGE = "기존 고객이 없으면 올바른 전화번호를 입력한 뒤 Enter를 눌러 추가해 주세요.";
const CLIENT_WITHOUT_PHONE_MESSAGE = "선택한 고객에 등록된 연락처가 없습니다.";
const DEFAULT_LMS_TITLE = "안내";
const GREETING_TEMPLATE_ID = "GREETING";
const INFO_TEMPLATE_ID = "INFO";
const PRICE_INFO_TEMPLATE_ID = "PRICE_INFO";
const REMINDER_TEMPLATE_ID = "REMINDER";
const SERVICE_INFO_TEMPLATE_ID = "SERVICE_INFO";
const SURVEY_TEMPLATE_ID = "SURVEY";
const THANKS_TEMPLATE_ID = "THANKS";
const CUSTOM_TEMPLATE_ID = "__custom__";
const CUSTOM_TEMPLATE_OPTION: TemplateOption = {
  id: CUSTOM_TEMPLATE_ID,
  name: "직접 작성",
  body: "",
  variables: [],
};
const NAME_FALLBACK_VARIABLES: TemplateInputVariable[] = [
  { key: "name", label: "산모명", required: true, type: "string" },
];
const PRICE_INFO_FALLBACK_VARIABLES: TemplateInputVariable[] = [
  { key: "name", label: "산모명", required: true, type: "string" },
  { key: "weeks", label: "서비스 주수", required: true, type: "number" },
  { key: "duration", label: "서비스 기간", required: true, type: "string" },
  { key: "type", label: "바우처 유형", required: true, type: "string" },
  { key: "fullPrice", label: "총 서비스 금액", required: true, type: "currency" },
  { key: "grant", label: "정부지원금", required: true, type: "currency" },
  { key: "actualPrice", label: "본인부담금", required: true, type: "currency" },
  { key: "bankName", label: "은행명", required: true, type: "string" },
  { key: "accNum", label: "계좌번호", required: true, type: "string" },
];
const PRICE_INFO_SELECT_CONTROLLED_KEYS = new Set([
  "weeks",
  "duration",
  "type",
  "fullPrice",
  "grant",
  "actualPrice",
  "bankName",
  "accNum",
]);
const DEFAULT_PRICE_INFO_YEAR = new Date().getFullYear();

function normalizePhone(raw: string) {
  return raw.replace(/[^0-9\-,]/g, "");
}

function splitRecipientPhones(raw: string) {
  return normalizePhone(raw)
    .split(",")
    .map((phone) => phone.trim())
    .filter(Boolean);
}

function hasUnreplacedVariables(text: string) {
  return /#\{[^}]+\}/.test(text);
}

function getRecipientInitial(name: string) {
  const trimmed = name.trim();
  return trimmed ? trimmed.charAt(0) : "수";
}

function formatRecipientPhone(phone: string) {
  return formatKoreanPhoneNumber(phone);
}

function getTextByteLength(text: string) {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(text).length;
  }

  return Array.from(text).reduce((size, char) => {
    const codePoint = char.codePointAt(0) ?? 0;
    if (codePoint <= 0x7f) return size + 1;
    if (codePoint <= 0x7ff) return size + 2;
    if (codePoint <= 0xffff) return size + 3;
    return size + 4;
  }, 0);
}

function shouldSendAsLms(message: string) {
  return getTextByteLength(message) > SMS_BYTE_LIMIT;
}

function getLmsTitle(option: TemplateOption) {
  const candidate = option.id === CUSTOM_TEMPLATE_ID ? DEFAULT_LMS_TITLE : option.name.trim();

  return getTextByteLength(candidate) <= MAX_LMS_TITLE_BYTES
    ? candidate
    : DEFAULT_LMS_TITLE;
}

function getDefaultVariableLabel(key: string) {
  if (key === "name") return "산모명";
  return key;
}

function normalizeTemplateVariables(
  requiredVariables: TemplateVariable[] = [],
  customVariables: CustomVariable[] = [],
  content = "",
): TemplateInputVariable[] {
  const variables = new Map<string, TemplateInputVariable>();

  requiredVariables.forEach((variable) => {
    variables.set(variable.key, {
      key: variable.key,
      label: variable.label || getDefaultVariableLabel(variable.key),
      required: variable.required,
      type: variable.type,
    });
  });

  customVariables.forEach((variable) => {
    variables.set(variable.key, {
      key: variable.key,
      label: variable.label || getDefaultVariableLabel(variable.key),
      required: variable.required,
    });
  });

  extractVariables(content).forEach((key) => {
    if (!variables.has(key)) {
      variables.set(key, {
        key,
        label: getDefaultVariableLabel(key),
        required: true,
      });
    }
  });

  return Array.from(variables.values());
}

function getFallbackVariables(
  requiredVariables: TemplateVariable[] | undefined,
  customVariables: CustomVariable[] | undefined,
  content: string | undefined,
  fallbackVariables: TemplateInputVariable[] = [],
): TemplateInputVariable[] {
  const variables = normalizeTemplateVariables(requiredVariables, customVariables, content ?? "");

  return variables.length > 0 ? variables : fallbackVariables;
}

function getServiceInfoFallbackVariables(content?: string): TemplateInputVariable[] {
  return getFallbackVariables(undefined, undefined, content, NAME_FALLBACK_VARIABLES);
}

function getVariableInputId(key: string) {
  return `template-variable-${key.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function getVariablePlaceholder(variable: TemplateInputVariable) {
  if (variable.key === "name") return "홍길동";
  if (variable.type === "currency") return "예: 100,000";
  if (variable.type === "number") return "숫자 입력";
  return `${variable.label} 입력`;
}

function getVariableInputMode(variable: TemplateInputVariable): React.HTMLAttributes<HTMLInputElement>["inputMode"] {
  return variable.type === "number" || variable.type === "currency" ? "numeric" : "text";
}

function getVoucherTypeLabel(type: string) {
  const voucherGroups = voucherOptions.voucherOptions as Record<string, Record<string, { label: string }>>;

  for (const types of Object.values(voucherGroups)) {
    const option = types[type];
    if (option?.label) {
      return option.label;
    }
  }

  return type;
}

function normalizeVoucherTypeValue(type: string | null | undefined) {
  if (!type?.trim()) {
    return "";
  }

  const normalizedType = type.replace(/[\s-]/g, "");
  const voucherGroups = voucherOptions.voucherOptions as Record<string, Record<string, { label: string }>>;

  for (const types of Object.values(voucherGroups)) {
    for (const [typeValue, option] of Object.entries(types)) {
      if (
        typeValue.replace(/[\s-]/g, "") === normalizedType ||
        option.label.replace(/[\s-]/g, "") === normalizedType
      ) {
        return typeValue;
      }
    }
  }

  return "";
}

function getBankAreaLabel(area: string) {
  return bankAccountJSON[area as keyof typeof bankAccountJSON]?.area ?? area;
}

function getBankAccountDisplayLabel(area: string, bankAccountInfos: readonly BankAccountInfo[]) {
  const selectedBankAccount = bankAccountInfos.find((bankAccount) => bankAccount.area === area);
  const accountText = [selectedBankAccount?.bankName, selectedBankAccount?.accNum].filter(Boolean).join(" ");

  return accountText ? `${getBankAreaLabel(area)} · ${accountText}` : getBankAreaLabel(area);
}

function formatClientDateVariable(value: string | null | undefined) {
  if (!value?.trim()) {
    return "";
  }

  const trimmed = value.trim();
  const isoDate = normalizeIsoDate(trimmed) || yymmddToIso(trimmed);

  if (!isoDate) {
    return trimmed;
  }

  return `${isoDate.slice(0, 4)}. ${isoDate.slice(5, 7)}. ${isoDate.slice(8, 10)}.`;
}

function formatCurrencyVariable(value: string | null | undefined) {
  if (!value?.trim()) {
    return "";
  }

  const trimmed = value.trim();
  const amount = Number.parseInt(trimmed.replace(/[,원\s]/g, ""), 10);

  return Number.isNaN(amount) ? trimmed : amount.toLocaleString("ko-KR");
}

function parseTemplateNumber(value: string | undefined) {
  const parsed = Number.parseInt(value?.replace(/[^0-9]/g, "") ?? "", 10);

  return Number.isNaN(parsed) ? 0 : parsed;
}

function getPriceInfoFallbackBody(
  variables: TemplateInputVariable[],
  values: Record<string, string>,
) {
  const templateValues = buildTemplateValues(variables, values);

  return priceInfoMsgTemplate({
    name: templateValues.name?.trim() ?? "",
    weeks: parseTemplateNumber(templateValues.weeks),
    duration: templateValues.duration?.trim() ?? "",
    type: templateValues.type?.trim() ?? "",
    fullPrice: formatCurrencyVariable(templateValues.fullPrice),
    grant: formatCurrencyVariable(templateValues.grant),
    actualPrice: formatCurrencyVariable(templateValues.actualPrice),
    bankName: templateValues.bankName?.trim() ?? "",
    accNum: templateValues.accNum?.trim() ?? "",
  });
}

function getClientVariableValue(key: string, client: Client) {
  const normalizedKey = key.replace(/[_\-\s]/g, "").toLowerCase();

  if (["name", "clientname", "mothername", "momname"].includes(normalizedKey)) {
    return client.name;
  }
  if (["phone", "clientphone", "recipientphone"].includes(normalizedKey)) {
    return client.phone ? formatKoreanPhoneNumber(client.phone) : "";
  }
  if (["address", "clientaddress"].includes(normalizedKey)) {
    return client.address ?? "";
  }
  if (["servicedate", "startdate", "servicestartdate"].includes(normalizedKey)) {
    return formatClientDateVariable(client.startDate);
  }
  if (["duedate", "birthduedate"].includes(normalizedKey)) {
    return formatClientDateVariable(client.dueDate);
  }
  if (["enddate", "serviceenddate"].includes(normalizedKey)) {
    return formatClientDateVariable(client.endDate);
  }
  if (["birthday", "birthdate"].includes(normalizedKey)) {
    return client.birthday ?? "";
  }
  if (["type", "vouchertype"].includes(normalizedKey)) {
    return client.type ?? "";
  }
  if (["duration", "serviceduration"].includes(normalizedKey)) {
    return client.duration != null ? String(client.duration) : "";
  }
  if (["weeks", "serviceweeks"].includes(normalizedKey)) {
    return client.duration != null ? String(Math.floor(Number(client.duration) / 5)) : "";
  }
  if (["fullprice", "totalprice"].includes(normalizedKey)) {
    return formatCurrencyVariable(client.fullPrice);
  }
  if (["grant", "governmentgrant"].includes(normalizedKey)) {
    return formatCurrencyVariable(client.grant);
  }
  if (["actualprice", "ownprice", "copayment"].includes(normalizedKey)) {
    return formatCurrencyVariable(client.actualPrice);
  }
  if (["primaryemployee", "primaryemployeename", "employee", "employeename"].includes(normalizedKey)) {
    return client.primaryEmployee?.name ?? "";
  }
  if (["secondaryemployee", "secondaryemployeename"].includes(normalizedKey)) {
    return client.secondaryEmployee?.name ?? "";
  }

  return "";
}

function getClientPriceInfoVariableValue(key: string, client: Client) {
  const normalizedKey = key.replace(/[_\-\s]/g, "").toLowerCase();

  if (["type", "vouchertype"].includes(normalizedKey)) {
    return normalizeVoucherTypeValue(client.type);
  }
  if (["bankname", "accnum", "accountnumber", "bankaccount", "area"].includes(normalizedKey)) {
    return "";
  }

  return getClientVariableValue(key, client);
}

function getBankAccountVariableUpdates(
  areaId: string | null | undefined,
  bankAccountInfos: readonly BankAccountInfo[],
) {
  if (!areaId) {
    return {};
  }

  const selectedBankAccount = bankAccountInfos.find((bankAccount) => bankAccount.area === areaId);
  if (!selectedBankAccount) {
    return {};
  }

  return {
    area: getBankAreaLabel(areaId),
    bankName: selectedBankAccount.bankName ?? "",
    accNum: selectedBankAccount.accNum ?? "",
  };
}

function getClientPriceInfoVariableUpdates(
  client: Client,
  bankAccountInfos: readonly BankAccountInfo[],
) {
  return {
    name: client.name,
    type: normalizeVoucherTypeValue(client.type),
    duration: client.duration != null ? String(client.duration) : "",
    weeks: client.duration != null ? String(Math.floor(Number(client.duration) / 5)) : "",
    fullPrice: formatCurrencyVariable(client.fullPrice),
    grant: formatCurrencyVariable(client.grant),
    actualPrice: formatCurrencyVariable(client.actualPrice),
    ...getBankAccountVariableUpdates(client.areaId, bankAccountInfos),
  };
}

function buildTemplateValues(
  variables: TemplateInputVariable[],
  values: Record<string, string>,
): Record<string, string> {
  return variables.reduce<Record<string, string>>((acc, variable) => {
    acc[variable.key] = values[variable.key] ?? "";
    return acc;
  }, {});
}

function renderTemplateWithValues(
  content: string,
  variables: TemplateInputVariable[],
  values: Record<string, string>,
  templateId: string,
) {
  const templateValues = buildTemplateValues(variables, values);
  const rendered = renderTemplate(content, templateValues);
  const name = templateValues.name?.trim();

  if (
    templateId === SERVICE_INFO_TEMPLATE_ID &&
    name &&
    !/\{\{\s*name\s*\}\}/.test(content)
  ) {
    return rendered.replace(/(^|\n)(\s*)산모님/u, `$1$2${name} 산모님`);
  }

  return rendered;
}

export default function NewMessagePage() {
  const searchParams = useSearchParams();
  const initialBody = searchParams.get("body") ?? "";
  const initialTemplateId = searchParams.get("template") ?? GREETING_TEMPLATE_ID;
  const initialClientId = parsePositiveIntQueryParam(searchParams.get("clientId"));
  const { data: allClients = [] } = useAllClients();
  const initialClient = initialClientId === null
    ? null
    : allClients.find((candidate) => candidate.id === initialClientId) ?? null;
  const routeSeedKey = `${initialBody}\u0000${initialTemplateId}\u0000${initialClientId ?? ""}`;

  return (
    <NewMessageForm
      key={routeSeedKey}
      initialBody={initialBody}
      initialTemplateId={initialTemplateId}
      initialClientId={initialClientId}
      initialClient={initialClient}
    />
  );
}

function NewMessageForm({ initialBody, initialTemplateId, initialClientId, initialClient }: NewMessageFormProps) {
  const initialClientPhone = normalizeKoreanPhoneDigits(initialClient?.phone);
  const initialRecipient: RecipientChip | null = initialClient && initialClientPhone
    ? {
        id: `client-${initialClient.id}`,
        clientId: initialClient.id,
        name: initialClient.name,
        phone: formatRecipientPhone(initialClientPhone),
        initial: getRecipientInitial(initialClient.name),
        tone: "primary",
      }
    : null;
  const [receiver, setReceiver] = useState("");
  const [recipientNameInputValue, setRecipientNameInputValue] = useState("");
  const [recipients, setRecipients] = useState<RecipientChip[]>(() => initialRecipient ? [initialRecipient] : []);

  useEffect(() => {
    if (initialClient) {
      const phone = normalizeKoreanPhoneDigits(initialClient.phone);
      if (phone) {
        const chip: RecipientChip = {
          id: `client-${initialClient.id}`,
          clientId: initialClient.id,
          name: initialClient.name,
          phone: formatRecipientPhone(phone),
          initial: getRecipientInitial(initialClient.name),
          tone: "primary",
        };
        queueMicrotask(() => {
          setRecipients((prev) => {
            if (prev.some((item) => item.clientId === initialClient.id)) return prev;
            return [chip, ...prev];
          });
        });
      }
    }
  }, [initialClient]);
  const [bodyOverride, setBodyOverride] = useState<string | null>(initialBody.trim() ? initialBody : null);
  const [templateVariableValues, setTemplateVariableValues] = useState<Record<string, string>>(() => {
    const values: Record<string, string> = {};
    if (initialClient) values.name = initialClient.name;
    return values;
  });
  const [priceInfoVoucherYear, setPriceInfoVoucherYear] = useState(DEFAULT_PRICE_INFO_YEAR);
  const [priceInfoArea, setPriceInfoArea] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(
    initialClient && !initialClientPhone ? CLIENT_WITHOUT_PHONE_MESSAGE : null,
  );
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(initialTemplateId);
  const ignoreNextPriceInfoSelectChangeRef = useRef(false);

  const {
    isLoading: isSenderApprovalLoading,
    needsSenderApproval,
  } = useMessagesPermissionGuard();

  const { data: greetingSystemTemplate } = useSystemTemplate(GREETING_TEMPLATE_ID);
  const { data: infoSystemTemplate } = useSystemTemplate(INFO_TEMPLATE_ID);
  const { data: priceInfoSystemTemplate } = useSystemTemplate(PRICE_INFO_TEMPLATE_ID);
  const { data: reminderSystemTemplate } = useSystemTemplate(REMINDER_TEMPLATE_ID);
  const { data: serviceInfoSystemTemplate } = useSystemTemplate(SERVICE_INFO_TEMPLATE_ID);
  const { data: surveySystemTemplate } = useSystemTemplate(SURVEY_TEMPLATE_ID);
  const { data: thanksSystemTemplate } = useSystemTemplate(THANKS_TEMPLATE_ID);
  const { data: userTemplates = [] } = useMessageTemplates();
  const { data: bankAccountInfos = [], isLoading: isBankAccountInfosLoading } = useBankAccountInfos();
  const { data: voucherPriceInfos = [], isLoading: isVoucherPriceInfosLoading } = useVoucherPriceInfos(
    selectedTemplateId === PRICE_INFO_TEMPLATE_ID ? templateVariableValues.type ?? "" : "",
    priceInfoVoucherYear,
  );

  const templateOptions = useMemo<TemplateOption[]>(() => {
    const greetingVariables = normalizeTemplateVariables(
      greetingSystemTemplate?.requiredVariables,
      greetingSystemTemplate?.customVariables,
      greetingSystemTemplate?.content,
    );
    const greetingOption: TemplateOption = {
      id: GREETING_TEMPLATE_ID,
      name: greetingSystemTemplate?.name ?? "인사 메시지",
      body: greetingSystemTemplate?.content
        ? renderTemplateWithValues(greetingSystemTemplate.content, greetingVariables, templateVariableValues, GREETING_TEMPLATE_ID)
        : greetingMsgTemplate(),
      variables: greetingVariables,
    };
    const serviceInfoVariables = serviceInfoSystemTemplate
      ? getFallbackVariables(
        serviceInfoSystemTemplate.requiredVariables,
        serviceInfoSystemTemplate.customVariables,
        serviceInfoSystemTemplate.content,
        NAME_FALLBACK_VARIABLES,
      )
      : getServiceInfoFallbackVariables();
    const serviceInfoOption: TemplateOption = {
      id: SERVICE_INFO_TEMPLATE_ID,
      name: serviceInfoSystemTemplate?.name ?? "서비스 안내",
      body: serviceInfoSystemTemplate?.content
        ? renderTemplateWithValues(
          serviceInfoSystemTemplate.content,
          serviceInfoVariables,
          templateVariableValues,
          SERVICE_INFO_TEMPLATE_ID,
        )
        : serviceInfoMsgTemplate({ name: templateVariableValues.name?.trim() ?? "" }),
      variables: serviceInfoVariables,
    };
    const infoVariables = normalizeTemplateVariables(
      infoSystemTemplate?.requiredVariables,
      infoSystemTemplate?.customVariables,
      infoSystemTemplate?.content,
    );
    const infoOption: TemplateOption = {
      id: INFO_TEMPLATE_ID,
      name: infoSystemTemplate?.name ?? "정보 수집",
      body: infoSystemTemplate?.content
        ? renderTemplateWithValues(infoSystemTemplate.content, infoVariables, templateVariableValues, INFO_TEMPLATE_ID)
        : infoMsgTemplate(),
      variables: infoVariables,
    };
    const priceInfoVariables = priceInfoSystemTemplate
      ? getFallbackVariables(
        priceInfoSystemTemplate.requiredVariables,
        priceInfoSystemTemplate.customVariables,
        priceInfoSystemTemplate.content,
        PRICE_INFO_FALLBACK_VARIABLES,
      )
      : PRICE_INFO_FALLBACK_VARIABLES;
    const priceInfoOption: TemplateOption = {
      id: PRICE_INFO_TEMPLATE_ID,
      name: priceInfoSystemTemplate?.name ?? "금액 및 계좌번호",
      body: priceInfoSystemTemplate?.content
        ? renderTemplateWithValues(
          priceInfoSystemTemplate.content,
          priceInfoVariables,
          templateVariableValues,
          PRICE_INFO_TEMPLATE_ID,
        )
        : getPriceInfoFallbackBody(priceInfoVariables, templateVariableValues),
      variables: priceInfoVariables,
    };
    const reminderVariables = reminderSystemTemplate
      ? getFallbackVariables(
        reminderSystemTemplate.requiredVariables,
        reminderSystemTemplate.customVariables,
        reminderSystemTemplate.content,
        NAME_FALLBACK_VARIABLES,
      )
      : NAME_FALLBACK_VARIABLES;
    const reminderOption: TemplateOption = {
      id: REMINDER_TEMPLATE_ID,
      name: reminderSystemTemplate?.name ?? "상담 후 리마인더",
      body: reminderSystemTemplate?.content
        ? renderTemplateWithValues(
          reminderSystemTemplate.content,
          reminderVariables,
          templateVariableValues,
          REMINDER_TEMPLATE_ID,
        )
        : reminderMsgTemplate({ name: templateVariableValues.name?.trim() ?? "" }),
      variables: reminderVariables,
    };
    const thanksVariables = thanksSystemTemplate
      ? getFallbackVariables(
        thanksSystemTemplate.requiredVariables,
        thanksSystemTemplate.customVariables,
        thanksSystemTemplate.content,
        NAME_FALLBACK_VARIABLES,
      )
      : NAME_FALLBACK_VARIABLES;
    const thanksOption: TemplateOption = {
      id: THANKS_TEMPLATE_ID,
      name: thanksSystemTemplate?.name ?? "예약 완료",
      body: thanksSystemTemplate?.content
        ? renderTemplateWithValues(
          thanksSystemTemplate.content,
          thanksVariables,
          templateVariableValues,
          THANKS_TEMPLATE_ID,
        )
        : thanksMsgTemplate({ name: templateVariableValues.name?.trim() ?? "" }),
      variables: thanksVariables,
    };
    const surveyVariables = surveySystemTemplate
      ? getFallbackVariables(
        surveySystemTemplate.requiredVariables,
        surveySystemTemplate.customVariables,
        surveySystemTemplate.content,
        NAME_FALLBACK_VARIABLES,
      )
      : NAME_FALLBACK_VARIABLES;
    const surveyOption: TemplateOption = {
      id: SURVEY_TEMPLATE_ID,
      name: surveySystemTemplate?.name ?? "모니터링 설문",
      body: surveySystemTemplate?.content
        ? renderTemplateWithValues(
          surveySystemTemplate.content,
          surveyVariables,
          templateVariableValues,
          SURVEY_TEMPLATE_ID,
        )
        : surveyMsgTemplate({ name: templateVariableValues.name?.trim() ?? "" }),
      variables: surveyVariables,
    };
    const userOptions = userTemplates.map((template) => ({
      id: template.id,
      name: template.name,
      body: renderTemplateWithValues(
        template.content,
        normalizeTemplateVariables([], [], template.content),
        templateVariableValues,
        template.id,
      ),
      variables: normalizeTemplateVariables([], [], template.content),
    }));

    return [
      greetingOption,
      serviceInfoOption,
      infoOption,
      priceInfoOption,
      reminderOption,
      thanksOption,
      surveyOption,
      ...userOptions,
      CUSTOM_TEMPLATE_OPTION,
    ];
  }, [
    greetingSystemTemplate,
    infoSystemTemplate,
    priceInfoSystemTemplate,
    reminderSystemTemplate,
    serviceInfoSystemTemplate,
    surveySystemTemplate,
    templateVariableValues,
    thanksSystemTemplate,
    userTemplates,
  ]);
  const selectedTemplate = useMemo(
    () => templateOptions.find((template) => template.id === selectedTemplateId) ?? CUSTOM_TEMPLATE_OPTION,
    [selectedTemplateId, templateOptions],
  );
  const selectedTemplateVariables = selectedTemplate.variables;
  const recipientNameVariable = selectedTemplateVariables.find((variable) => variable.key === "name");
  const renderedTemplateVariables = useMemo(() => {
    if (selectedTemplate.id !== PRICE_INFO_TEMPLATE_ID) {
      return selectedTemplateVariables.filter((variable) => variable.key !== "name");
    }

    return selectedTemplateVariables.filter(
      (variable) => variable.key !== "name" && !PRICE_INFO_SELECT_CONTROLLED_KEYS.has(variable.key),
    );
  }, [selectedTemplate.id, selectedTemplateVariables]);
  const body = bodyOverride ?? selectedTemplate.body;
  const payloadClientId = useMemo(() => {
    if (initialClientId !== null) {
      return initialClientId;
    }

    if (recipients.length === 1) {
      return recipients[0]?.clientId ?? null;
    }

    return null;
  }, [initialClientId, recipients]);
  const payloadRecipientName = useMemo(() => {
    if (recipients.length === 1) {
      return recipients[0]?.name ?? "";
    }

    return "";
  }, [recipients]);

  const receiverPayload = useMemo(() => {
    return recipients.map((recipient) => recipient.phone).join(",");
  }, [recipients]);
  const recipientCount = recipients.length;

  const showVariableHint = useMemo(() => hasUnreplacedVariables(body), [body]);
  const isPriceInfoTemplateSelected = selectedTemplate.id === PRICE_INFO_TEMPLATE_ID;
  const selectedPriceInfoSummary = useMemo(() => {
    if (!isPriceInfoTemplateSelected) {
      return null;
    }

    const fullPrice = templateVariableValues.fullPrice?.trim();
    const grant = templateVariableValues.grant?.trim();
    const actualPrice = templateVariableValues.actualPrice?.trim();
    const bankName = templateVariableValues.bankName?.trim();
    const accNum = templateVariableValues.accNum?.trim();

    if (!fullPrice && !grant && !actualPrice && !bankName && !accNum) {
      return null;
    }

    return { fullPrice, grant, actualPrice, bankName, accNum };
  }, [isPriceInfoTemplateSelected, templateVariableValues]);

  const validationError = useMemo(() => {
    if (!receiverPayload) return RECIPIENT_REQUIRED_MESSAGE;
    if (!PHONE_REGEX.test(receiverPayload)) return "수신자 연락처 형식이 올바르지 않습니다. (숫자, '-', ',' 만 허용)";
    if (splitRecipientPhones(receiverPayload).some((phone) => !SINGLE_PHONE_REGEX.test(phone))) {
      return "수신자 연락처 형식이 올바르지 않습니다. (숫자, '-', ',' 만 허용)";
    }
    if (recipientCount > MAX_RECIPIENTS) return `수신자는 한 번에 최대 ${MAX_RECIPIENTS}명까지 선택할 수 있습니다.`;
    const missingVariable = selectedTemplateVariables.find(
      (variable) => variable.required && !templateVariableValues[variable.key]?.trim(),
    );
    if (missingVariable) return `${missingVariable.label} 입력이 필요합니다.`;
    if (!body.trim()) return "메시지 본문을 입력해 주세요.";
    if (body.length > MAX_BODY) return `본문은 최대 ${MAX_BODY}자까지 입력할 수 있습니다.`;
    return null;
  }, [receiverPayload, recipientCount, selectedTemplateVariables, templateVariableValues, body]);

  const sendMutation = useMutation<SendResponse, unknown, void>({
    mutationFn: async () => {
      const message = body.trim();
      const payload: Record<string, unknown> = {
        receiver: receiverPayload,
        message,
        triggerType: "immediate",
        msgType: "AUTO",
      };
      if (payloadClientId !== null) payload.clientId = payloadClientId;
      if (shouldSendAsLms(message)) payload.title = getLmsTitle(selectedTemplate);
      if (payloadRecipientName.trim()) payload.recipientName = payloadRecipientName.trim();
      const res = await api.post<SendResponse>("/message-deliveries/sms", payload);
      const data = res.data;
      if (
        data.result &&
        (data.result.resultCode !== 1 || (data.result.errorCount ?? 0) > 0)
      ) {
        throw new Error(data.result.message ?? "발송에 실패했습니다.");
      }
      return data;
    },
    onSuccess: () => {
      setErrorMessage(null);
      setSuccessMessage("메시지 발송 요청이 접수되었습니다.");
      setReceiver("");
      setRecipientNameInputValue("");
      setRecipients([]);
      setTemplateVariableValues({});
      setBodyOverride(null);
    },
    onError: (err) => {
      setSuccessMessage(null);
      if (isAxiosError<{ error?: string; message?: string | string[] }>(err)) {
        const data = err.response?.data;
        const msg = Array.isArray(data?.message) ? data?.message.join(", ") : data?.message;
        setErrorMessage(msg ?? data?.error ?? "발송에 실패했습니다.");
        return;
      }
      if (err instanceof Error && err.message) {
        setErrorMessage(err.message);
        return;
      }
      setErrorMessage("발송에 실패했습니다.");
    },
  });

  const addRecipientChips = (nextRecipients: RecipientChip[]) => {
    const existingPhoneSet = new Set(recipients.map((recipient) => normalizeKoreanPhoneDigits(recipient.phone)));
    const filteredRecipients = nextRecipients.filter((recipient) => {
      const normalizedPhone = normalizeKoreanPhoneDigits(recipient.phone);
      if (!normalizedPhone || existingPhoneSet.has(normalizedPhone)) {
        return false;
      }

      existingPhoneSet.add(normalizedPhone);
      return true;
    });

    if (filteredRecipients.length === 0) {
      setErrorMessage(DUPLICATE_RECIPIENT_MESSAGE);
      return false;
    }

    setRecipients((current) => [...current, ...filteredRecipients]);
    setReceiver("");
    setErrorMessage(null);
    return true;
  };

  const handleClientRecipientSelect = (_clientId: number | null, client: Client | null) => {
    if (!client) {
      return;
    }

    const normalizedPhone = normalizeKoreanPhoneDigits(client.phone);
    if (!normalizedPhone) {
      setErrorMessage(CLIENT_WITHOUT_PHONE_MESSAGE);
      return;
    }

    if (recipients.length >= MAX_RECIPIENTS) {
      setErrorMessage(`수신자는 한 번에 최대 ${MAX_RECIPIENTS}명까지 선택할 수 있습니다.`);
      return;
    }

    const wasAdded = addRecipientChips([
      {
        id: `client-${client.id}`,
        clientId: client.id,
        name: client.name,
        phone: formatRecipientPhone(normalizedPhone),
        initial: getRecipientInitial(client.name),
        tone: "primary",
      },
    ]);
    if (!wasAdded) {
      return;
    }

    setRecipientNameInputValue("");
    if (selectedTemplate.id === PRICE_INFO_TEMPLATE_ID) {
      ignoreNextPriceInfoSelectChangeRef.current = true;
      window.setTimeout(() => {
        ignoreNextPriceInfoSelectChangeRef.current = false;
      }, 0);
      if (
        client.areaId &&
        bankAccountInfos.some((bankAccount) => bankAccount.area === client.areaId)
      ) {
        setPriceInfoArea(client.areaId);
      }
    }
    setTemplateVariableValues((current) => {
      const nextValues = { ...current };

      selectedTemplateVariables.forEach((variable) => {
        const value = selectedTemplate.id === PRICE_INFO_TEMPLATE_ID
          ? getClientPriceInfoVariableValue(variable.key, client)
          : getClientVariableValue(variable.key, client);
        if (value) {
          nextValues[variable.key] = value;
        }
      });

      if (selectedTemplate.id === PRICE_INFO_TEMPLATE_ID) {
        Object.entries(getClientPriceInfoVariableUpdates(client, bankAccountInfos)).forEach(([key, value]) => {
          if (value) {
            nextValues[key] = value;
          }
        });
      }

      return nextValues;
    });
    setBodyOverride(null);
  };

  const addManualRecipient = (rawQuery: string) => {
    const normalizedPhones = splitRecipientPhones(rawQuery);

    if (normalizedPhones.length === 0 || normalizedPhones.some((phone) => !SINGLE_PHONE_REGEX.test(phone))) {
      setErrorMessage(INVALID_PHONE_ENTRY_MESSAGE);
      return;
    }

    if (recipients.length + normalizedPhones.length > MAX_RECIPIENTS) {
      setErrorMessage(`수신자는 한 번에 최대 ${MAX_RECIPIENTS}명까지 선택할 수 있습니다.`);
      return;
    }

    addRecipientChips(
      normalizedPhones.map((phone) => ({
        id: `manual-${normalizeKoreanPhoneDigits(phone)}`,
        clientId: null,
        name: formatRecipientPhone(phone),
        phone: formatRecipientPhone(phone),
        initial: "수",
        tone: "orange",
      })),
    );
  };

  const handleTemplateSelect = (option: TemplateOption) => {
    setSelectedTemplateId(option.id);
    setBodyOverride(null);
  };

  const handleTemplateVariableChange = (key: string, value: string) => {
    setTemplateVariableValues((current) => ({
      ...current,
      [key]: value,
    }));
    setBodyOverride(null);
  };

  const handleReceiverKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    addManualRecipient(receiver);
  };

  const updateTemplateVariables = (updates: Record<string, string>) => {
    setTemplateVariableValues((current) => ({
      ...current,
      ...updates,
    }));
    setBodyOverride(null);
  };

  const handlePriceInfoYearChange = (value: string) => {
    setPriceInfoVoucherYear(Number(value));
    updateTemplateVariables({
      duration: "",
      weeks: "",
      fullPrice: "",
      grant: "",
      actualPrice: "",
    });
  };

  const handlePriceInfoTypeChange = (value: string) => {
    if (ignoreNextPriceInfoSelectChangeRef.current || !value) {
      return;
    }

    if (value === templateVariableValues.type) {
      return;
    }

    updateTemplateVariables({
      type: value,
      duration: "",
      weeks: "",
      fullPrice: "",
      grant: "",
      actualPrice: "",
    });
  };

  const handlePriceInfoDurationChange = (value: string) => {
    if (ignoreNextPriceInfoSelectChangeRef.current || !value) {
      return;
    }

    if (value === templateVariableValues.duration) {
      return;
    }

    const selectedVoucher = voucherPriceInfos.find((voucher) => voucher.duration === value);

    updateTemplateVariables({
      duration: value,
      weeks: String(Math.floor(Number(value) / 5)),
      fullPrice: formatCurrencyVariable(selectedVoucher?.fullPrice),
      grant: formatCurrencyVariable(selectedVoucher?.grant),
      actualPrice: formatCurrencyVariable(selectedVoucher?.actualPrice),
    });
  };

  const handlePriceInfoAreaChange = (value: string) => {
    const selectedBankAccount = bankAccountInfos.find((bankAccount) => bankAccount.area === value);

    setPriceInfoArea(value);
    updateTemplateVariables({
      area: getBankAreaLabel(value),
      bankName: selectedBankAccount?.bankName ?? "",
      accNum: selectedBankAccount?.accNum ?? "",
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (needsSenderApproval || isSenderApprovalLoading) {
      setErrorMessage("메시지 전송 권한이 필요합니다.");
      return;
    }

    if (validationError || sendMutation.isPending) {
      if (validationError) setErrorMessage(validationError);
      return;
    }
    sendMutation.mutate();
  };

  const isSubmitDisabled =
    Boolean(validationError) || sendMutation.isPending || isSenderApprovalLoading || needsSenderApproval;

  return (
    <section
      data-component="mobile_messages_new_page"
      data-slot="messages-page"
      data-page="messages-new"
      className={`messages-page ${styles.pageRoot}`}
    >
      <div data-component="mobile_messages_new_page_screen" className={styles.phoneScreen}>
        <form
          data-component="mobile_messages_new_page_screen_form"
          data-slot="messages-content"
          data-form="messages-new-form"
          onSubmit={handleSubmit}
          className={`shell-content gap-[calc(8px*var(--glint-ui-scale,1))] ${styles.navPage}`}
        >
          <div data-component="mobile_messages_new_page_screen_form_section-nav" className="shrink-0">
            <MessageSectionNav
              data-component="mobile_messages_new_page_screen_form_section-nav_nav"
              activeId="send"
            />
          </div>

          <div data-component="mobile_messages_new_page_screen_form_scroll" className={styles.msgScroll}>
            <ListCard
              data-component="mobile_messages_new_page_screen_form_scroll_list-card"
              title="새 메시지"
              actionLabel="즉시 발송"
              actionIcon={null}
              actionType="submit"
              actionDisabled={isSubmitDisabled}
              filters={[]}
            >
            <div data-component="mobile_messages_new_page_screen_form_scroll_list-card_body_form-card" className={styles.recipientCard}>
              <div
                data-component="mobile_messages_new_page_screen_form_scroll_list-card_body_form-card_content"
                className={styles.unifiedFormCardContent}
              >
                <div data-component="mobile_messages_new_page_screen_form_scroll_list-card_body_form-card_content_template" className={styles.formCardSection}>
                  <div data-component="mobile_messages_new_page_screen_form_scroll_list-card_body_form-card_content_template_row" className={styles.formSection}>
                    <label id="template-select-label" htmlFor="template-select" className={styles.formLabel}>
                      템플릿 선택 <span className={styles.required}>*</span>
                    </label>
                    <Select
                      value={selectedTemplate.id}
                      onValueChange={(value) => {
                        const option = templateOptions.find((template) => template.id === value);
                        if (option) handleTemplateSelect(option);
                      }}
                    >
                      <SelectTrigger
                        id="template-select"
                        data-component="mobile_messages_new_page_screen_form_scroll_list-card_body_form-card_content_template_row_select"
                        aria-labelledby="template-select-label"
                        className={styles.templateSelectTrigger}
                      >
                        <SelectValue placeholder="템플릿 선택" />
                      </SelectTrigger>
                      <SelectContent
                        className={styles.templateSelectContent}
                        avoidCollisions
                      >
                        {templateOptions.map((option) => (
                          <SelectItem key={option.id} value={option.id}>
                            {option.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div data-component="mobile_messages_new_page_screen_form_scroll_list-card_body_form-card_content_recipient" className={styles.formCardSection}>
                  {recipientNameVariable ? (
                    <div data-component="mobile_messages_new_page_screen_form_scroll_list-card_body_form-card_content_recipient_name-row" className={styles.formSection}>
                      <label htmlFor="recipient-name" className={styles.formLabel}>
                        산모님 성함
                        {recipientNameVariable.required ? <span className={styles.required}>*</span> : null}
                      </label>
                      {isPriceInfoTemplateSelected ? (
                        <ClientAutocomplete
                          data-component="mobile_messages_new_page_screen_form_scroll_list-card_body_form-card_content_recipient_name-row_autocomplete"
                          inputId="recipient-name"
                          value={null}
                          onChange={handleClientRecipientSelect}
                          inputValue={recipientNameInputValue}
                          onInputValueChange={(value) => {
                            setRecipientNameInputValue(value);
                            handleTemplateVariableChange("name", value);
                          }}
                          placeholder="산모님 성함"
                          label=""
                        />
                      ) : (
                        <Input
                          id="recipient-name"
                          data-component="mobile_messages_new_page_screen_form_scroll_list-card_body_form-card_content_recipient_name-row_input"
                          value={templateVariableValues.name ?? ""}
                          placeholder="산모님 성함"
                          onChange={(event) => handleTemplateVariableChange("name", event.target.value)}
                        />
                      )}
                    </div>
                  ) : null}

                  <div
                    data-component="mobile_messages_new_page_screen_form_scroll_list-card_body_form-card_content_recipient_row"
                    data-slot="messages-recipient-row"
                    className={styles.formSection}
                  >
                    <label htmlFor="receiver" className={styles.formLabel}>
                      휴대 전화번호 <span className={styles.required}>*</span>
                    </label>
                    {isPriceInfoTemplateSelected ? (
                      <Input
                        id="receiver"
                        type="tel"
                        inputMode="numeric"
                        value={receiver}
                        onChange={(event) => setReceiver(event.target.value)}
                        onKeyDown={handleReceiverKeyDown}
                        placeholder="010-0000-0000"
                        data-component="mobile_messages_new_page_screen_form_scroll_list-card_body_form-card_content_recipient_row_input"
                      />
                    ) : (
                      <ClientAutocomplete
                        data-component="mobile_messages_new_page_screen_form_scroll_list-card_body_form-card_content_recipient_row_autocomplete"
                        inputId="receiver"
                        value={null}
                        onChange={handleClientRecipientSelect}
                        inputValue={receiver}
                        onInputValueChange={setReceiver}
                        placeholder="010-0000-0000"
                        label=""
                        allowManualEntry
                        manualEntryLabel="입력한 번호 추가"
                        manualEntryDescription="전화번호를 입력한 뒤 Enter로 수신자에 추가합니다"
                        onManualEntry={addManualRecipient}
                      />
                    )}
                    <div data-component="mobile_messages_new_page_screen_form_scroll_list-card_body_form-card_content_recipient_row_chips" className={styles.recipientChips}>
                      {recipients.map((recipient) => (
                        <span key={recipient.id} className={styles.recipientChip}>
                          <span className={cn(styles.recipientChipAvatar, styles[`recipient_${recipient.tone}`])}>
                            {recipient.initial}
                          </span>
                          {recipient.name}
                          <button
                            type="button"
                            aria-label={`${recipient.name} 수신자 제거`}
                            className={styles.recipientChipX}
                            onClick={() => setRecipients((current) => current.filter((item) => item.id !== recipient.id))}
                          >
                            <X aria-hidden="true" size={10} strokeWidth={3} />
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                {renderedTemplateVariables.length > 0 || isPriceInfoTemplateSelected ? (
                  <div data-component="mobile_messages_new_page_screen_form_scroll_list-card_body_form-card_content_variables" className={styles.formCardSection}>
                    {renderedTemplateVariables.map((variable) => {
                      const inputId = getVariableInputId(variable.key);
                      return (
                        <div
                          key={variable.key}
                          data-component="mobile_messages_new_page_screen_form_scroll_list-card_body_form-card_content_variables_row"
                          data-template-variable-key={variable.key}
                          className={styles.formSection}
                        >
                          <label htmlFor={inputId} className={styles.formLabel}>
                            {variable.label}
                            {variable.required ? <span className={styles.required}>*</span> : null}
                          </label>
                          <Input
                            id={inputId}
                            data-component="mobile_messages_new_page_screen_form_scroll_list-card_body_form-card_content_variables_row_input"
                            data-template-variable-key={variable.key}
                            inputMode={getVariableInputMode(variable)}
                            value={templateVariableValues[variable.key] ?? ""}
                            placeholder={getVariablePlaceholder(variable)}
                            onChange={(event) => handleTemplateVariableChange(variable.key, event.target.value)}
                          />
                        </div>
                      );
                    })}
                    {isPriceInfoTemplateSelected ? (
                      <div
                        data-component="mobile_messages_new_page_screen_form_scroll_list-card_body_form-card_content_variables_price-info"
                        className={styles.priceInfoControls}
                      >
                        <div
                          data-component="mobile_messages_new_page_screen_form_scroll_list-card_body_form-card_content_variables_price-info_row"
                          data-template-variable-key="type"
                          className={styles.formSection}
                        >
                          <label id="price-info-type-label" className={styles.formLabel}>
                            바우처 유형 <span className={styles.required}>*</span>
                          </label>
                          <Select
                            value={templateVariableValues.type ?? ""}
                            onValueChange={handlePriceInfoTypeChange}
                          >
                            <SelectTrigger
                              data-component="mobile_messages_new_page_screen_form_scroll_list-card_body_form-card_content_variables_price-info_row_type-select"
                              aria-labelledby="price-info-type-label"
                              className={styles.variableSelectTrigger}
                            >
                              {templateVariableValues.type ? (
                                <span data-slot="select-value">{getVoucherTypeLabel(templateVariableValues.type)}</span>
                              ) : (
                                <SelectValue placeholder="바우처 유형" />
                              )}
                            </SelectTrigger>
                            <SelectContent className={styles.templateSelectContent}>
                              {Object.entries(voucherOptions.voucherOptions).map(([groupName, types]) => (
                                <div key={groupName} data-component="mobile_messages_new_page_screen_form_scroll_list-card_body_form-card_content_variables_price-info_row_type-group">
                                  <div
                                    data-component="mobile_messages_new_page_screen_form_scroll_list-card_body_form-card_content_variables_price-info_row_type-group_label"
                                    className={styles.selectGroupLabel}
                                  >
                                    {groupName}
                                  </div>
                                  {Object.entries(types).map(([typeValue, typeData]) => (
                                    <SelectItem key={typeValue} value={typeValue}>
                                      {typeData.label}
                                    </SelectItem>
                                  ))}
                                </div>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div
                          data-component="mobile_messages_new_page_screen_form_scroll_list-card_body_form-card_content_variables_price-info_row"
                          data-template-variable-key="duration"
                          className={styles.formSection}
                        >
                          <label id="price-info-duration-label" className={styles.formLabel}>
                            서비스 기간 <span className={styles.required}>*</span>
                          </label>
                          <Select
                            value={templateVariableValues.duration ?? ""}
                            onValueChange={handlePriceInfoDurationChange}
                            disabled={!templateVariableValues.type || voucherPriceInfos.length === 0}
                          >
                            <SelectTrigger
                              data-component="mobile_messages_new_page_screen_form_scroll_list-card_body_form-card_content_variables_price-info_row_duration-select"
                              aria-labelledby="price-info-duration-label"
                              className={styles.variableSelectTrigger}
                            >
                              {templateVariableValues.duration ? (
                                <span data-slot="select-value">{templateVariableValues.duration}일</span>
                              ) : (
                                <SelectValue
                                  placeholder={
                                    isVoucherPriceInfosLoading
                                      ? "불러오는 중"
                                      : "서비스 기간"
                                  }
                                />
                              )}
                            </SelectTrigger>
                            <SelectContent className={styles.templateSelectContent}>
                              {voucherPriceInfos.map((voucher) => (
                                <SelectItem key={voucher.id} value={voucher.duration}>
                                  {voucher.duration}일
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div
                          data-component="mobile_messages_new_page_screen_form_scroll_list-card_body_form-card_content_variables_price-info_row"
                          data-template-variable-key="bankAccount"
                          className={styles.formSection}
                        >
                          <label id="price-info-bank-account-label" className={styles.formLabel}>
                            지역 <span className={styles.required}>*</span>
                          </label>
                          <Select
                            value={priceInfoArea}
                            onValueChange={handlePriceInfoAreaChange}
                            disabled={isBankAccountInfosLoading || bankAccountInfos.length === 0}
                          >
                            <SelectTrigger
                              data-component="mobile_messages_new_page_screen_form_scroll_list-card_body_form-card_content_variables_price-info_row_bank-account-select"
                              aria-labelledby="price-info-bank-account-label"
                              className={styles.variableSelectTrigger}
                            >
                              {priceInfoArea ? (
                                <span data-slot="select-value">{getBankAccountDisplayLabel(priceInfoArea, bankAccountInfos)}</span>
                              ) : (
                                <SelectValue
                                  placeholder={
                                    isBankAccountInfosLoading
                                      ? "불러오는 중"
                                      : "지역"
                                  }
                                />
                              )}
                            </SelectTrigger>
                            <SelectContent className={styles.templateSelectContent}>
                              {bankAccountInfos.map((bankAccount) => (
                                <SelectItem key={bankAccount.area} value={bankAccount.area}>
                                  {getBankAccountDisplayLabel(bankAccount.area, bankAccountInfos)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div
                          data-component="mobile_messages_new_page_screen_form_scroll_list-card_body_form-card_content_variables_price-info_row"
                          data-template-variable-key="voucherYear"
                          className={styles.formSection}
                        >
                          <label id="price-info-year-label" className={styles.formLabel}>
                            바우처 연도 <span className={styles.required}>*</span>
                          </label>
                          <Select
                            value={String(priceInfoVoucherYear)}
                            onValueChange={handlePriceInfoYearChange}
                          >
                            <SelectTrigger
                              data-component="mobile_messages_new_page_screen_form_scroll_list-card_body_form-card_content_variables_price-info_row_year-select"
                              aria-labelledby="price-info-year-label"
                              className={styles.variableSelectTrigger}
                            >
                              <SelectValue placeholder="바우처 연도" />
                            </SelectTrigger>
                            <SelectContent className={styles.templateSelectContent}>
                              {[priceInfoVoucherYear - 1, priceInfoVoucherYear, priceInfoVoucherYear + 1].map((year) => (
                                <SelectItem key={year} value={String(year)}>
                                  {year}년
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        {selectedPriceInfoSummary ? (
                          <div
                            data-component="mobile_messages_new_page_screen_form_scroll_list-card_body_form-card_content_variables_price-info_summary"
                            className={styles.priceInfoSummary}
                          >
                            <div data-component="mobile_messages_new_page_screen_form_scroll_list-card_body_form-card_content_variables_price-info_summary_row" className={styles.priceInfoSummaryRow}>
                              <span>바우처</span>
                              <strong>{getVoucherTypeLabel(templateVariableValues.type ?? "")}</strong>
                            </div>
                            <div data-component="mobile_messages_new_page_screen_form_scroll_list-card_body_form-card_content_variables_price-info_summary_row" className={styles.priceInfoSummaryRow}>
                              <span>총 서비스 금액</span>
                              <strong>{selectedPriceInfoSummary.fullPrice || "-"}</strong>
                            </div>
                            <div data-component="mobile_messages_new_page_screen_form_scroll_list-card_body_form-card_content_variables_price-info_summary_row" className={styles.priceInfoSummaryRow}>
                              <span>정부지원금</span>
                              <strong>{selectedPriceInfoSummary.grant || "-"}</strong>
                            </div>
                            <div data-component="mobile_messages_new_page_screen_form_scroll_list-card_body_form-card_content_variables_price-info_summary_row" className={styles.priceInfoSummaryRow}>
                              <span>본인부담금</span>
                              <strong>{selectedPriceInfoSummary.actualPrice || "-"}</strong>
                            </div>
                            <div data-component="mobile_messages_new_page_screen_form_scroll_list-card_body_form-card_content_variables_price-info_summary_row" className={styles.priceInfoSummaryRow}>
                              <span>계좌</span>
                              <strong>
                                {selectedPriceInfoSummary.bankName && selectedPriceInfoSummary.accNum
                                  ? `${selectedPriceInfoSummary.bankName} ${selectedPriceInfoSummary.accNum}`
                                  : "-"}
                              </strong>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <div data-component="mobile_messages_new_page_screen_form_scroll_list-card_body_form-card_content_message-body" className={styles.formCardSection}>
                  <div data-component="mobile_messages_new_page_screen_form_scroll_list-card_body_form-card_content_message-body_row" className={styles.formSection}>
                    <div data-component="mobile_messages_new_page_screen_form_scroll_list-card_body_form-card_content_message-body_row_header" className={styles.formSectionHeader}>
                      <label htmlFor="body" className={styles.formLabel}>
                        메시지 본문
                      </label>
                      <button
                        type="button"
                        data-component="mobile_messages_new_page_screen_form_scroll_list-card_body_form-card_content_message-body_row_header_copy"
                        className="list-action ml-auto justify-end"
                        onClick={() => void navigator.clipboard.writeText(body)}
                      >
                        복사
                      </button>
                    </div>
                    <MsgField
                      data-component="mobile_messages_new_page_screen_form_scroll_list-card_body_form-card_content_message-body_row_field"
                      inputId="body"
                      ariaLabel="메시지 본문"
                      value={body}
                      maxLength={MAX_BODY}
                      onChange={setBodyOverride}
                      className={styles.messageField}
                      textareaClassName={styles.messageFieldTextarea}
                    />
                    {showVariableHint ? (
                      <p data-component="mobile_messages_new_page_screen_form_scroll_list-card_body_form-card_content_message-body_row_hint" className={styles.screenReaderNote}>
                        템플릿 변수가 포함되어 있습니다.
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>

            {errorMessage ? (
              <Alert
                data-component="mobile_messages_new_page_screen_form_scroll_list-card_body_error"
                variant="destructive"
                className={styles.feedbackAlert}
              >
                {errorMessage}
              </Alert>
            ) : null}

            {successMessage ? (
              <Alert
                data-component="mobile_messages_new_page_screen_form_scroll_list-card_body_success"
                variant="success"
                className={styles.feedbackAlert}
              >
                {successMessage}
              </Alert>
            ) : null}
            </ListCard>
          </div>
        </form>
      </div>
    </section>
  );
}
