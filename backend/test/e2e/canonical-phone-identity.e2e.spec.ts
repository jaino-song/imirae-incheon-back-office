import { PrismaClient } from "@prisma/client";

import { ClientEntity } from "domain/entities/client.entity";
import { EmployeeEntity } from "domain/entities/employee.entity";
import { normalizePhone } from "domain/utils/normalize-phone";
import { SbClientRepository } from "infrastructure/database/repositories/sb.client.repository";
import { SbEmployeeRepository } from "infrastructure/database/repositories/sb.employee.repository";

const describeE2E = process.env["E2E_CANONICAL_PHONE_IDENTITY"] === "1" ? describe : describe.skip;

const prisma = new PrismaClient();
const clientRepository = new SbClientRepository(prisma as never);
const employeeRepository = new SbEmployeeRepository(prisma as never);

function createClient(phone: string): ClientEntity {
    return ClientEntity.create({
        name: `canonical-client-${phone}`,
        address: null,
        phone,
        type: null,
        duration: null,
        fullPrice: null,
        grant: null,
        actualPrice: null,
        startDate: null,
        endDate: null,
        careCenter: null,
        voucherClient: false,
        birthday: null,
        dueDate: null,
        birthDate: null,
        serviceStatus: null,
        breastPump: false,
        eDocId: null,
    });
}

function createEmployee(phone: string): EmployeeEntity {
    return EmployeeEntity.create(
        `canonical-employee-${phone}`,
        ["E2E"],
        phone,
        "베스트",
        true,
    );
}

function isUniqueViolation(error: unknown): boolean {
    return typeof error === "object"
        && error !== null
        && "code" in error
        && error.code === "P2002";
}

describeE2E("canonical phone identity (real PostgreSQL)", () => {
    let branchId: string;
    const clientIds: number[] = [];
    const employeeIds: number[] = [];

    beforeAll(async () => {
        await prisma.$connect();
        const branch = await prisma.branch.create({
            data: {
                name: "Canonical phone E2E",
                slug: `canonical-phone-${process.pid}-${Date.now()}`,
            },
            select: { id: true },
        });
        branchId = branch.id;
    });

    afterAll(async () => {
        if (clientIds.length > 0) {
            await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
        }
        if (employeeIds.length > 0) {
            await prisma.employee.deleteMany({ where: { id: { in: employeeIds } } });
        }
        if (branchId) {
            await prisma.branch.delete({ where: { id: branchId } });
        }
        await prisma.$disconnect();
    });

    it("allows one concurrent client create for formatting-equivalent phones", async () => {
        const attempts = [
            createClient("010-1234-5678"),
            createClient("+82 10 1234 5678"),
        ];
        expect(attempts.map((entity) => entity.phoneNormalized)).toEqual([
            "01012345678",
            "01012345678",
        ]);

        const results = await Promise.allSettled(
            attempts.map((entity) => clientRepository.create(branchId, entity)),
        );
        const successes = results.filter((result): result is PromiseFulfilledResult<ClientEntity> => result.status === "fulfilled");
        const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");

        expect(successes).toHaveLength(1);
        expect(failures).toHaveLength(1);
        expect(isUniqueViolation(failures[0]?.reason)).toBe(true);
        clientIds.push(...successes.map((result) => result.value.id));
    });

    it("rejects concurrent employee create collisions on the canonical key", async () => {
        const attempts = [
            createEmployee("010-2233-4455"),
            createEmployee("+82 10 2233 4455"),
        ];
        const results = await Promise.allSettled(
            attempts.map((entity) => employeeRepository.create(branchId, entity)),
        );
        const successes = results.filter((result): result is PromiseFulfilledResult<EmployeeEntity> => result.status === "fulfilled");
        const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");

        expect(successes).toHaveLength(1);
        expect(failures).toHaveLength(1);
        expect(isUniqueViolation(failures[0]?.reason)).toBe(true);
        employeeIds.push(...successes.map((result) => result.value.id));
    });

    it("rejects formatting-equivalent client updates under concurrent writes", async () => {
        const first = await clientRepository.create(branchId, createClient("010-3333-4455"));
        const second = await clientRepository.create(branchId, createClient("010-6666-7788"));
        clientIds.push(first.id, second.id);

        const firstUpdate = await clientRepository.findById(branchId, first.id);
        const secondUpdate = await clientRepository.findById(branchId, second.id);
        expect(firstUpdate).not.toBeNull();
        expect(secondUpdate).not.toBeNull();
        firstUpdate!.update({ phone: "+82 10 9999 8888" });
        secondUpdate!.update({ phone: "010-9999-8888" });

        const results = await Promise.allSettled([
            clientRepository.update(branchId, firstUpdate!),
            clientRepository.update(branchId, secondUpdate!),
        ]);
        const successes = results.filter((result): result is PromiseFulfilledResult<ClientEntity> => result.status === "fulfilled");
        const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
        expect(successes).toHaveLength(1);
        expect(failures).toHaveLength(1);
        expect(isUniqueViolation(failures[0]?.reason)).toBe(true);
        expect(normalizePhone(firstUpdate!.phone)).toBe(firstUpdate!.phoneNormalized);
        expect(normalizePhone(secondUpdate!.phone)).toBe(secondUpdate!.phoneNormalized);
    });

    it("rejects formatting-equivalent employee updates under concurrent writes", async () => {
        const first = await employeeRepository.create(branchId, createEmployee("010-7777-8899"));
        const second = await employeeRepository.create(branchId, createEmployee("010-0000-1122"));
        employeeIds.push(first.id, second.id);

        const firstUpdate = await employeeRepository.findById(branchId, first.id);
        const secondUpdate = await employeeRepository.findById(branchId, second.id);
        expect(firstUpdate).not.toBeNull();
        expect(secondUpdate).not.toBeNull();
        firstUpdate!.updateProfile(undefined, undefined, "+82 10 9999 0001");
        secondUpdate!.updateProfile(undefined, undefined, "010-9999-0001");

        const results = await Promise.allSettled([
            employeeRepository.update(branchId, firstUpdate!),
            employeeRepository.update(branchId, secondUpdate!),
        ]);
        const successes = results.filter((result): result is PromiseFulfilledResult<EmployeeEntity> => result.status === "fulfilled");
        const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
        expect(successes).toHaveLength(1);
        expect(failures).toHaveLength(1);
        expect(isUniqueViolation(failures[0]?.reason)).toBe(true);
        expect(normalizePhone(firstUpdate!.phone)).toBe(firstUpdate!.phoneNormalized);
        expect(normalizePhone(secondUpdate!.phone)).toBe(secondUpdate!.phoneNormalized);
    });
});
