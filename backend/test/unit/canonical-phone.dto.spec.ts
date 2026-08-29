import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { ConfirmNewClientFieldsDto, ProposalDto } from "interface/dto/call-inbox.dto";
import { CreateClientDto, UpdateClientDto } from "interface/dto/client.dto";
import { ReRequestOutsiderDocumentRequestDto } from "interface/dto/eformsign.dto";
import { EformsignDocumentJobContractDataDto } from "interface/dto/eformsign-document-job.dto";
import { CreateEmployeeDto, UpdateEmployeeDto } from "interface/dto/employee.dto";

async function validationErrors<T extends object>(type: new () => T, payload: object) {
    return validate(plainToInstance(type, payload), {
        whitelist: true,
        forbidNonWhitelisted: true,
    });
}

describe("canonical phone write DTOs", () => {
    it("rejects malformed client phones but converts a blank nullable value to null", async () => {
        const createErrors = await validationErrors(CreateClientDto, {
            name: "고객",
            phone: "not-a-phone",
            voucherClient: false,
            breastPump: false,
        });
        expect(createErrors.some((error) => error.property === "phone")).toBe(true);

        const blank = plainToInstance(UpdateClientDto, { phone: "   " });
        expect(blank.phone).toBeNull();
        await expect(validate(blank)).resolves.toEqual([]);
    });

    it("rejects blank or malformed employee phones on create and update", async () => {
        const createErrors = await validationErrors(CreateEmployeeDto, {
            name: "직원",
            workArea: ["서울"],
            phone: "   ",
            grade: "스탠다드",
            openToNextWork: false,
        });
        expect(createErrors.some((error) => error.property === "phone")).toBe(true);

        const updateErrors = await validationErrors(UpdateEmployeeDto, { phone: "not-a-phone" });
        expect(updateErrors.some((error) => error.property === "phone")).toBe(true);
        const nullErrors = await validationErrors(UpdateEmployeeDto, { phone: null });
        expect(nullErrors.some((error) => error.property === "phone")).toBe(true);
    });

    it("rejects malformed phones in call proposals, confirmation fields, and eform re-request", async () => {
        const proposalErrors = await validationErrors(ProposalDto, {
            field: "phone",
            value: "bad",
            evidence: "e",
            confidence: "high",
        });
        expect(proposalErrors.some((error) => error.property === "value")).toBe(true);

        const confirmationErrors = await validationErrors(ConfirmNewClientFieldsDto, {
            name: "고객",
            phone: "bad",
            voucherClient: false,
            breastPump: false,
        });
        expect(confirmationErrors.some((error) => error.property === "phone")).toBe(true);

        const requestErrors = await validationErrors(ReRequestOutsiderDocumentRequestDto, {
            stepType: "05",
            stepSeq: "1",
            recipientPhone: { countryCode: "+82", phoneNumber: "bad" },
        });
        expect(requestErrors.some((error) => error.property === "recipientPhone")).toBe(true);
    });

    it("rejects malformed phones in queued eform contract data", async () => {
        const customerErrors = await validationErrors(EformsignDocumentJobContractDataDto, {
            customerContact: "bad",
            caretaker1Contact: "010-1111-2222",
        });
        expect(customerErrors.some((error) => error.property === "customerContact")).toBe(true);

        const caretakerErrors = await validationErrors(EformsignDocumentJobContractDataDto, {
            customerContact: "010-1111-2222",
            caretaker1Contact: "bad",
        });
        expect(caretakerErrors.some((error) => error.property === "caretaker1Contact")).toBe(true);

        const issuerErrors = await validationErrors(EformsignDocumentJobContractDataDto, {
            customerContact: "010-1111-2222",
            caretaker1Contact: "010-3333-4444",
            issuerPhone: "bad",
        });
        expect(issuerErrors.some((error) => error.property === "issuerPhone")).toBe(true);
    });
});
