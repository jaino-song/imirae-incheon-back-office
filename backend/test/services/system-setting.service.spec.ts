import { SystemSettingService } from "application/services/system-setting.service";
import { GetSettingUsecase } from "application/usecases/system-setting/get-setting.usecase";
import { UpdateSettingUsecase } from "application/usecases/system-setting/update-setting.usecase";
import { SystemSettingEntity } from "domain/entities/system-setting.entity";

describe("SystemSettingService", () => {
    const createMockGetSettingUsecase = () => ({
        execute: jest.fn(),
        executeEntity: jest.fn(),
        executeWithDefault: jest.fn(),
    });

    const createMockUpdateSettingUsecase = () => ({
        execute: jest.fn(),
        executeIfVersion: jest.fn(),
    });

    let service: SystemSettingService;
    let getSettingUsecase: ReturnType<typeof createMockGetSettingUsecase>;
    let updateSettingUsecase: ReturnType<typeof createMockUpdateSettingUsecase>;

    beforeEach(() => {
        getSettingUsecase = createMockGetSettingUsecase();
        updateSettingUsecase = createMockUpdateSettingUsecase();
        service = new SystemSettingService(
            getSettingUsecase as unknown as GetSettingUsecase,
            updateSettingUsecase as unknown as UpdateSettingUsecase
        );
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe("message automation past trigger config", () => {
        it("should return the default config when no setting is stored", async () => {
            getSettingUsecase.execute.mockResolvedValue(null);

            const result = await service.getMessageAutomationPastTriggerConfig("branch-1");

            expect(getSettingUsecase.execute).toHaveBeenCalledWith(
                "branch:branch-1:message_automation:past_trigger"
            );
            expect(result).toEqual({
                sendIntervalMinutes: 1,
                ruleOrder: [],
            });
        });

        it("should parse and normalize the stored config", async () => {
            getSettingUsecase.execute.mockResolvedValue(JSON.stringify({
                sendIntervalMinutes: 3,
                ruleOrder: ["rule-2", "rule-1", "rule-2"],
            }));

            const result = await service.getMessageAutomationPastTriggerConfig("branch-1");

            expect(result).toEqual({
                sendIntervalMinutes: 3,
                ruleOrder: ["rule-2", "rule-1"],
            });
        });

        it("should fall back to the default config when stored JSON is invalid", async () => {
            getSettingUsecase.execute.mockResolvedValue("{");

            const result = await service.getMessageAutomationPastTriggerConfig("branch-1");

            expect(result).toEqual({
                sendIntervalMinutes: 1,
                ruleOrder: [],
            });
        });

        it("should persist a normalized branch-scoped config", async () => {
            const entity = new SystemSettingEntity(
                "branch:branch-1:message_automation:past_trigger",
                JSON.stringify({
                    sendIntervalMinutes: 1440,
                    ruleOrder: ["rule-1", "rule-2"],
                }),
                new Date(),
            );
            updateSettingUsecase.execute.mockResolvedValue(entity);

            const result = await service.setMessageAutomationPastTriggerConfig("branch-1", {
                sendIntervalMinutes: 2000,
                ruleOrder: ["rule-1", "rule-2", "rule-1"],
            });

            expect(updateSettingUsecase.execute).toHaveBeenCalledWith(
                "branch:branch-1:message_automation:past_trigger",
                JSON.stringify({
                    sendIntervalMinutes: 1440,
                    ruleOrder: ["rule-1", "rule-2"],
                }),
            );
            expect(result).toBe(entity);
        });
    });

    describe("ribbon compare-and-set", () => {
        it("persists only when the approved ribbon version still matches", async () => {
            const entity = new SystemSettingEntity("ribbon_config", "{}", new Date());
            updateSettingUsecase.executeIfVersion.mockResolvedValue(entity);

            await expect(service.setRibbonConfigIfVersion("approved-version", {
                enabled: false,
                message: "",
                backgroundColor: "#004AAD",
                textColor: "#FFFFFF",
                linkText: "",
                linkHref: "",
                linkColor: "#FFB27B",
            })).resolves.toBe(entity);

            expect(updateSettingUsecase.executeIfVersion).toHaveBeenCalledWith(
                "ribbon_config",
                expect.any(String),
                "approved-version",
                expect.any(Function),
            );
        });

        it("rejects a stale ribbon version without invoking a second unconditional write", async () => {
            updateSettingUsecase.executeIfVersion.mockResolvedValue(null);

            await expect(service.setRibbonConfigIfVersion("stale-version", {
                enabled: true,
                message: "점검",
                backgroundColor: "#004AAD",
                textColor: "#FFFFFF",
                linkText: "",
                linkHref: "",
                linkColor: "#FFB27B",
            })).rejects.toThrow("Ribbon configuration changed");
            expect(updateSettingUsecase.execute).not.toHaveBeenCalled();
        });
    });

    describe("client auto-registration policy", () => {
        it("should default to enabled when no setting is stored", async () => {
            getSettingUsecase.executeWithDefault.mockResolvedValue("true");

            const result = await service.getClientAutoRegistrationEnabled("branch-1");

            expect(getSettingUsecase.executeWithDefault).toHaveBeenCalledWith(
                "branch:branch-1:client_auto_registration",
                "true",
            );
            expect(result).toBe(true);
        });

        it("should round-trip a stored value", async () => {
            const entity = new SystemSettingEntity(
                "branch:branch-1:client_auto_registration",
                "false",
                new Date(),
            );
            updateSettingUsecase.execute.mockResolvedValue(entity);

            const setResult = await service.setClientAutoRegistrationEnabled("branch-1", false);

            expect(updateSettingUsecase.execute).toHaveBeenCalledWith(
                "branch:branch-1:client_auto_registration",
                "false",
            );
            expect(setResult).toBe(entity);

            getSettingUsecase.executeWithDefault.mockResolvedValue("false");

            const getResult = await service.getClientAutoRegistrationEnabled("branch-1");

            expect(getResult).toBe(false);
        });
    });

    describe("greeting on auto-registration policy", () => {
        it("should default to disabled when no setting is stored", async () => {
            getSettingUsecase.executeWithDefault.mockResolvedValue("false");

            const result = await service.getGreetingOnAutoRegistrationEnabled("branch-1");

            expect(getSettingUsecase.executeWithDefault).toHaveBeenCalledWith(
                "branch:branch-1:greeting_on_auto_registration",
                "false",
            );
            expect(result).toBe(false);
        });

        it("should round-trip a stored value", async () => {
            const entity = new SystemSettingEntity(
                "branch:branch-1:greeting_on_auto_registration",
                "true",
                new Date(),
            );
            updateSettingUsecase.execute.mockResolvedValue(entity);

            const setResult = await service.setGreetingOnAutoRegistrationEnabled("branch-1", true);

            expect(updateSettingUsecase.execute).toHaveBeenCalledWith(
                "branch:branch-1:greeting_on_auto_registration",
                "true",
            );
            expect(setResult).toBe(entity);

            getSettingUsecase.executeWithDefault.mockResolvedValue("true");

            const getResult = await service.getGreetingOnAutoRegistrationEnabled("branch-1");

            expect(getResult).toBe(true);
        });
    });

    describe("PWA undelivered digest watermark", () => {
        it("should read a valid branch-scoped ISO timestamp", async () => {
            getSettingUsecase.execute.mockResolvedValue("2026-08-11T00:00:00.000Z");

            await expect(service.getPwaUndeliveredDigestWatermark("branch-1")).resolves.toEqual(
                new Date("2026-08-11T00:00:00.000Z"),
            );
            expect(getSettingUsecase.execute).toHaveBeenCalledWith(
                "branch:branch-1:pwa_undelivered_digest_watermark",
            );
        });

        it("should fail open to the initial window when the stored timestamp is invalid", async () => {
            getSettingUsecase.execute.mockResolvedValue("not-a-date");

            await expect(service.getPwaUndeliveredDigestWatermark("branch-1")).resolves.toBeNull();
        });

        it("should persist the watermark as an ISO timestamp", async () => {
            const watermark = new Date("2026-08-12T00:00:00.000Z");
            const entity = new SystemSettingEntity(
                "branch:branch-1:pwa_undelivered_digest_watermark",
                watermark.toISOString(),
                watermark,
            );
            updateSettingUsecase.execute.mockResolvedValue(entity);

            await expect(
                service.setPwaUndeliveredDigestWatermark("branch-1", watermark),
            ).resolves.toBe(entity);
            expect(updateSettingUsecase.execute).toHaveBeenCalledWith(
                "branch:branch-1:pwa_undelivered_digest_watermark",
                watermark.toISOString(),
            );
        });
    });
});
