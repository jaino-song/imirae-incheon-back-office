import {
    BadRequestException,
    ConflictException,
    Injectable,
    Logger,
    NotFoundException,
    NotImplementedException,
} from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validate as validateDto } from "class-validator";
import { PrismaService } from "infrastructure/database/prisma.service";
import { ClientService } from "application/services/client.service";
import { assertValidPhone, INVALID_PHONE_MESSAGE, InvalidPhoneError, normalizePhone } from "application/utils/normalize-phone";
import { PROPOSAL_FIELDS } from "application/services/call-extraction.prompt";
import {
    ConfirmDraftDto,
    ConfirmNewClientFieldsDto,
    ConfirmNewClientDraftDto,
    PatchClientDraftDto,
} from "interface/dto/call-inbox.dto";
import { UpdateClientDto } from "interface/dto/client.dto";
import { createHash } from "node:crypto";

const DRAFT_STATUSES = ["PENDING", "CONFIRMED", "DISCARDED"] as const;

function assertPhoneProposalValues(proposals: ReadonlyArray<{ field: string; value: unknown }>): void {
    for (const proposal of proposals) {
        if (proposal.field !== "phone" || proposal.value === null || proposal.value === undefined) continue;
        if (typeof proposal.value !== "string") {
            throw new BadRequestException(INVALID_PHONE_MESSAGE);
        }
        try {
            assertValidPhone(proposal.value);
        } catch (error) {
            if (error instanceof InvalidPhoneError) {
                throw new BadRequestException(error.message);
            }
            throw error;
        }
    }
}

@Injectable()
export class CallInboxService {
    private readonly logger = new Logger(CallInboxService.name);

    constructor(
        private readonly prismaService: PrismaService,
        private readonly clientService: ClientService,
    ) {}

    private async validateNewClientFields(rawFields: unknown): Promise<ConfirmNewClientFieldsDto> {
        if (rawFields === null || typeof rawFields !== "object" || Array.isArray(rawFields)) {
            throw new BadRequestException("fields is required for NEW_CLIENT");
        }

        const fields = plainToInstance(ConfirmNewClientFieldsDto, rawFields);
        const errors = await validateDto(fields, {
            whitelist: true,
            forbidNonWhitelisted: true,
            forbidUnknownValues: true,
        });
        if (errors.length > 0) {
            const messages = errors.flatMap((error) => Object.values(error.constraints ?? {}));
            throw new BadRequestException({
                message: messages.length > 0 ? messages : ["Invalid NEW_CLIENT fields"],
            });
        }
        return fields;
    }

    // ── call records ──────────────────────────────────────────────

    async listCallRecords(branchId: string, page: number, limit: number, category?: string, search?: string) {
        const where = {
            branchId,
            ...(category ? { category } : {}),
            ...(search
                ? {
                    OR: [
                        { callerName: { contains: search, mode: 'insensitive' as const } },
                        { callerPhone: { contains: search.replace(/\D/g, "") || search } },
                        { fileName: { contains: search, mode: 'insensitive' as const } },
                        { draft: { requestSummary: { contains: search, mode: 'insensitive' as const } } },
                    ],
                }
                : {}),
        };
        const [rows, total] = await Promise.all([
            this.prismaService.call_record.findMany({
                where,
                orderBy: { createdAt: "desc" },
                skip: (page - 1) * limit,
                take: limit,
                include: {
                    matchedClient: { select: { id: true, name: true, phone: true } },
                    draft: { select: { id: true, type: true, status: true, requestSummary: true } },
                },
            }),
            this.prismaService.call_record.count({ where }),
        ]);
        return {
            data: rows.map((row) => this.toCallRecordListItem(row)),
            total, page, limit, totalPages: Math.ceil(total / limit),
        };
    }

