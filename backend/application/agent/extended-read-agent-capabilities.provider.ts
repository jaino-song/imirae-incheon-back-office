import { ConflictException, Injectable } from "@nestjs/common";
import { z } from "zod";

import { AgentActionCertainFailureError, AgentActionUncertainError } from "./action-coordinator.service";
import { AgentCapabilityProvider } from "./capability.decorator";
import type { AgentCapabilityProviderContract, CapabilityDefinition } from "./capability.types";
import type { AgentContext } from "./agent-context";
import type { AgentFormField } from "@babyjamjam/shared";
import { PrismaService } from "infrastructure/database/prisma.service";
import { CallInboxService } from "application/services/call-inbox.service";
import { SystemSettingService } from "application/services/system-setting.service";
import { PROPOSAL_FIELDS } from "application/services/call-extraction.prompt";
import type { ProposalDto } from "interface/dto/call-inbox.dto";
import { createHash } from "node:crypto";
import { ConsultationInquiryService } from "application/services/consultation-inquiry.service";
import { DocumentService } from "application/services/document.service";
import { AgentIntelligenceService } from "./agent-intelligence.service";
import { SystemAdminService } from "application/services/system-admin.service";
import { readAgentActionEffect, recordAgentActionEffect } from "./agent-action-effect-receipt";

const QuerySchema = z.object({ query: z.string().trim().max(100).optional(), limit: z.number().int().positive().max(50).optional() });
const IdSchema = z.object({ id: z.union([z.string().min(1), z.number().int().positive()]) });
const RowsSchema = z.array(z.record(z.string(), z.unknown()));
const ActionResultSchema = z.object({ status: z.string(), id: z.union([z.string(), z.number()]) });
const BranchInputSchema = z.object({
    name: z.string().trim().min(1).max(120),
    slug: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{1,79}$/),
    region: z.string().trim().max(120).optional(),
    district: z.string().trim().max(120).optional(),
});
const RibbonSettingsSchema = z.object({
    enabled: z.boolean(),
    message: z.string().max(500),
    backgroundColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    textColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    linkText: z.string().max(120).default(""),
    linkHref: z.string().max(500).refine((value) => value === "" || (value.startsWith("/") && !value.startsWith("//")), "Only internal paths are allowed").default(""),
    linkColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
});
const SettingsReadOutputSchema = z.object({
    clientAutoRegistration: z.boolean(),
    greetingOnAutoRegistration: z.boolean(),
    messageAutomation: z.object({ sendIntervalMinutes: z.number().int(), ruleOrder: z.array(z.string()) }),
});
const WebsiteSettingsOutputSchema = z.object({ ribbon: RibbonSettingsSchema });
const AnalyticsSummaryOutputSchema = z.object({
    totalClients: z.number().int().nonnegative(),
    voucherClients: z.number().int().nonnegative(),
    byServiceStatus: z.array(z.object({ status: z.string(), count: z.number().int().nonnegative() })),
});
const ID_FORM_FIELDS: AgentFormField[] = [{ name: "id", label: "대상 ID", type: "text", required: true }];
const ProposalInputSchema = z.object({
    field: z.enum(PROPOSAL_FIELDS),
    value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
    evidence: z.string().max(2_000),
    confidence: z.enum(["high", "low"]),
});
const parseJsonInput = (value: unknown): unknown => {
    if (typeof value !== "string") return value;
    try {
        return JSON.parse(value) as unknown;
    } catch {
        return value;
    }
};

function stableJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
    if (value && typeof value === "object") {
        return `{${Object.entries(value as Record<string, unknown>)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
            .join(",")}}`;
    }
    return JSON.stringify(value) ?? "null";
}

function confirmationClientId(result: unknown, fallback: string): string | number {
    if (result && typeof result === "object" && !Array.isArray(result)) {
        const clientId = (result as Record<string, unknown>)["clientId"];
        if (typeof clientId === "string" || typeof clientId === "number") return clientId;
    }
    return fallback;
}
const DraftUpdateSchema = z.object({
    id: z.string().min(1),
    proposals: z.preprocess(parseJsonInput, z.array(ProposalInputSchema).optional()),
    clientId: z.coerce.number().int().positive().nullable().optional(),
}).superRefine((value, context) => {
    if (value.proposals === undefined && value.clientId === undefined) {
        context.addIssue({ code: "custom", path: ["proposals"], message: "Draft update payload is required" });
    }
});
const DraftConfirmSchema = z.object({
    id: z.string().min(1),
    fields: z.preprocess(parseJsonInput, z.record(z.string(), z.unknown()).refine(
        (value) => typeof value["name"] === "string" && value["name"].trim().length > 0,
        "New-client fields require a non-empty name",
    ).optional()),
    changes: z.preprocess(parseJsonInput, z.record(z.string(), z.unknown()).refine(
        (value) => Object.keys(value).some((key) => (PROPOSAL_FIELDS as readonly string[]).includes(key)),
        "Client-update changes require at least one allowed field",
    ).optional()),
}).superRefine((value, context) => {
    if (value.fields === undefined && value.changes === undefined) {
        context.addIssue({ code: "custom", path: ["fields"], message: "Draft confirmation payload is required" });
    }
});

function draftConfirmInputDigest(input: z.infer<typeof DraftConfirmSchema>): string {
    return createHash("sha256").update(stableJson(input)).digest("hex");
}

