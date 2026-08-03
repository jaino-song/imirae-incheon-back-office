import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";

import { AgentActionCertainFailureError, AgentActionUncertainError } from "application/agent/action-coordinator.service";
import { AgentCapabilityProvider } from "application/agent/capability.decorator";
import type { AgentCapabilityProviderContract, CapabilityDefinition } from "application/agent/capability.types";
import type { AgentContext } from "application/agent/agent-context";
import type { AgentFormField } from "@babyjamjam/shared";
import { CreateAndSendContractUsecase, ContractClientSnapshot } from "./create-and-send-contract.usecase";
import { GetEformsignAccessTokenUsecase } from "./get-eformsign-access-token.usecase";
import { FetchEformsignDocFromApiUsecase } from "./fetch-eformsign-doc-from-api.usecase";
import { EFORMSIGN_COMPLETED_STATUS_CODES, TERMINAL_STATUS_CODES } from "domain/constants/eformsign-doc-status.constants";
import { FindClientByIdUsecase } from "application/usecases/client/find-client-by-id.usecase";
import { clientAgentTargetVersion } from "application/usecases/client/client-agent-target";
import { CLIENT_REPOSITORY, IClientRepository } from "domain/repositories/client.repository.interface";
import { PrismaService } from "infrastructure/database/prisma.service";
import { recordAgentActionEffect } from "application/agent/agent-action-effect-receipt";