    async getCallRecord(branchId: string, id: string) {
        const record = await this.prismaService.call_record.findFirst({
            where: { id, branchId },
            include: {
                matchedClient: { select: { id: true, name: true, phone: true } },
                draft: true,
            },
        });
        if (!record) throw new NotFoundException("Call record not found");
        return {
            ...this.toCallRecordListItem(record),
            transcript: record.transcript,
            summary: record.summary,
            driveFileId: record.driveFileId,
            driveUrl: `https://drive.google.com/file/d/${record.driveFileId}/view`,
            failureReason: record.failureReason,
            draft: record.draft,
        };
    }

    private toCallRecordListItem(row: {
        id: string; category: string | null; processingStatus: string;
        callerName: string | null; callerPhone: string | null; fileName: string;
        recordedAt: Date | null; createdAt: Date;
        matchedClient?: { id: number; name: string; phone: string | null } | null;
        draft?: { id: string; type: string; status: string; requestSummary: string } | null;
        summary?: unknown;
    }) {
        const summaryLine =
            row.draft?.requestSummary ??
            ((row.summary as { key_content?: string } | null)?.key_content ?? null);
        return {
            id: row.id,
            category: row.category,
            processingStatus: row.processingStatus,
            callerName: row.callerName,
            callerPhone: row.callerPhone,
            fileName: row.fileName,
            recordedAt: row.recordedAt,
            createdAt: row.createdAt,
            matchedClient: row.matchedClient ?? null,
            draft: row.draft
                ? { id: row.draft.id, type: row.draft.type, status: row.draft.status, requestSummary: row.draft.requestSummary }
                : null,
            summaryLine,
        };
    }

    // ── drafts ────────────────────────────────────────────────────

    async listDrafts(branchId: string, status: string, page: number, limit: number) {
        const safeStatus = DRAFT_STATUSES.includes(status as never) ? status : "PENDING";
        const where = { branchId, status: safeStatus };
        const [rows, total] = await Promise.all([
            this.prismaService.client_draft.findMany({
                where,
                orderBy: { createdAt: "desc" },
                skip: (page - 1) * limit,
                take: limit,
                include: {
                    callRecord: { select: { id: true, callerPhone: true, callerName: true, recordedAt: true } },
                    client: { select: { id: true, name: true, phone: true } },
                },
            }),
            this.prismaService.client_draft.count({ where }),
        ]);

        // duplicate/existing-phone flags (spec §10) — computed in memory per page
        const phones = rows
            .map((row) => row.callRecord.callerPhone)
            .filter((phone): phone is string => Boolean(phone));
        const branchClients = phones.length
            ? await this.prismaService.client.findMany({
                where: { branchId, phone: { not: null } },
                select: { id: true, phone: true },
            })
            : [];
        const clientPhoneSet = new Set(
            branchClients.map((c) => normalizePhone(c.phone)).filter(Boolean),
        );
        const phoneCounts = new Map<string, number>();
        for (const phone of phones) phoneCounts.set(phone, (phoneCounts.get(phone) ?? 0) + 1);

        return {
            data: rows.map((row) => ({
                id: row.id,
                type: row.type,
                status: row.status,
                requestSummary: row.requestSummary,
                callerName: row.callRecord.callerName,
                callerPhone: row.callRecord.callerPhone,
                recordedAt: row.callRecord.recordedAt,
                createdAt: row.createdAt,
                callRecordId: row.callRecordId,
                client: row.client,
                hasLowConfidence: ((row.proposals as { confidence?: string }[]) ?? []).some(
                    (proposal) => proposal.confidence === "low",
                ),
                possibleDuplicate: row.callRecord.callerPhone
                    ? (phoneCounts.get(row.callRecord.callerPhone) ?? 0) > 1
                    : false,
                phoneMatchesExistingClient:
                    row.type === "NEW_CLIENT" && row.callRecord.callerPhone
                        ? clientPhoneSet.has(row.callRecord.callerPhone)
                        : false,
            })),
            total, page, limit, totalPages: Math.ceil(total / limit),
        };
    }

    async countDrafts(branchId: string, status: string): Promise<{ count: number }> {
        const safeStatus = DRAFT_STATUSES.includes(status as never) ? status : "PENDING";
        const count = await this.prismaService.client_draft.count({
            where: { branchId, status: safeStatus },
        });
        return { count };
    }

