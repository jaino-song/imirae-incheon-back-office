import { api } from "@/lib/api/client";
import type {
    MessageLogRecord,
    MessageTriggerRule,
    CreateMessageTriggerRuleDto,
    TriggerEventType,
    TriggerRecipientType,
    TriggerTemplateCatalogItem,
    UpcomingMessageTriggerJob,
    UpdateMessageTriggerRuleDto,
    UpdateMessageTriggerRuleBranchActivationDto,
} from "../types";

export const messageTriggersApi = {
    list: () => api.get<MessageTriggerRule[]>("/message-trigger-rules"),
    getById: (id: string) => api.get<MessageTriggerRule>(`/message-trigger-rules/${id}`),
    create: (dto: CreateMessageTriggerRuleDto) =>
        api.post<MessageTriggerRule>("/message-trigger-rules", dto),
    update: (id: string, dto: UpdateMessageTriggerRuleDto) =>
        api.patch<MessageTriggerRule>(`/message-trigger-rules/${id}`, dto),
    updateBranchActivation: (id: string, dto: UpdateMessageTriggerRuleBranchActivationDto) =>
        api.put<MessageTriggerRule>(`/message-trigger-rules/${id}/branch-activation`, dto),
    delete: (id: string) => api.delete(`/message-trigger-rules/${id}`),
    listTemplates: (params: {
        eventType?: TriggerEventType;
        recipientType?: TriggerRecipientType;
    }) =>
        api.get<TriggerTemplateCatalogItem[]>("/message-trigger-templates", {
            params,
        }),
    listUpcomingJobs: (limit = 200) =>
        api.get<UpcomingMessageTriggerJob[]>("/message-trigger-jobs/upcoming", {
            params: { limit },
        }),
    listHistory: (limit = 200) =>
        api.get<MessageLogRecord[]>("/message-logs", {
            params: { limit },
        }),
    cancelJob: (id: string) =>
        api.post<{ id: string; status: "canceled" }>(`/message-trigger-jobs/${id}/cancel`, {}),
};