const ContractInputSchema = z.object({ clientId: z.number().int().positive(), templateId: z.string().min(1).max(200), templateName: z.string().max(200).optional() });
const ContractOutputSchema = z.object({ success: z.boolean(), documentId: z.string().optional(), status: z.string(), uncertain: z.boolean().optional() });
const ContractApprovalSnapshotSchema = z.object({
    clientId: z.number().int().positive(),
    phoneLast4: z.string().min(1).max(20),
    templateId: z.string().min(1).max(200),
    templateName: z.string().max(200).nullable(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    duration: z.number().int().nonnegative().nullable(),
    fullPrice: z.string().max(40).nullable(),
    grant: z.string().max(80).nullable(),
    actualPrice: z.string().max(40).nullable(),
    effectiveDate: z.string().datetime({ offset: true }),
    includesSensitiveFields: z.literal(true),
}).strict();
type ContractApprovalSnapshot = z.infer<typeof ContractApprovalSnapshotSchema>;
const CONTRACT_FORM_FIELDS: AgentFormField[] = [
    { name: "clientId", label: "고객 ID", type: "number", required: true },
    { name: "templateId", label: "템플릿 ID", type: "text", required: true },
    { name: "templateName", label: "템플릿 이름", type: "text" },
];

@Injectable()
@AgentCapabilityProvider()
export class ContractExternalAgentCapabilitiesProvider implements AgentCapabilityProviderContract {
    constructor(
        private readonly createAndSend: CreateAndSendContractUsecase,
        private readonly getAccessToken: GetEformsignAccessTokenUsecase,
        private readonly fetchDocument: FetchEformsignDocFromApiUsecase,
        private readonly findClientById: FindClientByIdUsecase,
        @Inject(CLIENT_REPOSITORY)
        private readonly clientRepository: IClientRepository,
        private readonly prisma: PrismaService,
    ) {}

    getCapabilities(): CapabilityDefinition[] {
        const common = {
            domain: "contracts", version: "1.0.0", requiredRoles: ["owner", "admin", "manager"], sideEffect: true,
            approvalPolicy: "strong" as const, idempotencyPolicy: "provider-key" as const,
        };
        return [
            {
                meta: { ...common, name: "contracts.dispatch", description: "Create and send a contract after strong approval", risk: "external-side-effect" as const, renderer: "action-proposal" as const, flagKey: "agent.capability.contracts.dispatch" },
                inputSchema: ContractInputSchema, outputSchema: ContractOutputSchema,
                classifyOutcome: (rawOutput) => ContractOutputSchema.parse(rawOutput).success
                    ? { status: "succeeded" }
                    : { status: "failed", reason: "Contract provider rejected the dispatch" },
                formFields: CONTRACT_FORM_FIELDS,
                inspect: async (context, rawInput) => {
                    const input = ContractInputSchema.parse(rawInput);
                    const client = await this.findClientById.execute(context.principal.branchId, input.clientId);
                    if (!client) throw new Error("Contract client was not found in the current branch");
                    const effectiveDate = new Date();
                    return {
                        targetVersion: clientAgentTargetVersion(client),
                        targetSnapshot: this.toContractApprovalSnapshot(client, input, effectiveDate),
                        title: "계약서 생성 및 발송",
                        summary: `${client.name} 고객에게 ${input.templateName ?? input.templateId} 계약서를 발송합니다. 수신번호 ${maskPhone(client.phone)}로 민감 필드를 포함해 전송합니다.`,
                        provider: "eformsign",
                        estimatedCost: "eformsign 계약 요금제 기준",
                    };
                },
                execute: async (context, rawInput) => {
                    try {
                        const result = await this.createAndSend.execute(context.principal.branchId, {
                            ...ContractInputSchema.parse(rawInput),
                            idempotencyKey: context.actionId,
                        });
                        if (!result.success && (result.uncertain || result.remoteDocumentId)) {
                            throw new AgentActionUncertainError("Contract provider result is uncertain", { remoteDocumentId: result.remoteDocumentId });
                        }
                        if (!result.success) return { success: false, status: "failed" };
                        return { success: true, documentId: result.documentId, status: "sent" };
                    } catch (error) {
                        if (error instanceof AgentActionUncertainError) throw error;
                        throw new AgentActionUncertainError("Contract provider result is uncertain");
                    }
                },
                executeApprovedTarget: async (context, rawInput, expectedTargetVersion) => {
                    const input = ContractInputSchema.parse(rawInput);
                    const staged = await this.stageDispatchTarget(context, input, expectedTargetVersion);
                    try {
                        const result = await this.createAndSend.execute(context.principal.branchId, {
                            ...input,
                            idempotencyKey: context.actionId,
                            clientSnapshot: staged.clientSnapshot,
                            clientTargetVersion: staged.targetVersion,
                        });
                        if (!result.success && (result.uncertain || result.remoteDocumentId)) {
                            throw new AgentActionUncertainError("Contract provider result is uncertain", { remoteDocumentId: result.remoteDocumentId });
                        }
                        if (!result.success) return { success: false, status: "failed" };
                        return { success: true, documentId: result.documentId, status: "sent" };
                    } catch (error) {
                        if (error instanceof AgentActionUncertainError) throw error;
                        throw new AgentActionUncertainError("Contract provider result is uncertain");
                    }
                },
                revalidate: async (context, rawInput, expectedTargetVersion) => this.revalidateClient(context, rawInput, expectedTargetVersion),
                reconcile: async (_context, _rawInput, uncertainty) => {
                    const remoteDocumentId = typeof uncertainty?.["remoteDocumentId"] === "string" ? uncertainty["remoteDocumentId"] : undefined;
                    if (!remoteDocumentId) return { status: "uncertain" as const, reason: "Remote document identity is unavailable" };
                    try {
                        const token = await this.getAccessToken.execute(Date.now());
                        const document = await this.fetchDocument.execute(token.oauth_token.access_token, remoteDocumentId);
                        const statusType = document.current_status.status_type;
                        const status = document.current_status.status_doc_detail ?? statusType;
                        if (EFORMSIGN_COMPLETED_STATUS_CODES.has(statusType)) {
                            return { status: "succeeded" as const, result: { success: true, documentId: remoteDocumentId, status } };
                        }
                        if (TERMINAL_STATUS_CODES.has(statusType)) {
                            return { status: "failed" as const, result: { success: false, documentId: remoteDocumentId, status }, reason: "Provider reported a terminal non-completed status" };
                        }
                        return { status: "uncertain" as const, reason: "Provider document is still in progress" };
                    } catch {
                        return { status: "uncertain" as const, reason: "Provider status lookup failed" };
                    }
                },
            },
        ];
    }

    private async revalidateClient(
        context: Parameters<CapabilityDefinition["execute"]>[0],
        rawInput: unknown,
        expectedTargetVersion: string,
    ) {
        const input = ContractInputSchema.parse(rawInput);
        const client = await this.findClientById.execute(context.principal.branchId, input.clientId);
        const currentVersion = clientAgentTargetVersion(client);
        return {
            valid: Boolean(client) && currentVersion === expectedTargetVersion,
            currentVersion,
            reason: client ? "Client changed after proposal" : "Client is no longer available in this branch",
        };
    }

    private async stageDispatchTarget(
        context: AgentContext,
        input: z.infer<typeof ContractInputSchema>,
        expectedTargetVersion: string,
    ): Promise<{ clientSnapshot: ContractClientSnapshot; targetVersion: string }> {
        return this.prisma.$transaction(async (transaction) => {
            const client = await this.clientRepository.findByIdForUpdate(
                context.principal.branchId,
                input.clientId,
                transaction,
            );
            if (!client || clientAgentTargetVersion(client) !== expectedTargetVersion) {
                throw new AgentActionCertainFailureError("Client changed after approval; review a new proposal");
            }
            const approvedSnapshot = ContractApprovalSnapshotSchema.safeParse(context.approvedTargetSnapshot);
            if (!approvedSnapshot.success || approvedSnapshot.data.clientId !== input.clientId) {
                throw new AgentActionCertainFailureError("Contract approval details are missing or invalid; review a new proposal");
            }
            const canonicalSnapshot = this.toContractApprovalSnapshot(
                client,
                input,
                new Date(approvedSnapshot.data.effectiveDate),
            );
            if (JSON.stringify(canonicalSnapshot) !== JSON.stringify(approvedSnapshot.data)) {
                throw new AgentActionCertainFailureError("Contract approval details changed; review a new proposal");
            }
            const clientSnapshot = this.toContractClientSnapshot(client, approvedSnapshot.data.effectiveDate);
            await recordAgentActionEffect(transaction, context, "contracts.dispatch", "contract-dispatch", input.clientId, {
                input,
                targetVersion: expectedTargetVersion,
                approvalSnapshot: approvedSnapshot.data,
                clientSnapshot,
            });
            return { clientSnapshot, targetVersion: expectedTargetVersion };
        });
    }

    private toContractClientSnapshot(client: {
        id: number;
        name: string;
        phone: string | null;
        address: string | null;
        birthday: string | null;
        startDate: Date | null;
        endDate: Date | null;
        fullPrice: string | null;
        grant: string | null;
        actualPrice: string | null;
        duration: number | null;
    }, fallbackDate = new Date().toISOString()): ContractClientSnapshot {
        return {
            id: client.id,
            name: client.name,
            phone: client.phone,
            address: client.address,
            birthday: client.birthday,
            startDate: client.startDate?.toISOString() ?? null,
            endDate: client.endDate?.toISOString() ?? null,
            fullPrice: client.fullPrice,
            grant: client.grant,
            actualPrice: client.actualPrice,
            duration: client.duration,
            fallbackDate,
        };
    }

    private toContractApprovalSnapshot(
        client: {
            id: number;
            name: string;
            phone: string | null;
            startDate: Date | null;
            endDate: Date | null;
            duration: number | null;
            fullPrice: string | null;
            grant: string | null;
            actualPrice: string | null;
        },
        input: z.infer<typeof ContractInputSchema>,
        effectiveDate: Date,
    ): ContractApprovalSnapshot {
        return ContractApprovalSnapshotSchema.parse({
            clientId: client.id,
            phoneLast4: maskPhone(client.phone),
            templateId: input.templateId,
            templateName: input.templateName ?? null,
            startDate: client.startDate?.toISOString().slice(0, 10) ?? null,
            endDate: client.endDate?.toISOString().slice(0, 10) ?? null,
            duration: client.duration,
            fullPrice: client.fullPrice,
            grant: client.grant,
            actualPrice: client.actualPrice,
            effectiveDate: effectiveDate.toISOString(),
            includesSensitiveFields: true,
        });
    }
}

function maskPhone(value: string | null): string {
    const digits = (value ?? "").replace(/\D/g, "");
    return digits.length >= 4 ? `••••${digits.slice(-4)}` : "[masked]";
}
