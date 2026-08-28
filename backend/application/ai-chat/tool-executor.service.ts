import { Injectable, Logger } from "@nestjs/common";
import { ClientService } from "application/services/client.service";
import { EmployeeService } from "application/services/employee.service";
import { MessageService } from "application/services/message.service";
import { AreaTemplateService } from "application/services/area-template.service";
import { EformsignDocService } from "application/services/eformsign-doc.service";
import { VoucherPriceInfoService } from "application/services/voucher-price-info.service";
import { BankAccountInfoService } from "application/services/bank-account-info.service";
import { EmployeeScheduleService } from "application/services/employee-schedule.service";
import { isCUDTool } from "./tools";
import {
    ConsumedLegacyChatConfirmationIntent,
    LegacyChatConfirmationContext,
    LegacyChatConfirmationIntentResponse,
    LegacyChatConfirmationService,
    hashLegacyChatPayload,
    isConsumedLegacyChatConfirmationIntent,
    redactSensitiveLegacyChatContent,
    sanitizeLegacyChatToolPayload,
} from "./legacy-chat-confirmation.service";

export interface ToolExecutionResult {
    success: boolean;
    data?: unknown;
    error?: string;
    requiresConfirmation?: boolean;
    confirmationMessage?: string;
    confirmationIntentId?: string;
    confirmationNonce?: string;
    confirmationExpiresAt?: string;
}

type ToolArgs = Record<string, unknown>;

interface ToolIntegerOptions {
    min?: number;
    max?: number;
    defaultValue?: number;
}

interface ToolBooleanOptions {
    defaultValue?: boolean;
}

interface ToolStringOptions {
    allowedValues?: readonly string[];
    defaultValue?: string;
}

export interface LegacyChatToolContext extends LegacyChatConfirmationContext {
    globalRole?: string;
    branchRole?: string;
}

type ToolExecutionContext = LegacyChatToolContext | string;

const CLIENT_FILTERS = [
    "no-contract",
    "starting-soon",
    "ending-soon",
    "incomplete-contracts",
] as const;

const CLIENT_SERVICE_STATUSES = [
    "pre_booking",
    "waiting",
    "replacement_requested",
    "active",
    "completed",
    "terminated",
] as const;

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const BIRTHDAY_PATTERN = /^(\d{2})(\d{2})(\d{2})$/;

@Injectable()
export class ToolExecutorService {
    private readonly logger = new Logger(ToolExecutorService.name);

    constructor(
        private readonly clientService: ClientService,
        private readonly employeeService: EmployeeService,
        private readonly messageService: MessageService,
        private readonly areaTemplateService: AreaTemplateService,
        private readonly eformsignDocService: EformsignDocService,
        private readonly voucherPriceInfoService: VoucherPriceInfoService,
        private readonly bankAccountInfoService: BankAccountInfoService,
        private readonly employeeScheduleService: EmployeeScheduleService,
        private readonly confirmationService?: LegacyChatConfirmationService,
    ) {}

