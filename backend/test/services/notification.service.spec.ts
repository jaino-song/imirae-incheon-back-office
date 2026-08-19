import { Logger } from "@nestjs/common";
import { DailyDigestSection, NotificationService } from "application/services/notification.service";
import { NotificationEntity } from "domain/entities/notification.entity";
import { UserEntity } from "domain/entities/user.entity";

describe("NotificationService", () => {
    const branchId = "branch-1";
    const branchName = "인천점";
    const createUser = (id: string): UserEntity =>
        UserEntity.reconstitute(
            id,
            null,
            `${id}@example.com`,
            `사용자 ${id}`,
            null,
            "user",
            new Date("2026-05-01T00:00:00.000Z"),
            null,
            true,
            new Date("2026-05-01T00:00:00.000Z"),
            "email",
        );

    const subscribePushUsecase = { execute: jest.fn() };
    const unsubscribePushUsecase = { execute: jest.fn() };
    const sendNotificationUsecase = { execute: jest.fn(), broadcast: jest.fn() };
    const getNotificationsUsecase = { execute: jest.fn(), getUnread: jest.fn(), countUnread: jest.fn() };
    const markNotificationReadUsecase = { execute: jest.fn(), markAllAsRead: jest.fn() };
    const getVapidKeyUsecase = { execute: jest.fn() };
    const userRepository = {
        findById: jest.fn(),
        findByKakaoId: jest.fn(),
        findByEmail: jest.fn(),
        findByRoles: jest.fn(),
        findNotificationRecipientsByBranchId: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
    };
    const emailPort = {
        send: jest.fn(),
    };
    const systemSettingService = { getUserEmailNotificationsEnabled: jest.fn() };

    let service: NotificationService;
    let originalNotificationEmailEnabled: string | undefined;

    beforeEach(() => {
        originalNotificationEmailEnabled = process.env["NOTIFICATION_EMAIL_ENABLED"];
        process.env["NOTIFICATION_EMAIL_ENABLED"] = "true";

        service = new NotificationService(
            subscribePushUsecase as never,
            unsubscribePushUsecase as never,
            sendNotificationUsecase as never,
            getNotificationsUsecase as never,
            markNotificationReadUsecase as never,
            getVapidKeyUsecase as never,
            userRepository as never,
            emailPort as never,
            systemSettingService as never,
        );

        userRepository.findById.mockResolvedValue(null);
        userRepository.findNotificationRecipientsByBranchId.mockResolvedValue([
            createUser("user-1"),
            createUser("user-2"),
            createUser("user-1"),
        ]);
        getNotificationsUsecase.execute.mockResolvedValue([]);
        sendNotificationUsecase.execute.mockImplementation((branchid: string, params: { userId: string }) =>
            Promise.resolve(NotificationEntity.create(params.userId, "title", "body", { branchid }))
        );
    });

    afterEach(() => {
        if (originalNotificationEmailEnabled === undefined) {
            delete process.env["NOTIFICATION_EMAIL_ENABLED"];
        } else {
            process.env["NOTIFICATION_EMAIL_ENABLED"] = originalNotificationEmailEnabled;
        }
        jest.clearAllMocks();
    });

    it("should persist notifications for unique branch users", async () => {
        await expect(
            service.sendToBranchUsers(
                branchId,
                "전자문서 검토 필요",
                "검토가 필요합니다.",
                { type: "eformsign-review-required", documentId: "doc-1" },
            )
        ).resolves.toEqual({ sent: 2, failed: 0 });

        expect(sendNotificationUsecase.execute).toHaveBeenCalledTimes(2);
        expect(sendNotificationUsecase.execute).toHaveBeenCalledWith(
            branchId,
            expect.objectContaining({ userId: "user-1" }),
        );
        expect(sendNotificationUsecase.execute).toHaveBeenCalledWith(
            branchId,
            expect.objectContaining({ userId: "user-2" }),
        );
    });

    it("should preserve in-app notifications without sending email when globally disabled", async () => {
        process.env["NOTIFICATION_EMAIL_ENABLED"] = "false";
        const savedNotification = NotificationEntity.create("user-1", "title", "body");
        sendNotificationUsecase.execute.mockResolvedValue(savedNotification);

        await expect(
            service.sendNotification(branchId, "user-1", "title", "body"),
        ).resolves.toBe(savedNotification);

        expect(emailPort.send).not.toHaveBeenCalled();
        expect(systemSettingService.getUserEmailNotificationsEnabled).not.toHaveBeenCalled();
    });

    it("should send a plain notification email with escaped HTML content", async () => {
        const savedNotification = NotificationEntity.create("user-1", "title", "body");
        userRepository.findById.mockResolvedValue(createUser("user-1"));
        systemSettingService.getUserEmailNotificationsEnabled.mockResolvedValue(true);
        sendNotificationUsecase.execute.mockResolvedValue(savedNotification);
        emailPort.send.mockResolvedValue("email-id");

        await expect(
            service.sendNotification(
                branchId,
                "user-1",
                '<알림 "제목">',
                '<script>alert("x")</script>\n다음 줄',
            ),
        ).resolves.toBe(savedNotification);

        const [options] = emailPort.send.mock.calls[0] as [{ subject: string; text: string; html: string }];
        expect(options.subject).toBe('[아가잼잼] <알림 "제목">');
        expect(options.text).toContain('<script>alert("x")</script>\n다음 줄');
        expect(options.html).toContain("&lt;알림 &quot;제목&quot;&gt;");
        expect(options.html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
        expect(options.html).not.toContain("<script>");
    });

    it("should skip a plain notification email when the user preference is disabled", async () => {
        const savedNotification = NotificationEntity.create("user-1", "title", "body");
        userRepository.findById.mockResolvedValue(createUser("user-1"));
        systemSettingService.getUserEmailNotificationsEnabled.mockResolvedValue(false);
        sendNotificationUsecase.execute.mockResolvedValue(savedNotification);

        await expect(
            service.sendNotification(branchId, "user-1", "title", "body"),
        ).resolves.toBe(savedNotification);

        expect(systemSettingService.getUserEmailNotificationsEnabled).toHaveBeenCalledWith("user-1");
        expect(emailPort.send).not.toHaveBeenCalled();
    });

    it("should skip deduped branch notifications for the same document", async () => {
        getNotificationsUsecase.execute.mockResolvedValueOnce([
            NotificationEntity.create("user-1", "old", "old", {
                type: "eformsign-review-required",
                documentId: "doc-1",
            }),
        ]);

        await expect(
            service.sendToBranchUsers(
                branchId,
                "전자문서 검토 필요",
                "검토가 필요합니다.",
                { type: "eformsign-review-required", documentId: "doc-1" },
                {
                    dedupe: {
                        type: "eformsign-review-required",
                        documentId: "doc-1",
                    },
                },
            )
        ).resolves.toEqual({ sent: 1, failed: 0 });

        expect(sendNotificationUsecase.execute).toHaveBeenCalledTimes(1);
        expect(sendNotificationUsecase.execute).toHaveBeenCalledWith(
            branchId,
            expect.objectContaining({ userId: "user-2" }),
        );
    });

    describe("sendDailyDigestToBranchUsers", () => {
        const digestContext = {
            ctaUrl: "https://example.com/login",
            ctaLabel: "로그인해서 확인하기",
        };
        const sections: DailyDigestSection[] = [
            {
                key: "upcoming",
                label: "서비스 시작 예정",
                description: "7일 내에 시작 예정인 서비스가 6건 있어요.",
                count: 6,
                unit: "건",
                url: "/clients/filtered?filter=starting-soon",
            },
            {
                key: "contractsNotSent",
                label: "계약서 미발송",
                description: "아직 계약서가 발송되지 않은 고객이 1명 있어요.",
                count: 1,
                unit: "명",
                url: "/clients/filtered?filter=no-contract",
                details: ["김지혜"],
            },
        ];

        beforeEach(() => {
            systemSettingService.getUserEmailNotificationsEnabled.mockResolvedValue(true);
            emailPort.send.mockResolvedValue("email-id");
        });

        it("should store one notification and push per branch user exactly once", async () => {
            await expect(
                service.sendDailyDigestToBranchUsers(branchId, branchName, sections, digestContext),
            ).resolves.toEqual({ sent: 2, failed: 0 });

            expect(sendNotificationUsecase.execute).toHaveBeenCalledTimes(2);
            for (const userId of ["user-1", "user-2"]) {
                expect(sendNotificationUsecase.execute).toHaveBeenCalledWith(branchId, {
                    userId,
                    title: "오늘 확인할 알림이 2건 있습니다",
                    body: "[인천점] 서비스 시작 예정 6건 · 계약서 미발송 1명 지금 확인해 보세요.",
                    data: { type: "daily-summary", url: "/", sections },
                });
            }
        });

        it("should store exact item notifications instead of an aggregate row for itemized sections", async () => {
            const itemizedSections: DailyDigestSection[] = [{
                key: "ending",
                label: "서비스 종료 예정",
                description: "7일 내에 종료 예정인 서비스가 1건 있어요.",
                count: 1,
                unit: "건",
                url: "/clients/filtered?filter=ending-soon",
                notificationItems: [{
                    title: "서비스 종료 예정",
                    body: "김민지 산모님의 서비스가 내일 종료됩니다.",
                    data: {
                        type: "daily-summary-item",
                        category: "service-ending",
                        clientId: 10,
                        url: "/clients/filtered?filter=ending-soon",
                    },
                }],
            }];

            await service.sendDailyDigestToBranchUsers(
                branchId,
                branchName,
                itemizedSections,
                digestContext,
            );

            expect(sendNotificationUsecase.execute).toHaveBeenCalledTimes(2);
            for (const userId of ["user-1", "user-2"]) {
                expect(sendNotificationUsecase.execute).toHaveBeenCalledWith(branchId, {
                    userId,
                    title: "서비스 종료 예정",
                    body: "김민지 산모님의 서비스가 내일 종료됩니다.",
                    data: {
                        type: "daily-summary-item",
                        category: "service-ending",
                        clientId: 10,
                        url: "/clients/filtered?filter=ending-soon",
                    },
                });
            }
        });

        it("should resolve recipients from the branch, never from the global role list", async () => {
            await service.sendDailyDigestToBranchUsers(branchId, branchName, sections, digestContext);

            expect(userRepository.findNotificationRecipientsByBranchId).toHaveBeenCalledWith(branchId);
            expect(userRepository.findByRoles).not.toHaveBeenCalled();
        });

        it("should send exactly one email per user carrying every section", async () => {
            await service.sendDailyDigestToBranchUsers(branchId, branchName, sections, digestContext);

            expect(emailPort.send).toHaveBeenCalledTimes(2);

            const recipients = emailPort.send.mock.calls.map(
                ([options]: [{ to: string }]) => options.to,
            );
            expect(recipients.sort()).toEqual(["user-1@example.com", "user-2@example.com"]);

            const [options] = emailPort.send.mock.calls[0] as [
                { subject: string; html: string; text: string },
            ];
            expect(options.subject).toBe("[아가잼잼] 오늘 확인할 알림이 2건 있습니다");
            expect(options.html).toContain("오늘 인천점에서 확인이 필요한 알림 2건을 정리했어요.");
            expect(options.html).toContain("서비스 시작 예정");
            expect(options.html).toContain("7일 내에 시작 예정인 서비스가 6건 있어요.");
            expect(options.html).toContain("계약서 미발송");
            expect(options.html).toContain("아직 계약서가 발송되지 않은 고객이 1명 있어요.");
            expect(options.html).toContain("김지혜");
            expect(options.html).toContain(`href="${digestContext.ctaUrl}"`);
            expect(options.html).toContain("로그인해서 확인하기");
            expect(options.text).toContain("[서비스 시작 예정] 7일 내에 시작 예정인 서비스가 6건 있어요.");
            expect(options.text).toContain("오늘 인천점에서 확인이 필요한 알림 2건을 정리했어요.");
            expect(options.text).toContain("김지혜");
            expect(options.text).toContain(`로그인해서 확인하기: ${digestContext.ctaUrl}`);
        });

        it("should escape section details supplied by users", async () => {
            userRepository.findNotificationRecipientsByBranchId.mockResolvedValue([createUser("user-1")]);

            await service.sendDailyDigestToBranchUsers(
                branchId,
                branchName,
                [{ ...sections[1]!, details: ['<script>alert("x")</script>'] }],
                digestContext,
            );

            const [options] = emailPort.send.mock.calls[0] as [{ html: string }];
            expect(options.html).not.toContain("<script>");
            expect(options.html).toContain("&lt;script&gt;");
        });

        it("should render one line per undelivered-message detail, with an HTML-bearing name escaped", async () => {
            userRepository.findNotificationRecipientsByBranchId.mockResolvedValue([createUser("user-1")]);

            const undeliveredSection: DailyDigestSection = {
                key: "undeliveredMessages",
                label: "자동 전송 실패·취소",
                description: "어제 자동 전송 중 발송되지 못한 메시지가 2건 있어요. 필요하면 수동으로 발송해 주세요.",
                count: 2,
                unit: "건",
                url: "/messages",
                details: [
                    '<script>alert("x")</script> · 서비스 안내 — 24시간 경과로 취소',
                    "박민수 · 계약서 안내 — 발송 실패",
                ],
            };

            await service.sendDailyDigestToBranchUsers(branchId, branchName, [undeliveredSection], digestContext);

            const [options] = emailPort.send.mock.calls[0] as [{ html: string }];
            expect(options.html).not.toContain("<script>");
            expect(options.html).toContain(
                '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; · 서비스 안내 — 24시간 경과로 취소<br />박민수 · 계약서 안내 — 발송 실패',
            );
        });

        it("should prefix the digest body with the branch name and escape it in HTML", async () => {
            userRepository.findNotificationRecipientsByBranchId.mockResolvedValue([createUser("user-1")]);
            const unsafeBranchName = '<인천 & "본점">';

            await service.sendDailyDigestToBranchUsers(
                branchId,
                unsafeBranchName,
                [sections[0]!],
                digestContext,
            );

            expect(sendNotificationUsecase.execute).toHaveBeenCalledWith(
                branchId,
                expect.objectContaining({ body: `[${unsafeBranchName}] 서비스 시작 예정 6건 지금 확인해 보세요.` }),
            );
            const [options] = emailPort.send.mock.calls[0] as [{ html: string; text: string }];
            expect(options.html).toContain("오늘 &lt;인천 &amp; &quot;본점&quot;&gt;에서");
            expect(options.text).toContain(`오늘 ${unsafeBranchName}에서`);
        });

        it("should use the single section URL for a single-section digest", async () => {
            await service.sendDailyDigestToBranchUsers(branchId, branchName, [sections[0]!], digestContext);

            expect(sendNotificationUsecase.execute).toHaveBeenCalledWith(
                branchId,
                expect.objectContaining({
                    data: expect.objectContaining({ url: sections[0]!.url }),
                }),
            );
        });

        it("should still store the in-app digest when notification email is globally disabled", async () => {
            process.env["NOTIFICATION_EMAIL_ENABLED"] = "false";

            await expect(
                service.sendDailyDigestToBranchUsers(branchId, branchName, sections, digestContext),
            ).resolves.toEqual({ sent: 2, failed: 0 });

            expect(sendNotificationUsecase.execute).toHaveBeenCalledTimes(2);
            expect(emailPort.send).not.toHaveBeenCalled();
            expect(systemSettingService.getUserEmailNotificationsEnabled).not.toHaveBeenCalled();
        });

        it("should skip the email for users who turned email notifications off", async () => {
            systemSettingService.getUserEmailNotificationsEnabled.mockImplementation((userId: string) =>
                Promise.resolve(userId === "user-1")
            );

            await service.sendDailyDigestToBranchUsers(branchId, branchName, sections, digestContext);

            expect(sendNotificationUsecase.execute).toHaveBeenCalledTimes(2);
            expect(emailPort.send).toHaveBeenCalledTimes(1);
            expect(emailPort.send).toHaveBeenCalledWith(
                expect.objectContaining({ to: "user-1@example.com" }),
            );
        });

        it("should send nothing when there are no sections", async () => {
            await expect(
                service.sendDailyDigestToBranchUsers(branchId, branchName, [], digestContext),
            ).resolves.toEqual({ sent: 0, failed: 0 });

            expect(userRepository.findNotificationRecipientsByBranchId).not.toHaveBeenCalled();
            expect(sendNotificationUsecase.execute).not.toHaveBeenCalled();
            expect(emailPort.send).not.toHaveBeenCalled();
        });

        it("should count a failed recipient without aborting the rest of the branch", async () => {
            sendNotificationUsecase.execute.mockImplementation((_branchid: string, params: { userId: string }) =>
                params.userId === "user-1"
                    ? Promise.reject(new Error("db down"))
                    : Promise.resolve(NotificationEntity.create(params.userId, "title", "body"))
            );

            await expect(
                service.sendDailyDigestToBranchUsers(branchId, branchName, sections, digestContext),
            ).resolves.toEqual({ sent: 1, failed: 1 });

            expect(emailPort.send).toHaveBeenCalledTimes(1);
            expect(emailPort.send).toHaveBeenCalledWith(
                expect.objectContaining({ to: "user-2@example.com" }),
            );
        });

        it("should keep recipient counts sent and warn when every digest email fails", async () => {
            const warnSpy = jest.spyOn(Logger.prototype, "warn").mockImplementation();
            emailPort.send.mockRejectedValue(new Error("smtp down"));

            try {
                await expect(
                    service.sendDailyDigestToBranchUsers(branchId, branchName, sections, digestContext),
                ).resolves.toEqual({ sent: 2, failed: 0 });

                expect(warnSpy).toHaveBeenCalledWith(
                    "daily digest emails for branch branch-1: 0 sent, 0 skipped, 2 failed",
                );
            } finally {
                warnSpy.mockRestore();
            }
        });

        it("should treat preference lookup failures as failed emails without failing recipients", async () => {
            const warnSpy = jest.spyOn(Logger.prototype, "warn").mockImplementation();
            systemSettingService.getUserEmailNotificationsEnabled.mockRejectedValue(new Error("settings down"));

            try {
                await expect(
                    service.sendDailyDigestToBranchUsers(branchId, branchName, sections, digestContext),
                ).resolves.toEqual({ sent: 2, failed: 0 });

                expect(emailPort.send).not.toHaveBeenCalled();
                expect(warnSpy).toHaveBeenCalledWith(
                    "daily digest emails for branch branch-1: 0 sent, 0 skipped, 2 failed",
                );
            } finally {
                warnSpy.mockRestore();
            }
        });

        it("should throttle digest emails instead of sending every email at once", async () => {
            jest.useFakeTimers();

            const emailResolvers: Array<() => void> = [];
            userRepository.findNotificationRecipientsByBranchId.mockResolvedValue([
                createUser("user-1"),
                createUser("user-2"),
                createUser("user-3"),
            ]);
            emailPort.send.mockImplementation(() =>
                new Promise((resolve) => {
                    emailResolvers.push(() => resolve("email-id"));
                })
            );

            const sendPromise = service.sendDailyDigestToBranchUsers(branchId, branchName, sections, digestContext);

            try {
                for (let i = 0; i < 10; i++) {
                    await jest.advanceTimersByTimeAsync(0);
                }

                expect(emailPort.send).toHaveBeenCalledTimes(1);
                emailResolvers.shift()?.();
                await Promise.resolve();

                await jest.advanceTimersByTimeAsync(500);
                expect(emailPort.send).toHaveBeenCalledTimes(1);

                await jest.advanceTimersByTimeAsync(100);
                expect(emailPort.send).toHaveBeenCalledTimes(2);
                emailResolvers.shift()?.();
                await Promise.resolve();

                await jest.advanceTimersByTimeAsync(600);
                expect(emailPort.send).toHaveBeenCalledTimes(3);
                emailResolvers.shift()?.();
                await expect(sendPromise).resolves.toEqual({ sent: 3, failed: 0 });
                expect(emailPort.send).toHaveBeenCalledTimes(3);
            } finally {
                jest.useRealTimers();
            }
        });

        it("should keep the throttle window after a digest email fails", async () => {
            jest.useFakeTimers();
            userRepository.findNotificationRecipientsByBranchId.mockResolvedValue([
                createUser("user-1"),
                createUser("user-2"),
            ]);
            emailPort.send
                .mockRejectedValueOnce(new Error("smtp down"))
                .mockResolvedValueOnce("email-id");

            const sendPromise = service.sendDailyDigestToBranchUsers(branchId, branchName, sections, digestContext);

            try {
                await jest.advanceTimersByTimeAsync(0);
                expect(emailPort.send).toHaveBeenCalledTimes(1);

                await jest.advanceTimersByTimeAsync(0);
                await jest.advanceTimersByTimeAsync(599);
                expect(emailPort.send).toHaveBeenCalledTimes(1);

                await jest.advanceTimersByTimeAsync(1);
                expect(emailPort.send).toHaveBeenCalledTimes(2);
                await expect(sendPromise).resolves.toEqual({ sent: 2, failed: 0 });
            } finally {
                jest.useRealTimers();
            }
        });
    });
});
