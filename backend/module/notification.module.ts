import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import {
    SubscribePushUsecase,
    UnsubscribePushUsecase,
    SendNotificationUsecase,
    GetNotificationsUsecase,
    MarkNotificationReadUsecase,
    GetVapidKeyUsecase,
    CleanupNotificationsUsecase,
} from "application/usecases/notification";
import { NotificationService } from "application/services/notification.service";
import { PwaNotificationSchedulerService } from "application/services/pwa-notification-scheduler.service";
import { NotificationCleanupSchedulerService } from "application/services/notification-cleanup-scheduler.service";
import { NotificationController } from "interface/controllers/notification.controller";
import { DatabaseModule } from "infrastructure/database/database.module";
import { AuthModule } from "infrastructure/auth/auth.module";
import { SbPushSubscriptionRepository } from "infrastructure/database/repositories/sb.push-subscription.repository";
import { SbNotificationRepository } from "infrastructure/database/repositories/sb.notification.repository";
import { SbUserRepository } from "infrastructure/database/repositories/sb.user.repository";
import { SbClientRepository } from "infrastructure/database/repositories/sb.client.repository";
import { WebPushAdapter } from "infrastructure/api/web-push.adapter";
import { PUSH_SUBSCRIPTION_REPOSITORY } from "domain/repositories/push-subscription.repository.interface";
import { NOTIFICATION_REPOSITORY } from "domain/repositories/notification.repository.interface";
import { USER_REPOSITORY } from "domain/repositories/user.repository.interface";
import { CLIENT_REPOSITORY } from "domain/repositories/client.repository.interface";
import { BRANCH_REPOSITORY } from "domain/repositories/branch.repository.interface";
import { SbBranchRepository } from "infrastructure/database/repositories/sb.branch.repository";
import { WEB_PUSH_PORT } from "domain/ports/web-push.port";
import { SystemSettingModule } from "./system-setting.module";
import { NotificationAgentCapabilitiesProvider } from "application/usecases/notification/notification-agent-capabilities.provider";
import { MessageModule } from "./message.module";

@Module({
    imports: [DatabaseModule, ConfigModule, AuthModule, SystemSettingModule, MessageModule],
    controllers: [NotificationController],
    providers: [
        // Use Cases
        SubscribePushUsecase,
        UnsubscribePushUsecase,
        SendNotificationUsecase,
        GetNotificationsUsecase,
        MarkNotificationReadUsecase,
        GetVapidKeyUsecase,
        CleanupNotificationsUsecase,
        // Services
        NotificationService,
        PwaNotificationSchedulerService,
        NotificationCleanupSchedulerService,
        NotificationAgentCapabilitiesProvider,
        // Repository bindings (Port -> Adapter)
        {
            provide: PUSH_SUBSCRIPTION_REPOSITORY,
            useClass: SbPushSubscriptionRepository,
        },
        {
            provide: NOTIFICATION_REPOSITORY,
            useClass: SbNotificationRepository,
        },
        {
            provide: USER_REPOSITORY,
            useClass: SbUserRepository,
        },
        {
            provide: CLIENT_REPOSITORY,
            useClass: SbClientRepository,
        },
        {
            provide: BRANCH_REPOSITORY,
            useClass: SbBranchRepository,
        },
        // External service binding (Port -> Adapter)
        {
            provide: WEB_PUSH_PORT,
            useClass: WebPushAdapter,
        },
    ],
    exports: [NotificationService],
})
export class NotificationModule {}