const DRAFT_UPDATE_FORM_FIELDS: AgentFormField[] = [
    { name: "id", label: "초안 ID", type: "text", required: true },
    { name: "proposals", label: "제안 JSON", type: "textarea" },
    { name: "clientId", label: "연결 고객 ID", type: "number" },
];
const DRAFT_CONFIRM_FORM_FIELDS: AgentFormField[] = [
    { name: "id", label: "초안 ID", type: "text", required: true },
    { name: "fields", label: "신규 고객 필드 JSON", type: "textarea" },
    { name: "changes", label: "고객 변경 JSON", type: "textarea" },
];

interface QueryModel {
    findMany(args: Record<string, unknown>): Promise<unknown[]>;
    findFirst(args: Record<string, unknown>): Promise<unknown | null>;
    updateMany(args: Record<string, unknown>): Promise<{ count: number }>;
    deleteMany?(args: Record<string, unknown>): Promise<{ count: number }>;
}

function rows(value: unknown): Record<string, unknown>[] {
    return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item))) : [];
}

@Injectable()
@AgentCapabilityProvider()
export class ExtendedReadAgentCapabilitiesProvider implements AgentCapabilityProviderContract {
    constructor(
        private readonly prisma: PrismaService,
        private readonly callInbox: CallInboxService,
        private readonly systemSettings: SystemSettingService,
        private readonly consultationInquiries: ConsultationInquiryService,
        private readonly documents: DocumentService,
        private readonly intelligence: AgentIntelligenceService,
        private readonly systemAdmin: SystemAdminService,
    ) {}

    getCapabilities(): CapabilityDefinition[] {
        return [
            this.read("consultations.list", "consultations", "List consultation inquiries for the current branch", "consultation_inquiry", {}, { select: { id: true, motherName: true, dueDate: true, voucherType: true, preferredCaregiverName: true, referralSource: true, source: true, status: true, readAt: true, createdAt: true, updatedAt: true }, searchFields: ["motherName", "status", "preferredCaregiverName"] }),
            this.read("consultations.search", "consultations", "Search consultation inquiries for the current branch", "consultation_inquiry", {}, { select: { id: true, motherName: true, dueDate: true, voucherType: true, preferredCaregiverName: true, referralSource: true, source: true, status: true, readAt: true, createdAt: true, updatedAt: true }, searchFields: ["motherName", "status", "preferredCaregiverName"] }),
            this.read("consultations.unread", "consultations", "List unread consultation inquiries", "consultation_inquiry", { readAt: null }, { select: { id: true, motherName: true, dueDate: true, voucherType: true, preferredCaregiverName: true, referralSource: true, source: true, status: true, readAt: true, createdAt: true, updatedAt: true }, searchFields: ["motherName", "status", "preferredCaregiverName"] }),
            this.read("calls.list", "calls", "List calls for the current branch", "call_record", {}, { select: { id: true, fileName: true, recordedAt: true, summary: true, category: true, callerName: true, matchedClientId: true, processingStatus: true, createdAt: true }, searchFields: ["fileName", "callerName", "category"] }),
            this.read("calls.transcriptSummary", "calls", "List call transcript summaries without exposing raw transcripts", "call_record", {}, { select: { id: true, recordedAt: true, summary: true, category: true, processingStatus: true, matchedClientId: true, createdAt: true }, searchFields: ["fileName", "callerName", "category"] }),
            this.read("drafts.list", "drafts", "List client drafts for the current branch", "client_draft", {}, { select: { id: true, callRecordId: true, type: true, status: true, clientId: true, reviewedAt: true, createdAt: true, confirmingStartedAt: true } }),
            this.read("files.search", "files", "Search authorized files for the current branch", "document", {}, { select: { id: true, name: true, description: true, tags: true, mimeType: true, fileSize: true, orgId: true, uploadedBy: true, createdAt: true, updatedAt: true, categoryId: true, branchId: true }, searchFields: ["name", "description"] }),
            this.read("files.metadata", "files", "Read authorized file metadata without signed URLs", "document", {}, { select: { id: true, name: true, description: true, tags: true, mimeType: true, fileSize: true, orgId: true, uploadedBy: true, createdAt: true, updatedAt: true, categoryId: true, branchId: true }, searchFields: ["name", "description"] }),
            this.read("service-records.oversight", "service-records", "Read service-record oversight rows for the current branch", "service_record_case", {}, { select: { id: true, clientId: true, status: true, startDate: true, endDate: true, requiredSessionCount: true, formVersion: true, completedAt: true, finalizationDueAt: true, finalizationStartedAt: true, finalizedAt: true, documentsCompletedAt: true, finalizationAttempts: true, nextAttemptAt: true, version: true, createdAt: true, updatedAt: true } }),
            this.analyticsSummary(),
            this.settingsRead(),
            this.websiteSettingsRead(),
            this.policyRetrieve(),
            this.write("consultations.markRead", "consultations", "Mark a consultation inquiry read after approval", "consultation_inquiry"),
            this.draftUpdate(),
            this.draftConfirm(),
            this.write("files.delete", "files", "Delete an authorized file after strong approval", "document", "irreversible-write", "strong"),
            this.adminCreateBranch(),
            this.websiteUpdateSettings(),
        ];
    }