    async execute(
        contextOrBranchId: ToolExecutionContext,
        toolName: string,
        args: ToolArgs,
    ): Promise<ToolExecutionResult> {
        const context = this.normalizeContext(contextOrBranchId);
        const argKeys = Object.keys(args || {}).sort();
        this.logger.log(
            `Executing tool: ${toolName} argKeys=[${argKeys.join(',')}]`
        );

        if (isCUDTool(toolName)) {
            const validationError = this.validateMutationPayload(toolName, args);
            if (validationError) {
                return { success: false, error: validationError };
            }

            if (!this.isBoundContext(context) || !this.confirmationService) {
                return this.requestConfirmation(toolName, args);
            }

            const intent = await this.confirmationService.createIntent(
                context,
                toolName,
                sanitizeLegacyChatToolPayload(args),
            );
            return this.requestConfirmation(toolName, args, intent);
        }

        try {
            switch (toolName) {
                case "searchClients":
                    return await this.searchClients(context.branchId, args);
                case "getClient":
                    return await this.getClient(context.branchId, args);
                case "createClient":
                    return await this.createClient(context.branchId, args);
                case "updateClient":
                    return await this.updateClient(context.branchId, args);
                case "deleteClient":
                    return await this.deleteClient(context.branchId, args);
                case "searchEmployees":
                    return await this.searchEmployees(context.branchId, args);
                case "getEmployee":
                    return await this.getEmployee(context.branchId, args);
                case "createEmployee":
                    return await this.createEmployee(context.branchId, args);
                case "updateEmployee":
                    return await this.updateEmployee(context.branchId, args);
                case "deleteEmployee":
                    return await this.deleteEmployee(context.branchId, args);
                case "getMessages":
                    return await this.getMessages(context.branchId);
                case "createMessage":
                    return await this.createMessage(context.branchId, args);
                case "updateMessage":
                    return await this.updateMessage(context.branchId, args);
                case "deleteMessage":
                    return await this.deleteMessage(context.branchId, args);
                case "listAvailableTemplates":
                    return await this.listAvailableTemplates(context.branchId);
                case "createAndSendContract":
                    return await this.createAndSendContract(context.branchId, args);
                case "getContractStatus":
                    return await this.getContractStatus(context.branchId, args);
                case "getDashboardStats":
                    return await this.getDashboardStats(context.branchId);
                // Client filters & actions
                case "getClientsByFilter":
                    return await this.getClientsByFilter(context.branchId, args);
                case "terminateClientService":
                    return await this.terminateClientService(context.branchId, args);
                case "requestEmployeeReplacement":
                    return await this.requestEmployeeReplacement(context.branchId, args);
                // Employee filters & actions
                case "getAvailableEmployees":
                    return await this.getAvailableEmployees(context.branchId);
                case "getEmployeesByWorkArea":
                    return await this.getEmployeesByWorkArea(context.branchId, args);
                case "getEmployeesByGrade":
                    return await this.getEmployeesByGrade(context.branchId, args);
                case "changeEmployeeAvailability":
                    return await this.changeEmployeeAvailability(context.branchId, args);
                // Schedules
                case "listSchedules":
                    return await this.listSchedules(context.branchId);
                case "getSchedulesByEmployee":
                    return await this.getSchedulesByEmployee(context.branchId, args);
                // Voucher prices
                case "listVoucherPrices":
                    return await this.listVoucherPrices(args);
                case "getVoucherPriceByType":
                    return await this.getVoucherPriceByType(args);
                // Bank accounts
                case "listBankAccounts":
                    return await this.listBankAccounts(context);
                case "getBankAccountByArea":
                    return await this.getBankAccountByArea(context, args);
                // Contracts
                case "listAllContracts":
                    return await this.listAllContracts(context.branchId);
                default:
                    return { success: false, error: `Unknown tool: ${toolName}` };
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "unknown error";
            this.logger.error(`Tool execution failed: ${errorMessage.replace(/\d[\d\s-]{7,}\d/g, "[REDACTED]")}`);
            return {
                success: false,
                error: errorMessage.replace(/\d[\d\s-]{7,}\d/g, "[REDACTED]"),
            };
        }
    }

    /** Execute only after LegacyChatConfirmationService atomically consumed an intent. */
    async executeAuthorized(
        context: LegacyChatToolContext,
        toolName: string,
        args: ToolArgs,
        intent?: ConsumedLegacyChatConfirmationIntent,
    ): Promise<ToolExecutionResult> {
        if (
            !isCUDTool(toolName)
            || !intent
            || intent.toolName !== toolName
            || intent.userId !== context.userId
            || intent.branchId !== context.branchId
            || intent.sessionId !== context.sessionId
            || intent.payloadHash !== hashLegacyChatPayload(args)
            || !isConsumedLegacyChatConfirmationIntent(intent)
        ) {
            return { success: false, error: "Only confirmed mutation tools can use this path" };
        }

        const sanitizedArgs = sanitizeLegacyChatToolPayload(args);
        try {
            switch (toolName) {
                case "createClient": return await this.createClient(context.branchId, sanitizedArgs);
                case "updateClient": return await this.updateClient(context.branchId, sanitizedArgs);
                case "deleteClient": return await this.deleteClient(context.branchId, sanitizedArgs);
                case "terminateClientService": return await this.terminateClientService(context.branchId, sanitizedArgs);
                case "requestEmployeeReplacement": return await this.requestEmployeeReplacement(context.branchId, sanitizedArgs);
                case "createEmployee": return await this.createEmployee(context.branchId, sanitizedArgs);
                case "updateEmployee": return await this.updateEmployee(context.branchId, sanitizedArgs);
                case "deleteEmployee": return await this.deleteEmployee(context.branchId, sanitizedArgs);
                case "changeEmployeeAvailability": return await this.changeEmployeeAvailability(context.branchId, sanitizedArgs);
                case "createMessage": return await this.createMessage(context.branchId, sanitizedArgs);
                case "updateMessage": return await this.updateMessage(context.branchId, sanitizedArgs);
                case "deleteMessage": return await this.deleteMessage(context.branchId, sanitizedArgs);
                case "createAndSendContract": return await this.createAndSendContract(context.branchId, sanitizedArgs);
                default: return { success: false, error: `Unknown tool: ${toolName}` };
            }
        } catch (error) {
            this.logger.error(`Confirmed tool execution failed: ${toolName}`);
            const errorMessage = error instanceof Error ? error.message : "unknown error";
            return {
                success: false,
                error: errorMessage.replace(/\d[\d\s-]{7,}\d/g, "[REDACTED]"),
            };
        }
    }

    private normalizeContext(contextOrBranchId: ToolExecutionContext): LegacyChatToolContext {
        if (typeof contextOrBranchId === "string") {
            return {
                userId: "",
                branchId: contextOrBranchId,
                sessionId: "",
            };
        }

        return contextOrBranchId;
    }

    private isBoundContext(context: LegacyChatToolContext): context is LegacyChatToolContext {
        return Boolean(context.userId && context.branchId && context.sessionId);
    }

    private validateMutationPayload(toolName: string, args: ToolArgs): string | null {
        try {
            switch (toolName) {
                case "createClient":
                    this.parseRequiredStringArg(args, "name");
                    this.parseRequiredIntegerArg(args, "primaryEmployeeId", { min: 1 });
                    this.parseRequiredBooleanArg(args, "careCenter");
                    this.parseRequiredBooleanArg(args, "voucherClient");
                    this.parseOptionalIntegerArg(args, "secondaryEmployeeId", { min: 1 });
                    this.parseOptionalIntegerArg(args, "duration", { min: 1 });
                    this.parseOptionalDateArg(args, "startDate");
                    this.parseOptionalDateArg(args, "endDate");
                    this.parseNullableBirthdayArg(args, "birthday");
                    break;
                case "updateClient":
                    if (this.isMissingArg(args["clientId"]) && this.isMissingArg(args["clientName"])) {
                        throw new Error("clientId 또는 clientName이 필요합니다");
                    }
                    if (!this.isMissingArg(args["clientId"])) this.parseRequiredIntegerArg(args, "clientId", { min: 1 });
                    if (!this.isMissingArg(args["primaryEmployeeId"])) this.parseOptionalIntegerArg(args, "primaryEmployeeId", { min: 1 });
                    if (!this.isMissingArg(args["secondaryEmployeeId"])) this.parseOptionalIntegerArg(args, "secondaryEmployeeId", { min: 1 });
                    if (!this.isMissingArg(args["careCenter"])) this.parseOptionalBooleanArg(args, "careCenter");
                    if (!this.isMissingArg(args["voucherClient"])) this.parseOptionalBooleanArg(args, "voucherClient");
                    this.parseOptionalDateArg(args, "startDate");
                    this.parseOptionalDateArg(args, "endDate");
                    break;
                case "deleteClient":
                case "terminateClientService":
                    if (this.isMissingArg(args["clientId"]) && this.isMissingArg(args["clientName"])) {
                        throw new Error("clientId 또는 clientName이 필요합니다");
                    }
                    if (!this.isMissingArg(args["clientId"])) this.parseRequiredIntegerArg(args, "clientId", { min: 1 });
                    break;
                case "requestEmployeeReplacement":
                    if (this.isMissingArg(args["clientId"]) && this.isMissingArg(args["clientName"])) {
                        throw new Error("clientId 또는 clientName이 필요합니다");
                    }
                    if (!this.isMissingArg(args["clientId"])) this.parseRequiredIntegerArg(args, "clientId", { min: 1 });
                    if (!this.isMissingArg(args["newPrimaryEmployeeId"])) this.parseRequiredIntegerArg(args, "newPrimaryEmployeeId", { min: 1 });
                    if (!this.isMissingArg(args["newSecondaryEmployeeId"])) this.parseOptionalIntegerArg(args, "newSecondaryEmployeeId", { min: 1 });
                    break;
                case "createEmployee":
                    this.parseRequiredStringArg(args, "name");
                    this.parseRequiredStringArg(args, "phone");
                    this.parseRequiredStringArg(args, "grade");
                    this.parseOptionalBooleanArg(args, "openToNextWork");
                    this.parseOptionalDateArg(args, "companyRegisteredDate");
                    break;
                case "updateEmployee":
                case "deleteEmployee":
                case "changeEmployeeAvailability":
                    this.parseRequiredIntegerArg(args, "employeeId", { min: 1 });
                    if (toolName === "changeEmployeeAvailability") this.parseRequiredBooleanArg(args, "available");
                    if (toolName === "updateEmployee") {
                        this.parseOptionalBooleanArg(args, "openToNextWork");
                        this.parseOptionalDateArg(args, "companyRegisteredDate");
                    }
                    break;
                case "createMessage":
                    this.parseRequiredStringArg(args, "title");
                    this.parseRequiredStringArg(args, "text");
                    break;
                case "updateMessage":
                    this.parseRequiredIntegerArg(args, "messageId", { min: 1 });
                    this.parseRequiredStringArg(args, "title");
                    this.parseRequiredStringArg(args, "text");
                    break;
                case "deleteMessage":
                    this.parseRequiredIntegerArg(args, "messageId", { min: 1 });
                    break;
                case "createAndSendContract":
                    this.parseRequiredIntegerArg(args, "clientId", { min: 1 });
                    this.parseRequiredStringArg(args, "areaId");
                    break;
                default:
                    break;
            }
            return null;
        } catch (error) {
            return error instanceof Error ? error.message : "입력값이 올바르지 않습니다";
        }
    }

    private requestConfirmation(
        toolName: string,
        args: ToolArgs,
        intent?: LegacyChatConfirmationIntentResponse,
    ): ToolExecutionResult {
        const clientRef = args['clientId'] ?? args['clientName'] ?? '?';
        const employeeRef = args['employeeId'] ?? args['employeeName'] ?? '?';
        const newPrimaryEmployeeRef = args['newPrimaryEmployeeId'] ?? args['newPrimaryEmployeeName'] ?? '?';
        const messages: Record<string, string> = {
            createClient: `새 산모 "${args['name']}"님을 등록하시겠습니까?`,
            updateClient: `산모 ${clientRef}의 정보를 수정하시겠습니까?`,
            deleteClient: `산모 ${clientRef}을(를) 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`,
            terminateClientService: `산모 ${clientRef}의 서비스를 종료하시겠습니까?`,
            requestEmployeeReplacement: `산모 ${clientRef}의 관리사를 교체하시겠습니까? (새 담당: ${newPrimaryEmployeeRef})`,
            createEmployee: `새 관리사 "${args['name']}"님을 등록하시겠습니까?`,
            updateEmployee: `관리사 ${employeeRef}의 정보를 수정하시겠습니까?`,
            deleteEmployee: `관리사 ${employeeRef}을(를) 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`,
            changeEmployeeAvailability: `관리사 ${employeeRef}의 배정 상태를 ${this.booleanLabel(args['available'], '가능', '불가')}으로 변경하시겠습니까?`,
            createMessage: `새 메시지 "${args['title']}"을(를) 등록하시겠습니까?`,
            updateMessage: `메시지 ID ${args['messageId']}을(를) 수정하시겠습니까?`,
            deleteMessage: `메시지 ID ${args['messageId']}을(를) 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`,
            createAndSendContract: `산모 ${clientRef}에게 계약서를 발송하시겠습니까?`,
        };

        const confirmationMessage = messages[toolName] || `${toolName} 작업을 실행하시겠습니까?`;

        return {
            success: true,
            requiresConfirmation: true,
            confirmationMessage: redactSensitiveLegacyChatContent(confirmationMessage),
            confirmationIntentId: intent?.intentId,
            confirmationNonce: intent?.nonce,
            confirmationExpiresAt: intent?.confirmationExpiresAt,
        };
    }

    private isMissingArg(value: unknown): boolean {
        return value === undefined || value === null || (typeof value === "string" && value.trim().length === 0);
    }

    private parseRequiredIntegerArg(args: ToolArgs, key: string, options: ToolIntegerOptions = {}): number {
        const value = args[key];
        if (this.isMissingArg(value)) {
            throw new Error(`${key}이(가) 필요합니다`);
        }

        return this.parseIntegerValue(value, key, options);
    }

    private parseOptionalIntegerArg(args: ToolArgs, key: string, options: ToolIntegerOptions = {}): number | undefined {
        const value = args[key];
        if (this.isMissingArg(value)) {
            return options.defaultValue;
        }

        return this.parseIntegerValue(value, key, options);
    }

    private parseNullableIntegerArg(args: ToolArgs, key: string, options: ToolIntegerOptions = {}): number | null {
        const value = args[key];
        if (this.isMissingArg(value)) {
            return null;
        }

        return this.parseIntegerValue(value, key, options);
    }

    private parseIntegerValue(value: unknown, key: string, options: ToolIntegerOptions): number {
        let parsed: number;

        if (typeof value === "number") {
            parsed = value;
        } else if (typeof value === "string" && /^[-+]?\d+$/.test(value.trim())) {
            parsed = Number(value.trim());
        } else {
            throw new Error(this.integerErrorMessage(key, options));
        }

        if (!Number.isSafeInteger(parsed)) {
            throw new Error(this.integerErrorMessage(key, options));
        }

        if (options.min !== undefined && parsed < options.min) {
            throw new Error(this.integerErrorMessage(key, options));
        }

        if (options.max !== undefined && parsed > options.max) {
            throw new Error(this.integerErrorMessage(key, options));
        }

        return parsed;
    }

    private integerErrorMessage(key: string, options: ToolIntegerOptions): string {
        if (options.min !== undefined && options.max !== undefined) {
            return `${key}은(는) ${options.min} 이상 ${options.max} 이하의 정수여야 합니다`;
        }

        if (options.min !== undefined) {
            return `${key}은(는) ${options.min} 이상의 정수여야 합니다`;
        }

        if (options.max !== undefined) {
            return `${key}은(는) ${options.max} 이하의 정수여야 합니다`;
        }

        return `${key}은(는) 정수여야 합니다`;
    }

    private parseRequiredBooleanArg(args: ToolArgs, key: string): boolean {
        const value = args[key];
        if (this.isMissingArg(value)) {
            throw new Error(`${key}이(가) 필요합니다`);
        }

        return this.parseBooleanValue(value, key);
    }

    private parseOptionalBooleanArg(args: ToolArgs, key: string, options: ToolBooleanOptions = {}): boolean | undefined {
        const value = args[key];
        if (this.isMissingArg(value)) {
            return options.defaultValue;
        }

        return this.parseBooleanValue(value, key);
    }

    private parseBooleanValue(value: unknown, key: string): boolean {
        if (typeof value !== "boolean") {
            throw new Error(`${key}은(는) true 또는 false여야 합니다`);
        }

        return value;
    }

    private booleanLabel(value: unknown, trueLabel: string, falseLabel: string): string {
        if (value === true) {
            return trueLabel;
        }

        if (value === false) {
            return falseLabel;
        }

        return "지정된 상태";
    }

    private parseRequiredStringArg(args: ToolArgs, key: string, options: ToolStringOptions = {}): string {
        const value = args[key];
        if (this.isMissingArg(value)) {
            throw new Error(`${key}이(가) 필요합니다`);
        }

        return this.parseStringValue(value, key, options);
    }

    private parseOptionalStringArg(args: ToolArgs, key: string, options: ToolStringOptions = {}): string | undefined {
        const value = args[key];
        if (this.isMissingArg(value)) {
            return options.defaultValue;
        }

        return this.parseStringValue(value, key, options);
    }

    private parseNullableStringArg(args: ToolArgs, key: string, options: ToolStringOptions = {}): string | null {
        const value = args[key];
        if (this.isMissingArg(value)) {
            return null;
        }

        return this.parseStringValue(value, key, options);
    }

    private parseOptionalStringListArg(args: ToolArgs, key: string): string[] {
        const value = this.parseOptionalStringArg(args, key);
        if (value === undefined) {
            return [];
        }

        return value.split(",").map((item) => item.trim()).filter(Boolean);
    }

    private parseStringValue(value: unknown, key: string, options: ToolStringOptions): string {
        if (typeof value !== "string") {
            throw new Error(`${key}은(는) 문자열이어야 합니다`);
        }

        const parsed = value.trim();
        if (parsed.length === 0) {
            throw new Error(`${key}이(가) 필요합니다`);
        }

        if (options.allowedValues && !options.allowedValues.includes(parsed)) {
            throw new Error(`${key}은(는) ${options.allowedValues.join(", ")} 중 하나여야 합니다`);
        }

        return parsed;
    }

    private parseOptionalDateArg(args: ToolArgs, key: string): string | undefined {
        const value = this.parseOptionalStringArg(args, key);
        if (value === undefined) {
            return undefined;
        }

        return this.parseDateValue(value, key);
    }

    private parseNullableDateArg(args: ToolArgs, key: string): string | null {
        const value = this.parseOptionalStringArg(args, key);
        if (value === undefined) {
            return null;
        }

        return this.parseDateValue(value, key);
    }

    private parseNullableBirthdayArg(args: ToolArgs, key: string): string | null {
        const value = this.parseOptionalStringArg(args, key);
        if (value === undefined) {
            return null;
        }

        return this.parseBirthdayValue(value, key);
    }

    private parseDateValue(value: string, key: string): string {
        const match = ISO_DATE_PATTERN.exec(value);
        if (!match) {
            throw new Error(`${key}은(는) YYYY-MM-DD 형식이어야 합니다`);
        }

        const year = Number(match[1]);
        const month = Number(match[2]);
        const day = Number(match[3]);
        const date = new Date(Date.UTC(year, month - 1, day));
        const isValidDate =
            date.getUTCFullYear() === year
            && date.getUTCMonth() === month - 1
            && date.getUTCDate() === day;

        if (!isValidDate) {
            throw new Error(`${key}은(는) 유효한 날짜여야 합니다`);
        }

        return value;
    }

    private parseBirthdayValue(value: string, key: string): string {
        const match = BIRTHDAY_PATTERN.exec(value);
        if (!match) {
            throw new Error(`${key}은(는) YYMMDD 형식이어야 합니다`);
        }

        const year = 2000 + Number(match[1]);
        const month = Number(match[2]);
        const day = Number(match[3]);
        const date = new Date(Date.UTC(year, month - 1, day));
        const isValidDate =
            date.getUTCFullYear() === year
            && date.getUTCMonth() === month - 1
            && date.getUTCDate() === day;

        if (!isValidDate) {
            throw new Error(`${key}은(는) 유효한 생년월일이어야 합니다`);
        }

        return value;
    }

    private async resolveClientId(branchid: string, args: ToolArgs): Promise<number> {
        const rawId = args['clientId'];
        if (!this.isMissingArg(rawId)) {
            return this.parseRequiredIntegerArg(args, "clientId", { min: 1 });
        }

        const clientName = [args['clientName'], args['name'], args['query']]
            .find((value) => typeof value === "string" && value.trim().length > 0);

        if (!clientName || typeof clientName !== "string") {
            throw new Error("clientId 또는 clientName이 필요합니다");
        }

        const query = clientName.trim();
        const result = await this.clientService.findAllPaginated(branchid, 1, 10, query);
        if (result.data.length === 0) {
            throw new Error(`"${query}" 산모를 찾을 수 없습니다`);
        }
        if (result.data.length > 1) {
            const candidates = result.data.slice(0, 5).map((c) => `${c.id}:${c.name}`).join(", ");
            throw new Error(`"${query}" 이름의 산모가 여러 명입니다. clientId를 지정해주세요 (${candidates})`);
        }

        return result.data[0]!.id;
    }

    private async resolveEmployeeId(
        branchid: string,
        args: ToolArgs,
        idKey: string,
        nameKey: string,
    ): Promise<number> {
        const rawId = args[idKey];
        if (!this.isMissingArg(rawId)) {
            return this.parseRequiredIntegerArg(args, idKey, { min: 1 });
        }

        const employeeNameRaw = args[nameKey];
        if (typeof employeeNameRaw !== "string" || employeeNameRaw.trim().length === 0) {
            throw new Error(`${idKey} 또는 ${nameKey}이 필요합니다`);
        }

        const employeeName = employeeNameRaw.trim();
        const employees = await this.employeeService.findAll(branchid);
        const matches = employees.filter((e) => e.name.includes(employeeName));

        if (matches.length === 0) {
            throw new Error(`"${employeeName}" 관리사를 찾을 수 없습니다`);
        }
        if (matches.length > 1) {
            const candidates = matches.slice(0, 5).map((e) => `${e.id}:${e.name}`).join(", ");
            throw new Error(`"${employeeName}" 이름의 관리사가 여러 명입니다. ${idKey}를 지정해주세요 (${candidates})`);
        }

        return matches[0]!.id;
    }

    private async searchClients(branchid: string, args: ToolArgs): Promise<ToolExecutionResult> {
        const query = String(args['query'] || "");
        const page = this.parseOptionalIntegerArg(args, "page", { defaultValue: 1, min: 1 }) ?? 1;
        const requestedLimit = this.parseOptionalIntegerArg(args, "limit", { defaultValue: 10, min: 1 }) ?? 10;
        const limit = Math.min(requestedLimit, 50);

        const result = await this.clientService.findAllPaginated(branchid, page, limit, query);
        return {
            success: true,
            data: {
                clients: result.data.map(c => ({
                    id: c.id,
                    name: c.name,
                    phone: c.phone,
                    address: c.address,
                    serviceStatus: c.serviceStatus,
                    primaryEmployee: c.primaryEmployee?.name,
                })),
                total: result.total,
                page: result.page,
                totalPages: result.totalPages,
            },
        };
    }

    private async getClient(branchid: string, args: ToolArgs): Promise<ToolExecutionResult> {
        const clientId = this.parseRequiredIntegerArg(args, "clientId", { min: 1 });
        const client = await this.clientService.findById(branchid, clientId);
        if (!client) {
            return { success: false, error: "산모를 찾을 수 없습니다" };
        }
        return { success: true, data: client };
    }

    private async createClient(branchid: string, args: ToolArgs): Promise<ToolExecutionResult> {
        const client = await this.clientService.create(branchid, {
            name: this.parseRequiredStringArg(args, "name"),
            primaryEmployeeId: this.parseRequiredIntegerArg(args, "primaryEmployeeId", { min: 1 }),
            secondaryEmployeeId: this.parseOptionalIntegerArg(args, "secondaryEmployeeId", { min: 1 }) ?? null,
            address: this.parseNullableStringArg(args, "address"),
            phone: this.parseNullableStringArg(args, "phone"),
            type: this.parseNullableStringArg(args, "type"),
            duration: this.parseOptionalIntegerArg(args, "duration", { min: 1 }) ?? null,
            startDate: this.parseNullableDateArg(args, "startDate"),
            endDate: this.parseNullableDateArg(args, "endDate"),
            careCenter: this.parseRequiredBooleanArg(args, "careCenter"),
            voucherClient: this.parseRequiredBooleanArg(args, "voucherClient"),
            birthday: this.parseNullableBirthdayArg(args, "birthday"),
            breastPump: this.parseOptionalBooleanArg(args, "breastPump", { defaultValue: false }) ?? false,
        });
        return { success: true, data: { id: client.id, name: client.name, message: "산모가 등록되었습니다" } };
    }

    private async updateClient(branchid: string, args: ToolArgs): Promise<ToolExecutionResult> {
        const clientId = await this.resolveClientId(branchid, args);
        const updateData: Record<string, unknown> = {};
        
        if (args['name'] !== undefined) {
            const name = this.parseOptionalStringArg(args, "name");
            if (name !== undefined) updateData['name'] = name;
        }
        if (args['phone'] !== undefined) updateData['phone'] = this.parseNullableStringArg(args, "phone");
        if (args['address'] !== undefined) updateData['address'] = this.parseNullableStringArg(args, "address");
        if (args['primaryEmployeeId'] !== undefined) updateData['primaryEmployeeId'] = this.parseRequiredIntegerArg(args, "primaryEmployeeId", { min: 1 });
        if (args['secondaryEmployeeId'] !== undefined) updateData['secondaryEmployeeId'] = this.parseNullableIntegerArg(args, "secondaryEmployeeId", { min: 1 });
        if (args['type'] !== undefined) updateData['type'] = this.parseNullableStringArg(args, "type");
        if (args['duration'] !== undefined) updateData['duration'] = this.parseNullableIntegerArg(args, "duration", { min: 1 });
        if (args['startDate'] !== undefined) updateData['startDate'] = this.parseNullableDateArg(args, "startDate");
        if (args['endDate'] !== undefined) updateData['endDate'] = this.parseNullableDateArg(args, "endDate");
        if (args['serviceStatus'] !== undefined) updateData['serviceStatus'] = this.parseNullableStringArg(args, "serviceStatus", { allowedValues: CLIENT_SERVICE_STATUSES });

        const client = await this.clientService.update(
            branchid,
            clientId,
            updateData as Parameters<typeof this.clientService.update>[2]
        );
        return { success: true, data: { id: client.id, name: client.name, message: "산모 정보가 수정되었습니다" } };
    }

    private async deleteClient(branchid: string, args: ToolArgs): Promise<ToolExecutionResult> {
        const clientId = await this.resolveClientId(branchid, args);
        await this.clientService.delete(branchid, clientId);
        return { success: true, data: { message: "산모가 삭제되었습니다" } };
    }

    private async searchEmployees(branchid: string, args: ToolArgs): Promise<ToolExecutionResult> {
        const query = String(args['query'] || "");
        const openToNextWork = this.parseOptionalBooleanArg(args, "openToNextWork");
        const employees = await this.employeeService.findAll(branchid);
        const filtered = employees.filter(e => 
            (e.name.includes(query) || e.phone.includes(query))
            && (openToNextWork === undefined || e.openToNextWork === openToNextWork)
        );
        return {
            success: true,
            data: filtered.map(e => ({
                id: e.id,
                name: e.name,
                phone: e.phone,
                grade: e.grade,
                openToNextWork: e.openToNextWork,
            })),
        };
    }

    private async getEmployee(branchid: string, args: ToolArgs): Promise<ToolExecutionResult> {
        const employeeId = this.parseRequiredIntegerArg(args, "employeeId", { min: 1 });
        const employee = await this.employeeService.findById(branchid, employeeId);
        if (!employee) {
            return { success: false, error: "관리사를 찾을 수 없습니다" };
        }
        return { success: true, data: employee };
    }

    private async createEmployee(branchid: string, args: ToolArgs): Promise<ToolExecutionResult> {
        const employee = await this.employeeService.create(branchid, {
            name: this.parseRequiredStringArg(args, "name"),
            phone: this.parseRequiredStringArg(args, "phone"),
            grade: this.parseRequiredStringArg(args, "grade"),
            workArea: this.parseOptionalStringListArg(args, "workArea"),
            openToNextWork: this.parseOptionalBooleanArg(args, "openToNextWork", { defaultValue: true }) ?? true,
            registeredDate: this.parseOptionalDateArg(args, "companyRegisteredDate"),
        });
        return { success: true, data: { id: employee.id, name: employee.name, message: "관리사가 등록되었습니다" } };
    }

    private async updateEmployee(branchid: string, args: ToolArgs): Promise<ToolExecutionResult> {
        const employeeId = this.parseRequiredIntegerArg(args, "employeeId", { min: 1 });
        const updateData: Record<string, unknown> = {};
        
        if (args['name'] !== undefined) {
            const name = this.parseOptionalStringArg(args, "name");
            if (name !== undefined) updateData['name'] = name;
        }
        if (args['phone'] !== undefined) {
            const phone = this.parseOptionalStringArg(args, "phone");
            if (phone !== undefined) updateData['phone'] = phone;
        }
        if (args['grade'] !== undefined) {
            const grade = this.parseOptionalStringArg(args, "grade");
            if (grade !== undefined) updateData['grade'] = grade;
        }
        if (args['workArea'] !== undefined) updateData['workArea'] = this.parseOptionalStringListArg(args, "workArea");
        if (args['openToNextWork'] !== undefined) updateData['openToNextWork'] = this.parseRequiredBooleanArg(args, "openToNextWork");

        const employee = await this.employeeService.update(
            branchid,
            employeeId,
            updateData as Parameters<typeof this.employeeService.update>[2]
        );
        return { success: true, data: { id: employee.id, name: employee.name, message: "관리사 정보가 수정되었습니다" } };
    }

    private async deleteEmployee(branchid: string, args: ToolArgs): Promise<ToolExecutionResult> {
        const employeeId = this.parseRequiredIntegerArg(args, "employeeId", { min: 1 });
        await this.employeeService.delete(branchid, employeeId);
        return { success: true, data: { message: "관리사가 삭제되었습니다" } };
    }

    private async getMessages(branchid: string): Promise<ToolExecutionResult> {
        const messages = await this.messageService.findAll(branchid);
        return {
            success: true,
            data: messages.map((m) => ({
                id: m.id,
                title: m.title,
                text: m.text,
                createdAt: m.createdAt,
                editedAt: m.editedAt,
            })),
        };
    }

    private async createMessage(branchid: string, args: ToolArgs): Promise<ToolExecutionResult> {
        const message = await this.messageService.create(
            branchid,
            this.parseRequiredStringArg(args, "title"),
            this.parseRequiredStringArg(args, "text"),
        );
        return { success: true, data: { id: message.id, title: message.title, message: "메시지가 등록되었습니다" } };
    }

    private async updateMessage(branchid: string, args: ToolArgs): Promise<ToolExecutionResult> {
        const messageId = this.parseRequiredIntegerArg(args, "messageId", { min: 1 });
        const title = this.parseRequiredStringArg(args, "title");
        const text = this.parseRequiredStringArg(args, "text");

        const message = await this.messageService.update(branchid, messageId, title, text);
        return { success: true, data: { id: message.id, title: message.title, message: "메시지가 수정되었습니다" } };
    }

    private async deleteMessage(branchid: string, args: ToolArgs): Promise<ToolExecutionResult> {
        const messageId = this.parseRequiredIntegerArg(args, "messageId", { min: 1 });
        await this.messageService.delete(branchid, messageId);
        return { success: true, data: { message: "메시지가 삭제되었습니다" } };
    }

    private async listAvailableTemplates(branchid: string): Promise<ToolExecutionResult> {
        const templates = await this.areaTemplateService.findAll(branchid);
        return {
            success: true,
            data: templates.map(t => ({
                areaId: t.areaId,
                templateId: t.templateId,
                templateName: t.templateName,
            })),
        };
    }

    private async createAndSendContract(branchid: string, args: ToolArgs): Promise<ToolExecutionResult> {
        const clientId = this.parseRequiredIntegerArg(args, "clientId", { min: 1 });
        const areaId = this.parseRequiredStringArg(args, "areaId");

        const template = await this.areaTemplateService.findByArea(branchid, areaId);
        if (!template) {
            return { success: false, error: `지역 "${areaId}"에 대한 템플릿을 찾을 수 없습니다` };
        }

        const result = await this.eformsignDocService.createAndSendContract(branchid, {
            clientId,
            templateId: template.templateId,
            templateName: template.templateName || undefined,
        });

        if (!result.success) {
            return { success: false, error: result.error };
        }

        return {
            success: true,
            data: {
                documentId: result.documentId,
                message: "계약서가 발송되었습니다",
            },
        };
    }

    private async getContractStatus(branchid: string, args: ToolArgs): Promise<ToolExecutionResult> {
        if (!this.isMissingArg(args['documentId'])) {
            const documentId = this.parseRequiredStringArg(args, "documentId");
            const doc = await this.eformsignDocService.findByDocumentId(branchid, documentId);
            if (!doc) {
                return { success: false, error: "문서를 찾을 수 없습니다" };
            }
            return { success: true, data: doc };
        }

        if (!this.isMissingArg(args['clientId'])) {
            const clientId = this.parseRequiredIntegerArg(args, "clientId", { min: 1 });
            const docs = await this.eformsignDocService.findByClientId(branchid, clientId);
            return { success: true, data: docs };
        }

        return { success: false, error: "documentId 또는 clientId가 필요합니다" };
    }

    private async getDashboardStats(branchid: string): Promise<ToolExecutionResult> {
        const [allClients, allEmployees, startingSoon, endingSoon, incompleteContracts, noContract] = await Promise.all([
            this.clientService.findAll(branchid),
            this.employeeService.findAll(branchid),
            this.clientService.findByFilter(branchid, "starting-soon"),
            this.clientService.findByFilter(branchid, "ending-soon"),
            this.clientService.findByFilter(branchid, "incomplete-contracts"),
            this.clientService.findByFilter(branchid, "no-contract"),
        ]);

        return {
            success: true,
            data: {
                totalClients: allClients.length,
                totalEmployees: allEmployees.length,
                startingSoonCount: startingSoon.length,
                endingSoonCount: endingSoon.length,
                incompleteContractsCount: incompleteContracts.length,
                noContractCount: noContract.length,
            },
        };
    }

    private async getClientsByFilter(branchid: string, args: ToolArgs): Promise<ToolExecutionResult> {
        const filter = this.parseRequiredStringArg(args, "filter", { allowedValues: CLIENT_FILTERS });
        const clients = await this.clientService.findByFilter(branchid, filter);
        return {
            success: true,
            data: {
                filter,
                count: clients.length,
                clients: clients.map(c => ({
                    id: c.id,
                    name: c.name,
                    phone: c.phone,
                    serviceStatus: c.serviceStatus,
                    startDate: c.startDate,
                    endDate: c.endDate,
                    primaryEmployee: c.primaryEmployee?.name,
                })),
            },
        };
    }

    private async terminateClientService(branchid: string, args: ToolArgs): Promise<ToolExecutionResult> {
        const clientId = await this.resolveClientId(branchid, args);
        const reason = this.parseOptionalStringArg(args, "reason");
        const client = await this.clientService.terminateService(branchid, clientId, reason);
        return { success: true, data: { id: client.id, name: client.name, message: "서비스가 종료되었습니다" } };
    }

    private async requestEmployeeReplacement(branchid: string, args: ToolArgs): Promise<ToolExecutionResult> {
        const newSecondaryEmployeeId = this.parseOptionalIntegerArg(args, "newSecondaryEmployeeId", { min: 1 });
        const clientId = await this.resolveClientId(branchid, args);
        const newPrimaryEmployeeId = await this.resolveEmployeeId(
            branchid,
            args,
            "newPrimaryEmployeeId",
            "newPrimaryEmployeeName",
        );
        const client = await this.clientService.requestReplacement(
            branchid,
            clientId,
            newPrimaryEmployeeId,
            newSecondaryEmployeeId
        );
        return { success: true, data: { id: client.id, name: client.name, message: "관리사 교체가 요청되었습니다" } };
    }

    private async getAvailableEmployees(branchid: string): Promise<ToolExecutionResult> {
        const employees = await this.employeeService.findAllOpenToNextWork(branchid);
        return {
            success: true,
            data: employees.map(e => ({
                id: e.id,
                name: e.name,
                phone: e.phone,
                grade: e.grade,
                workArea: e.workArea,
            })),
        };
    }

    private async getEmployeesByWorkArea(branchid: string, args: ToolArgs): Promise<ToolExecutionResult> {
        const workArea = this.parseRequiredStringArg(args, "workArea");
        const employees = await this.employeeService.findByWorkArea(branchid, workArea);
        return {
            success: true,
            data: employees.map(e => ({
                id: e.id,
                name: e.name,
                phone: e.phone,
                grade: e.grade,
                openToNextWork: e.openToNextWork,
            })),
        };
    }

    private async getEmployeesByGrade(branchid: string, args: ToolArgs): Promise<ToolExecutionResult> {
        const grade = this.parseRequiredStringArg(args, "grade");
        const employees = await this.employeeService.findByGrade(branchid, grade);
        return {
            success: true,
            data: employees.map(e => ({
                id: e.id,
                name: e.name,
                phone: e.phone,
                workArea: e.workArea,
                openToNextWork: e.openToNextWork,
            })),
        };
    }

    private async changeEmployeeAvailability(branchid: string, args: ToolArgs): Promise<ToolExecutionResult> {
        const employeeId = this.parseRequiredIntegerArg(args, "employeeId", { min: 1 });
        const available = this.parseRequiredBooleanArg(args, "available");
        const employee = await this.employeeService.changeOpenStatus(branchid, employeeId, available);
        return { 
            success: true, 
            data: { 
                id: employee.id, 
                name: employee.name, 
                openToNextWork: employee.openToNextWork,
                message: available ? "배정 가능으로 변경되었습니다" : "배정 불가로 변경되었습니다",
            },
        };
    }

    private async listSchedules(branchid: string): Promise<ToolExecutionResult> {
        const schedules = await this.employeeScheduleService.findAll(branchid);
        return {
            success: true,
            data: schedules.map(s => ({
                id: s.id,
                clientId: s.clientId,
                primaryEmployeeId: s.primaryEmployeeId,
                secondaryEmployeeId: s.secondaryEmployeeId,
                workAddress: s.workAddress,
                startDate: s.startDate,
                endDate: s.endDate,
                replaced: s.replaced,
            })),
        };
    }

    private async getSchedulesByEmployee(branchid: string, args: ToolArgs): Promise<ToolExecutionResult> {
        const employeeId = this.parseRequiredIntegerArg(args, "employeeId", { min: 1 });
        const [primarySchedules, secondarySchedules] = await Promise.all([
            this.employeeScheduleService.findByPrimaryEmployeeId(branchid, employeeId),
            this.employeeScheduleService.findBySecondaryEmployeeId(branchid, employeeId),
        ]);
        return {
            success: true,
            data: {
                asPrimary: primarySchedules.map(s => ({
                    id: s.id,
                    clientId: s.clientId,
                    workAddress: s.workAddress,
                    startDate: s.startDate,
                    endDate: s.endDate,
                })),
                asSecondary: secondarySchedules.map(s => ({
                    id: s.id,
                    clientId: s.clientId,
                    workAddress: s.workAddress,
                    startDate: s.startDate,
                    endDate: s.endDate,
                })),
            },
        };
    }

    private async listVoucherPrices(args: ToolArgs): Promise<ToolExecutionResult> {
        const year = this.parseOptionalIntegerArg(args, "year", { min: 1900, max: 2200 });
        const vouchers = await this.voucherPriceInfoService.list();
        const filteredVouchers = year === undefined ? vouchers : vouchers.filter((v) => v.year === year);
        return {
            success: true,
            data: filteredVouchers.map(v => ({
                id: v.id,
                type: v.type,
                duration: Number(v.duration),
                fullPrice: v.fullPrice,
                grant: v.grant,
                actualPrice: v.actualPrice,
                year: v.year,
            })),
        };
    }

    private async getVoucherPriceByType(args: ToolArgs): Promise<ToolExecutionResult> {
        const type = this.parseRequiredStringArg(args, "type");
        const year = this.parseOptionalIntegerArg(args, "year", { min: 1900, max: 2200 });
        const vouchers = await this.voucherPriceInfoService.findByType(type, year);
        return {
            success: true,
            data: vouchers.map(v => ({
                id: v.id,
                type: v.type,
                duration: Number(v.duration),
                fullPrice: v.fullPrice,
                grant: v.grant,
                actualPrice: v.actualPrice,
                year: v.year,
            })),
        };
    }

    private async listBankAccounts(context: LegacyChatToolContext): Promise<ToolExecutionResult> {
        if (!this.canReadBankAccounts(context)) {
            return { success: false, error: "은행 계좌 정보는 지점 관리자만 조회할 수 있습니다" };
        }

        const accounts = await this.bankAccountInfoService.findAll(context.branchId);
        return {
            success: true,
            data: accounts.map(a => ({
                area: a.area,
                bankName: a.bankName,
                accountLast4: this.maskAccountNumber(a.accNum),
            })),
        };
    }

    private async getBankAccountByArea(context: LegacyChatToolContext, args: ToolArgs): Promise<ToolExecutionResult> {
        if (!this.canReadBankAccounts(context)) {
            return { success: false, error: "은행 계좌 정보는 지점 관리자만 조회할 수 있습니다" };
        }

        const area = this.parseRequiredStringArg(args, "area");
        const account = await this.bankAccountInfoService.findByArea(area, context.branchId);
        if (!account) {
            return { success: false, error: `${area} 지역의 계좌 정보를 찾을 수 없습니다` };
        }
        return {
            success: true,
            data: {
                area: account.area,
                bankName: account.bankName,
                accountLast4: this.maskAccountNumber(account.accNum),
            },
        };
    }

    private canReadBankAccounts(context: LegacyChatToolContext): boolean {
        return [context.globalRole, context.branchRole].some((role) => role === "owner" || role === "admin");
    }

    private maskAccountNumber(account: string | null): string | null {
        const digits = account?.replace(/\D/g, "") ?? "";
        return digits ? digits.slice(-4) : null;
    }

    private async listAllContracts(branchid: string): Promise<ToolExecutionResult> {
        const contracts = await this.eformsignDocService.findAll(branchid);
        return {
            success: true,
            data: contracts.map(c => ({
                id: c.id,
                documentId: c.documentId,
                clientId: c.clientId,
                statusType: c.statusType,
                statusDetail: c.statusDetail,
                stepName: c.stepName,
                createdDate: c.createdDate,
                updatedDate: c.updatedDate,
            })),
        };
    }
}