    async getDraft(branchId: string, id: string) {
        const draft = await this.prismaService.client_draft.findFirst({
            where: { id, branchId },
            include: {
                callRecord: { include: { matchedClient: { select: { id: true, name: true, phone: true } } } },
                client: true,
                reviewedBy: { select: { id: true, name: true } },
            },
        });
        if (!draft) throw new NotFoundException("Draft not found");
        return draft;
    }

    async patchDraft(branchId: string, id: string, dto: PatchClientDraftDto) {
        await this.requirePendingDraft(branchId, id);
        if (dto.proposals !== undefined) assertPhoneProposalValues(dto.proposals);
        if (dto.clientId != null) {
            const client = await this.prismaService.client.findFirst({
                where: { id: dto.clientId, branchId },
                select: { id: true },
            });
            if (!client) throw new NotFoundException("Client not found in this branch");
        }
        await this.prismaService.client_draft.update({
            where: { id },
            data: {
                ...(dto.proposals !== undefined ? { proposals: dto.proposals as unknown as object[] } : {}),
                ...(dto.clientId !== undefined ? { clientId: dto.clientId } : {}),
            },
        });
        return this.getDraft(branchId, id);
    }

    /** Apply an approved patch at the same linearization point as its target check. */
    async patchDraftApprovedTarget(
        branchId: string,
        id: string,
        dto: PatchClientDraftDto,
        expectedTargetVersion: string,
    ) {
        if (dto.proposals !== undefined) assertPhoneProposalValues(dto.proposals);
        await this.prismaService.$transaction(async (transaction) => {
            await this.lockDraftForUpdate(transaction, branchId, id);
            const draft = await transaction.client_draft.findFirst({ where: { id, branchId } });
            if (!draft || draft.status !== "PENDING" || draftTargetVersion(draft) !== expectedTargetVersion) {
                throw new ConflictException("Draft changed after approval; review a new proposal");
            }
            if (dto.clientId != null) {
                const client = await transaction.client.findFirst({
                    where: { id: dto.clientId, branchId },
                    select: { id: true },
                });
                if (!client) throw new NotFoundException("Client not found in this branch");
            }
            await transaction.client_draft.update({
                where: { id },
                data: {
                    ...(dto.proposals !== undefined ? { proposals: dto.proposals as unknown as object[] } : {}),
                    ...(dto.clientId !== undefined ? { clientId: dto.clientId } : {}),
                },
            });
        });
        return this.getDraft(branchId, id);
    }

    async confirmNewClient(branchId: string, userId: string, id: string, dto: ConfirmNewClientDraftDto) {
        const draft = await this.requirePendingDraft(branchId, id);
        if (draft.type !== "NEW_CLIENT") {
            throw new NotImplementedException("CLIENT_UPDATE confirm ships in Phase 2");
        }
        const fields = await this.validateNewClientFields(dto.fields);
        return this.confirmNewClientWithDraft(branchId, userId, id, draft, {
            ...dto,
            fields,
        });
    }