    private read(
        name: string,
        domain: string,
        description: string,
        table: string,
        fixedWhere: Record<string, unknown> = {},
        options: { select?: Record<string, boolean>; searchFields?: string[] } = {},
    ): CapabilityDefinition {
        return {
            meta: {
                name, domain, version: "1.0.0", description, risk: "read", requiredRoles: ["owner", "admin", "manager", "user"],
                renderer: domain === "files" ? "attachment" : "text", flagKey: `agent.capability.${name}`, sideEffect: false,
            },
            inputSchema: QuerySchema,
            outputSchema: RowsSchema,
            execute: async (context, rawInput) => {
                const input = QuerySchema.parse(rawInput);
                const records = await this.findMany(table, context.principal.branchId, {
                    ...fixedWhere,
                    ...(input.query && options.searchFields?.length
                        ? { OR: options.searchFields.map((field) => ({ [field]: { contains: input.query, mode: "insensitive" } })) }
                        : {}),
                }, input.limit ?? 20, options);
                return rows(records).map((record) => this.sanitizeReadRow(name, record));
            },
        };
    }

    private write(
        name: string,
        domain: string,
        description: string,
        table: string,
        risk: "reversible-write" | "irreversible-write" | "privileged-administration" = "reversible-write",
        approvalPolicy: "structured" | "strong" = "structured",
        requiredRoles: string[] = ["owner", "admin", "manager"],
    ): CapabilityDefinition {
        return {
            meta: {
                name, domain, version: "1.0.0", description, risk, requiredRoles, renderer: "action-proposal",
                flagKey: `agent.capability.${name}`, sideEffect: true, approvalPolicy, idempotencyPolicy: "action-id",
            },
            inputSchema: IdSchema,
            outputSchema: ActionResultSchema,
            formFields: ID_FORM_FIELDS,
            inspect: async (context, rawInput) => {
                const input = IdSchema.parse(rawInput);
                const record = await this.findBranchRecord(table, context.principal.branchId, input.id);
                if (!record) throw new Error("Action target was not found in the current branch");
                return {
                    targetVersion: this.targetVersion(record),
                    targetSnapshot: this.targetSnapshot(record),
                    title: description,
                    summary: `${String(input.id)} 대상을 변경합니다.`,
                };
            },
            execute: async (context, rawInput) => {
                const input = IdSchema.parse(rawInput);
                const id = input.id;
                const model = this.model(table);
                const where = { branchId: context.principal.branchId, id };
                const existing = await model.findFirst({ where });
                if (!existing) throw new AgentActionUncertainError("Target is no longer available");
                if (name.endsWith("markRead")) {
                    await this.consultationInquiries.markRead(context.principal.branchId, String(id));
                    return { status: "updated", id };
                }
                if (name.endsWith("delete")) {
                    await recordAgentActionEffect(this.prisma, context, name, "document", String(id), {
                        status: "storage-delete-authorized",
                        id,
                    });
                    await this.documents.deleteStorageForDocument(context.principal.branchId, String(id));
                    await this.documents.deleteMetadataAfterStorageDeletion(context.principal.branchId, String(id));
                    await recordAgentActionEffect(this.prisma, context, name, "document", String(id), {
                        status: "storage-deleted",
                        id,
                    });
                    return { status: "deleted", id };
                }
                if (name === "drafts.confirm") {
                    await model.updateMany({ where, data: { status: "confirmed", confirmedAt: new Date() } });
                    return { status: "confirmed", id };
                }
                if (name === "admin.createBranch") throw new AgentActionUncertainError("Privileged branch creation requires the dedicated admin workflow");
                await model.updateMany({ where, data: { updatedAt: new Date() } });
                return { status: "updated", id };
            },
            executeApprovedTarget: async (context, rawInput, expectedTargetVersion) => {
                const input = IdSchema.parse(rawInput);
                if (name.endsWith("delete")) {
                    return this.executeApprovedFileDeletion(context, String(input.id), expectedTargetVersion);
                }
                return this.prisma.$transaction(async (transaction) => {
                    await this.lockBranchRecordForUpdate(transaction, table, context.principal.branchId, input.id);
                    const transactionModel = this.transactionModel(transaction, table);
                    const existing = await transactionModel.findFirst({
                        where: { branchId: context.principal.branchId, id: input.id },
                    });
                    if (!existing || this.targetVersion(existing) !== expectedTargetVersion) {
                        throw new AgentActionCertainFailureError("Target changed after approval; review a new proposal");
                    }
                    if (name.endsWith("markRead")) {
                        const updated = await transactionModel.updateMany({
                            where: { branchId: context.principal.branchId, id: input.id },
                            data: { readAt: new Date() },
                        });
                        if (updated.count !== 1) throw new AgentActionCertainFailureError("Target is no longer available");
                        return { status: "updated", id: input.id };
                    }
                    const updated = await transactionModel.updateMany({
                        where: { branchId: context.principal.branchId, id: input.id },
                        data: { updatedAt: new Date() },
                    });
                    if (updated.count !== 1) throw new AgentActionCertainFailureError("Target is no longer available");
                    return { status: "updated", id: input.id };
                });
            },
            revalidate: async (context, rawInput, expectedTargetVersion) => {
                const input = IdSchema.parse(rawInput);
                return this.revalidateBranchRecord(table, context.principal.branchId, input.id, expectedTargetVersion);
            },
            reconcile: async (context, rawInput) => {
                const input = IdSchema.parse(rawInput);
                const record = await this.findBranchRecord(table, context.principal.branchId, input.id);
                if (name.endsWith("delete")) {
                    const receipt = await readAgentActionEffect(this.prisma, context, name);
                    if (record) return { status: "uncertain" as const, reason: "File metadata still exists" };
                    if (receipt?.result["status"] === "storage-delete-authorized"
                        || receipt?.result["status"] === "storage-deleted") {
                        return { status: "succeeded" as const, result: { status: "deleted", id: input.id } };
                    }
                    return { status: "uncertain" as const, reason: "File storage deletion is not yet proven" };
                }
                if (name.endsWith("markRead") && record && (record["readAt"] || record["isRead"] === true)) {
                    return { status: "succeeded" as const, result: { status: "updated", id: input.id } };
                }
                return { status: "uncertain" as const, reason: "Canonical write outcome cannot be proven" };
            },
            ...(name.endsWith("delete") ? {
                recover: async (context, rawInput) => {
                    const input = IdSchema.parse(rawInput);
                    const receipt = await readAgentActionEffect(this.prisma, context, name);
                    if (receipt?.resourceType !== "document"
                        || String(receipt.resourceId) !== String(input.id)
                        || (receipt.result["status"] !== "storage-delete-authorized" && receipt.result["status"] !== "storage-deleted")) return;
                    const storagePath = receipt.result["storagePath"];
                    if (typeof storagePath === "string") {
                        await this.documents.deleteStoragePath(storagePath);
                        return;
                    }
                    await this.documents.recoverStagedDeletion(context.principal.branchId, String(input.id));
                },
            } : {}),
        };
    }

