import { Injectable, Inject, Logger } from "@nestjs/common";
import { EFORMSIGN_CLIENT_REPOSITORY, IEformsignClientRepository } from "domain/repositories/eformsign.client.interface";
import { CLIENT_REPOSITORY, IClientRepository } from "domain/repositories/client.repository.interface";
import { EFORMSIGN_DOCUMENT_KIND } from "domain/entities/eformsign-doc.entity";
import { CreateEformsignDocUsecase } from "./create-eformsign-doc.usecase";
import { GetEformsignAccessTokenUsecase } from "./get-eformsign-access-token.usecase";
import { ContractClientAssignmentGuardService } from "application/services/contract-client-assignment-guard.service";

export interface CreateAndSendContractParams {
    clientId: number;
    templateId: string;
    templateName?: string;
}

export interface CreateAndSendContractResult {
    success: boolean;
    documentId?: string;
    error?: string;
    remoteDocumentId?: string;
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
    ) {}

    async execute(
        branchid: string,
        params: CreateAndSendContractParams
    ): Promise<CreateAndSendContractResult> {
        const { clientId, templateId, templateName } = params;

        const client = await this.clientRepository.findById(branchid, clientId);
        if (!client) {
            return { success: false, error: "고객을 찾을 수 없습니다" };
        }

        if (!client.phone) {
            return { success: false, error: "고객 연락처가 없습니다" };
        }

        let remoteDocumentId: string | undefined;
        try {
            await this.assignmentGuard.assertAssignedClient(branchid, clientId);
            const executionTime = Date.now();
            const tokenResponse = await this.getAccessTokenUsecase.execute(executionTime);
            const accessToken = tokenResponse.oauth_token.access_token;

            const formatDate = (date: Date | null): { year: string; month: string; day: string } => {
                if (!date) {
                    const now = new Date();
                    return {
                        year: now.getFullYear().toString(),
                        month: (now.getMonth() + 1).toString().padStart(2, '0'),
                        day: now.getDate().toString().padStart(2, '0'),
                    };
                }
                return {
                    year: date.getFullYear().toString(),
                    month: (date.getMonth() + 1).toString().padStart(2, '0'),
                    day: date.getDate().toString().padStart(2, '0'),
                };
            };

            const startDate = formatDate(client.startDate);
            const endDate = formatDate(client.endDate);
            const today = formatDate(new Date());

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

            const documentName = `${templateName || "계약서"} - ${client.name}`;
            const result = await this.eformsignClient.createDocument(accessToken, {
                templateId,
                documentName,
                prefillFields,
                recipient: {
                    name: client.name,
                    sms: client.phone,
                },
            });
            remoteDocumentId = result.documentId;

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
            });

            this.logger.log(`Contract created and sent: documentId=${result.documentId}, clientId=${clientId}`);

            return {
                success: true,
                documentId: result.documentId,
            };
        } catch (error) {
            this.logger.error(`Failed to create contract: ${error}`);
            return {
                success: false,
                error: error instanceof Error ? error.message : "계약서 생성에 실패했습니다",
                remoteDocumentId,
            };
        }
    }
}