    /** Claim a pending draft under a target-version lock before confirmation side effects. */
    async confirmApprovedTarget(
        branchId: string,
        userId: string,
        id: string,
        dto: ConfirmDraftDto,
        expectedTargetVersion: string,
    ) {
        const prepared = await this.prismaService.$transaction(async (transaction) => {
            // Validate NEW_CLIENT input before acquiring the row lock. The
            // second read below still protects the target-version check from
            // a concurrent draft change between validation and locking.
            const observed = await transaction.client_draft.findFirst({ where: { id, branchId } });
            if (!observed || observed.status !== "PENDING" || draftTargetVersion(observed) !== expectedTargetVersion) {
                throw new ConflictException("Draft changed after approval; review a new proposal");
            }
            const newClientFields = observed.type === "NEW_CLIENT"
                ? await this.validateNewClientFields(dto.fields)
                : undefined;
            const clientUpdateChanges = observed.type === "CLIENT_UPDATE"
                ? await this.prepareClientUpdateChanges(observed, dto.changes)
                : undefined;

            await this.lockDraftForUpdate(transaction, branchId, id);
            const current = await transaction.client_draft.findFirst({ where: { id, branchId } });
            if (!current || current.status !== "PENDING" || draftTargetVersion(current) !== expectedTargetVersion) {
                throw new ConflictException("Draft changed after approval; review a new proposal");
            }
            if (current.type === "NEW_CLIENT" && newClientFields === undefined) {
                throw new ConflictException("Draft changed after approval; review a new proposal");
            }
            if (current.type !== "NEW_CLIENT" && current.type !== "CLIENT_UPDATE") {
                throw new BadRequestException(`Unknown draft type: ${current.type}`);
            }
            const locked = await transaction.client_draft.updateMany({
                where: { id, branchId, status: "PENDING" },
                data: { status: "CONFIRMING", confirmingStartedAt: new Date() },
            });
            if (locked.count !== 1) throw new ConflictException("Draft already reviewed");
            return { draft: current, clientUpdateChanges, newClientFields };
        });

        if (prepared.draft.type === "NEW_CLIENT") {
            return this.confirmNewClientWithDraft(branchId, userId, id, prepared.draft, {
                fields: prepared.newClientFields!,
                suppressGreetingSms: dto.suppressGreetingSms,
            }, true);
        }
        if (prepared.draft.type === "CLIENT_UPDATE") {
            return this.confirmClientUpdate(branchId, userId, id, prepared.draft, prepared.clientUpdateChanges!, true);
        }
        throw new BadRequestException(`Unknown draft type: ${prepared.draft.type}`);
    }

    private async confirmNewClientWithDraft(
        branchId: string,
        userId: string,
        id: string,
        draft: { callRecordId: string },
        dto: { fields: ConfirmNewClientFieldsDto; suppressGreetingSms?: boolean },
        alreadyLocked = false,
    ) {
        // optimistic lock BEFORE side effects: only one caller flips PENDING→CONFIRMING.
        // confirmingStartedAt anchors the stuck-CONFIRMING sweep so a slow confirm
        // running shortly after a long-pending draft cannot be reverted mid-flight.
        if (!alreadyLocked) {
            const locked = await this.prismaService.client_draft.updateMany({
                where: { id, status: "PENDING" },
                data: { status: "CONFIRMING", confirmingStartedAt: new Date() },
            });
            if (locked.count === 0) {
                throw new ConflictException("Draft already reviewed");
            }
        }

        let createdClientId: number | null = null;
        try {
            const fields = dto.fields;
            const client = await this.clientService.create(branchId, {
                name: fields.name,
                address: fields.address ?? null,
                phone: fields.phone ?? null,
                type: fields.type ?? null,
                duration: fields.duration ?? null,
                fullPrice: fields.fullPrice ?? null,
                grant: fields.grant ?? null,
                actualPrice: fields.actualPrice ?? null,
                startDate: fields.startDate ?? null,
                endDate: fields.endDate ?? null,
                // Omission keeps the historical new-client default, while an
                // explicit null remains a clear for this nullable column.
                careCenter: fields.careCenter === undefined ? false : fields.careCenter,
                voucherClient: fields.voucherClient ?? false,
                birthday: fields.birthday ?? null,
                dueDate: fields.dueDate ?? null,
                birthDate: fields.birthDate ?? null,
                serviceStatus: fields.serviceStatus ?? null,
                breastPump: fields.breastPump ?? false,
                areaId: fields.areaId ?? null,
                primaryEmployeeId: fields.primaryEmployeeId ?? null,
                secondaryEmployeeId: fields.secondaryEmployeeId ?? null,
                suppressGreetingSms: dto.suppressGreetingSms ?? false,
            });
            createdClientId = client.id;

            await this.prismaService.client_draft.update({
                where: { id },
                data: { status: "CONFIRMED", clientId: client.id, reviewedById: userId, reviewedAt: new Date(), confirmingStartedAt: null },
            });
            await this.prismaService.call_record.update({
                where: { id: draft.callRecordId },
                data: { matchedClientId: client.id },
            });
            return { clientId: client.id };
        } catch (error) {
            if (createdClientId !== null) {
                // The client EXISTS — never roll back to PENDING (re-confirm would duplicate it).
                // Best-effort re-assert CONFIRMED; if even that fails the CONFIRMING sweep
                // surfaces the draft again and staff see the duplicate-phone warning.
                this.logger.error(
                    `Confirm bookkeeping failed after client ${createdClientId} was created for draft ${id}: ${error}`,
                );
                await this.prismaService.client_draft
                    .update({
                        where: { id },
                        data: { status: "CONFIRMED", clientId: createdClientId, reviewedById: userId, reviewedAt: new Date(), confirmingStartedAt: null },
                    })
                    .catch(() => undefined);
                return { clientId: createdClientId };
            }
            // create itself failed: roll the lock back so staff can fix input and retry
            await this.prismaService.client_draft
                .update({ where: { id }, data: { status: "PENDING", confirmingStartedAt: null } })
                .catch(() => undefined);
            throw error;
        }
    }

