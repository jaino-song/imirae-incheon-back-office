import { Logger } from "@nestjs/common";

import { ServiceRecordSecurityEventService } from "application/services/service-record-security-event.service";

describe("ServiceRecordSecurityEventService", () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("emits only redacted identifiers and counters, never phone or token material", () => {
        const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
        const service = new ServiceRecordSecurityEventService();

        service.emit({
            outcome: "challenge_failed",
            branchId: "branch-1",
            scheduleId: 10,
            employeeId: 7,
            tokenId: "row-token-id",
            failedAttempts: 3,
        });

        expect(warn).toHaveBeenCalledTimes(1);
        const payload = JSON.parse(String(warn.mock.calls[0]?.[0]));
        expect(payload).toMatchObject({
            event: "service_record_phone_challenge",
            outcome: "challenge_failed",
            tokenId: "row-token-id",
            failedAttempts: 3,
        });
        expect(JSON.stringify(payload)).not.toContain("010-1111-2222");
        expect(JSON.stringify(payload)).not.toContain("efl_secret_link");
        expect(payload).not.toHaveProperty("phone");
        expect(payload).not.toHaveProperty("linkToken");
        expect(payload).not.toHaveProperty("accessToken");
    });
});
