import { ClientEntity } from "domain/entities/client.entity";

function createClient(phone: string | null = "010-1234-5678"): ClientEntity {
    return ClientEntity.create({
        name: "테스트 고객",
        address: "인천",
        phone,
        type: "A",
        duration: 10,
        fullPrice: "100000",
        grant: null,
        actualPrice: "100000",
        startDate: null,
        endDate: null,
        careCenter: false,
        voucherClient: false,
        birthday: null,
        dueDate: null,
        birthDate: null,
        serviceStatus: "waiting",
        breastPump: false,
        eDocId: null,
    });
}

describe("ClientEntity canonical phone identity", () => {
    it("keeps the display phone while deriving a canonical key", () => {
        const client = createClient();

        expect(client.phone).toBe("010-1234-5678");
        expect(client.phoneNormalized).toBe("01012345678");
    });

    it("updates the canonical key when a phone is changed or cleared", () => {
        const client = createClient();

        client.update({ phone: " +82 10 1234 5678 " });
        expect(client.phone).toBe(" +82 10 1234 5678 ");
        expect(client.phoneNormalized).toBe("01012345678");

        client.update({ phone: null });
        expect(client.phone).toBeNull();
        expect(client.phoneNormalized).toBeNull();
    });

    it("preserves an explicitly persisted null key for an invalid legacy value", () => {
        const client = ClientEntity.reconstitute(
            1,
            "레거시 고객",
            null,
            "전화번호 없음",
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            false,
            false,
            null,
            null,
            null,
            false,
            null,
            null,
            null,
            "branch-a",
            false,
            null,
            null,
        );

        expect(client.phoneNormalized).toBeNull();
    });

    it("rejects malformed phone values on create and update without partial mutation", () => {
        expect(() => createClient("not-a-phone")).toThrow("올바른 국내 전화번호 형식이 아닙니다.");

        const client = createClient();
        expect(() => client.update({ phone: "not-a-phone", name: "unchanged" })).toThrow("올바른 국내 전화번호 형식이 아닙니다.");
        expect(client.phone).toBe("010-1234-5678");
        expect(client.phoneNormalized).toBe("01012345678");
    });
});
