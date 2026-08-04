import { Injectable } from "@nestjs/common";
import { z } from "zod";

import { AgentCapabilityProvider } from "application/agent/capability.decorator";
import type { AgentCapabilityProviderContract, CapabilityDefinition } from "application/agent/capability.types";
import { resolveEformsignDocDisplayStatus } from "application/utils/eformsign-doc-display-status";
import { FindEformsignDocsByClientIdUsecase } from "./find-eformsign-docs-by-client-id.usecase";

const InputSchema = z.object({ clientId: z.number().int().positive() });
const StatusSchema = z.object({ documentId: z.string(), documentName: z.string().nullable(), status: z.string(), statusDetail: z.string(), updatedDate: z.string(), expired: z.boolean() });
const OutputSchema = z.object({ documents: z.array(StatusSchema) });

@Injectable()
@AgentCapabilityProvider()
export class EformsignAgentCapabilitiesProvider implements AgentCapabilityProviderContract {
    constructor(private readonly findDocs: FindEformsignDocsByClientIdUsecase) {}

    getCapabilities(): CapabilityDefinition[] {
        return [{
            meta: { name: "contracts.status", domain: "contracts", version: "1.0.0", description: "Read active contract status for a client", risk: "read", requiredRoles: ["owner", "admin", "manager", "user"], renderer: "activity", flagKey: "agent.capability.contracts.status", sideEffect: false },
            inputSchema: InputSchema, outputSchema: OutputSchema,
            execute: async (context, rawInput) => {
                const docs = await this.findDocs.execute(context.principal.branchId, InputSchema.parse(rawInput).clientId);
                return { documents: docs.filter((doc) => doc.statusType !== "deleted").map((doc) => ({ documentId: doc.documentId, documentName: doc.documentName, status: resolveEformsignDocDisplayStatus({ id: doc.documentId, current_status: { status_type: doc.statusType, step_type: doc.stepType, step_name: doc.stepName } }), statusDetail: doc.statusDetail, updatedDate: doc.updatedDate.toISOString(), expired: doc.expired })) };
            },
        }];
    }
}