    private model(table: string): QueryModel {
        const model = (this.prisma as unknown as Record<string, unknown>)[table];
        if (!model || typeof model !== "object") throw new Error(`Agent table unavailable: ${table}`);
        return model as QueryModel;
    }

    private transactionModel(transaction: unknown, table: string): QueryModel {
        const model = (transaction as Record<string, unknown>)[table];
        if (!model || typeof model !== "object") throw new Error(`Agent transaction table unavailable: ${table}`);
        return model as QueryModel;
    }

    private async lockBranchRecordForUpdate(
        transaction: unknown,
        table: string,
        branchId: string,
        id: string | number,
    ): Promise<void> {
        const lockQueries: Record<string, string> = {
            consultation_inquiry: 'SELECT "id" FROM "consultation_inquiry" WHERE "id" = $1 AND "branch_id" = $2 FOR UPDATE',
            document: 'SELECT "id" FROM "document" WHERE "id" = $1 AND "branch_id" = $2 FOR UPDATE',
            client_draft: 'SELECT "id" FROM "client_draft" WHERE "id" = $1 AND "branch_id" = $2 FOR UPDATE',
            call_record: 'SELECT "id" FROM "call_record" WHERE "id" = $1 AND "branch_id" = $2 FOR UPDATE',
            service_record_case: 'SELECT "id" FROM "service_record_case" WHERE "id" = $1 AND "branch_id" = $2 FOR UPDATE',
        };
        const rawTransaction = transaction as {
            $queryRawUnsafe?: (query: string, ...values: unknown[]) => Promise<unknown>;
        };
        const query = lockQueries[table];
        if (query && typeof rawTransaction.$queryRawUnsafe === "function") {
            await rawTransaction.$queryRawUnsafe(query, id, branchId);
        }
    }

    private async executeApprovedFileDeletion(
        context: AgentContext,
        id: string,
        expectedTargetVersion: string,
    ): Promise<{ status: string; id: string }> {
        const staged = await this.prisma.$transaction(async (transaction) => {
            await this.lockBranchRecordForUpdate(transaction, "document", context.principal.branchId, id);
            const document = await this.transactionModel(transaction, "document").findFirst({
                where: { id, branchId: context.principal.branchId },
            });
            if (!document || this.targetVersion(document) !== expectedTargetVersion) {
                throw new AgentActionCertainFailureError("File changed after approval; review a new proposal");
            }
            const documentRecord = typeof document === "object" && document !== null && !Array.isArray(document)
                ? document as Record<string, unknown>
                : null;
            const storagePath = typeof documentRecord?.["storagePath"] === "string" ? documentRecord["storagePath"] : null;
            if (!storagePath) throw new AgentActionCertainFailureError("File storage metadata is unavailable");
            await recordAgentActionEffect(transaction, context, "files.delete", "document", id, {
                status: "storage-delete-authorized",
                id,
                storagePath,
                targetVersion: expectedTargetVersion,
            });
            const deleted = await this.transactionModel(transaction, "document").deleteMany?.({
                where: { id, branchId: context.principal.branchId },
            });
            if (!deleted || deleted.count !== 1) throw new AgentActionCertainFailureError("File is no longer available");
            return { id, storagePath };
        });
        await this.documents.deleteStoragePath(staged.storagePath);
        await recordAgentActionEffect(this.prisma, context, "files.delete", "document", id, {
            status: "storage-deleted",
            id,
            storagePath: staged.storagePath,
            targetVersion: expectedTargetVersion,
        });
        return { status: "deleted", id };
    }

