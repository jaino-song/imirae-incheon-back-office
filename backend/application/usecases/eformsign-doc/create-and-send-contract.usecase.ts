import { Injectable, Inject, Logger, Optional } from "@nestjs/common";
import { createHash } from "node:crypto";
import { EFORMSIGN_CLIENT_REPOSITORY, IEformsignClientRepository } from "domain/repositories/eformsign.client.interface";
import { CLIENT_REPOSITORY, IClientRepository } from "domain/repositories/client.repository.interface";
import { EFORMSIGN_DOCUMENT_KIND } from "domain/entities/eformsign-doc.entity";
import { CreateEformsignDocUsecase } from "./create-eformsign-doc.usecase";
import { GetEformsignAccessTokenUsecase } from "./get-eformsign-access-token.usecase";
import { ContractClientAssignmentGuardService } from "application/services/contract-client-assignment-guard.service";
import { EformsignApiError } from "infrastructure/api/eformsign-api.error";
import { EformsignDispatchBoundaryService } from "application/services/eformsign-dispatch-boundary.service";

export interface CreateAndSendContractParams {
    clientId: number;
    templateId: string;
    templateName?: string;
    idempotencyKey?: string;
    /**
     * Approval-bound contract dispatches pass the exact client projection that
     * was durably staged while the target row was locked. The provider path
     * must never re-read a newer client row after that point.
     */
    clientSnapshot?: ContractClientSnapshot;
    /** Exact approval target used to fence the post-provider e_doc_id link. */
    clientTargetVersion?: string;
}

export interface ContractClientSnapshot {
    id: number;
    name: string;
    phone: string | null;
    address: string | null;
    birthday: string | null;
    startDate: string | null;
    endDate: string | null;
    fullPrice: string | null;
    grant: string | null;
    actualPrice: string | null;
    duration: number | null;
    /** Snapshot-time UTC instant used for null service dates and today's fields. */
    fallbackDate?: string;
}

export interface CreateAndSendContractResult {
    success: boolean;
    documentId?: string;
    error?: string;
    remoteDocumentId?: string;
    uncertain?: boolean;
}

@Injectable()
export class CreateAndSendContractUsecase {
    private readonly logger = new Logger(CreateAndSendContractUsecase.name);

    constructor(
        @Inject(EFORMSIGN_CLIENT_REPOSITORY)
        private readonly eformsignClient: IEformsignClientRepository,
        @Inject(CLIENT_REPOSITORY)
        private readonly clientRepository: IClientRepository,
        private readonly getAccessTokenUsecase: GetEformsignAccessTokenUsecase,
        private readonly createEformsignDocUsecase: CreateEformsignDocUsecase,
        private readonly assignmentGuard: ContractClientAssignmentGuardService,
        @Optional() private readonly dispatchBoundary?: EformsignDispatchBoundaryService,
    ) {}

