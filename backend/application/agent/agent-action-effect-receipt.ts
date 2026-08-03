import { z } from "zod";
import { Prisma } from "@prisma/client";

import type { AgentContext } from "./agent-context";
import type { PrismaService } from "infrastructure/database/prisma.service";

const AgentActionEffectReceiptSchema = z.object({
    actionId: z.string().min(1),
    capability: z.string().min(1),
    resourceType: z.string().min(1),
    resourceId: z.union([z.string().min(1), z.number().int().positive()]),
    result: z.record(z.string(), z.unknown()),
    recordedAt: z.string().datetime({ offset: true }),
}).strict();

export type AgentActionEffectReceipt = z.infer<typeof AgentActionEffectReceiptSchema>;

/**
 * Persist a durable, action-identity-bound effect receipt before returning from
 * a mutation capability. If this write cannot be confirmed the coordinator
 * leaves the action uncertain; reconciliation never guesses from business data.
 */
export async function recordAgentActionEffect(
    prisma: PrismaService,
    context: AgentContext,
    capability: string,
    resourceType: string,
    resourceId: string | number,
    result: Record<string, unknown>,
): Promise<AgentActionEffectReceipt> {
    if (!context.actionId) throw new Error("Action identity is required to record an effect receipt");
    const receipt = AgentActionEffectReceiptSchema.parse({
        actionId: context.actionId,
        capability,
        resourceType,
        resourceId,
        result,
        recordedAt: new Date().toISOString(),
    });
    const updated = await prisma.agent_action.updateMany({
        where: {
            id: context.actionId,
            userId: context.principal.userId,
            branchId: context.principal.branchId,
            capability,
            status: "executing",
        },
        data: { effectReceipt: receipt as Prisma.InputJsonValue, effectRecordedAt: new Date(receipt.recordedAt) },
    });
    if (updated.count !== 1) throw new Error("Action effect receipt could not be persisted");
    return receipt;
}

export async function readAgentActionEffect(
    prisma: PrismaService,
    context: AgentContext,
    capability: string,
): Promise<AgentActionEffectReceipt | null> {
    if (!context.actionId) return null;
    const action = await prisma.agent_action.findFirst({
        where: {
            id: context.actionId,
            userId: context.principal.userId,
            branchId: context.principal.branchId,
            capability,
        },
        select: { effectReceipt: true },
    });
    const parsed = AgentActionEffectReceiptSchema.safeParse(action?.effectReceipt);
    return parsed.success ? parsed.data : null;
}
