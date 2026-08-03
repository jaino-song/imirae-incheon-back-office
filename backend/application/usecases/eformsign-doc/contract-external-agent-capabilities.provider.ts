import { Injectable } from "@nestjs/common";
import { z } from "zod";

import { AgentActionUncertainError } from "application/agent/action-coordinator.service";
import { AgentCapabilityProvider } from "application/agent/capability.decorator";
import type { AgentCapabilityProviderContract, CapabilityDefinition } from "application/agent/capability.types";
import type { AgentFormField } from "@babyjamjam/shared";
import { CreateAndSendContractUsecase } from "./create-and-send-contract.usecase";
import { GetEformsignAccessTokenUsecase } from "./get-eformsign-access-token.usecase";
import { FetchEformsignDocFromApiUsecase } from "./fetch-eformsign-doc-from-api.usecase";
import { EFORMSIGN_COMPLETED_STATUS_CODES, TERMINAL_STATUS_CODES } from "domain/constants/eformsign-doc-status.constants";
import { FindClientByIdUsecase } from "application/usecases/client/find-client-by-id.usecase";
import { clientAgentTargetSnapshot, clientAgentTargetVersion } from "application/usecases/client/client-agent-target";

const ContractInputSchema = z.object({ clientId: z.number().int().positive(), templateId: z.string().min(1).max(200), templateName: z.string().max(200).optional() });
const ContractOutputSchema = z.object({ success: z.boolean(), documentId: z.string().optional(), status: z.string(), uncertain: z.boolean().optional() });
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
    ) {}

    getCapabilities(): CapabilityDefinition[] {
        const common = {
            domain: "contracts", version: "1.0.0", requiredRoles: ["owner", "admin", "manager"], sideEffect: true,
            approvalPolicy: "strong" as const, idempotencyPolicy: "provider-key" as const,
        };
        return [
            {
                meta: { ...common, name: "contracts.prepareDispatch", description: "Prepare a contract dispatch for approval", risk: "reversible-write" as const, renderer: "action-proposal" as const, flagKey: "agent.capability.contracts.prepareDispatch" },
                inputSchema: ContractInputSchema, outputSchema: ContractOutputSchema,
                classifyOutcome: (rawOutput) => ContractOutputSchema.parse(rawOutput).success
                    ? { status: "succeeded" }
                    : { status: "failed", reason: "Contract preparation was not completed" },
                formFields: CONTRACT_FORM_FIELDS,
                inspect: async (context, rawInput) => {
                    const input = ContractInputSchema.parse(rawInput);
                    const client = await this.findClientById.execute(context.principal.branchId, input.clientId);
                    if (!client) throw new Error("Contract client was not found in the current branch");
                    return {
                        targetVersion: clientAgentTargetVersion(client),
                        targetSnapshot: clientAgentTargetSnapshot(client),
                        title: "계약서 준비",
                        summary: `${client.name} 고객의 ${input.templateName ?? input.templateId} 계약서를 준비합니다.`,
                        provider: "eformsign",
                    };
                },
                execute: async (_context, rawInput) => ({ ...ContractInputSchema.parse(rawInput), status: "prepared", success: true }),
                revalidate: async (context, rawInput, expectedTargetVersion) => this.revalidateClient(context, rawInput, expectedTargetVersion),
                reconcile: async (_context, rawInput) => ({
                    status: "succeeded",
                    result: { ...ContractInputSchema.parse(rawInput), status: "prepared", success: true },
                    reason: "Preparation has no external side effect",
                }),
            },
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
                    return {
                        targetVersion: clientAgentTargetVersion(client),
                        targetSnapshot: clientAgentTargetSnapshot(client),
                        title: "계약서 생성 및 발송",
                        summary: `${client.name} 고객에게 ${input.templateName ?? input.templateId} 계약서를 발송합니다.`,
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
}