    async execute(
        branchid: string,
        params: CreateAndSendContractParams
    ): Promise<CreateAndSendContractResult> {
        const { clientId, templateId, templateName, idempotencyKey } = params;

        const client = params.clientSnapshot ?? await this.clientRepository.findById(branchid, clientId);
        if (!client) {
            return { success: false, error: "고객을 찾을 수 없습니다" };
        }

        if (!client.phone) {
            return { success: false, error: "고객 연락처가 없습니다" };
        }

        let remoteDocumentId: string | undefined;
        let providerAttempted = false;
        let dispatchIntent: Awaited<ReturnType<EformsignDispatchBoundaryService["claim"]>>["intent"] | undefined;
        try {
            const assignment = await this.assignmentGuard.assertAssignedClient(branchid, clientId);
            if (this.dispatchBoundary) {
                // Approval-bound agent calls supply an immutable target version; direct callers
                // fall back to the current client projection. Hashing the generation keeps
                // caller-provided request keys out of operator-facing persistence while making
                // the same logical request stable across retries.
                const startDate = typeof client.startDate === "string"
                    ? client.startDate
                    : client.startDate?.toISOString() ?? null;
                const endDate = typeof client.endDate === "string"
                    ? client.endDate
                    : client.endDate?.toISOString() ?? null;
                const generationSource = idempotencyKey?.trim()
                    || params.clientTargetVersion
                    || JSON.stringify({
                        clientId,
                        name: client.name,
                        phone: client.phone,
                        address: client.address,
                        birthday: client.birthday,
                        startDate,
                        endDate,
                        fullPrice: client.fullPrice,
                        grant: client.grant,
                        actualPrice: client.actualPrice,
                        duration: client.duration,
                    });
                const generation = createHash("sha256").update(generationSource).digest("hex");
                const fingerprint = createHash("sha256")
                    .update(JSON.stringify({
                        clientId,
                        client: {
                            name: client.name,
                            phone: client.phone,
                            address: client.address,
                            birthday: client.birthday,
                            startDate,
                            endDate,
                            fullPrice: client.fullPrice,
                            grant: client.grant,
                            actualPrice: client.actualPrice,
                            duration: client.duration,
                        },
                        templateId,
                        templateName: templateName ?? null,
                        generation,
                    }))
                    .digest("hex");
                const claim = await this.dispatchBoundary.claim({
                    branchId: branchid,
                    clientId,
                    assignmentId: assignment?.scheduleId ?? null,
                    templateId,
                    action: "create",
                    generation,
                    fingerprint,
                });
                if (claim.disposition === "already_accepted") {
                    return claim.intent.providerDocumentId
                        ? { success: true, documentId: claim.intent.providerDocumentId }
                        : {
                            success: false,
                            error: "계약서 발송 결과를 확인할 수 없습니다",
                            uncertain: true,
                        };
                }
                if (claim.disposition === "uncertain") {
                    return {
                        success: false,
                        error: "계약서 발송 결과 확인이 필요합니다",
                        ...(claim.intent.providerDocumentId
                            ? { remoteDocumentId: claim.intent.providerDocumentId }
                            : {}),
                        uncertain: true,
                    };
                }
                dispatchIntent = claim.intent;
            }
            const executionTime = Date.now();
            const tokenResponse = await this.getAccessTokenUsecase.execute(executionTime);
            const accessToken = tokenResponse.oauth_token.access_token;

            const fallbackInstant = params.clientSnapshot?.fallbackDate ?? new Date().toISOString();
            const formatDate = (date: Date | string | null): { year: string; month: string; day: string } => {
                if (!date) {
                    const now = new Date(fallbackInstant);
                    return {
                        year: now.getUTCFullYear().toString().slice(-2),
                        month: (now.getUTCMonth() + 1).toString().padStart(2, '0'),
                        day: now.getUTCDate().toString().padStart(2, '0'),
                    };
                }
                const instant = typeof date === "string" ? new Date(date) : date;
                return {
                    year: instant.getUTCFullYear().toString().slice(-2),
                    month: (instant.getUTCMonth() + 1).toString().padStart(2, '0'),
                    day: instant.getUTCDate().toString().padStart(2, '0'),
                };
            };

            const startDate = formatDate(client.startDate);
            const endDate = formatDate(client.endDate);
            const today = formatDate(fallbackInstant);

            const prefillFields = [
                { id: "이용자 성명", value: client.name },
                { id: "이용자 생년월일", value: client.birthday || "" },
                { id: "이용자 주소", value: client.address || "" },
                { id: "계약 시작 년도", value: startDate.year },
                { id: "계약 시작 월", value: startDate.month },
                { id: "계약 시작 일", value: startDate.day },
                { id: "계약 종료 년도", value: endDate.year },
                { id: "계약 종료 월", value: endDate.month },
                { id: "계약 종료 일", value: endDate.day },
                { id: "서비스 비용", value: client.fullPrice || "" },
                { id: "정부지원금", value: client.grant || "" },
                { id: "본인부담금", value: client.actualPrice || "" },
                { id: "서비스 기간", value: client.duration?.toString() || "" },
                { id: "서비스 가격", value: client.fullPrice || "" },
                { id: "본인부담금 수령 년도", value: today.year },
                { id: "본인부담금 수령 월", value: today.month },
                { id: "본인부담금 수령 일", value: today.day },
                { id: "서비스 기간", value: `${client.duration || 0}일` },
            ];

            // The contract template sets title_change=false: it builds the title from its own
            // doc_default_title pattern and rejects an explicit name with 4000010. Send none and
            // record whatever eformsign named it, falling back to our own label if the response
            // omits it, so the mirror row never carries a title the vendor disagrees with.
            const fallbackDocumentName = `${templateName || "계약서"} - ${client.name}`;
            providerAttempted = true;
            const result = await this.eformsignClient.createDocument(accessToken, {
                templateId,
                // The durable intent key is the fallback when a direct caller did not supply
                // one. Agent action ids remain provider keys when present for compatibility.
                idempotencyKey: idempotencyKey?.trim() || dispatchIntent?.businessKey,
                prefillFields,
                recipient: {
                    name: client.name,
                    sms: client.phone,
                },
            });
            remoteDocumentId = result.documentId;
            if (dispatchIntent && this.dispatchBoundary) {
                const accepted = await this.dispatchBoundary.markAccepted(
                    dispatchIntent,
                    result.documentId,
                    { documentName: result.documentName ?? null },
                );
                if (!accepted || accepted.status !== "accepted") {
                    return {
                        success: false,
                        error: "계약서 발송 결과 확인이 필요합니다",
                        remoteDocumentId: result.documentId,
                        uncertain: true,
                    };
                }
            }
            const documentName = result.documentName ?? fallbackDocumentName;

            await this.createEformsignDocUsecase.execute(branchid, {
                documentId: result.documentId,
                documentName,
                clientId,
                linkToClient: true,
                statusType: "010",
                statusDetail: "created",
                stepType: "01",
                stepIndex: "1",
                stepName: "시작",
                stepRecipientType: "signer",
                stepRecipientName: client.name,
                stepRecipientSms: client.phone,
                expiredDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                documentKind: EFORMSIGN_DOCUMENT_KIND.CONTRACT,
                templateId,
                templateName: templateName ?? null,
                customerName: client.name,
                clientTargetVersion: params.clientTargetVersion,
            });

            this.logger.log(`Contract created and sent: documentId=${result.documentId}, clientId=${clientId}`);

            return {
                success: true,
                documentId: result.documentId,
            };
        } catch (error) {
            this.logger.error(`Failed to create contract: ${error}`);
            const certainProviderRejection = error instanceof EformsignApiError
                && error.status >= 400
                && error.status < 500
                && error.status !== 408;
            if (dispatchIntent) {
                if (providerAttempted && !certainProviderRejection) {
                    await this.dispatchBoundary?.markUncertain(
                        dispatchIntent,
                        error instanceof Error ? error.message : "provider outcome unavailable",
                        remoteDocumentId,
                    ).catch((persistError) => {
                        this.logger.error(`Failed to persist uncertain eformsign contract outcome: ${persistError}`);
                    });
                } else {
                    await this.dispatchBoundary?.releaseBeforeSend(
                        dispatchIntent,
                        error instanceof Error ? error.message : "contract dispatch did not start",
                    ).catch(() => undefined);
                }
            }
            return {
                success: false,
                error: error instanceof Error ? error.message : "계약서 생성에 실패했습니다",
                ...(remoteDocumentId ? { remoteDocumentId } : {}),
                ...(providerAttempted ? { uncertain: !certainProviderRejection } : {}),
            };
        }
    }
}
