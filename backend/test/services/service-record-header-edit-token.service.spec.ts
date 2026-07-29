import { JwtService } from "@nestjs/jwt";

import { ServiceRecordHeaderEditTokenService } from "application/services/service-record-header-edit-token.service";

const BRANCH_ID = "11111111-1111-1111-1111-111111111111";

describe("ServiceRecordHeaderEditTokenService", () => {
    const jwt = new JwtService({ secret: "service-record-header-edit-test-secret" });
    const service = new ServiceRecordHeaderEditTokenService(jwt);

    it("issues a short-lived header-only capability and resolves its scoped context", async () => {
        const issued = await service.issue({
            branchId: BRANCH_ID,
            scheduleId: 10,
            employeeId: 20,
            serviceRecordCaseId: "case-1",
            linkToken: "efl_link_token",
            issuedBy: "admin-1",
        });

        await expect(service.resolve(issued.token)).resolves.toEqual({
            tokenId: expect.stringMatching(/^admin-header-edit:/),
            branchId: BRANCH_ID,
            scheduleId: 10,
            employeeId: 20,
            serviceRecordCaseId: "case-1",
            accessMode: "admin_header_edit",
            linkToken: "efl_link_token",
        });
        expect(issued.expiresAt.getTime()).toBeGreaterThan(Date.now());
        expect(issued.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 5 * 60 * 1000);
    });

    it("rejects a tampered capability", async () => {
        const issued = await service.issue({
            branchId: BRANCH_ID,
            scheduleId: 10,
            employeeId: 20,
            linkToken: "efl_link_token",
            issuedBy: "admin-1",
        });

        await expect(service.resolve(`${issued.token}tampered`)).resolves.toBeNull();
    });
});
