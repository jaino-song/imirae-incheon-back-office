import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as crypto from "crypto";
import {
    IEformsignClientRepository,
    EformsignTokenResponse,
    EformsignApiDocumentResponse,
    EformsignApiListResponse,
    CreateDocumentPayload,
    CreateDocumentResponse,
    EformsignReviewerMember,
} from "domain/repositories/eformsign.client.interface";
import { EformsignApiError } from "infrastructure/api/eformsign-api.error";

const EFORMSIGN_MAX_ATTEMPTS = 4;
const EFORMSIGN_REQUEST_TIMEOUT_MS = 10_000;
// createDocument uploads the service-record signature images — up to 20 slots of dataURI
// PNG — and is the one call we refuse to retry, so a timeout here means giving up without
// knowing whether the customer already received the document. It gets room to finish.
const EFORMSIGN_CREATE_DOCUMENT_TIMEOUT_MS = 60_000;
// Below this, an attempt is not worth starting: see the budget check in request().
const EFORMSIGN_MIN_ATTEMPT_BUDGET_MS = 250;
const EFORMSIGN_TOTAL_DEADLINE_MS = 30_000;
const EFORMSIGN_BACKOFF_BASE_MS = 500;
const EFORMSIGN_BACKOFF_MAX_MS = 4_000;
const EFORMSIGN_RETRY_AFTER_MAX_MS = 10_000;

interface EformsignRequestOptions {
    idempotent?: boolean;
    timeoutMs?: number;
}

// These two responses were read as implicit `any` off response.json(). Now that the
// request helper parses the body, they get the shapes the call sites actually use —
// every field stays optional because the fallbacks below rely on that.
interface CreateDocumentApiResponse {
    template_id?: string;
    document?: { id?: string; document_name?: string; document_status?: string };
    document_id?: string;
    id?: string;
    status?: string;
}

interface EformsignTemplateConfigResponse {
    config?: {
        step_settings?: Array<{
            type?: string;
            option?: {
                receipients?: Array<{
                    member?: { name?: string; id?: string; sms?: { phone_number?: string } };
                }>;
            };
        }>;
    };
}

/**
 * Infrastructure repository that calls eformsign external API.
 * Uses EFORMSIGN_DOC_API_URL for document-related calls (not token endpoints).
 */
@Injectable()
export class EformsignApiClient implements IEformsignClientRepository {
    private readonly logger = new Logger(EformsignApiClient.name);
    private readonly USER_EMAIL: string;
    private readonly EFORMSIGN_API_URL: string; // base for token endpoints
    private readonly EFORMSIGN_DOC_API_URL: string; // for document endpoints (kr-api)
    private readonly EFORMSIGN_API_KEY: string;
    private readonly EFORMSIGN_PRIVATE_KEY: string;
    private readonly isConfigured: boolean;

    constructor(private configService: ConfigService) {
        this.USER_EMAIL = this.configService.get<string>("EFORMSIGN_USER_EMAIL") || "";
        this.EFORMSIGN_API_URL = this.configService.get<string>("EFORMSIGN_API_URL") || "";
        this.EFORMSIGN_DOC_API_URL = this.configService.get<string>("EFORMSIGN_DOC_API_URL") || "";
        this.EFORMSIGN_API_KEY = this.configService.get<string>("EFORMSIGN_API_KEY") || "";
        this.EFORMSIGN_PRIVATE_KEY = this.configService.get<string>("EFORMSIGN_PRIVATE_KEY") || "";
        this.isConfigured = Boolean(
            this.USER_EMAIL &&
            this.EFORMSIGN_API_URL &&
            this.EFORMSIGN_DOC_API_URL &&
            this.EFORMSIGN_API_KEY &&
            this.EFORMSIGN_PRIVATE_KEY
        );

        if (!this.isConfigured) {
            this.logger.warn("Eformsign API env vars are not fully configured. Eformsign API client will be disabled.");
        }
    }

