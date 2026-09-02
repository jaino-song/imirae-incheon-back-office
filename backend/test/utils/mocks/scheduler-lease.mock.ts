import type { SchedulerLeaseService } from "application/services/scheduler-lease.service";

export function createSchedulerLeaseMock(
    held = true,
): SchedulerLeaseService & { holdsLease: jest.Mock<boolean, []> } {
    return {
        holdsLease: jest.fn(() => held),
    } as unknown as SchedulerLeaseService & { holdsLease: jest.Mock<boolean, []> };
}
