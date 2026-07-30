import type { ConfigService } from "@nestjs/config";

import { SERVICE_RECORD_TEMPLATE_TIER_ENV_KEYS } from "application/usecases/eformsign-doc/service-record-field-ids";
import { EFORMSIGN_DOCUMENT_KIND } from "domain/entities/eformsign-doc.entity";

type ConfigReader = Pick<ConfigService, "get">;

export interface EformsignDocumentClassificationInput {
    documentKind?: string | null;
    serviceRecordCaseId?: string | null;
    templateId?: string | null;
}

export function configuredServiceRecordTemplateIds(
    configService?: ConfigReader,
): Set<string> {
    return new Set(
        SERVICE_RECORD_TEMPLATE_TIER_ENV_KEYS
            .map(({ envKey }) =>
                configService?.get<string>(envKey)?.trim()
                ?? process.env[envKey]?.trim(),
            )
            .filter((id): id is string => Boolean(id)),
    );
}

export function isServiceRecordEformsignDocument(
    document: EformsignDocumentClassificationInput,
    serviceRecordTemplateIds: ReadonlySet<string>,
): boolean {
    return document.documentKind
        === EFORMSIGN_DOCUMENT_KIND.SERVICE_RECORD_SNAPSHOT
        || document.serviceRecordCaseId != null
        || serviceRecordTemplateIds.has(document.templateId ?? "");
}
