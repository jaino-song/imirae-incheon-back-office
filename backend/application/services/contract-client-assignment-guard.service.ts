import { BadRequestException, Injectable } from "@nestjs/common";
import { normalizePhone } from "application/utils/normalize-phone";
import { SERVICE_STATUS } from "domain/value-objects/service-status.vo";
import { PrismaService } from "infrastructure/database/prisma.service";

const NO_ASSIGNMENT_MESSAGE = "고객의 제공인력 배정을 먼저 저장해 주세요.";
const PROVIDER_MISMATCH_MESSAGE = "전자문서의 제공인력과 고객 배정 정보가 일치하지 않습니다.";
const TERMINATED_SERVICE_MESSAGE = "해지된 고객에게는 전자문서를 발송할 수 없습니다.";

type AssignedSchedule = {
    id: number;
    terminatedAt: Date | null;
    primaryEmployee: { phone: string | null };
};

@Injectable()
export class ContractClientAssignmentGuardService {
    constructor(private readonly prisma: PrismaService) {}

    /**
     * Ownership check only — deliberately blind to termination.
     *
     * The finalize path uses this to confirm that an already in-flight document
     * belongs to the client it claims, and an early-terminated client's signed
     * contract must still be finalizable: a contract the 산모 already signed is not
     * voided by termination, and the nightly auto-finalize cron would otherwise burn
     * its attempts and strand that document at review stage 070 forever. Send-side
     * callers want {@link assertLiveAssignedClient} instead.
     */
    async assertAssignedClient(branchId: string, clientId: number): Promise<{ scheduleId: number }> {
        const schedule = await this.requireAssignedSchedule(branchId, clientId);
        return { scheduleId: schedule.id };
    }

    /** Ownership plus provider identity. Blind to termination, same as above. */
    async assertAssignedProvider(
        branchId: string,
        clientId: number,
        providerPhone: string | null | undefined,
    ): Promise<{ scheduleId: number }> {
        const schedule = await this.requireAssignedSchedule(branchId, clientId);
        this.assertProviderMatches(schedule, providerPhone);
        return { scheduleId: schedule.id };
    }

    /**
     * Send-side variant: ownership plus liveness.
     *
     * Sending a NEW contract to a client whose service is over is always wrong, and
     * nothing else on the send path stops it — the assignment lookup has never had a
     * date bound, so a terminated schedule was returned before `terminated_at` existed
     * too. This is the predicate that closes it, kept separate from the ownership
     * check above because the finalize path must NOT inherit it.
     */
    async assertLiveAssignedClient(branchId: string, clientId: number): Promise<{ scheduleId: number }> {
        const schedule = await this.requireAssignedSchedule(branchId, clientId);
        await this.assertServiceLive(branchId, clientId, schedule);
        return { scheduleId: schedule.id };
    }

    /** Send-side variant of {@link assertAssignedProvider}: liveness, then identity. */
    async assertLiveAssignedProvider(
        branchId: string,
        clientId: number,
        providerPhone: string | null | undefined,
    ): Promise<{ scheduleId: number }> {
        const schedule = await this.requireAssignedSchedule(branchId, clientId);
        // Liveness first: on a terminated service a provider mismatch is the less
        // useful of the two answers, and the assigned provider on a terminated row is
        // not who anyone would be sending to anyway.
        await this.assertServiceLive(branchId, clientId, schedule);
        this.assertProviderMatches(schedule, providerPhone);
        return { scheduleId: schedule.id };
    }

    private async requireAssignedSchedule(branchId: string, clientId: number): Promise<AssignedSchedule> {
        const schedule = await this.findActiveSchedule(branchId, clientId);
        if (!schedule) {
            throw new BadRequestException(NO_ASSIGNMENT_MESSAGE);
        }
        return schedule;
    }

    private assertProviderMatches(
        schedule: AssignedSchedule,
        providerPhone: string | null | undefined,
    ): void {
        const expectedPhone = normalizePhone(providerPhone ?? null);
        const assignedPhone = normalizePhone(schedule.primaryEmployee.phone);
        if (!expectedPhone || !assignedPhone || expectedPhone !== assignedPhone) {
            throw new BadRequestException(PROVIDER_MISMATCH_MESSAGE);
        }
    }

    /**
     * Two independent termination signals, because two independent paths write them.
     * `terminateService` stamps `employee_schedule.terminated_at`, but an operator can
     * also flip `serviceStatus` to 중단 through the ordinary client update, which
     * touches no schedule row. Either one means the service is over.
     */
    private async assertServiceLive(
        branchId: string,
        clientId: number,
        schedule: AssignedSchedule,
    ): Promise<void> {
        if (schedule.terminatedAt) {
            throw new BadRequestException(TERMINATED_SERVICE_MESSAGE);
        }

        // Read the client fresh rather than trusting a caller-supplied snapshot: an
        // approval-bound agent call carries an immutable target version that can
        // predate the termination it is being checked against.
        const client = await this.prisma.client.findFirst({
            where: { id: clientId, branchId },
            select: { serviceStatus: true },
        });
        if (client?.serviceStatus === SERVICE_STATUS.TERMINATED) {
            throw new BadRequestException(TERMINATED_SERVICE_MESSAGE);
        }
    }

    private findActiveSchedule(branchId: string, clientId: number) {
        return this.prisma.employee_schedule.findFirst({
            where: { clientId, branchId, replaced: false },
            orderBy: { id: "desc" },
            select: {
                id: true,
                // Selected for the send-side liveness check only. Widening the select
                // cannot change which row comes back, so the ownership callers above
                // are unaffected.
                terminatedAt: true,
                primaryEmployee: { select: { phone: true } },
            },
        });
    }
}
