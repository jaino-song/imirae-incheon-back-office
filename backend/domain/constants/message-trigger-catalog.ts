export enum MessageTriggerEventType {
    CLIENT_CREATED = "CLIENT_CREATED",
    SERVICE_START = "SERVICE_START",
    SERVICE_END = "SERVICE_END",
    EMPLOYEE_ASSIGNED = "EMPLOYEE_ASSIGNED",
}

export enum MessageTriggerOffsetType {
    IMMEDIATE = "IMMEDIATE",
    SAME_DAY = "SAME_DAY",
    BEFORE_DAYS = "BEFORE_DAYS",
    AFTER_DAYS = "AFTER_DAYS",
}

export enum MessageTriggerRecipientType {
    CLIENT = "CLIENT",
    PRIMARY_EMPLOYEE = "PRIMARY_EMPLOYEE",
    SECONDARY_EMPLOYEE = "SECONDARY_EMPLOYEE",
}

export enum MessageTriggerTemplateKey {
    CLIENT_WELCOME = "CLIENT_WELCOME",
    SERVICE_START_REMINDER = "SERVICE_START_REMINDER",
    SERVICE_INFO = "SERVICE_INFO",
    SERVICE_END_REMINDER = "SERVICE_END_REMINDER",
    EMPLOYEE_ASSIGNED = "EMPLOYEE_ASSIGNED",
    SERVICE_RECORD_LINK = "SERVICE_RECORD_LINK",
    CLIENT_GREETING = "CLIENT_GREETING",
    PRICE_INFO = "PRICE_INFO",
    REMINDER = "REMINDER",
    THANKS = "THANKS",
    SURVEY = "SURVEY",
    INFO = "INFO",
}

export const AGENT_SMS_RULE_ID_PREFIX = "agent-sms:";

export type SupportedTriggerProvider = "sms";

// Free pairing: every SMS (system-template) trigger may fire on any client lifecycle event.
const CLIENT_EVENT_TYPES = [
    MessageTriggerEventType.CLIENT_CREATED,
    MessageTriggerEventType.SERVICE_START,
    MessageTriggerEventType.SERVICE_END,
];

export interface MessageTriggerTemplateVariable {
    key: string;
    label: string;
}

export interface MessageTriggerTemplateCatalogItem {
    key: MessageTriggerTemplateKey;
    name: string;
    description: string;
    allowedEventTypes: MessageTriggerEventType[];
    allowedRecipientTypes: MessageTriggerRecipientType[];
    requiredVariables: MessageTriggerTemplateVariable[];
    providers: Partial<Record<SupportedTriggerProvider, { templateKey: string }>>;
}

export const EVENT_RECIPIENT_OPTIONS: Record<
    MessageTriggerEventType,
    readonly MessageTriggerRecipientType[]
> = {
    [MessageTriggerEventType.CLIENT_CREATED]: [MessageTriggerRecipientType.CLIENT],
    [MessageTriggerEventType.SERVICE_START]: [MessageTriggerRecipientType.CLIENT],
    [MessageTriggerEventType.SERVICE_END]: [MessageTriggerRecipientType.CLIENT],
    [MessageTriggerEventType.EMPLOYEE_ASSIGNED]: [
        MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
        MessageTriggerRecipientType.SECONDARY_EMPLOYEE,
    ],
};

export const EVENT_OFFSET_OPTIONS: Record<
    MessageTriggerEventType,
    readonly MessageTriggerOffsetType[]
> = {
    [MessageTriggerEventType.CLIENT_CREATED]: [
        MessageTriggerOffsetType.IMMEDIATE,
        MessageTriggerOffsetType.AFTER_DAYS,
    ],
    [MessageTriggerEventType.SERVICE_START]: [
        MessageTriggerOffsetType.SAME_DAY,
        MessageTriggerOffsetType.BEFORE_DAYS,
        MessageTriggerOffsetType.AFTER_DAYS,
    ],
    [MessageTriggerEventType.SERVICE_END]: [
        MessageTriggerOffsetType.SAME_DAY,
        MessageTriggerOffsetType.BEFORE_DAYS,
        MessageTriggerOffsetType.AFTER_DAYS,
    ],
    [MessageTriggerEventType.EMPLOYEE_ASSIGNED]: [MessageTriggerOffsetType.IMMEDIATE],
};

export const MESSAGE_TRIGGER_TEMPLATE_CATALOG: Record<
    MessageTriggerTemplateKey,
    MessageTriggerTemplateCatalogItem
