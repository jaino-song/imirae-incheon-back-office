import { BadRequestException } from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import {
    assertClientDurationMatchesDates,
    deriveClientDuration,
} from "application/usecases/client/client-write-validation";
import { ClientEntity } from "domain/entities/client.entity";
import { ConfirmNewClientFieldsDto } from "interface/dto/call-inbox.dto";
import { CreateClientDto } from "interface/dto/client.dto";

const requiredClientProps = {
    name: "홍길동",
    address: "서울",
    phone: "010-1234-5678",
    type: "A가1형",
    duration: 6,
    startDate: new Date("2026-08-03T00:00:00.000Z"),
    endDate: new Date("2026-08-10T00:00:00.000Z"),
    careCenter: false,
    voucherClient: true,
    birthday: "900101",
    dueDate: null,
    birthDate: null,
    serviceStatus: "active",
    breastPump: false,
    eDocId: null,
};

describe("client pricing and service-period invariants", () => {
    it("accepts formatted whole-won DTO input but rejects decimals and trailing text", async () => {
        const valid = plainToInstance(CreateClientDto, {
            name: "홍길동",
            voucherClient: true,
            breastPump: false,
            fullPrice: " 1,000원 ",
            grant: "0",
            actualPrice: "1,000",
        });
        expect(valid.fullPrice).toBe("1,000원");
        expect(await validate(valid)).toHaveLength(0);

        const callInboxValid = plainToInstance(ConfirmNewClientFieldsDto, {
            name: "홍길동",
            fullPrice: " 1,000원 ",
            grant: "0",
            actualPrice: "1,000",
        });
        expect(callInboxValid.fullPrice).toBe("1,000원");
        expect(await validate(callInboxValid)).toHaveLength(0);

        for (const fullPrice of ["1000abc", "1000.50", "1,00"]) {
            const invalid = plainToInstance(CreateClientDto, {
                name: "홍길동",
                voucherClient: true,
                breastPump: false,
                fullPrice,
            });
            const errors = await validate(invalid);
            expect(errors.find((error) => error.property === "fullPrice")).toBeDefined();

            const callInboxInvalid = plainToInstance(ConfirmNewClientFieldsDto, {
                name: "홍길동",
                fullPrice,
            });
            const callInboxErrors = await validate(callInboxInvalid);
            expect(callInboxErrors.find((error) => error.property === "fullPrice")).toBeDefined();
        }
    });

    it("stores canonical prices and normalizes legacy grouped rows at entity boundaries", () => {
        const entity = ClientEntity.create({
            ...requiredClientProps,
            fullPrice: "1,000원",
            grant: "500원",
            actualPrice: "500",
        });
        expect(entity.fullPrice).toBe("1000");
        expect(entity.grant).toBe("500");
        expect(entity.actualPrice).toBe("500");

        entity.update({ fullPrice: "2,000원" });
        expect(entity.fullPrice).toBe("2000");
        expect(() => ClientEntity.create({
            ...requiredClientProps,
            fullPrice: "1000abc",
            grant: "0",
            actualPrice: "1000",
        })).toThrow("Invalid Korean won amount");
        expect(() => ClientEntity.create({
            ...requiredClientProps,
            duration: 5,
            fullPrice: "1000",
            grant: "0",
            actualPrice: "1000",
        })).toThrow("duration must equal the Korean business-day count (6)");
        const legacyFormatted = ClientEntity.reconstitute(
            1,
            requiredClientProps.name,
            requiredClientProps.address,
            requiredClientProps.phone,
            requiredClientProps.type,
            requiredClientProps.duration,
            "1,000",
            "0",
            "1000",
            requiredClientProps.startDate,
            requiredClientProps.endDate,
            requiredClientProps.careCenter,
            requiredClientProps.voucherClient,
            requiredClientProps.birthday,
            requiredClientProps.dueDate,
            requiredClientProps.serviceStatus,
            requiredClientProps.breastPump,
            requiredClientProps.eDocId,
        );
        expect(legacyFormatted.fullPrice).toBe("1000");
        expect(() => ClientEntity.reconstitute(
            1,
            requiredClientProps.name,
            requiredClientProps.address,
            requiredClientProps.phone,
            requiredClientProps.type,
            requiredClientProps.duration,
            "1000abc",
            "0",
            "1000",
            requiredClientProps.startDate,
            requiredClientProps.endDate,
            requiredClientProps.careCenter,
            requiredClientProps.voucherClient,
            requiredClientProps.birthday,
            requiredClientProps.dueDate,
            requiredClientProps.serviceStatus,
            requiredClientProps.breastPump,
            requiredClientProps.eDocId,
        )).toThrow("Invalid Korean won amount");
    });

    it("derives one inclusive Korean business-day duration and rejects mismatches", () => {
        const start = new Date("2026-08-03T00:00:00.000Z");
        const end = new Date("2026-08-10T00:00:00.000Z");
        expect(deriveClientDuration(start, end)).toBe(6);
        expect(() => assertClientDurationMatchesDates(5, 6))
            .toThrow(BadRequestException);
        expect(() => deriveClientDuration(
            new Date("2028-01-03T00:00:00.000Z"),
            new Date("2028-01-04T00:00:00.000Z"),
        )).toThrow(BadRequestException);
        expect(() => deriveClientDuration(end, start)).toThrow(BadRequestException);
    });

    it("re-derives entity duration for date patches and clears stale values", () => {
        const entity = ClientEntity.create({
            ...requiredClientProps,
            fullPrice: "1000",
            grant: "0",
            actualPrice: "1000",
        });

        entity.update({ endDate: new Date("2026-08-11T00:00:00.000Z") });
        expect(entity.duration).toBe(7);

        expect(() => entity.update({ duration: 6 }))
            .toThrow("duration must equal the Korean business-day count (7)");
        expect(entity.duration).toBe(7);
        entity.update({ duration: 7 });
        expect(entity.duration).toBe(7);

        entity.duration = 1;
        entity.update({ name: "프로필만 변경" });
        expect(entity.duration).toBe(7);

        const beforeInvalidPatch = {
            startDate: entity.startDate,
            endDate: entity.endDate,
            duration: entity.duration,
        };
        expect(() => entity.update({
            endDate: new Date("2026-08-01T00:00:00.000Z"),
            duration: 1,
        })).toThrow();
        expect(entity.startDate).toEqual(beforeInvalidPatch.startDate);
        expect(entity.endDate).toEqual(beforeInvalidPatch.endDate);
        expect(entity.duration).toBe(beforeInvalidPatch.duration);

        entity.update({ endDate: null });
        expect(entity.endDate).toBeNull();
        expect(entity.duration).toBeNull();
    });

    it("rejects a stale pre-booking duration when the missing date completes the range", () => {
        const prebooking = ClientEntity.create({
            ...requiredClientProps,
            duration: 5,
            endDate: null,
            fullPrice: "1000",
            grant: "0",
            actualPrice: "1000",
        });

        expect(() => prebooking.update({
            endDate: requiredClientProps.endDate,
        })).toThrow("duration must equal the Korean business-day count (6)");
        expect(prebooking.endDate).toBeNull();
        expect(prebooking.duration).toBe(5);

        prebooking.update({
            endDate: requiredClientProps.endDate,
            duration: 6,
        });
        expect(prebooking.endDate).toEqual(requiredClientProps.endDate);
        expect(prebooking.duration).toBe(6);
    });
});
