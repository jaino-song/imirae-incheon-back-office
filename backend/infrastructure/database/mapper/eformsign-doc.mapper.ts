import { EformsignDocEntity, EformsignDocumentKind } from "domain/entities/eformsign-doc.entity";
import {
    decodeEformsignStepRecipientTypes,
    encodeEformsignStepRecipientTypes,
} from "domain/value-objects/eformsign-step-recipient-types";

type EformsignDocRow = {
    id: number;
    documentId: string;
    documentName: string | null;
    documentNumber: string | null;
    templateName: string | null;
    customerName: string | null;
    creatorName: string | null;
    lastEditorName: string | null;
    stepRecipientTypes: string | null;
    createdDate: Date;
    updatedDate: Date;
    statusType: string;
    statusDetail: string;
    stepType: string;
    stepIndex: string;
    stepName: string;
    stepRecipientType: string;
    stepRecipientName: string;
    stepRecipientSms: string;
    expiredDate: Date;
    expired: boolean;
    clientId: number | null;
    documentKind: string | null;
    employeeScheduleId: number | null;
    templateId: string | null;
};

export class EformsignDocMapper {
    static toDomain(row: EformsignDocRow): EformsignDocEntity {
        return EformsignDocEntity.reconstitute({
            id: row.id,
            documentId: row.documentId,
            documentName: row.documentName,
            documentNumber: row.documentNumber,
            templateName: row.templateName,
            customerName: row.customerName,
            creatorName: row.creatorName,
            lastEditorName: row.lastEditorName,
            stepRecipientTypes: decodeEformsignStepRecipientTypes(row.stepRecipientTypes),
            createdDate: row.createdDate,
            updatedDate: row.updatedDate,
            statusType: row.statusType,
            statusDetail: row.statusDetail,
            stepType: row.stepType,
            stepIndex: row.stepIndex,
            stepName: row.stepName,
            stepRecipientType: row.stepRecipientType,
            stepRecipientName: row.stepRecipientName,
            stepRecipientSms: row.stepRecipientSms,
            expiredDate: row.expiredDate,
            expired: row.expired,
            clientId: row.clientId,
            documentKind: row.documentKind as EformsignDocumentKind | null,
            employeeScheduleId: row.employeeScheduleId,
            templateId: row.templateId,
        });
    }

    static toPrismaCreate(entity: EformsignDocEntity) {
        return {
            documentId: entity.documentId,
            documentName: entity.documentName,
            documentNumber: entity.documentNumber,
            templateName: entity.templateName,
            customerName: entity.customerName,
            creatorName: entity.creatorName,
            lastEditorName: entity.lastEditorName,
            stepRecipientTypes: encodeEformsignStepRecipientTypes(entity.stepRecipientTypes),
            createdDate: entity.createdDate,
            updatedDate: entity.updatedDate,
            statusType: entity.statusType,
            statusDetail: entity.statusDetail,
            stepType: entity.stepType,
            stepIndex: entity.stepIndex,
            stepName: entity.stepName,
            stepRecipientType: entity.stepRecipientType,
            stepRecipientName: entity.stepRecipientName,
            stepRecipientSms: entity.stepRecipientSms,
            expiredDate: entity.expiredDate,
            expired: entity.expired,
            clientId: entity.clientId,
            documentKind: entity.documentKind,
            employeeScheduleId: entity.employeeScheduleId,
            templateId: entity.templateId,
        };
    }

    static toPrismaUpdate(entity: EformsignDocEntity) {
        return {
            documentId: entity.documentId,
            // Null means "the caller did not carry this value", not "clear it": several
            // callers rebuild the entity without optional mirror metadata and would
            // otherwise wipe stored values. Nothing needs to clear them, so omission is
            // the safe default.
            ...(entity.documentName == null ? {} : { documentName: entity.documentName }),
            ...(entity.documentNumber == null ? {} : { documentNumber: entity.documentNumber }),
            ...(entity.templateName == null ? {} : { templateName: entity.templateName }),
            ...(entity.customerName == null ? {} : { customerName: entity.customerName }),
            ...(entity.creatorName == null ? {} : { creatorName: entity.creatorName }),
            ...(entity.lastEditorName == null ? {} : { lastEditorName: entity.lastEditorName }),
            ...(entity.stepRecipientTypes == null
                ? {}
                : { stepRecipientTypes: encodeEformsignStepRecipientTypes(entity.stepRecipientTypes) }),
            createdDate: entity.createdDate,
            updatedDate: entity.updatedDate,
            statusType: entity.statusType,
            statusDetail: entity.statusDetail,
            stepType: entity.stepType,
            stepIndex: entity.stepIndex,
            stepName: entity.stepName,
            stepRecipientType: entity.stepRecipientType,
            stepRecipientName: entity.stepRecipientName,
            stepRecipientSms: entity.stepRecipientSms,
            expiredDate: entity.expiredDate,
            expired: entity.expired,
            clientId: entity.clientId,
            documentKind: entity.documentKind,
            employeeScheduleId: entity.employeeScheduleId,
            templateId: entity.templateId,
        };
    }
}