    private draftUpdate(): CapabilityDefinition {
        return {
            meta: {
                name: "drafts.update", domain: "drafts", version: "1.0.0",
                description: "Update a pending client draft through the canonical draft use case",
                risk: "reversible-write", requiredRoles: ["owner", "admin", "manager"], renderer: "action-proposal",
                flagKey: "agent.capability.drafts.update", sideEffect: true, approvalPolicy: "structured", idempotencyPolicy: "action-id",
            },
            inputSchema: DraftUpdateSchema,
            outputSchema: ActionResultSchema,
            formFields: DRAFT_UPDATE_FORM_FIELDS,
            inspect: async (context, rawInput) => this.inspectDraft(context.principal.branchId, DraftUpdateSchema.parse(rawInput).id, "고객 초안 수정"),
            execute: async (context, rawInput) => {
                const input = DraftUpdateSchema.parse(rawInput);
                await this.callInbox.patchDraft(context.principal.branchId, input.id, {
                    ...(input.proposals === undefined ? {} : { proposals: input.proposals as ProposalDto[] }),
                    ...(input.clientId === undefined ? {} : { clientId: input.clientId }),
                });
                return { status: "updated", id: input.id };
            },
            executeApprovedTarget: async (context, rawInput, expectedTargetVersion) => {
                const input = DraftUpdateSchema.parse(rawInput);
                try {
                    await this.callInbox.patchDraftApprovedTarget(context.principal.branchId, input.id, {
                        ...(input.proposals === undefined ? {} : { proposals: input.proposals as ProposalDto[] }),
                        ...(input.clientId === undefined ? {} : { clientId: input.clientId }),
                    }, expectedTargetVersion);
                } catch (error) {
                    if (error instanceof ConflictException) {
                        throw new AgentActionCertainFailureError(error.message);
                    }
                    throw error;
                }
                return { status: "updated", id: input.id };
            },
            revalidate: async (context, rawInput, expectedTargetVersion) => this.revalidateBranchRecord(
                "client_draft", context.principal.branchId, DraftUpdateSchema.parse(rawInput).id, expectedTargetVersion,
            ),
            reconcile: async (context, rawInput) => {
                const input = DraftUpdateSchema.parse(rawInput);
                const record = await this.findBranchRecord("client_draft", context.principal.branchId, input.id);
                if (!record) return { status: "failed", reason: "Draft no longer exists" };
                const matches = (input.clientId === undefined || record["clientId"] === input.clientId)
                    && (input.proposals === undefined || this.targetVersion(record["proposals"]) === this.targetVersion(input.proposals));
                return matches
                    ? { status: "succeeded", result: { status: "updated", id: input.id } }
                    : { status: "uncertain", reason: "Draft does not match the approved update" };
            },
        };
    }

    private draftConfirm(): CapabilityDefinition {
        return {
            meta: {
                name: "drafts.confirm", domain: "drafts", version: "1.0.0",
                description: "Confirm a pending client draft through the canonical draft workflow",
                risk: "reversible-write", requiredRoles: ["owner", "admin", "manager"], renderer: "action-proposal",
                flagKey: "agent.capability.drafts.confirm", sideEffect: true, approvalPolicy: "structured", idempotencyPolicy: "action-id",
            },
            inputSchema: DraftConfirmSchema,
            outputSchema: ActionResultSchema,
            formFields: DRAFT_CONFIRM_FORM_FIELDS,
            inspect: async (context, rawInput) => this.inspectDraftConfirmation(context.principal.branchId, DraftConfirmSchema.parse(rawInput)),
            execute: async (context, rawInput) => {
                const input = DraftConfirmSchema.parse(rawInput);
                const result = await this.callInbox.confirm(context.principal.branchId, context.principal.userId, input.id, {
                    ...(input.fields === undefined ? {} : { fields: input.fields }),
                    ...(input.changes === undefined ? {} : { changes: input.changes }),
                    // Greeting SMS is an external side effect and remains a separate Release C action.
                    suppressGreetingSms: true,
                });
                const id = confirmationClientId(result, input.id);
                await recordAgentActionEffect(this.prisma, context, "drafts.confirm", "client_draft", input.id, {
                    status: "confirmed",
                    draftId: input.id,
                    inputDigest: draftConfirmInputDigest(input),
                    clientId: id,
                });
                return { status: "confirmed", id };
            },
            executeApprovedTarget: async (context, rawInput, expectedTargetVersion) => {
                const input = DraftConfirmSchema.parse(rawInput);
                let result: unknown;
                try {
                    result = await this.callInbox.confirmApprovedTarget(context.principal.branchId, context.principal.userId, input.id, {
                        ...(input.fields === undefined ? {} : { fields: input.fields }),
                        ...(input.changes === undefined ? {} : { changes: input.changes }),
                        suppressGreetingSms: true,
                    }, expectedTargetVersion);
                } catch (error) {
                    if (error instanceof ConflictException) {
                        throw new AgentActionCertainFailureError(error.message);
                    }
                    throw error;
                }
                const id = confirmationClientId(result, input.id);
                await recordAgentActionEffect(this.prisma, context, "drafts.confirm", "client_draft", input.id, {
                    status: "confirmed",
                    draftId: input.id,
                    inputDigest: draftConfirmInputDigest(input),
                    clientId: id,
                });
                return { status: "confirmed", id };
            },
            revalidate: async (context, rawInput, expectedTargetVersion) => this.revalidateBranchRecord(
                "client_draft", context.principal.branchId, DraftConfirmSchema.parse(rawInput).id, expectedTargetVersion,
            ),
            reconcile: async (context, rawInput) => {
                const input = DraftConfirmSchema.parse(rawInput);
                const record = await this.findBranchRecord("client_draft", context.principal.branchId, input.id);
                if (!record) return { status: "failed", reason: "Draft no longer exists" };
                if (record["status"] !== "CONFIRMED") return { status: "uncertain", reason: "Draft confirmation is not terminal" };
                const receipt = await readAgentActionEffect(this.prisma, context, "drafts.confirm");
                const receiptResult = receipt?.result;
                const receiptClientId = receiptResult?.["clientId"];
                const recordClientId = record["clientId"];
                const hasClientId = (value: unknown): value is string | number =>
                    typeof value === "string" || typeof value === "number";
                const clientIdsMatch = hasClientId(recordClientId)
                    && hasClientId(receiptClientId)
                    && String(recordClientId) === String(receiptClientId);
                const receiptMatches = receipt !== null
                    && receipt.actionId === context.actionId
                    && receipt.capability === "drafts.confirm"
                    && receipt.resourceType === "client_draft"
                    && receipt.resourceId === input.id
                    && receiptResult?.["status"] === "confirmed"
                    && receiptResult?.["draftId"] === input.id
                    && receiptResult?.["inputDigest"] === draftConfirmInputDigest(input)
                    && clientIdsMatch;
                if (!receiptMatches) {
                    return { status: "uncertain", reason: "Draft confirmation effect receipt is missing or does not match the approved action" };
                }
                const id = receiptClientId as string | number;
                return { status: "succeeded", result: { status: "confirmed", id } };
            },
        };
    }