    /**
     * Generate eformsign signature using SHA256withECDSA
     */
    private generateSignature(executionTime: number): string {
        this.assertConfigured();
        const message = String(executionTime);
        const privateKeyDer = Buffer.from(this.EFORMSIGN_PRIVATE_KEY, "hex");

        const privateKey = crypto.createPrivateKey({
            key: privateKeyDer,
            format: "der",
            type: "pkcs8",
        });

        const signature = crypto.sign(
            "sha256",
            Buffer.from(message, "utf-8"),
            privateKey
        );

        return signature.toString("hex");
    }

    /**
     * Get access token from eformsign API (uses base API URL)
     * POST /v2.0/api_auth/access_token
     */
    async getAccessToken(executionTime: number, memberEmail?: string): Promise<EformsignTokenResponse> {
        this.assertConfigured();
        const signature = this.generateSignature(executionTime);
        const email = memberEmail || this.USER_EMAIL;

        // API key must be Base64 encoded according to eformsign docs
        const encodedApiKey = Buffer.from(this.EFORMSIGN_API_KEY).toString("base64");

        return this.request<EformsignTokenResponse>(
            "getAccessToken",
            `${this.EFORMSIGN_API_URL}/v2.0/api_auth/access_token`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "eformsign_signature": signature,
                    "Authorization": `Bearer ${encodedApiKey}`,
                },
                body: JSON.stringify({
                    execution_time: executionTime,
                    member_id: email,
                }),
            },
            "Failed to get access token",
        );
    }

    /**
     * Refresh access token from eformsign API (uses base API URL)
     * POST /v2.0/api_auth/refresh_token
     */
    async refreshAccessToken(executionTime: number, refreshToken: string): Promise<EformsignTokenResponse> {
        this.assertConfigured();
        const signature = this.generateSignature(executionTime);

        return this.request<EformsignTokenResponse>(
            "refreshAccessToken",
            `${this.EFORMSIGN_API_URL}/v2.0/api_auth/refresh_token`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "eformsign_signature": signature,
                    "api_key": this.EFORMSIGN_API_KEY,
                },
                body: JSON.stringify({
                    execution_time: executionTime,
                    refresh_token: refreshToken,
                }),
            },
            "Failed to refresh token",
        );
    }

    /**
     * Get in-progress documents from eformsign API (uses DOC API URL)
     * POST /v2.0/api/list_document with type: "01"
     */
    async getInProgressDocuments(accessToken: string): Promise<EformsignApiDocumentResponse[]> {
        this.assertConfigured();
        const data = await this.request<EformsignApiListResponse>(
            "getInProgressDocuments",
            `${this.EFORMSIGN_DOC_API_URL}/v2.0/api/list_document`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${accessToken}`,
                },
                body: JSON.stringify({
                    type: "01",
                    title_and_content: "",
                    title: "",
                    content: "",
                    limit: "100",
                    skip: "0",
                }),
            },
            "Failed to get in-progress documents",
        );
        return data.documents || [];
    }

    /**
     * Get completed documents from eformsign API (uses DOC API URL)
     * POST /v2.0/api/list_document with type: "03"
     */
    async getCompletedDocuments(accessToken: string): Promise<EformsignApiDocumentResponse[]> {
        this.assertConfigured();
        const data = await this.request<EformsignApiListResponse>(
            "getCompletedDocuments",
            `${this.EFORMSIGN_DOC_API_URL}/v2.0/api/list_document`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${accessToken}`,
                },
                body: JSON.stringify({
                    type: "03",
                    title_and_content: "",
                    title: "",
                    content: "",
                    limit: "100",
                    skip: "0",
                }),
            },
            "Failed to get completed documents",
        );
        return data.documents || [];
    }

    /**
     * Get all documents (both in-progress and completed)
     */
    async getAllDocuments(accessToken: string): Promise<EformsignApiDocumentResponse[]> {
        this.assertConfigured();
        const [inProgress, completed] = await Promise.all([
            this.getInProgressDocuments(accessToken),
            this.getCompletedDocuments(accessToken),
        ]);
        return [...inProgress, ...completed];
    }

    async findDocumentsByTitle(
        accessToken: string,
        title: string,
    ): Promise<EformsignApiDocumentResponse[]> {
        this.assertConfigured();
        const [inProgress, completed] = await Promise.all([
            this.listDocumentsByTitle(accessToken, "01", title),
            this.listDocumentsByTitle(accessToken, "03", title),
        ]);
        return [...inProgress, ...completed].filter((document) => document.document_name === title);
    }

    private async listDocumentsByTitle(
        accessToken: string,
        type: "01" | "03",
        title: string,
    ): Promise<EformsignApiDocumentResponse[]> {
        const data = await this.request<EformsignApiListResponse>(
            "listDocumentsByTitle",
            `${this.EFORMSIGN_DOC_API_URL}/v2.0/api/list_document`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${accessToken}`,
                },
                body: JSON.stringify({
                    type,
                    title_and_content: title,
                    title,
                    content: "",
                    limit: "100",
                    skip: "0",
                }),
            },
            "Failed to find document by title",
        );
        return data.documents ?? [];
    }

    /**
     * Get single document info from eformsign API (uses DOC API URL)
     * GET /v2.0/api/documents/{DOCUMENT_ID}
     */
    async getDocument(accessToken: string, documentId: string): Promise<EformsignApiDocumentResponse> {
        this.assertConfigured();
        const includeParams = new URLSearchParams({
            include_fields: "true",
            include_histories: "true",
            include_previous_status: "true",
            include_next_status: "true",
            include_external_token: "true",
            include_detail_template_info: "true",
        });

        return this.request<EformsignApiDocumentResponse>(
            "getDocument",
            `${this.EFORMSIGN_DOC_API_URL}/v2.0/api/documents/${documentId}?${includeParams.toString()}`,
            {
                method: "GET",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${accessToken}`,
                },
            },
            "Failed to get document",
        );
    }

    async createDocument(accessToken: string, payload: CreateDocumentPayload): Promise<CreateDocumentResponse> {
        this.assertConfigured();

        // Two dispatch shapes (verified live):
        // - reviewer: new-format recipient mirroring the template's pre-specified reviewer step;
        //   any mismatch (or the legacy flat shape) is rejected with 4000012/500.
        // - recipient: legacy flat participant shape used by the contract flow (step 2 SMS signer).
        let recipients: unknown[] = [];
        if (payload.reviewer) {
            recipients = [
                {
                    step_type: "06",
                    use_sms: Boolean(payload.reviewer.phoneNumber),
                    use_mail: true,
                    member: {
                        name: payload.reviewer.name,
                        id: payload.reviewer.id,
                        ...(payload.reviewer.phoneNumber
                            ? { sms: { country_code: "", phone_number: payload.reviewer.phoneNumber } }
                            : {}),
                    },
                },
            ];
        } else if (payload.recipient) {
            recipients = [
                {
                    step_idx: "2",
                    step_type: "05",
                    name: payload.recipient.name,
                    id: "",
                    sms: payload.recipient.sms,
                    use_sms: true,
                },
            ];
        }

        const requestBody = {
            template_id: payload.templateId,
            document: {
                document_name: payload.documentName,
                fields: payload.prefillFields.map(f => ({
                    id: f.id,
                    value: f.value,
                })),
                recipients,
            },
        };

        // eformsign requires template_id as a QUERY parameter; sending it only in the body 400s
        // ("Required String parameter 'template_id' is not present"). Verified against the live
        // tenant. Kept in the body too (harmless, ignored) so the contract flow is unaffected.
        const url = `${this.EFORMSIGN_DOC_API_URL}/v2.0/api/documents?template_id=${encodeURIComponent(payload.templateId)}`;
        const data = await this.request<CreateDocumentApiResponse>(
            "createDocument",
            url,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${accessToken}`,
                },
                body: JSON.stringify(requestBody),
            },
            "Failed to create document",
            {
                // Creating a document also sends it to the customer. A 5xx, timeout, or network
                // error has an ambiguous outcome and retrying could create/send a duplicate.
                // A 429 is safe because the server explicitly rejected the request before work.
                idempotent: false,
                timeoutMs: EFORMSIGN_CREATE_DOCUMENT_TIMEOUT_MS,
            },
        );

        // Live response shape: { template_id, document: { id, document_name, document_status } }.
        const documentId = data.document?.id ?? data.document_id ?? data.id ?? "";
        if (!documentId) {
            throw new Error(`createDocument: no document id in response: ${JSON.stringify(data).slice(0, 300)}`);
        }
        return {
            documentId,
            status: data.document?.document_status || data.status || "created",
        };
    }

    /**
     * Read the pre-specified recipient of the template's reviewer step from the form config.
     * Dispatching to a reviewer step requires mirroring this member exactly (see createDocument).
     */
    async getTemplateReviewer(accessToken: string, templateId: string): Promise<EformsignReviewerMember | null> {
        this.assertConfigured();
        const data = await this.request<EformsignTemplateConfigResponse>(
            "getTemplateReviewer",
            `${this.EFORMSIGN_DOC_API_URL}/v2.0/api/forms/${encodeURIComponent(templateId)}?is_include_config=true`,
            { headers: { "Authorization": `Bearer ${accessToken}` } },
            "Failed to get template config",
        );
        const steps: Array<{ type?: string; option?: { receipients?: Array<{ member?: { name?: string; id?: string; sms?: { phone_number?: string } } }> } }> =
            data?.config?.step_settings ?? [];
        const reviewerStep = steps.find(s => s.type === "reviewer");
        const member = reviewerStep?.option?.receipients?.[0]?.member;
        if (!member?.id || !member?.name) return null;
        return {
            name: member.name,
            id: member.id,
            phoneNumber: member.sms?.phone_number || undefined,
        };
    }

    /**
     * Reads the body inside the retry loop, not after it. A response whose headers
     * arrived but whose body then stalls or resets fails at the json()/text() call, and
     * leaving that outside meant one transient body failure killed a run that the retry
     * policy was supposed to survive. Body failures now follow the same policy as the
     * request itself — including the idempotency rule, so a createDocument whose body
     * fails is never retried: the customer may already have the document.
     */
    private async request<T>(
        operation: string,
        url: string,
        init: RequestInit,
        errorPrefix: string,
        options: EformsignRequestOptions = {},
    ): Promise<T> {
        const idempotent = options.idempotent ?? true;
        const requestTimeoutMs = options.timeoutMs ?? EFORMSIGN_REQUEST_TIMEOUT_MS;
        // A non-idempotent call is never retried, so the multi-attempt budget does not
        // apply to it; it gets one attempt and its own timeout.
        const deadline = Date.now() + (idempotent ? EFORMSIGN_TOTAL_DEADLINE_MS : requestTimeoutMs);
        let lastError: unknown;

        for (let attempt = 1; attempt <= EFORMSIGN_MAX_ATTEMPTS; attempt += 1) {
            const remainingMs = deadline - Date.now();
            // Backoff already refuses to sleep past the deadline, so arriving here with
            // almost nothing left means a 1ms attempt whose abort would replace the real
            // 429/5xx we were retrying — reporting a timeout for a rate limit.
            if (attempt > 1 && remainingMs < EFORMSIGN_MIN_ATTEMPT_BUDGET_MS) {
                break;
            }
            const attemptTimeoutMs = Math.max(
                1,
                Math.min(requestTimeoutMs, remainingMs),
            );
            let response: Response | undefined;
            let payload: T | undefined;
            let httpError: EformsignApiError | undefined;
            let transportError: unknown;
            let hasPayload = false;

            try {
                response = await fetch(url, {
                    ...init,
                    signal: AbortSignal.timeout(attemptTimeoutMs),
                });
                if (response.ok) {
                    payload = await response.json() as T;
                    hasPayload = true;
                } else {
                    const errorData = await response.text();
                    httpError = new EformsignApiError(
                        `${errorPrefix}: ${response.status} - ${errorData}`,
                        response.status,
                    );
                }
            } catch (error) {
                transportError = error;
            }

            if (transportError !== undefined) {
                if (!idempotent || attempt === EFORMSIGN_MAX_ATTEMPTS) {
                    throw transportError;
                }

                const delayMs = this.getExponentialBackoffMs(attempt);
                if (Date.now() + delayMs >= deadline) {
                    throw transportError;
                }
                lastError = transportError;
                this.logRetry(
                    operation,
                    attempt + 1,
                    delayMs,
                    this.getNetworkErrorCause(transportError),
                );
                await this.waitForRetry(delayMs);
                continue;
            }

            if (hasPayload) {
                return payload as T;
            }

            const error = httpError as EformsignApiError;
            const retryableStatus = error.status === 429
                || (idempotent && error.status >= 500 && error.status <= 599);

            if (!retryableStatus || attempt === EFORMSIGN_MAX_ATTEMPTS) {
                throw error;
            }

            const delayMs = this.getRetryDelayMs(response as Response, attempt);
            if (Date.now() + delayMs >= deadline) {
                throw error;
            }
            lastError = error;
            this.logRetry(operation, attempt + 1, delayMs, `status=${error.status}`);
            await this.waitForRetry(delayMs);
        }

        // Reached only by the out-of-budget break above, which always has a prior failure.
        if (lastError !== undefined) {
            throw lastError;
        }
        throw new Error(`Eformsign ${operation} exhausted retry attempts.`);
    }

    private getRetryDelayMs(response: Response, attempt: number): number {
        const retryAfter = response.headers.get("Retry-After")?.trim();
        // An empty or whitespace header would coerce to 0 and retry with no backoff at all.
        if (retryAfter) {
            const seconds = Number(retryAfter);
            const parsedDelayMs = Number.isFinite(seconds) && seconds >= 0
                ? seconds * 1_000
                : Date.parse(retryAfter) - Date.now();

            if (Number.isFinite(parsedDelayMs) && parsedDelayMs >= 0) {
                return Math.min(parsedDelayMs, EFORMSIGN_RETRY_AFTER_MAX_MS);
            }
        }

        return this.getExponentialBackoffMs(attempt);
    }

    private getExponentialBackoffMs(attempt: number): number {
        const exponentialDelay = Math.min(
            EFORMSIGN_BACKOFF_BASE_MS * (2 ** (attempt - 1)),
            EFORMSIGN_BACKOFF_MAX_MS,
        );
        const halfDelay = exponentialDelay / 2;
        return Math.round(halfDelay + (Math.random() * halfDelay));
    }

    private logRetry(
        operation: string,
        nextAttempt: number,
        delayMs: number,
        cause: string,
    ): void {
        this.logger.warn(
            `Eformsign ${operation} retry nextAttempt=${nextAttempt}/${EFORMSIGN_MAX_ATTEMPTS} waitMs=${delayMs} ${cause}`,
        );
    }

    private getNetworkErrorCause(error: unknown): string {
        return `cause=${error instanceof Error ? error.name : "network-error"}`;
    }

    private async waitForRetry(delayMs: number): Promise<void> {
        await new Promise<void>((resolve) => {
            setTimeout(resolve, delayMs);
        });
    }

    private assertConfigured() {
        if (!this.isConfigured) {
            throw new Error("Eformsign integration is not configured.");
        }
    }
}
