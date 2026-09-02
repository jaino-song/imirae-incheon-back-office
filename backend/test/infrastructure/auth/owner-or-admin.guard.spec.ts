import { ExecutionContext } from "@nestjs/common";
import { OwnerOrAdminGuard } from "infrastructure/auth/owner-or-admin.guard";

describe("OwnerOrAdminGuard", () => {
    const guard = new OwnerOrAdminGuard();

    const contextFor = (request: Record<string, unknown>): ExecutionContext => ({
        switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext);

    it.each([
        ["owner", { globalRole: "owner", branchRole: "owner" }],
        ["branch admin", { globalRole: "user", branchRole: "admin" }],
    ])("allows %s principal", (_label, tenant) => {
        expect(guard.canActivate(contextFor({ tenant }))).toBe(true);
    });

    it.each([
        ["branch manager", { globalRole: "user", branchRole: "manager" }],
        ["branch user", { globalRole: "user", branchRole: "user" }],
    ])("denies %s principal", (_label, tenant) => {
        expect(guard.canActivate(contextFor({ tenant }))).toBe(false);
    });
});