    private findMany(
        table: string,
        branchId: string,
        where: Record<string, unknown>,
        take: number,
        options: { select?: Record<string, boolean> } = {},
    ): Promise<unknown[]> {
        return this.model(table).findMany({
            where: { branchId, ...where },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take,
            ...(options.select ? { select: options.select } : {}),
        });
    }

    private sanitizeReadRow(name: string, record: Record<string, unknown>): Record<string, unknown> {
        if (name.startsWith("calls.")) {
            const safe = { ...record };
            delete safe["transcript"];
            delete safe["callerPhone"];
            return safe;
        }
        if (name.startsWith("consultations.")) {
            const safe = { ...record };
            delete safe["phone"];
            delete safe["address"];
            delete safe["additionalNotes"];
            delete safe["selectedServices"];
            return safe;
        }
        if (name.startsWith("files.")) {
            const safe = { ...record };
            delete safe["storagePath"];
            delete safe["storageUrl"];
            return safe;
        }
        if (name.startsWith("drafts.")) {
            const safe = { ...record };
            for (const key of ["proposals", "extractionMeta", "requestSummary", "discardReason", "reviewedById"]) delete safe[key];
            return safe;
        }
        if (name.startsWith("service-records.")) {
            const safe = { ...record };
            for (const key of ["momName", "momBirth", "babyName", "babyBirth", "lastError"]) delete safe[key];
            return safe;
        }
        return record;
    }

    private adminCreateBranch(): CapabilityDefinition {
        return {
            meta: {
                name: "admin.createBranch", domain: "admin", version: "1.0.0",
                description: "Create a branch after owner-only strong approval", risk: "privileged-administration",
                requiredRoles: ["owner"], renderer: "action-proposal", flagKey: "agent.capability.admin.createBranch",
                sideEffect: true, approvalPolicy: "strong", idempotencyPolicy: "action-id",
            },
            inputSchema: BranchInputSchema,
            outputSchema: ActionResultSchema,
            formFields: [
                { name: "name", label: "지점 이름", type: "text", required: true },
                { name: "slug", label: "지점 슬러그", type: "text", required: true },
                { name: "region", label: "지역", type: "text" },
                { name: "district", label: "구역", type: "text" },
            ],
            inspect: async (_context, rawInput) => {
                const input = BranchInputSchema.parse(rawInput);
                const existing = await this.prisma.branch.findUnique({ where: { slug: input.slug }, select: { id: true } });
                if (existing) throw new Error("Branch slug is already in use");
                return {
                    targetVersion: this.targetVersion({ slug: input.slug, available: true }),
                    targetSnapshot: { slug: input.slug, available: true },
                    title: "지점 생성",
                    summary: `${input.name} 지점을 ${input.slug} 슬러그로 생성합니다.`,
                };
            },
            execute: async (context, rawInput) => {
                const input = BranchInputSchema.parse(rawInput);
                const existing = await this.prisma.branch.findUnique({ where: { slug: input.slug }, select: { id: true, ownerId: true, name: true } });
                if (existing) {
                    throw new AgentActionCertainFailureError("Branch slug is already in use");
                }
                const branch = await this.systemAdmin.createBranch({
                    ...input,
                    ownerId: context.principal.userId,
                    isActive: true,
                }, async (transaction, branchId) => {
                    await recordAgentActionEffect(transaction, context, "admin.createBranch", "branch", branchId, { status: "created", id: branchId });
                });
                const result = { status: "created", id: branch.id };
                return result;
            },
            executeApprovedTarget: async (context, rawInput) => {
                const input = BranchInputSchema.parse(rawInput);
                try {
                    const branch = await this.systemAdmin.createBranch({
                        ...input,
                        ownerId: context.principal.userId,
                        isActive: true,
                    }, async (transaction, branchId) => {
                        await recordAgentActionEffect(transaction, context, "admin.createBranch", "branch", branchId, { status: "created", id: branchId });
                    });
                    return { status: "created", id: branch.id };
                } catch (error) {
                    if (error instanceof AgentActionCertainFailureError) throw error;
                    if (error instanceof Error && /already|unique|사용 중|conflict|409/i.test(error.message)) {
                        throw new AgentActionCertainFailureError("Branch slug is already in use");
                    }
                    throw error;
                }
            },
            revalidate: async (_context, rawInput, expectedTargetVersion) => {
                const input = BranchInputSchema.parse(rawInput);
                const existing = await this.prisma.branch.findUnique({ where: { slug: input.slug }, select: { id: true } });
                const currentVersion = this.targetVersion({ slug: input.slug, available: !existing });
                return { valid: !existing && currentVersion === expectedTargetVersion, currentVersion, reason: "Branch slug availability changed" };
            },
            reconcile: async (context) => {
                const receipt = await readAgentActionEffect(this.prisma, context, "admin.createBranch");
                const result = receipt?.resourceType === "branch" ? ActionResultSchema.safeParse(receipt.result) : null;
                return result?.success
                    ? { status: "succeeded", result: result.data }
                    : { status: "uncertain", reason: "No action-bound branch creation receipt was found" };
            },
        };
    }

