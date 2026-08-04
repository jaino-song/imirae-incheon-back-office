import { CAPABILITY_CATALOG_BY_NAME } from "./capability-catalog";

describe("capability catalog", () => {
    it("keeps voucher pricing restricted to its provider roles", () => {
        expect(CAPABILITY_CATALOG_BY_NAME.get("vouchers.prices")?.requiredRoles).toEqual(["owner", "admin", "manager"]);
    });
});
