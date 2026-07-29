import { api } from "@/lib/api/client";
import type {
    ApplyServiceScheduleChangeRequest,
    ApplyServiceScheduleChangeResponse,
    CreateServiceRecordHeaderEditLinkResponse,
    PrepareServiceRecordLinkRequest,
    PrepareServiceRecordLinkResponse,
    ResetServiceRecordLinkResponse,
    SendServiceRecordLinkRequest,
    SendServiceRecordLinkResponse,
    ServiceScheduleChangePreviewResponse,
    ServiceRecordOverview,
} from "../types";

export const serviceRecordsApi = {
    getClientOverview: (clientId: number) =>
        api.get<ServiceRecordOverview>(`/admin/service-records/client/${clientId}`),
    prepareLink: (scheduleId: number, request: PrepareServiceRecordLinkRequest = {}) =>
        api.post<PrepareServiceRecordLinkResponse>(
            `/admin/service-records/schedules/${scheduleId}/prepare-link`,
            request,
        ),
    resetLink: (scheduleId: number) =>
        api.post<ResetServiceRecordLinkResponse>(
            `/admin/service-records/schedules/${scheduleId}/reset-link`,
            {},
        ),
    createHeaderEditLink: (scheduleId: number) =>
        api.post<CreateServiceRecordHeaderEditLinkResponse>(
            `/admin/service-records/schedules/${scheduleId}/header-edit-link`,
            {},
        ),
    previewScheduleChange: (scheduleId: number) =>
        api.get<ServiceScheduleChangePreviewResponse>(
            `/schedule-change-requests/schedules/${scheduleId}/preview`,
        ),
    applyScheduleChange: (scheduleId: number, request: ApplyServiceScheduleChangeRequest) =>
        api.post<ApplyServiceScheduleChangeResponse>(
            `/schedule-change-requests/schedules/${scheduleId}/apply`,
            request,
        ),
    sendLink: (scheduleId: number, request: SendServiceRecordLinkRequest = {}) =>
        api.post<SendServiceRecordLinkResponse>(
            `/admin/service-records/schedules/${scheduleId}/send-link`,
            request,
        ),
};
