import { buildContractAutoRegistrationPayload } from "../contract-auto-registration";

describe("buildContractAutoRegistrationPayload", () => {
  it("preserves selected employees and delegates auto-registration policy to the backend", () => {
    const payload = buildContractAutoRegistrationPayload({
      name: "홍길동",
      phone: "010-1234-5678",
      birthday: "900101",
      address: "인천시 남동구",
      dueDate: "2026-08-01",
      startDate: "2026-08-03",
      endDate: "2026-08-14",
      primaryEmployeeId: 17,
      secondaryEmployeeId: 23,
    });

    expect(payload).toEqual({
      name: "홍길동",
      phone: "010-1234-5678",
      birthday: "900101",
      address: "인천시 남동구",
      dueDate: "2026-08-01",
      startDate: "2026-08-03",
      endDate: "2026-08-14",
      primaryEmployeeId: 17,
      secondaryEmployeeId: 23,
      careCenter: false,
      voucherClient: true,
      breastPump: false,
      source: "contract_auto_registration",
    });
    expect(payload).not.toHaveProperty("suppressGreetingSms");
  });
});