    private websiteUpdateSettings(): CapabilityDefinition {
        return {
            meta: {
                name: "website.updateSettings", domain: "website", version: "1.0.0",
                description: "Update website settings after approval", risk: "reversible-write",
                requiredRoles: ["owner"], renderer: "action-proposal", flagKey: "agent.capability.website.updateSettings",
                sideEffect: true, approvalPolicy: "structured", idempotencyPolicy: "action-id",
            },
            inputSchema: RibbonSettingsSchema,
            outputSchema: ActionResultSchema,
            formFields: [
                { name: "enabled", label: "리본 표시", type: "boolean", required: true },
                { name: "message", label: "리본 문구", type: "textarea", required: true },
                { name: "backgroundColor", label: "배경색", type: "text", required: true },
                { name: "textColor", label: "글자색", type: "text", required: true },
                { name: "linkText", label: "링크 문구", type: "text" },
                { name: "linkHref", label: "내부 링크", type: "text" },
                { name: "linkColor", label: "링크 색상", type: "text", required: true },
            ],
            inspect: async (_context, rawInput) => {
                RibbonSettingsSchema.parse(rawInput);
                const current = await this.systemSettings.getRibbonConfig();
                return {
                    targetVersion: this.targetVersion(current),
                    targetSnapshot: { ...current },
                    title: "웹사이트 리본 설정 변경",
                    summary: "공개 웹사이트의 리본 표시 설정을 변경합니다.",
                };
            },
            execute: async (_context, rawInput) => {
                const input = RibbonSettingsSchema.parse(rawInput);
                await this.systemSettings.setRibbonConfig(input);
                return { status: "updated", id: "ribbon_config" };
            },
            executeApprovedTarget: async (_context, rawInput, expectedTargetVersion) => {
                const input = RibbonSettingsSchema.parse(rawInput);
                try {
                    await this.systemSettings.setRibbonConfigIfVersion(expectedTargetVersion, input);
                } catch (error) {
                    if (error instanceof ConflictException) {
                        throw new AgentActionCertainFailureError(error.message);
                    }
                    throw error;
                }
                return { status: "updated", id: "ribbon_config" };
            },
            revalidate: async (_context, _rawInput, expectedTargetVersion) => {
                const currentVersion = this.targetVersion(await this.systemSettings.getRibbonConfig());
                return { valid: currentVersion === expectedTargetVersion, currentVersion, reason: "Ribbon configuration changed after proposal" };
            },
            reconcile: async (_context, rawInput) => {
                const desired = RibbonSettingsSchema.parse(rawInput);
                const current = await this.systemSettings.getRibbonConfig();
                return this.targetVersion(current) === this.targetVersion(desired)
                    ? { status: "succeeded" as const, result: { status: "updated", id: "ribbon_config" } }
                    : { status: "uncertain" as const, reason: "Ribbon configuration does not match the approved proposal" };
            },
        };
    }

    private settingsRead(): CapabilityDefinition {
        return {
            meta: {
                name: "settings.read", domain: "settings", version: "1.1.0",
                description: "Read explicitly approved operational policies for the current branch",
                risk: "read", requiredRoles: ["owner", "admin", "manager", "user"], renderer: "text",
                flagKey: "agent.capability.settings.read", sideEffect: false,
            },
            inputSchema: z.object({}).default({}),
            outputSchema: SettingsReadOutputSchema,
            execute: async (context, rawInput) => {
                z.object({}).parse(rawInput);
                const branchId = context.principal.branchId;
                const [clientAutoRegistration, greetingOnAutoRegistration, messageAutomation] = await Promise.all([
                    this.systemSettings.getClientAutoRegistrationEnabled(branchId),
                    this.systemSettings.getGreetingOnAutoRegistrationEnabled(branchId),
                    this.systemSettings.getMessageAutomationPastTriggerConfig(branchId),
                ]);
                return SettingsReadOutputSchema.parse({ clientAutoRegistration, greetingOnAutoRegistration, messageAutomation });
            },
        };
    }

