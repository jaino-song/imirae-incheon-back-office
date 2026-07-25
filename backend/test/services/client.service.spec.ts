import { Logger } from "@nestjs/common";

import { ClientService } from "../../application/services/client.service";
import {
    CreateClientUsecase,
    DeleteClientUsecase,
    FindClientByIdUsecase,
    ListClientsPaginatedUsecase,
    ListClientsUsecase,
    UpdateClientUsecase,
} from "../../application/usecases/client";
import { MessageTriggerService } from "../../application/services/message-trigger.service";
import { ServiceRecordLinkService } from "../../application/services/service-record-link.service";
import { SystemSettingService } from "../../application/services/system-setting.service";
import { ClientEntity } from "../../domain/entities/client.entity";
import { IClientRepository } from "../../domain/repositories/client.repository.interface";
import { PrismaService } from "../../infrastructure/database/prisma.service";

describe("ClientService", () => {
    // ============================================
    // Test Fixtures & Setup
    // ============================================
    
    const createMockCreateClientUsecase = () => ({
        execute: jest.fn(),
        executeWithInitialSchedule: jest.fn(),
    });

    const createMockUpdateClientUsecase = () => ({
        execute: jest.fn(),
    });

    const createMockFindClientByIdUsecase = () => ({
        execute: jest.fn(),
    });

    const createMockListClientsUsecase = () => ({
        execute: jest.fn(),
    });

    const createMockListClientsPaginatedUsecase = () => ({
        execute: jest.fn(),
    });

    const createMockDeleteClientUsecase = () => ({
        execute: jest.fn(),
    });

    const createDeferred = <T = void>() => {
        let resolve!: (value: T | PromiseLike<T>) => void;
        const promise = new Promise<T>((resolvePromise) => {
            resolve = resolvePromise;
        });
        return { promise, resolve };
    };

    const createMockPrismaService = () => {
        const prisma = {
            employee_schedule: {
            create: jest.fn(),
            update: jest.fn(),
            updateMany: jest.fn(),
            findFirst: jest.fn(),
            findMany: jest.fn().mockResolvedValue([]),
            },
            employee: {
                findMany: jest.fn().mockImplementation(({ where }) =>
                    Promise.resolve(where.id.in.map((id: number) => ({ id }))),
                ),
            },
            client: {
                update: jest.fn(),
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
            eformsign_doc: {
                findMany: jest.fn().mockResolvedValue([]),
                updateMany: jest.fn().mockResolvedValue({ count: 0 }),
            },
            schedule_change_request: {
                findMany: jest.fn().mockResolvedValue([]),
            },
            area: {
                findFirst: jest.fn().mockResolvedValue({ id: "incheon" }),
            },
            $transaction: jest.fn(),
        };
        prisma.$transaction.mockImplementation(async (callback) => callback(prisma));
        return prisma;
    };

    const createMockTriggerService = () => ({
        ensureDefaultRulesForBranch: jest.fn().mockResolvedValue(undefined),
        syncClientRulesForClient: jest.fn().mockResolvedValue(undefined),
        syncEmployeeAssignmentRulesForSchedule: jest.fn().mockResolvedValue(undefined),
        cancelPendingJobsForClientDeletion: jest.fn().mockResolvedValue(undefined),
    });

    const createMockServiceRecordLinkService = () => ({
        scheduleForServiceStart: jest.fn().mockResolvedValue(undefined),
        revoke: jest.fn().mockResolvedValue(undefined),
    });

    const createMockSystemSettingService = () => ({
        getClientAutoRegistrationEnabled: jest.fn().mockResolvedValue(true),
        getGreetingOnAutoRegistrationEnabled: jest.fn().mockResolvedValue(false),
    });

    const createMockClientRepository = (): jest.Mocked<IClientRepository> => ({
        findById: jest.fn(),
        findAll: jest.fn(),
        findAllPaginated: jest.fn(),
        create: jest.fn(),
        createWithInitialSchedule: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        findByStartDate: jest.fn(),
        findByEndDate: jest.fn(),
        findByCreatedDate: jest.fn(),
        findStartingWithinDays: jest.fn().mockResolvedValue([]),
        findEndingWithinDays: jest.fn().mockResolvedValue([]),
        findWithIncompleteContractsStartingWithinDays: jest.fn().mockResolvedValue([]),
        findWithoutContractSentStartingWithinDays: jest.fn().mockResolvedValue([]),
        findByPhone: jest.fn().mockResolvedValue(null),
    });

    const createClientEntity = (): ClientEntity => new ClientEntity(
        1,
        "Test Client",
        "Test Address",
        "010-1234-5678",
        "A형",
        15,
        "100000",
        "50000",
        "50000",
        new Date("2024-01-01"),
        new Date("2024-06-01"),
        false,
        true,
        "900101",
        "pending",
        false,
        null,
    );

    const branchId = "org-1";

    let service: ClientService;
    let createClientUsecase: ReturnType<typeof createMockCreateClientUsecase>;
    let updateClientUsecase: ReturnType<typeof createMockUpdateClientUsecase>;
    let findClientByIdUsecase: ReturnType<typeof createMockFindClientByIdUsecase>;
    let listClientsUsecase: ReturnType<typeof createMockListClientsUsecase>;
    let listClientsPaginatedUsecase: ReturnType<typeof createMockListClientsPaginatedUsecase>;
    let deleteClientUsecase: ReturnType<typeof createMockDeleteClientUsecase>;
    let prismaService: ReturnType<typeof createMockPrismaService>;
    let triggerService: ReturnType<typeof createMockTriggerService>;
    let serviceRecordLinkService: ReturnType<typeof createMockServiceRecordLinkService>;
    let clientRepository: ReturnType<typeof createMockClientRepository>;
    let systemSettingService: ReturnType<typeof createMockSystemSettingService>;

    beforeEach(() => {
        createClientUsecase = createMockCreateClientUsecase();
        updateClientUsecase = createMockUpdateClientUsecase();
        findClientByIdUsecase = createMockFindClientByIdUsecase();
        listClientsUsecase = createMockListClientsUsecase();
        listClientsPaginatedUsecase = createMockListClientsPaginatedUsecase();
        deleteClientUsecase = createMockDeleteClientUsecase();
        prismaService = createMockPrismaService();
        triggerService = createMockTriggerService();
        serviceRecordLinkService = createMockServiceRecordLinkService();
        clientRepository = createMockClientRepository();
        systemSettingService = createMockSystemSettingService();

        service = new ClientService(
            createClientUsecase as unknown as CreateClientUsecase,
            findClientByIdUsecase as unknown as FindClientByIdUsecase,
            listClientsUsecase as unknown as ListClientsUsecase,
            listClientsPaginatedUsecase as unknown as ListClientsPaginatedUsecase,
            updateClientUsecase as unknown as UpdateClientUsecase,
            deleteClientUsecase as unknown as DeleteClientUsecase,
            prismaService as unknown as PrismaService,
            clientRepository,
            systemSettingService as unknown as SystemSettingService,
            triggerService as unknown as MessageTriggerService,
            serviceRecordLinkService as unknown as ServiceRecordLinkService,
        );
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    // ============================================
    // checkPhoneExists
    // ============================================
    describe("checkPhoneExists", () => {
        it("should check duplicate phones through the client repository only", async () => {
            const client = createClientEntity();
            clientRepository.findByPhone.mockResolvedValue(client);

            const result = await service.checkPhoneExists(branchId, "010-1234-5678");

            expect(result).toBe(true);
            expect(clientRepository.findByPhone).toHaveBeenCalledWith(branchId, "01012345678");
        });

        it("should return false without querying when the phone is invalid", async () => {
            const result = await service.checkPhoneExists(branchId, "1234");

            expect(result).toBe(false);
            expect(clientRepository.findByPhone).not.toHaveBeenCalled();
        });
    });

    // ============================================
    // create
    // ============================================
    describe("create", () => {
        describe("given valid client data with primary employee", () => {
            it("should create the client and employee schedule atomically", async () => {
                // Arrange
                const mockClient = createClientEntity();
                const mockSchedule = { id: 10, clientId: 1 };
                createClientUsecase.executeWithInitialSchedule.mockResolvedValue({
                    client: mockClient,
                    scheduleId: mockSchedule.id,
                });

                const params = {
                    name: "New Client",
                    primaryEmployeeId: 5,
                    address: "123 Main St",
                    phone: "010-1234-5678",
                    startDate: "2024-01-01",
                    endDate: "2024-06-01",
                    careCenter: false,
                    voucherClient: true,
                    breastPump: false,
                    reuseExistingClient: true,
                };

                // Act
                const result = await service.create(branchId, params);

                // Assert
                expect(createClientUsecase.executeWithInitialSchedule).toHaveBeenCalledWith(
                    branchId,
                    expect.objectContaining({
                        name: "New Client",
                        address: "123 Main St",
                    }),
                    expect.objectContaining({
                        primaryEmployeeId: 5,
                        secondaryEmployeeId: null,
                        workAddress: "123 Main St",
                    }),
                );
                expect(createClientUsecase.execute).not.toHaveBeenCalled();
                expect(prismaService.employee_schedule.create).not.toHaveBeenCalled();
                expect(serviceRecordLinkService.scheduleForServiceStart).toHaveBeenCalledWith(10);
                expect(result).toBe(mockClient);
            });
        });

        describe("given valid client data without primary employee", () => {
            it("should create client and skip employee_schedule creation", async () => {
                // Arrange
                const mockClient = createClientEntity();
                createClientUsecase.execute.mockResolvedValue(mockClient);

                const params = {
                    name: "New Client",
                    address: "123 Main St",
                    phone: "010-1234-5678",
                    careCenter: false,
                    voucherClient: true,
                    breastPump: false,
                    reuseExistingClient: true,
                };

                // Act
                const result = await service.create(branchId, params);

                // Assert
                expect(createClientUsecase.execute).toHaveBeenCalledWith(
                    branchId,
                    expect.objectContaining({
                        name: "New Client",
                        address: "123 Main St",
                    })
                );
                expect(prismaService.employee_schedule.create).not.toHaveBeenCalled();
                expect(result).toBe(mockClient);
            });
        });

        it("should allow an areaId when the area belongs to the branch", async () => {
            // Arrange
            const mockClient = createClientEntity();
            createClientUsecase.execute.mockResolvedValue(mockClient);

            const params = {
                name: "New Client",
                phone: "010-1234-5678",
                careCenter: null,
                voucherClient: true,
                breastPump: false,
                areaId: "incheon",
            };

            // Act
            await service.create(branchId, params);

            // Assert
            expect(prismaService.area.findFirst).toHaveBeenCalledWith({
                where: {
                    id: "incheon",
                    OR: [{ branchId }, { branchId: null }],
                },
                select: { id: true },
            });
            expect(createClientUsecase.execute).toHaveBeenCalledWith(
                branchId,
                expect.objectContaining({
                    areaId: "incheon",
                    careCenter: null,
                }),
            );
        });

        it("calls ensureDefaultRulesForBranch then syncClientRulesForClient with suppressGreeting=false by default", async () => {
            // Arrange
            const mockClient = createClientEntity();
            createClientUsecase.execute.mockResolvedValue(mockClient);

            const params = {
                name: "New Client",
                phone: "010-1234-5678",
                careCenter: false,
                voucherClient: true,
                breastPump: false,
            };

            // Act
            await service.create(branchId, params);

            // Assert
            expect(triggerService.ensureDefaultRulesForBranch).toHaveBeenCalledWith(branchId);
            expect(triggerService.syncClientRulesForClient).toHaveBeenCalledWith(
                branchId,
                mockClient.id,
                true,
                false,
            );
        });

        it("links every matching contract by normalized phone after manual client creation", async () => {
            const mockClient = createClientEntity();
            createClientUsecase.execute.mockResolvedValue(mockClient);
            prismaService.eformsign_doc.updateMany.mockResolvedValue({ count: 2 });
            prismaService.eformsign_doc.findMany.mockResolvedValue([
                {
                    id: 11,
                    documentId: "DOC-LATEST",
                    clientId: null,
                    stepRecipientSms: "고객 010-1234-5678",
                },
                {
                    id: 10,
                    documentId: "DOC-OLDER",
                    clientId: 99,
                    stepRecipientSms: "연락처 +82 10 1234 5678",
                },
                {
                    id: 9,
                    documentId: "DOC-OTHER",
                    clientId: null,
                    stepRecipientSms: "010-9999-5678",
                },
            ]);

            await service.create(branchId, {
                name: "New Client",
                phone: "010-1234-5678",
                careCenter: false,
                voucherClient: true,
                breastPump: false,
            });

            expect(prismaService.eformsign_doc.findMany).toHaveBeenCalledWith({
                where: {
                    branchId,
                    serviceRecordCaseId: null,
                    stepRecipientSms: { contains: "5678" },
                    OR: [
                        { documentKind: "contract" },
                        { documentKind: null },
                    ],
                },
                orderBy: [
                    { createdDate: "desc" },
                    { id: "desc" },
                ],
                select: {
                    id: true,
                    documentId: true,
                    clientId: true,
                    stepRecipientSms: true,
                },
            });
            expect(prismaService.eformsign_doc.updateMany).toHaveBeenCalledWith({
                where: {
                    branchId,
                    id: { in: [11, 10] },
                },
                data: { clientId: mockClient.id },
            });
            expect(prismaService.client.updateMany).toHaveBeenCalledWith({
                where: {
                    id: mockClient.id,
                    branchId,
                },
                data: { eDocId: "DOC-LATEST" },
            });
            expect(mockClient.eDocId).toBe("DOC-LATEST");
        });

        it("calls ensureDefaultRulesForBranch then syncClientRulesForClient with suppressGreeting=true when suppressGreetingSms is set", async () => {
            // Arrange
            const mockClient = createClientEntity();
            createClientUsecase.execute.mockResolvedValue(mockClient);

            const params = {
                name: "New Client",
                phone: "010-1234-5678",
                careCenter: false,
                voucherClient: true,
                breastPump: false,
                suppressGreetingSms: true,
            };

            // Act
            await service.create(branchId, params);

            // Assert
            expect(triggerService.ensureDefaultRulesForBranch).toHaveBeenCalledWith(branchId);
            expect(triggerService.syncClientRulesForClient).toHaveBeenCalledWith(
                branchId,
                mockClient.id,
                true,
                true,
            );
        });

        it("does not apply automatic message routines when applyMessageAutomation is false", async () => {
            const mockClient = createClientEntity();
            createClientUsecase.execute.mockResolvedValue(mockClient);

            await service.create(branchId, {
                name: "New Client",
                phone: "010-1234-5678",
                careCenter: false,
                voucherClient: true,
                breastPump: false,
                applyMessageAutomation: false,
            });

            expect(triggerService.ensureDefaultRulesForBranch).not.toHaveBeenCalled();
            expect(triggerService.syncClientRulesForClient).not.toHaveBeenCalled();
        });

        it("does not schedule assignment or service-record messages when message automation is false", async () => {
            const mockClient = createClientEntity();
            createClientUsecase.executeWithInitialSchedule.mockResolvedValue({
                client: mockClient,
                scheduleId: 42,
            });

            await service.create(branchId, {
                name: "New Client",
                phone: "010-1234-5678",
                primaryEmployeeId: 7,
                careCenter: false,
                voucherClient: true,
                breastPump: false,
                applyMessageAutomation: false,
            });

            expect(triggerService.syncEmployeeAssignmentRulesForSchedule).not.toHaveBeenCalled();
            expect(serviceRecordLinkService.scheduleForServiceStart).not.toHaveBeenCalled();
        });

        it("rejects a duplicate phone unless reuseExistingClient is explicitly enabled", async () => {
            clientRepository.findByPhone.mockResolvedValue(createClientEntity());

            await expect(service.create(branchId, {
                name: "Duplicate Client",
                phone: "010-1234-5678",
                careCenter: false,
                voucherClient: true,
                breastPump: false,
            })).rejects.toMatchObject({
                status: 409,
                response: expect.objectContaining({ clientId: 1 }),
            });
        });

        it("rejects contract auto registration when the branch setting is disabled", async () => {
            systemSettingService.getClientAutoRegistrationEnabled.mockResolvedValue(false);

            await expect(service.create(branchId, {
                name: "Auto Client",
                careCenter: false,
                voucherClient: true,
                breastPump: false,
                source: "contract_auto_registration",
            })).rejects.toThrow("자동 고객 등록이 꺼져 있습니다. 고객을 먼저 등록한 뒤 계약서를 생성해 주세요.");
        });

        it.each([
            [false, true],
            [true, false],
        ])("persists suppressGreetingSms=%s when auto-registration greeting enabled=%s", async (greetingEnabled, expectedSuppressed) => {
            const client = createClientEntity();
            createClientUsecase.execute.mockResolvedValue(client);
            systemSettingService.getGreetingOnAutoRegistrationEnabled.mockResolvedValue(greetingEnabled);

            await service.create(branchId, {
                name: "Auto Client",
                careCenter: false,
                voucherClient: true,
                breastPump: false,
                source: "contract_auto_registration",
                suppressGreetingSms: greetingEnabled,
            });

            expect(createClientUsecase.execute).toHaveBeenCalledWith(branchId, expect.objectContaining({
                suppressGreetingSms: expectedSuppressed,
            }));
            expect(triggerService.syncClientRulesForClient).toHaveBeenCalledWith(
                branchId,
                client.id,
                true,
                expectedSuppressed,
            );
        });

        it("rejects a service period whose end date precedes its start date", async () => {
            await expect(service.create(branchId, {
                name: "Invalid Period",
                startDate: "2026-07-18",
                endDate: "2026-07-17",
                careCenter: false,
                voucherClient: true,
                breastPump: false,
            })).rejects.toThrow("서비스 시작일은 종료일보다 늦을 수 없습니다.");
        });

        it("does not resolve client creation before automatic message jobs are synchronized", async () => {
            const mockClient = createClientEntity();
            const syncCompletion = createDeferred();
            const syncStarted = createDeferred();
            createClientUsecase.execute.mockResolvedValue(mockClient);
            triggerService.syncClientRulesForClient.mockImplementation(() => {
                syncStarted.resolve();
                return syncCompletion.promise;
            });

            let resolved = false;
            const creation = service.create(branchId, {
                name: "New Client",
                phone: "010-1234-5678",
                careCenter: false,
                voucherClient: true,
                breastPump: false,
            });
            void creation.then(() => {
                resolved = true;
            });

            await syncStarted.promise;
            await Promise.resolve();
            expect(resolved).toBe(false);

            syncCompletion.resolve();
            await expect(creation).resolves.toBe(mockClient);
        });

        describe("given client data with both primary and secondary employees", () => {
            it("should create single schedule with both employees", async () => {
                // Arrange
                const mockClient = createClientEntity();
                const mockSchedule = { id: 10, clientId: 1 };
                createClientUsecase.executeWithInitialSchedule.mockResolvedValue({
                    client: mockClient,
                    scheduleId: mockSchedule.id,
                });

                const params = {
                    name: "New Client",
                    primaryEmployeeId: 5,
                    secondaryEmployeeId: 6,
                    address: "123 Main St",
                    careCenter: false,
                    voucherClient: true,
                    breastPump: false,
                };

                // Act
                await service.create(branchId, params);

                // Assert
                expect(createClientUsecase.executeWithInitialSchedule).toHaveBeenCalledWith(
                    branchId,
                    expect.any(Object),
                    expect.objectContaining({
                        primaryEmployeeId: 5,
                        secondaryEmployeeId: 6,
                    }),
                );
                expect(serviceRecordLinkService.scheduleForServiceStart).toHaveBeenCalledWith(10);
            });
        });

        describe("phone deduplication (reuse-existing)", () => {
            it("returns 409 with the existing client id when reuse is not confirmed", async () => {
                const existingClient = createClientEntity();
                clientRepository.findByPhone.mockResolvedValue(existingClient);

                await expect(service.create(branchId, {
                    name: "New Client",
                    phone: "010-1234-5678",
                    careCenter: false,
                    voucherClient: true,
                    breastPump: false,
                })).rejects.toMatchObject({
                    status: 409,
                    response: expect.objectContaining({
                        message: "이미 같은 전화번호의 고객이 있습니다.",
                        clientId: existingClient.id,
                    }),
                });
            });

            it("reuses the existing client when a client with the same normalized phone already exists in the branch", async () => {
                // Arrange
                const existingClient = createClientEntity();
                clientRepository.findByPhone.mockResolvedValue(existingClient);

                const params = {
                    name: "New Client",
                    phone: "010-1234-5678",
                    careCenter: false,
                    voucherClient: true,
                    breastPump: false,
                    reuseExistingClient: true,
                };

                // Act
                const result = await service.create(branchId, params);

                // Assert: returns the existing client unchanged
                expect(result).toBe(existingClient);
                // Assert: no new client was created
                expect(createClientUsecase.execute).not.toHaveBeenCalled();
                expect(clientRepository.create).not.toHaveBeenCalled();
                // Assert: no side-effects fired
                expect(triggerService.syncClientRulesForClient).not.toHaveBeenCalled();
                expect(prismaService.employee_schedule.create).not.toHaveBeenCalled();
            });

            it("links matching contracts when reusing an existing client by phone", async () => {
                const existingClient = createClientEntity();
                clientRepository.findByPhone.mockResolvedValue(existingClient);
                prismaService.eformsign_doc.updateMany.mockResolvedValue({ count: 1 });
                prismaService.eformsign_doc.findMany.mockResolvedValue([
                    {
                        id: 9,
                        documentId: "DOC-0009",
                        clientId: null,
                        stepRecipientSms: "고객 010-1234-5678",
                    },
                ]);

                await service.create(branchId, {
                    name: "Existing",
                    phone: "010-1234-5678",
                    careCenter: false,
                    voucherClient: true,
                    breastPump: false,
                    reuseExistingClient: true,
                });

                expect(prismaService.eformsign_doc.updateMany).toHaveBeenCalledWith({
                    where: {
                        branchId,
                        id: { in: [9] },
                    },
                    data: { clientId: existingClient.id },
                });
                expect(prismaService.client.updateMany).toHaveBeenCalledWith({
                    where: {
                        id: existingClient.id,
                        branchId,
                    },
                    data: { eDocId: "DOC-0009" },
                });
                expect(existingClient.eDocId).toBe("DOC-0009");
            });

            it("creates the missing assignment when a duplicate client is reused with a selected employee", async () => {
                const existingClient = createClientEntity();
                clientRepository.findByPhone.mockResolvedValue(existingClient);
                prismaService.employee_schedule.findFirst.mockResolvedValue(null);
                prismaService.employee_schedule.create.mockResolvedValue({ id: 33, clientId: existingClient.id });

                const result = await service.create(branchId, {
                    name: "New Client",
                    phone: "010-1234-5678",
                    primaryEmployeeId: 5,
                    careCenter: false,
                    voucherClient: true,
                    breastPump: false,
                    reuseExistingClient: true,
                });

                expect(result).toBe(existingClient);
                expect(prismaService.$transaction).toHaveBeenCalledTimes(1);
                expect(prismaService.employee_schedule.create).toHaveBeenCalledWith({
                    data: expect.objectContaining({
                        clientId: existingClient.id,
                        branchId,
                        primaryEmployeeId: 5,
                        replaced: false,
                    }),
                });
                expect(serviceRecordLinkService.scheduleForServiceStart).toHaveBeenCalledWith(33);
            });

            it("rejects an employee that does not belong to the client branch", async () => {
                prismaService.employee.findMany.mockResolvedValue([]);

                await expect(service.create(branchId, {
                    name: "New Client",
                    primaryEmployeeId: 999,
                    careCenter: false,
                    voucherClient: true,
                    breastPump: false,
                })).rejects.toThrow("selected employees must belong to the client branch");

                expect(createClientUsecase.execute).not.toHaveBeenCalled();
                expect(createClientUsecase.executeWithInitialSchedule).not.toHaveBeenCalled();
            });

            it("creates a new client when no client with that phone exists in the branch", async () => {
                // Arrange — findByPhone returns null (no duplicate)
                clientRepository.findByPhone.mockResolvedValue(null);
                const mockClient = createClientEntity();
                createClientUsecase.execute.mockResolvedValue(mockClient);

                const params = {
                    name: "New Client",
                    phone: "010-9999-0000",
                    careCenter: false,
                    voucherClient: true,
                    breastPump: false,
                };

                // Act
                const result = await service.create(branchId, params);

                // Assert: normal create path ran
                expect(createClientUsecase.execute).toHaveBeenCalledTimes(1);
                expect(result).toBe(mockClient);
            });
        });

        describe("contract auto registration", () => {
            it("rejects creation when auto registration is disabled", async () => {
                systemSettingService.getClientAutoRegistrationEnabled.mockResolvedValue(false);

                await expect(service.create(branchId, {
                    name: "Auto Client",
                    source: "contract_auto_registration",
                    careCenter: false,
                    voucherClient: true,
                    breastPump: false,
                })).rejects.toMatchObject({
                    status: 409,
                    response: expect.objectContaining({
                        message: "자동 고객 등록이 꺼져 있습니다. 고객을 먼저 등록한 뒤 계약서를 생성해 주세요.",
                    }),
                });
                expect(createClientUsecase.execute).not.toHaveBeenCalled();
            });

            it.each([
                [false, true],
                [true, false],
            ])("persists suppressGreetingSms=%s when greeting enabled is %s", async (greetingEnabled, expectedSuppress) => {
                const createdClient = createClientEntity();
                createClientUsecase.execute.mockResolvedValue(createdClient);
                systemSettingService.getGreetingOnAutoRegistrationEnabled.mockResolvedValue(greetingEnabled);

                await service.create(branchId, {
                    name: "Auto Client",
                    source: "contract_auto_registration",
                    suppressGreetingSms: greetingEnabled,
                    careCenter: false,
                    voucherClient: true,
                    breastPump: false,
                });

                expect(createClientUsecase.execute).toHaveBeenCalledWith(
                    branchId,
                    expect.objectContaining({ suppressGreetingSms: expectedSuppress }),
                );
                expect(triggerService.syncClientRulesForClient).toHaveBeenCalledWith(
                    branchId,
                    createdClient.id,
                    true,
                    expectedSuppress,
                );
            });
        });

        it("rejects a service period whose end date is before its start date", async () => {
            await expect(service.create(branchId, {
                name: "Invalid Period",
                startDate: "2026-08-02",
                endDate: "2026-08-01",
                careCenter: false,
                voucherClient: true,
                breastPump: false,
            })).rejects.toThrow("서비스 시작일은 종료일보다 늦을 수 없습니다.");
        });
    });

    // ============================================
    // update
    // ============================================
    describe("update", () => {
        describe("given existing client and no employee change", () => {
            it("should update client without creating new schedule", async () => {
                // Arrange
                const existingClient = createClientEntity();
                const updatedClient = createClientEntity();

                findClientByIdUsecase.execute.mockResolvedValue(existingClient);
                updateClientUsecase.execute.mockResolvedValue(updatedClient);

                // Act
                const result = await service.update(branchId, 1, { name: "New Name", address: "New Address" });

                // Assert
                expect(findClientByIdUsecase.execute).toHaveBeenCalledWith(branchId, 1);
                expect(prismaService.employee_schedule.create).not.toHaveBeenCalled();
                expect(prismaService.employee_schedule.update).not.toHaveBeenCalled();
                expect(prismaService.client.updateMany).toHaveBeenCalledWith(expect.objectContaining({
                    where: { id: 1, branchId },
                    data: expect.objectContaining({ name: "New Name", address: "New Address" }),
                }));
                expect(result).toBe(existingClient);
            });

            it("links matching contracts by the effective phone after client information is updated", async () => {
                const existingClient = createClientEntity();
                findClientByIdUsecase.execute.mockResolvedValue(existingClient);
                prismaService.eformsign_doc.updateMany.mockResolvedValue({ count: 1 });
                prismaService.eformsign_doc.findMany.mockResolvedValue([
                    {
                        id: 12,
                        documentId: "DOC-AFTER-UPDATE",
                        clientId: null,
                        stepRecipientSms: "이용자 010 1234 5678",
                    },
                ]);

                const result = await service.update(branchId, existingClient.id, {
                    name: "Updated Client",
                });

                expect(prismaService.eformsign_doc.findMany).toHaveBeenCalledWith(
                    expect.objectContaining({
                        where: expect.objectContaining({
                            branchId,
                            serviceRecordCaseId: null,
                            stepRecipientSms: { contains: "5678" },
                        }),
                    }),
                );
                expect(prismaService.eformsign_doc.updateMany).toHaveBeenCalledWith({
                    where: {
                        branchId,
                        id: { in: [12] },
                    },
                    data: { clientId: existingClient.id },
                });
                expect(prismaService.client.updateMany).toHaveBeenCalledWith({
                    where: {
                        id: existingClient.id,
                        branchId,
                    },
                    data: { eDocId: "DOC-AFTER-UPDATE" },
                });
                expect(result.eDocId).toBe("DOC-AFTER-UPDATE");
            });

            it("does not resolve a service date update before scheduled jobs are recalculated", async () => {
                const existingClient = createClientEntity();
                const updatedClient = createClientEntity();
                const syncCompletion = createDeferred();
                const syncStarted = createDeferred();
                findClientByIdUsecase.execute.mockResolvedValue(existingClient);
                updateClientUsecase.execute.mockResolvedValue(updatedClient);
                triggerService.syncClientRulesForClient.mockImplementation(() => {
                    syncStarted.resolve();
                    return syncCompletion.promise;
                });

                let resolved = false;
                const update = service.update(branchId, 1, { endDate: "2026-08-01" });
                void update.then(() => {
                    resolved = true;
                });

                await syncStarted.promise;
                await Promise.resolve();
                expect(resolved).toBe(false);

                syncCompletion.resolve();
                await expect(update).resolves.toBe(existingClient);
            });
        });

        describe("given existing client and primary employee change", () => {
            it("should mark old schedule as replaced and create new schedule", async () => {
                // Arrange
                const existingClient = createClientEntity();
                const updatedClient = createClientEntity();

                findClientByIdUsecase.execute.mockResolvedValue(existingClient);
                // Mock findFirst to return current schedule with a different employee
                prismaService.employee_schedule.findFirst.mockResolvedValue({ 
                    id: 10, 
                    clientId: 1,
                    primaryEmployeeId: 5,
                    secondaryEmployeeId: null,
                });
                prismaService.employee_schedule.update.mockResolvedValue({});
                prismaService.employee_schedule.create.mockResolvedValue({ id: 20, clientId: 1 });
                updateClientUsecase.execute.mockResolvedValue(updatedClient);

                // Act
                await service.update(branchId, 1, { primaryEmployeeId: 7 });

                // Assert
                // Should lookup current schedule by clientId
                expect(prismaService.employee_schedule.findFirst).toHaveBeenCalledWith({
                    where: { clientId: 1, branchId: "org-1", replaced: false },
                    orderBy: { id: 'desc' },
                });
                // Mark old schedule as replaced
                expect(prismaService.employee_schedule.update).toHaveBeenCalledWith({
                    where: { id: 10 },
                    data: { replaced: true, endDate: expect.any(Date) },
                });
                // Create new schedule with clientId
                expect(prismaService.employee_schedule.create).toHaveBeenCalledWith({
                    data: expect.objectContaining({
                        clientId: 1,
                        primaryEmployeeId: 7,
                        replaced: false,
                    }),
                });
                expect(serviceRecordLinkService.revoke).toHaveBeenCalledWith(10);
                expect(serviceRecordLinkService.scheduleForServiceStart).toHaveBeenCalledWith(20);
            });

            it("keeps feedback access for the old assignment when replacement creation fails", async () => {
                const existingClient = createClientEntity();
                findClientByIdUsecase.execute.mockResolvedValue(existingClient);
                prismaService.employee_schedule.findFirst.mockResolvedValue({
                    id: 10,
                    clientId: 1,
                    primaryEmployeeId: 5,
                    secondaryEmployeeId: null,
                });
                prismaService.employee_schedule.create.mockRejectedValue(new Error("schedule insert failed"));

                await expect(
                    service.update(branchId, 1, { primaryEmployeeId: 7 }),
                ).rejects.toThrow("schedule insert failed");

                expect(prismaService.$transaction).toHaveBeenCalledTimes(1);
                expect(serviceRecordLinkService.revoke).not.toHaveBeenCalled();
                expect(updateClientUsecase.execute).not.toHaveBeenCalled();
            });

            it("should NOT create new schedule if same employee is selected", async () => {
                // Arrange
                const existingClient = createClientEntity();
                const updatedClient = createClientEntity();

                findClientByIdUsecase.execute.mockResolvedValue(existingClient);
                // Mock findFirst to return current schedule with the SAME employee
                prismaService.employee_schedule.findFirst.mockResolvedValue({ 
                    id: 10, 
                    clientId: 1,
                    primaryEmployeeId: 7,
                    secondaryEmployeeId: null,
                });
                updateClientUsecase.execute.mockResolvedValue(updatedClient);

                // Act
                await service.update(branchId, 1, { primaryEmployeeId: 7 });

                // Assert
                // Should lookup current schedule
                expect(prismaService.employee_schedule.findFirst).toHaveBeenCalled();
                // Should NOT mark old schedule as replaced or create new schedule
                expect(prismaService.employee_schedule.update).not.toHaveBeenCalled();
                expect(prismaService.employee_schedule.create).not.toHaveBeenCalled();
                expect(serviceRecordLinkService.scheduleForServiceStart).not.toHaveBeenCalled();
            });
        });

        describe("given non-existent client", () => {
            it("should throw error", async () => {
                // Arrange
                findClientByIdUsecase.execute.mockResolvedValue(null);

                // Act & Assert
                await expect(service.update(branchId, 999, { name: "New Name" }))
                    .rejects
                    .toThrow("Client with id 999 not found");
            });
        });

        describe("given secondary employee being added", () => {
            it("should create new schedule with secondary employee", async () => {
                // Arrange
                const existingClient = createClientEntity();
                const updatedClient = createClientEntity();

                findClientByIdUsecase.execute.mockResolvedValue(existingClient);
                // No existing schedule
                prismaService.employee_schedule.findFirst.mockResolvedValue(null);
                prismaService.employee_schedule.create.mockResolvedValue({ id: 21, clientId: 1 });
                updateClientUsecase.execute.mockResolvedValue(updatedClient);

                // Act
                await service.update(branchId, 1, { primaryEmployeeId: 5, secondaryEmployeeId: 8 });

                // Assert
                expect(prismaService.employee_schedule.create).toHaveBeenCalledWith({
                    data: expect.objectContaining({
                        clientId: 1,
                        primaryEmployeeId: 5,
                        secondaryEmployeeId: 8,
                        replaced: false,
                    }),
                });
                expect(serviceRecordLinkService.scheduleForServiceStart).toHaveBeenCalledWith(21);
            });
        });

        describe("given secondary employee being removed", () => {
            it("should mark old schedule as replaced and create new schedule without secondary", async () => {
                // Arrange
                const existingClient = createClientEntity();
                const updatedClient = createClientEntity();

                findClientByIdUsecase.execute.mockResolvedValue(existingClient);
                // Current schedule has secondary employee
                prismaService.employee_schedule.findFirst.mockResolvedValue({
                    id: 15,
                    clientId: 1,
                    primaryEmployeeId: 5,
                    secondaryEmployeeId: 6,
                });
                prismaService.employee_schedule.update.mockResolvedValue({});
                prismaService.employee_schedule.create.mockResolvedValue({ id: 20, clientId: 1 });
                updateClientUsecase.execute.mockResolvedValue(updatedClient);

                // Act
                await service.update(branchId, 1, { secondaryEmployeeId: null });

                // Assert
                expect(prismaService.employee_schedule.update).toHaveBeenCalledWith({
                    where: { id: 15 },
                    data: { replaced: true, endDate: expect.any(Date) },
                });
                expect(prismaService.employee_schedule.create).toHaveBeenCalledWith({
                    data: expect.objectContaining({
                        clientId: 1,
                        primaryEmployeeId: 5,
                        secondaryEmployeeId: null,
                    }),
                });
                expect(serviceRecordLinkService.revoke).toHaveBeenCalledWith(15);
                expect(serviceRecordLinkService.scheduleForServiceStart).toHaveBeenCalledWith(20);
            });
        });

        describe("phone collision guard", () => {
            it("rejects updating a client's phone to one already used by another client in the branch", async () => {
                // Arrange
                const existingClient = createClientEntity(); // id = 1
                findClientByIdUsecase.execute.mockResolvedValue(existingClient);

                // Another client (id = 2) already holds that phone
                const otherClient = new ClientEntity(
                    2, "Other Client", "Other Address", "010-1234-5678",
                    "A형", 15, "100000", "50000", "50000",
                    new Date("2024-01-01"), new Date("2024-06-01"),
                    false, true, "900101", "pending", false, null,
                );
                clientRepository.findByPhone.mockResolvedValue(otherClient);

                // Act & Assert
                await expect(
                    service.update(branchId, 1, { phone: "010-1234-5678" }),
                ).rejects.toThrow(expect.objectContaining({ status: 409 }));

                // No DB writes should have occurred
                expect(updateClientUsecase.execute).not.toHaveBeenCalled();
                expect(prismaService.employee_schedule.create).not.toHaveBeenCalled();
            });

            it("allows update when the matching client is the same record (self)", async () => {
                // Arrange
                const existingClient = createClientEntity(); // id = 1
                findClientByIdUsecase.execute.mockResolvedValue(existingClient);
                updateClientUsecase.execute.mockResolvedValue(existingClient);

                // findByPhone returns the same client (id = 1) — keeping own phone
                clientRepository.findByPhone.mockResolvedValue(existingClient);

                // Act
                await service.update(branchId, 1, { phone: "010-1234-5678" });

                // Assert: update proceeded
                expect(prismaService.client.updateMany).toHaveBeenCalledTimes(1);
            });

            it("allows update when no other client has that phone", async () => {
                // Arrange
                const existingClient = createClientEntity();
                findClientByIdUsecase.execute.mockResolvedValue(existingClient);
                updateClientUsecase.execute.mockResolvedValue(existingClient);

                // findByPhone returns null — no collision
                clientRepository.findByPhone.mockResolvedValue(null);

                // Act
                await service.update(branchId, 1, { phone: "010-9999-0000" });

                // Assert: update proceeded
                expect(prismaService.client.updateMany).toHaveBeenCalledTimes(1);
            });
        });
    });

    // ============================================
    // findAll
    // ============================================
    describe("findAll", () => {
        it("should delegate to listClientsUsecase and attach employee info", async () => {
            // Arrange
            const mockClients = [createClientEntity()];
            listClientsUsecase.execute.mockResolvedValue(mockClients);

            // Act
            const result = await service.findAll(branchId);

            // Assert
            expect(listClientsUsecase.execute).toHaveBeenCalledWith(branchId);
            expect(result).toHaveLength(1);
            expect(result[0]).toMatchObject({
                id: 1,
                name: "Test Client",
                primaryEmployee: null,
                secondaryEmployee: null,
                hasSigned: false,
            });
        });

        it("should include employee phone numbers from active schedule", async () => {
            // Arrange
            const mockClients = [createClientEntity()];
            listClientsUsecase.execute.mockResolvedValue(mockClients);
            prismaService.employee_schedule.findMany.mockResolvedValue([
                {
                    clientId: 1,
                    primaryEmployee: {
                        id: 55,
                        name: "지원자 1",
                        phone: "010-0000-1111",
                    },
                    secondaryEmployee: {
                        id: 66,
                        name: "지원자 2",
                        phone: "010-0000-2222",
                    },
                },
            ]);

            // Act
            const result = await service.findAll(branchId);

            // Assert
            expect(result[0]).toMatchObject({
                primaryEmployee: {
                    id: 55,
                    name: "지원자 1",
                    phone: "010-0000-1111",
                },
                secondaryEmployee: {
                    id: 66,
                    name: "지원자 2",
                    phone: "010-0000-2222",
                },
            });
        });

        describe("contract required badge", () => {
            const createWaitingClient = (startDate: string, eDocId: string | null = null) =>
                new ClientEntity(
                    1,
                    "Test Client",
                    null,
                    null,
                    null,
                    null,
                    null,
                    null,
                    null,
                    new Date(`${startDate}T00:00:00.000Z`),
                    new Date("2026-08-31T00:00:00.000Z"),
                    false,
                    true,
                    null,
                    "waiting",
                    false,
                    eDocId,
                );

            beforeEach(() => {
                jest.useFakeTimers();
                jest.setSystemTime(new Date("2026-07-13T00:00:00.000Z"));
            });

            afterEach(() => {
                jest.useRealTimers();
            });

            it("should show contract required from exactly three business days before service start", async () => {
                listClientsUsecase.execute.mockResolvedValue([createWaitingClient("2026-07-16")]);

                const [client] = await service.findAll(branchId);

                expect(client?.badges[0]?.key).toBe("contract_required");
            });

            it("should hide contract required more than three business days before service start", async () => {
                listClientsUsecase.execute.mockResolvedValue([createWaitingClient("2026-07-20")]);

                const [client] = await service.findAll(branchId);

                expect(client?.badges.some((badge) => badge.key === "contract_required")).toBe(false);
            });

            it("should hide contract required after the contract is completed", async () => {
                const client = createWaitingClient("2026-07-16", "completed-document");
                listClientsUsecase.execute.mockResolvedValue([client]);
                prismaService.eformsign_doc.findMany.mockResolvedValue([
                    { clientId: 1, statusType: "003" },
                ]);

                const [result] = await service.findAll(branchId);

                expect(result?.badges.some((badge) => badge.key === "contract_required")).toBe(false);
            });

            it("should use the latest contract instead of the pinned eDocId for the badge", async () => {
                const client = createWaitingClient("2026-07-16", "old-rejected-document");
                listClientsUsecase.execute.mockResolvedValue([client]);
                prismaService.eformsign_doc.findMany.mockResolvedValue([
                    { clientId: 1, statusType: "003" },
                    { clientId: 1, statusType: "080" },
                ]);

                const [result] = await service.findAll(branchId);

                expect(result?.eDocId).toBe("old-rejected-document");
                expect(result?.documentStatus).toBe("completed");
                expect(result?.badges.some((badge) => badge.key === "contract_required")).toBe(false);
                expect(prismaService.eformsign_doc.findMany).toHaveBeenCalledWith({
                    where: {
                        clientId: { in: [1] },
                        OR: [
                            { documentKind: "contract" },
                            { documentKind: null },
                        ],
                    },
                    orderBy: [
                        { createdDate: "desc" },
                        { id: "desc" },
                    ],
                    select: { clientId: true, statusType: true },
                });
                expect(prismaService.eformsign_doc.findMany).toHaveBeenCalledTimes(1);
            });

            it("should keep the existing badge behavior when the client has no contract documents", async () => {
                listClientsUsecase.execute.mockResolvedValue([createWaitingClient("2026-07-16")]);
                prismaService.eformsign_doc.findMany.mockResolvedValue([]);

                const [result] = await service.findAll(branchId);

                expect(result?.documentStatus).toBeNull();
                expect(result?.badges.some((badge) => badge.key === "contract_required")).toBe(true);
            });

            it("should keep showing contract required after service starts", async () => {
                listClientsUsecase.execute.mockResolvedValue([createWaitingClient("2026-07-10")]);

                const [client] = await service.findAll(branchId);

                expect(client?.badges[0]?.key).toBe("contract_required");
            });

            it("should show a neutral pre-booking badge without requiring a contract", async () => {
                const preBookingClient = createWaitingClient("2026-07-16");
                preBookingClient.startDate = null;
                preBookingClient.endDate = null;
                preBookingClient.serviceStatus = "pre_booking";
                listClientsUsecase.execute.mockResolvedValue([preBookingClient]);

                const [client] = await service.findAll(branchId);

                expect(client?.badges).toEqual([
                    expect.objectContaining({
                        key: "service_status",
                        status: "preBooking",
                        label: "예약 전",
                        tone: "neutral",
                    }),
                ]);
            });
        });
    });

    // ============================================
    // findById
    // ============================================
    describe("findById", () => {
        it("should delegate to findClientByIdUsecase and attach employee info", async () => {
            // Arrange
            const mockClient = createClientEntity();
            findClientByIdUsecase.execute.mockResolvedValue(mockClient);

            // Act
            const result = await service.findById(branchId, 1);

            // Assert
            expect(findClientByIdUsecase.execute).toHaveBeenCalledWith(branchId, 1);
            expect(result).toMatchObject({
                id: 1,
                name: "Test Client",
                primaryEmployee: null,
                secondaryEmployee: null,
                hasSigned: false,
            });
        });

        it("should include employee phone numbers from active schedule", async () => {
            // Arrange
            const mockClient = createClientEntity();
            findClientByIdUsecase.execute.mockResolvedValue(mockClient);
            prismaService.employee_schedule.findMany.mockResolvedValue([
                {
                    clientId: 1,
                    primaryEmployee: {
                        id: 55,
                        name: "지원자 1",
                        phone: "010-0000-1111",
                    },
                    secondaryEmployee: {
                        id: 66,
                        name: "지원자 2",
                        phone: "010-0000-2222",
                    },
                },
            ]);

            // Act
            const result = await service.findById(branchId, 1);

            // Assert
            expect(result).toMatchObject({
                primaryEmployee: {
                    id: 55,
                    name: "지원자 1",
                    phone: "010-0000-1111",
                },
                secondaryEmployee: {
                    id: 66,
                    name: "지원자 2",
                    phone: "010-0000-2222",
                },
            });
        });
    });

    // ============================================
    // delete
    // ============================================
    describe("delete", () => {
        it("should cancel pending message jobs before deleting the client", async () => {
            // Arrange
            deleteClientUsecase.execute.mockResolvedValue(undefined);

            // Act
            await service.delete(branchId, 1);

            // Assert
            expect(triggerService.cancelPendingJobsForClientDeletion).toHaveBeenCalledWith(branchId, 1);
            expect(deleteClientUsecase.execute).toHaveBeenCalledWith(branchId, 1);
            expect(
                triggerService.cancelPendingJobsForClientDeletion.mock.invocationCallOrder[0],
            ).toBeLessThan(deleteClientUsecase.execute.mock.invocationCallOrder[0] ?? 0);
        });
    });

    // ============================================
    // terminateService
    // ============================================
    describe("terminateService", () => {
        describe("given existing client", () => {
            it("should update client status to terminated", async () => {
                // Arrange
                const mockClient = createClientEntity();
                const terminatedClient = new ClientEntity(
                    1, "Test Client", "Test Address", "010-1234-5678", "A형", 15,
                    "100000", "50000", "50000", new Date(), new Date(),
                    false, true, "900101", "terminated", false, null
                );
                findClientByIdUsecase.execute.mockResolvedValue(mockClient);
                updateClientUsecase.execute.mockResolvedValue(terminatedClient);
                prismaService.employee_schedule.updateMany = jest.fn().mockResolvedValue({ count: 1 });

                // Act
                const result = await service.terminateService(branchId, 1, "Client requested");

                // Assert
                expect(findClientByIdUsecase.execute).toHaveBeenCalledWith(branchId, 1);
                expect(updateClientUsecase.execute).toHaveBeenCalledWith(branchId, 1, {
                    serviceStatus: "terminated",
                    endDate: expect.any(Date),
                });
                expect(prismaService.employee_schedule.updateMany).toHaveBeenCalledWith({
                    where: { clientId: 1, replaced: false },
                    data: { endDate: expect.any(Date) },
                });
                expect(result.serviceStatus).toBe("terminated");
            });

            it("should terminate without reason", async () => {
                // Arrange
                const mockClient = createClientEntity();
                const terminatedClient = new ClientEntity(
                    1, "Test Client", "Test Address", "010-1234-5678", "A형", 15,
                    "100000", "50000", "50000", new Date(), new Date(),
                    false, true, "900101", "terminated", false, null
                );
                findClientByIdUsecase.execute.mockResolvedValue(mockClient);
                updateClientUsecase.execute.mockResolvedValue(terminatedClient);
                prismaService.employee_schedule.updateMany = jest.fn().mockResolvedValue({ count: 1 });

                // Act
                await service.terminateService(branchId, 1);

                // Assert
                expect(updateClientUsecase.execute).toHaveBeenCalledWith(branchId, 1, expect.objectContaining({
                    serviceStatus: "terminated",
                }));
            });

            it("should sync client trigger rules with includePast=false", async () => {
                // Arrange
                const mockClient = createClientEntity();
                const terminatedClient = new ClientEntity(
                    1, "Test Client", "Test Address", "010-1234-5678", "A형", 15,
                    "100000", "50000", "50000", new Date(), new Date(),
                    false, true, "900101", "terminated", false, null
                );
                findClientByIdUsecase.execute.mockResolvedValue(mockClient);
                updateClientUsecase.execute.mockResolvedValue(terminatedClient);
                prismaService.employee_schedule.updateMany = jest.fn().mockResolvedValue({ count: 1 });

                // Act
                await service.terminateService(branchId, 1);

                // Assert
                expect(triggerService.syncClientRulesForClient).toHaveBeenCalledWith(branchId, 1, false);
            });
        });

        describe("given non-existent client", () => {
            it("should throw NotFoundException", async () => {
                // Arrange
                findClientByIdUsecase.execute.mockResolvedValue(null);

                // Act & Assert
                await expect(service.terminateService(branchId, 999))
                    .rejects
                    .toThrow("Client with id 999 not found");
            });
        });
    });

    // ============================================
    // requestReplacement
    // ============================================
    describe("requestReplacement", () => {
        it("rejects employees outside the client branch", async () => {
            findClientByIdUsecase.execute.mockResolvedValue(createClientEntity());
            prismaService.employee.findMany.mockResolvedValue([]);

            await expect(service.requestReplacement(branchId, 1, 99)).rejects.toMatchObject({ status: 400 });
        });

        it("rejects the same primary and secondary employee", async () => {
            findClientByIdUsecase.execute.mockResolvedValue(createClientEntity());

            await expect(service.requestReplacement(branchId, 1, 7, 7))
                .rejects.toThrow("주담당과 부담당은 같은 직원일 수 없습니다.");
        });

        it("keeps status and existing schedule unchanged when replacement schedule creation fails", async () => {
            const client = createClientEntity();
            findClientByIdUsecase.execute.mockResolvedValue(client);
            const persisted = { serviceStatus: "pending", replaced: false };
            prismaService.employee_schedule.findFirst.mockResolvedValue({ id: 10 });
            prismaService.client.updateMany.mockImplementation(async ({ data }) => {
                persisted.serviceStatus = data.serviceStatus;
                return { count: 1 };
            });
            prismaService.employee_schedule.update.mockImplementation(async () => {
                persisted.replaced = true;
                return {};
            });
            prismaService.employee_schedule.create.mockRejectedValue(new Error("schedule create failed"));
            prismaService.$transaction.mockImplementation(async (callback) => {
                const snapshot = { ...persisted };
                try {
                    return await callback(prismaService);
                } catch (error) {
                    Object.assign(persisted, snapshot);
                    throw error;
                }
            });

            await expect(service.requestReplacement(branchId, 1, 7)).rejects.toThrow("schedule create failed");
            expect(persisted).toEqual({ serviceStatus: "pending", replaced: false });
            expect(serviceRecordLinkService.revoke).not.toHaveBeenCalled();
        });

        describe("given existing client and new employee", () => {
            it("should update status to replacement_requested and create new schedule", async () => {
                // Arrange
                const mockClient = createClientEntity();
                const updatedClient = new ClientEntity(
                    1, "Test Client", "Test Address", "010-1234-5678", "A형", 15,
                    "100000", "50000", "50000", new Date(), new Date("2024-06-01"),
                    false, true, "900101", "replacement_requested", false, null
                );
                findClientByIdUsecase.execute
                    .mockResolvedValueOnce(mockClient)
                    .mockResolvedValueOnce(updatedClient);
                updateClientUsecase.execute.mockResolvedValue(updatedClient);
                prismaService.employee_schedule.findFirst.mockResolvedValue({
                    id: 10,
                    clientId: 1,
                    primaryEmployeeId: 5,
                    secondaryEmployeeId: null,
                });
                prismaService.employee_schedule.update.mockResolvedValue({});
                prismaService.employee_schedule.create.mockResolvedValue({ id: 20, clientId: 1 });

                // Act
                const result = await service.requestReplacement(branchId, 1, 7, 8);

                // Assert
                // Should update status
                expect(prismaService.client.updateMany).toHaveBeenCalledWith({
                    where: { id: 1, branchId },
                    data: { serviceStatus: "replacement_requested" },
                });
                // Should mark old schedule as replaced
                expect(prismaService.employee_schedule.update).toHaveBeenCalledWith({
                    where: { id: 10 },
                    data: { replaced: true, endDate: expect.any(Date) },
                });
                // Should create new schedule with new employees
                expect(prismaService.employee_schedule.create).toHaveBeenCalledWith({
                    data: expect.objectContaining({
                        clientId: 1,
                        primaryEmployeeId: 7,
                        secondaryEmployeeId: 8,
                        replaced: false,
                    }),
                });
                expect(result.serviceStatus).toBe("replacement_requested");
                expect(serviceRecordLinkService.revoke).toHaveBeenCalledWith(10);
                expect(serviceRecordLinkService.scheduleForServiceStart).toHaveBeenCalledWith(20);
            });

            it("keeps the committed replacement and logs when link revocation fails", async () => {
                const mockClient = createClientEntity();
                const updatedClient = new ClientEntity(
                    1, "Test Client", "Test Address", "010-1234-5678", "A형", 15,
                    "100000", "50000", "50000", new Date(), new Date("2024-06-01"),
                    false, true, "900101", "replacement_requested", false, null
                );
                findClientByIdUsecase.execute
                    .mockResolvedValueOnce(mockClient)
                    .mockResolvedValueOnce(updatedClient);
                prismaService.employee_schedule.findFirst.mockResolvedValue({ id: 10 });
                prismaService.employee_schedule.update.mockResolvedValue({});
                prismaService.employee_schedule.create.mockResolvedValue({ id: 20, clientId: 1 });
                serviceRecordLinkService.revoke.mockRejectedValue(new Error("revoke failed"));
                const errorLog = jest.spyOn(Logger.prototype, "error").mockImplementation();

                await expect(service.requestReplacement(branchId, 1, 7)).resolves.toBe(updatedClient);

                expect(prismaService.client.updateMany).toHaveBeenCalledWith({
                    where: { id: 1, branchId },
                    data: { serviceStatus: "replacement_requested" },
                });
                expect(prismaService.employee_schedule.update).toHaveBeenCalledWith({
                    where: { id: 10 },
                    data: { replaced: true, endDate: expect.any(Date) },
                });
                expect(errorLog).toHaveBeenCalledWith(expect.stringContaining(
                    "[SERVICE_RECORD_LINK_REVOKE_FAILED] 제공기록지 링크 폐기 실패 — 고객 1",
                ));
            });

            it("should handle replacement with primary employee only", async () => {
                // Arrange
                const mockClient = createClientEntity();
                const updatedClient = new ClientEntity(
                    1, "Test Client", "Test Address", "010-1234-5678", "A형", 15,
                    "100000", "50000", "50000", new Date(), new Date("2024-06-01"),
                    false, true, "900101", "replacement_requested", false, null
                );
                findClientByIdUsecase.execute
                    .mockResolvedValueOnce(mockClient)
                    .mockResolvedValueOnce(updatedClient);
                updateClientUsecase.execute.mockResolvedValue(updatedClient);
                prismaService.employee_schedule.findFirst.mockResolvedValue(null); // No existing schedule
                prismaService.employee_schedule.create.mockResolvedValue({ id: 20, clientId: 1 });

                // Act
                await service.requestReplacement(branchId, 1, 7);

                // Assert
                expect(prismaService.employee_schedule.create).toHaveBeenCalledWith({
                    data: expect.objectContaining({
                        clientId: 1,
                        primaryEmployeeId: 7,
                        secondaryEmployeeId: null,
                        replaced: false,
                    }),
                });
            });
        });

        describe("given non-existent client", () => {
            it("should throw NotFoundException", async () => {
                // Arrange
                findClientByIdUsecase.execute.mockResolvedValue(null);

                // Act & Assert
                await expect(service.requestReplacement(branchId, 999, 7))
                    .rejects
                    .toThrow("Client with id 999 not found");
            });
        });
    });

    // ============================================
    // completeReplacement
    // ============================================
    describe("completeReplacement", () => {
        describe("given client in replacement_requested status", () => {
            it("should compute and restore status based on dates", async () => {
                // Arrange
                const mockClient = new ClientEntity(
                    1, "Test Client", "Test Address", "010-1234-5678", "A형", 15,
                    "100000", "50000", "50000",
                    new Date("2024-01-01"), // start date in the past
                    new Date("2025-12-31"), // end date in the future
                    false, true, "900101", "replacement_requested", false, null
                );
                const completedClient = new ClientEntity(
                    1, "Test Client", "Test Address", "010-1234-5678", "A형", 15,
                    "100000", "50000", "50000",
                    new Date("2024-01-01"), new Date("2025-12-31"),
                    false, true, "900101", "active", false, null
                );
                findClientByIdUsecase.execute.mockResolvedValue(mockClient);
                updateClientUsecase.execute.mockResolvedValue(completedClient);

                // Act
                await service.completeReplacement(branchId, 1);

                // Assert
                expect(findClientByIdUsecase.execute).toHaveBeenCalledWith(branchId, 1);
                // Should compute status (active since we're between start and end dates)
                expect(updateClientUsecase.execute).toHaveBeenCalledWith(branchId, 1, {
                    serviceStatus: expect.stringMatching(/active|waiting|completed/),
                });
            });
        });

        describe("given client not in replacement_requested status", () => {
            it("should still complete but log warning", async () => {
                // Arrange
                const mockClient = new ClientEntity(
                    1, "Test Client", "Test Address", "010-1234-5678", "A형", 15,
                    "100000", "50000", "50000",
                    new Date("2024-01-01"), new Date("2025-12-31"),
                    false, true, "900101", "active", false, null // Not in replacement_requested
                );
                findClientByIdUsecase.execute.mockResolvedValue(mockClient);
                updateClientUsecase.execute.mockResolvedValue(mockClient);

                // Act
                await service.completeReplacement(branchId, 1);

                // Assert
                // Should still update status
                expect(updateClientUsecase.execute).toHaveBeenCalled();
            });
        });

        describe("given non-existent client", () => {
            it("should throw NotFoundException", async () => {
                // Arrange
                findClientByIdUsecase.execute.mockResolvedValue(null);

                // Act & Assert
                await expect(service.completeReplacement(branchId, 999))
                    .rejects
                    .toThrow("Client with id 999 not found");
            });
        });
    });

    // ============================================
    // findAllPaginated
    // ============================================
    describe("findAllPaginated", () => {
        it("should return paginated results with employee info", async () => {
            // Arrange
            const mockClients = [createClientEntity()];
            const paginatedResult = {
                data: mockClients,
                total: 1,
                page: 1,
                limit: 10,
                totalPages: 1,
            };
            listClientsPaginatedUsecase.execute.mockResolvedValue(paginatedResult);

            // Act
            const result = await service.findAllPaginated(branchId, 1, 10, "Test");

            // Assert
            expect(listClientsPaginatedUsecase.execute).toHaveBeenCalledWith(branchId, 1, 10, "Test");
            expect(result.data).toHaveLength(1);
            expect(result.total).toBe(1);
            expect(result.page).toBe(1);
            expect(result.totalPages).toBe(1);
        });

        it("should handle empty search results", async () => {
            // Arrange
            const paginatedResult = {
                data: [],
                total: 0,
                page: 1,
                limit: 10,
                totalPages: 0,
            };
            listClientsPaginatedUsecase.execute.mockResolvedValue(paginatedResult);

            // Act
            const result = await service.findAllPaginated(branchId, 1, 10, "NonExistent");

            // Assert
            expect(result.data).toHaveLength(0);
            expect(result.total).toBe(0);
        });
    });

    // ============================================
    // Service status computation tests
    // ============================================
    describe("service status computation", () => {
        it("should attach computed service status to clients", async () => {
            // Arrange
            // Create client with dates that would result in 'active' status
            const futureEndDate = new Date();
            futureEndDate.setMonth(futureEndDate.getMonth() + 1);
            const pastStartDate = new Date();
            pastStartDate.setMonth(pastStartDate.getMonth() - 1);

            const mockClient = new ClientEntity(
                1, "Test Client", "Test Address", "010-1234-5678", "A형", 15,
                "100000", "50000", "50000",
                pastStartDate, futureEndDate,
                false, true, "900101", "waiting", // Stored as waiting
                false, null
            );
            listClientsUsecase.execute.mockResolvedValue([mockClient]);
            // Mock the prismaService.client.update for background update
            prismaService.client = { update: jest.fn().mockResolvedValue({}) } as unknown as typeof prismaService.client;

            // Act
            const result = await service.findAll(branchId);

            // Assert
            // Should return computed status, not stored status
            expect(result).toHaveLength(1);
            expect(result[0]?.serviceStatus).toBe("active");
        });
    });
});