    /** Unified confirm entry-point: dispatches to NEW_CLIENT or CLIENT_UPDATE path */
    async confirm(branchId: string, userId: string, id: string, dto: ConfirmDraftDto) {
        const draft = await this.requirePendingDraft(branchId, id);
        if (draft.type === "NEW_CLIENT") {
            const fields = await this.validateNewClientFields(dto.fields);
            return this.confirmNewClientWithDraft(branchId, userId, id, draft, {
                fields,
                suppressGreetingSms: dto.suppressGreetingSms,
            });
        }
        if (draft.type === "CLIENT_UPDATE") {
            if (!dto.changes || typeof dto.changes !== "object" || Array.isArray(dto.changes)) {
                throw new BadRequestException("changes is required for CLIENT_UPDATE");
            }
            return this.confirmClientUpdate(branchId, userId, id, draft, dto.changes);
        }
        throw new BadRequestException(`Unknown draft type: ${draft.type}`);
    }

    private async confirmClientUpdate(
        branchId: string,
        userId: string,
        id: string,
        draft: { clientId: number | null; callRecordId: string },
        rawChanges: Record<string, unknown>,
        alreadyLocked = false,
    ) {
        // Approved-target callers pass the prepared payload from the locked
        // transaction. Re-validating here would introduce deterministic throws
        // after PENDING→CONFIRMING and could strand the claim outside rollback.
        const filteredChanges = alreadyLocked
            ? rawChanges
            : await this.prepareClientUpdateChanges(draft, rawChanges);
        // `prepareClientUpdateChanges` validates this for the ordinary path;
        // the approved path supplies the same invariant from its locked
        // transaction. Do not rethrow after the claim has been committed.
        const clientId = draft.clientId as number;

        // c. optimistic lock PENDING → CONFIRMING.
        // confirmingStartedAt anchors the stuck-CONFIRMING sweep against this transition,
        // not the draft's createdAt, so an in-flight confirm cannot be reverted by the
        // sweep just because the draft has been sitting around for a while.
        if (!alreadyLocked) {
            const locked = await this.prismaService.client_draft.updateMany({
                where: { id, status: "PENDING" },
                data: { status: "CONFIRMING", confirmingStartedAt: new Date() },
            });
            if (locked.count === 0) {
                throw new ConflictException("Draft already reviewed");
            }
        }

        let updateApplied = false;
        try {
            // d. apply the changes via the validated update path
            await this.clientService.update(branchId, clientId, filteredChanges as Parameters<typeof this.clientService.update>[2]);
            updateApplied = true;

            // e. mark CONFIRMED
            await this.prismaService.client_draft.update({
                where: { id },
                data: { status: "CONFIRMED", reviewedById: userId, reviewedAt: new Date(), confirmingStartedAt: null },
            });
            return { clientId };
        } catch (error) {
            if (updateApplied) {
                // f. update succeeded but bookkeeping failed — never revert to PENDING
                this.logger.error(
                    `Confirm bookkeeping failed after changes applied to client ${clientId} for draft ${id}: ${error}`,
                );
                await this.prismaService.client_draft
                    .update({
                        where: { id },
                        data: { status: "CONFIRMED", reviewedById: userId, reviewedAt: new Date(), confirmingStartedAt: null },
                    })
                    .catch(() => undefined);
                return { clientId };
            }
            // update itself failed — roll back lock
            await this.prismaService.client_draft
                .update({ where: { id }, data: { status: "PENDING", confirmingStartedAt: null } })
                .catch(() => undefined);
            throw error;
        }
    }