    private analyticsSummary(): CapabilityDefinition {
        return {
            meta: {
                name: "analytics.summary", domain: "analytics", version: "1.0.0",
                description: "Read operational analytics for the current branch",
                risk: "read", requiredRoles: ["owner", "admin", "manager", "user"], renderer: "text",
                flagKey: "agent.capability.analytics.summary", sideEffect: false,
            },
            inputSchema: z.object({}).default({}),
            outputSchema: AnalyticsSummaryOutputSchema,
            execute: async (context, rawInput) => {
                z.object({}).parse(rawInput);
                const where = { branchId: context.principal.branchId };
                const [totalClients, voucherClients, grouped] = await Promise.all([
                    this.prisma.client.count({ where }),
                    this.prisma.client.count({ where: { ...where, voucherClient: true } }),
                    this.prisma.client.groupBy({ by: ["serviceStatus"], where, _count: { _all: true } }),
                ]);
                return AnalyticsSummaryOutputSchema.parse({
                    totalClients,
                    voucherClients,
                    byServiceStatus: grouped.map((row) => ({ status: row.serviceStatus ?? "unspecified", count: row._count._all })),
                });
            },
        };
    }

    private policyRetrieve(): CapabilityDefinition {
        const inputSchema = z.object({ query: z.string().trim().min(1).max(500), locale: z.enum(["ko", "en"]).default("ko") });
        const outputSchema = z.object({
            catalogVersion: z.string(), query: z.string(), locale: z.string(), retrievedAt: z.string(),
            matches: z.array(z.object({ id: z.string(), version: z.string(), effectiveAt: z.string(), source: z.string(), checksum: z.string(), score: z.number(), policy: z.string() })),
        });
        return {
            meta: {
                name: "policy.retrieve", domain: "policy", version: "1.0.0",
                description: "Retrieve versioned operational policy for explanatory answers",
                risk: "read", requiredRoles: ["owner", "admin", "manager", "user"], renderer: "text",
                flagKey: "agent.capability.policy.retrieve", sideEffect: false,
            },
            inputSchema,
            outputSchema,
            execute: async (_context, rawInput) => {
                const input = inputSchema.parse(rawInput);
                return outputSchema.parse(this.intelligence.retrievePolicy(input.query, input.locale));
            },
        };
    }

    private websiteSettingsRead(): CapabilityDefinition {
        return {
            meta: {
                name: "website.settings", domain: "website", version: "1.1.0",
                description: "Read the public ribbon configuration without exposing raw system settings",
                risk: "read", requiredRoles: ["owner", "admin", "manager", "user"], renderer: "text",
                flagKey: "agent.capability.website.settings", sideEffect: false,
            },
            inputSchema: z.object({}).default({}),
            outputSchema: WebsiteSettingsOutputSchema,
            execute: async (_context, rawInput) => {
                z.object({}).parse(rawInput);
                return WebsiteSettingsOutputSchema.parse({ ribbon: await this.systemSettings.getRibbonConfig() });
            },
        };
    }

    private async findBranchRecord(table: string, branchId: string, id: string | number): Promise<Record<string, unknown> | null> {
        const value = await this.model(table).findFirst({ where: { branchId, id } });
        return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
    }

    private async inspectDraft(branchId: string, id: string, title: string) {
        const record = await this.findBranchRecord("client_draft", branchId, id);
        if (!record) throw new Error("Draft was not found in the current branch");
        return {
            targetVersion: this.targetVersion(record),
            targetSnapshot: this.targetSnapshot(record),
            title,
            summary: `${id} 초안을 변경합니다.`,
        };
    }

    private async inspectDraftConfirmation(branchId: string, input: z.infer<typeof DraftConfirmSchema>) {
        const record = await this.findBranchRecord("client_draft", branchId, input.id);
        if (!record) throw new Error("Draft was not found in the current branch");
        if (record["type"] === "NEW_CLIENT") {
            z.object({
                fields: z.record(z.string(), z.unknown()),
                changes: z.undefined().optional(),
            }).parse(input);
        } else if (record["type"] === "CLIENT_UPDATE") {
            z.object({
                fields: z.undefined().optional(),
                changes: z.record(z.string(), z.unknown()),
            }).parse(input);
        } else {
            throw new Error("Draft type is not supported");
        }
        return {
            targetVersion: this.targetVersion(record),
            targetSnapshot: this.targetSnapshot(record),
            title: "고객 초안 확정",
            summary: `${input.id} 초안을 확정합니다.`,
        };
    }

    private async revalidateBranchRecord(table: string, branchId: string, id: string | number, expectedTargetVersion: string) {
        const record = await this.findBranchRecord(table, branchId, id);
        const currentVersion = record ? this.targetVersion(record) : "missing";
        return {
            valid: Boolean(record) && currentVersion === expectedTargetVersion,
            currentVersion,
            reason: record ? "Target changed after proposal" : "Target is no longer available in this branch",
        };
    }

    private targetVersion(value: unknown): string {
        return createHash("sha256").update(JSON.stringify(value)).digest("hex");
    }

    private targetSnapshot(record: Record<string, unknown>): Record<string, unknown> {
        const snapshot: Record<string, unknown> = {};
        for (const key of ["id", "name", "status", "updatedAt", "readAt", "mimeType", "fileSize"]) {
            if (record[key] !== undefined) snapshot[key] = record[key];
        }
        return snapshot;
    }
}
