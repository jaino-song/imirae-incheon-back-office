import { api } from "@/lib/api/client";

import { updateSystemAdminUserAccount } from "./users";

jest.mock("@/lib/api/client", () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
  },
}));

const mockPatch = api.patch as jest.Mock;

describe("updateSystemAdminUserAccount", () => {
  beforeEach(() => {
    mockPatch.mockReset();
    mockPatch.mockResolvedValue({ data: undefined });
  });

  it("encodes the dynamic account id in the client request path", async () => {
    const input = {
      role: "manager" as const,
      branchIds: ["11111111-1111-4111-8111-111111111111"],
      expectedRole: "user" as const,
      expectedBranchIds: ["11111111-1111-4111-8111-111111111111"],
    };

    await updateSystemAdminUserAccount("account id/with?reserved", input);

    expect(mockPatch).toHaveBeenCalledWith(
      "/users/account%20id%2Fwith%3Freserved/account-assignment",
      input,
    );
  });
});