> = {
    [MessageTriggerTemplateKey.CLIENT_WELCOME]: {
        key: MessageTriggerTemplateKey.CLIENT_WELCOME,
        name: "고객 등록 안내",
        description: "고객 등록 직후 또는 등록 후 N일 뒤 발송하는 안내 메시지",
        allowedEventTypes: [MessageTriggerEventType.CLIENT_CREATED],
        allowedRecipientTypes: [MessageTriggerRecipientType.CLIENT],
        requiredVariables: [
            { key: "clientName", label: "고객명" },
            { key: "registrationDate", label: "등록일" },
            { key: "serviceType", label: "서비스 타입" },
        ],
        providers: {
            sms: { templateKey: "CLIENT_WELCOME" },
        },
    },
    [MessageTriggerTemplateKey.SERVICE_START_REMINDER]: {
        key: MessageTriggerTemplateKey.SERVICE_START_REMINDER,
        name: "서비스 시작 알림",
        description: "서비스 시작 전후 기준으로 고객에게 발송하는 안내 메시지",
        allowedEventTypes: [MessageTriggerEventType.SERVICE_START],
        allowedRecipientTypes: [MessageTriggerRecipientType.CLIENT],
        requiredVariables: [
            { key: "clientName", label: "고객명" },
            { key: "serviceStartDate", label: "서비스 시작일" },
            { key: "timingText", label: "발송 기준 문구" },
        ],
        providers: {
            sms: { templateKey: "SERVICE_START_REMINDER" },
        },
    },
    [MessageTriggerTemplateKey.SERVICE_INFO]: {
        key: MessageTriggerTemplateKey.SERVICE_INFO,
        name: "서비스 안내",
        description: "서비스 시작 전 주요 안내사항을 고객에게 SMS로 발송하는 메시지",
        allowedEventTypes: CLIENT_EVENT_TYPES,
        allowedRecipientTypes: [MessageTriggerRecipientType.CLIENT],
        requiredVariables: [
            { key: "name", label: "산모님 성함" },
        ],
        providers: {
            sms: { templateKey: "SERVICE_INFO" },
        },
    },
    [MessageTriggerTemplateKey.SERVICE_END_REMINDER]: {
        key: MessageTriggerTemplateKey.SERVICE_END_REMINDER,
        name: "서비스 종료 알림",
        description: "서비스 종료 전후 기준으로 고객에게 발송하는 메시지",
        allowedEventTypes: [MessageTriggerEventType.SERVICE_END],
        allowedRecipientTypes: [MessageTriggerRecipientType.CLIENT],
        requiredVariables: [
            { key: "clientName", label: "고객명" },
            { key: "serviceEndDate", label: "서비스 종료일" },
            { key: "timingText", label: "발송 기준 문구" },
        ],
        providers: {
            sms: { templateKey: "SERVICE_END_REMINDER" },
        },
    },
    [MessageTriggerTemplateKey.EMPLOYEE_ASSIGNED]: {
        key: MessageTriggerTemplateKey.EMPLOYEE_ASSIGNED,
        name: "직원 배정 알림",
        description: "직원이 고객에게 배정될 때 직원에게 발송하는 메시지",
        allowedEventTypes: [MessageTriggerEventType.EMPLOYEE_ASSIGNED],
        allowedRecipientTypes: [
            MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
            MessageTriggerRecipientType.SECONDARY_EMPLOYEE,
        ],
        requiredVariables: [
            { key: "employeeName", label: "직원명" },
            { key: "clientName", label: "고객명" },
            { key: "serviceStartDate", label: "서비스 시작일" },
        ],
        providers: {
            sms: { templateKey: "EMPLOYEE_ASSIGNED" },
        },
    },
    [MessageTriggerTemplateKey.SERVICE_RECORD_LINK]: {
        key: MessageTriggerTemplateKey.SERVICE_RECORD_LINK,
        name: "제공기록지 작성 링크",
        description: "서비스 시작일 오후 3시에 제공인력에게 제공기록지 작성 링크를 SMS로 발송합니다.",
        allowedEventTypes: [MessageTriggerEventType.SERVICE_START],
        allowedRecipientTypes: [MessageTriggerRecipientType.PRIMARY_EMPLOYEE],
        requiredVariables: [
            { key: "employeeName", label: "제공인력명" },
            { key: "clientName", label: "고객명" },
            { key: "serviceStartDate", label: "서비스 시작일" },
            { key: "serviceRecordUrl", label: "제공기록지 링크" },
        ],
        providers: {
            sms: { templateKey: "SERVICE_RECORD_LINK" },
        },
    },
    [MessageTriggerTemplateKey.CLIENT_GREETING]: {
        key: MessageTriggerTemplateKey.CLIENT_GREETING,
        name: "인사 메시지",
        description: "신규 고객 등록 직후 발송하는 인사 메시지 (SMS)",
        allowedEventTypes: CLIENT_EVENT_TYPES,
        allowedRecipientTypes: [MessageTriggerRecipientType.CLIENT],
        requiredVariables: [],
        providers: {
            sms: { templateKey: "CLIENT_GREETING" },
        },
    },
    [MessageTriggerTemplateKey.PRICE_INFO]: {
        key: MessageTriggerTemplateKey.PRICE_INFO,
        name: "비용 안내",
        description: "고객에게 비용·계좌 정보를 SMS로 발송",
        allowedEventTypes: CLIENT_EVENT_TYPES,
        allowedRecipientTypes: [MessageTriggerRecipientType.CLIENT],
        requiredVariables: [
            { key: "name", label: "산모님 성함" },
            { key: "weeks", label: "주수" },
            { key: "duration", label: "이용일수" },
            { key: "type", label: "바우처 유형" },
            { key: "fullPrice", label: "총 금액" },
            { key: "grant", label: "정부지원금" },
            { key: "actualPrice", label: "본인부담금" },
            { key: "bankName", label: "입금 은행" },
            { key: "accNum", label: "계좌번호" },
        ],
        providers: {
            sms: { templateKey: "PRICE_INFO" },
        },
    },
    [MessageTriggerTemplateKey.REMINDER]: {
        key: MessageTriggerTemplateKey.REMINDER,
        name: "리마인드",
        description: "고객에게 일정 리마인드를 SMS로 발송",
        allowedEventTypes: CLIENT_EVENT_TYPES,
        allowedRecipientTypes: [MessageTriggerRecipientType.CLIENT],
        requiredVariables: [{ key: "name", label: "산모님 성함" }],
        providers: {
            sms: { templateKey: "REMINDER" },
        },
    },
    [MessageTriggerTemplateKey.THANKS]: {
        key: MessageTriggerTemplateKey.THANKS,
        name: "예약 완료(입금 확인)",
        description: "고객에게 예약 완료/입금 확인 메시지를 SMS로 발송",
        allowedEventTypes: CLIENT_EVENT_TYPES,
        allowedRecipientTypes: [MessageTriggerRecipientType.CLIENT],
        requiredVariables: [{ key: "name", label: "산모님 성함" }],
        providers: {
            sms: { templateKey: "THANKS" },
        },
    },
    [MessageTriggerTemplateKey.SURVEY]: {
        key: MessageTriggerTemplateKey.SURVEY,
        name: "모니터링 설문",
        description: "고객에게 모니터링 설문 안내를 SMS로 발송",
        allowedEventTypes: CLIENT_EVENT_TYPES,
        allowedRecipientTypes: [MessageTriggerRecipientType.CLIENT],
        requiredVariables: [{ key: "name", label: "산모님 성함" }],
        providers: {
            sms: { templateKey: "SURVEY" },
        },
    },
    [MessageTriggerTemplateKey.INFO]: {
        key: MessageTriggerTemplateKey.INFO,
        name: "정보 요청",
        description: "고객에게 정보 안내 메시지를 SMS로 발송",
        allowedEventTypes: CLIENT_EVENT_TYPES,
        allowedRecipientTypes: [MessageTriggerRecipientType.CLIENT],
        requiredVariables: [],
        providers: {
            sms: { templateKey: "INFO" },
        },
    },
};

export function getMessageTriggerTemplateCatalog(
    provider: SupportedTriggerProvider,
): MessageTriggerTemplateCatalogItem[] {
    return Object.values(MESSAGE_TRIGGER_TEMPLATE_CATALOG).filter(
        (item) => item.providers[provider],
    );
}

export function isCompatibleMessageTriggerTemplate(params: {
    templateKey: MessageTriggerTemplateKey;
    eventType: MessageTriggerEventType;
    recipientType: MessageTriggerRecipientType;
}): boolean {
    const item = MESSAGE_TRIGGER_TEMPLATE_CATALOG[params.templateKey];
    return (
        item.allowedEventTypes.includes(params.eventType) &&
        item.allowedRecipientTypes.includes(params.recipientType)
    );
}