    private async prepareClientUpdateChanges(
        draft: { clientId: number | null },
        rawChanges: unknown,
    ): Promise<Record<string, unknown>> {
        if (draft.clientId == null) {
            throw new ConflictException("고객 연결이 필요합니다");
        }
        if (!rawChanges || typeof rawChanges !== "object" || Array.isArray(rawChanges)) {
            throw new BadRequestException("changes is required for CLIENT_UPDATE");
        }
        const allowedSet = new Set<string>(PROPOSAL_FIELDS);
        const filteredChanges: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(rawChanges)) {
            // JSON omission and an explicit null are different operations. An
            // own property whose value is undefined cannot be sent over the
            // wire, so treat it as omitted as well and never forward it to the
            // update path.
            if (allowedSet.has(key) && value !== undefined) filteredChanges[key] = value;
        }
        if (Object.keys(filteredChanges).length === 0) {
            throw new BadRequestException("No valid fields remain after allowlist filtering");
        }

        for (const field of ["name", "voucherClient", "breastPump"] as const) {
            if (Object.prototype.hasOwnProperty.call(filteredChanges, field) && filteredChanges[field] === null) {
                throw new BadRequestException(`${field} cannot be null`);
            }
        }

        // Reuse the canonical client-update validators after allowlist
        // filtering. Unknown fields remain intentionally ignored for the
        // call-inbox contract, while malformed allowed fields fail before the
        // draft claim or any client/message side effect.
        const candidate = plainToInstance(UpdateClientDto, filteredChanges);
        const errors = await validateDto(candidate, {
            whitelist: true,
            forbidNonWhitelisted: true,
            forbidUnknownValues: true,
        });
        if (errors.length > 0) {
            const messages = errors.flatMap((error) => Object.values(error.constraints ?? {}));
            throw new BadRequestException({
                message: messages.length > 0 ? messages : ["Invalid CLIENT_UPDATE changes"],
            });
        }
        return filteredChanges;
    }

    async discard(branchId: string, userId: string, id: string, reason?: string) {
        await this.requirePendingDraft(branchId, id);
        const locked = await this.prismaService.client_draft.updateMany({
            where: { id, status: "PENDING" },
            data: { status: "DISCARDED" },
        });
        if (locked.count === 0) throw new ConflictException("Draft already reviewed");
        await this.prismaService.client_draft.update({
            where: { id },
            data: { status: "DISCARDED", discardReason: reason ?? null, reviewedById: userId, reviewedAt: new Date() },
        });
        return { id, status: "DISCARDED" };
    }

    private async requirePendingDraft(branchId: string, id: string) {
        const draft = await this.prismaService.client_draft.findFirst({
            where: { id, branchId },
            include: { callRecord: { select: { id: true, callerPhone: true, callerName: true } } },
        });
        if (!draft) throw new NotFoundException("Draft not found");
        if (draft.status !== "PENDING") throw new ConflictException("Draft already reviewed");
        return draft;
    }

    private async lockDraftForUpdate(transaction: unknown, branchId: string, id: string): Promise<void> {
        const rawTransaction = transaction as {
            $queryRawUnsafe?: (query: string, ...values: unknown[]) => Promise<unknown>;
        };
        if (typeof rawTransaction.$queryRawUnsafe !== "function") return;
        await rawTransaction.$queryRawUnsafe(
            'SELECT "id" FROM "client_draft" WHERE "id" = $1 AND "branch_id" = $2 FOR UPDATE',
            id,
            branchId,
        );
    }
}

function draftTargetVersion(value: unknown): string {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
