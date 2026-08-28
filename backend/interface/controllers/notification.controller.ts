import {
    Controller,
    Get,
    Post,
    Patch,
    Body,
    Param,
    Query,
    UseGuards,
    Request,
    ParseIntPipe,
    ForbiddenException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NotificationService } from "application/services/notification.service";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { OwnerOrAdminGuard } from "infrastructure/auth/owner-or-admin.guard";
import { CurrentTenant, TenantGuard } from "infrastructure/tenant";
import {
    SubscribePushDto,
    UnsubscribePushDto,
    SendNotificationDto,
    BroadcastNotificationDto,
    GetNotificationsQueryDto,
    VapidKeyResponseDto,
    NotificationResponseDto,
    UnreadCountResponseDto,
    BroadcastResultResponseDto,
} from "../dto/notification.dto";

interface JwtPayload {
    userId: string;
    role: string;
}

@Controller("notifications")
export class NotificationController {
    constructor(
        private readonly notificationService: NotificationService,
        private readonly configService: ConfigService,
    ) {}

    /**
     * Get VAPID public key (needed by frontend to subscribe)
     * Public endpoint - no auth required
     */
    @Get("vapid-key")
    getVapidKey(): VapidKeyResponseDto {
        return {
            publicKey: this.notificationService.getVapidPublicKey(),
        };
    }

    /**
     * Subscribe to push notifications
     */
    @Post("subscribe")
    @UseGuards(JwtGuard)
    async subscribe(
        @Request() req: { user: JwtPayload },
        @Body() dto: SubscribePushDto,
    ): Promise<{ success: boolean }> {
        await this.notificationService.subscribePush(
            req.user.userId,
            dto.endpoint,
            dto.p256dh,
            dto.auth,
            dto.userAgent,
        );
        return { success: true };
    }

    /**
     * Unsubscribe from push notifications
     */
    @Post("unsubscribe")
    @UseGuards(JwtGuard)
    async unsubscribe(
        @Request() req: { user: JwtPayload },
        @Body() dto: UnsubscribePushDto,
    ): Promise<{ success: boolean }> {
        await this.notificationService.unsubscribePush(req.user.userId, dto.endpoint);
        return { success: true };
    }

    /**
     * Get user's notifications with pagination
     */
    @Get()
    @UseGuards(JwtGuard, TenantGuard)
    async getNotifications(
        @CurrentTenant() tenant: { branchId?: string },
        @Request() req: { user: JwtPayload },
        @Query() query: GetNotificationsQueryDto,
    ): Promise<NotificationResponseDto[]> {
        if (req.user.userId === 'dev-user') {
            return [];
        }
        const notifications = await this.notificationService.getNotifications(
            tenant.branchId ?? "",
            req.user.userId,
            { limit: query.limit, offset: query.offset },
        );
        return notifications.map(this.toResponseDto);
    }

    /**
     * Get unread notifications count
     */
    @Get("unread/count")
    @UseGuards(JwtGuard, TenantGuard)
    async getUnreadCount(
        @CurrentTenant() tenant: { branchId?: string },
        @Request() req: { user: JwtPayload }
    ): Promise<UnreadCountResponseDto> {
        if (req.user.userId === 'dev-user') {
            return { count: 0 };
        }
        const count = await this.notificationService.countUnreadNotifications(
            tenant.branchId ?? "",
            req.user.userId
        );
        return { count };
    }

    /**
     * Mark a notification as read
     */
    @Patch(":id/read")
    @UseGuards(JwtGuard, TenantGuard)
    async markAsRead(
        @CurrentTenant() tenant: { branchId?: string },
        @Request() req: { user: JwtPayload },
        @Param("id", ParseIntPipe) id: number,
    ): Promise<NotificationResponseDto> {
        const notification = await this.notificationService.markAsRead(
            tenant.branchId ?? "",
            id,
            req.user.userId
        );
        return this.toResponseDto(notification);
    }

    /**
     * Mark all notifications as read
     */
    @Patch("read-all")
    @UseGuards(JwtGuard, TenantGuard)
    async markAllAsRead(
        @CurrentTenant() tenant: { branchId?: string },
        @Request() req: { user: JwtPayload }
    ): Promise<{ success: boolean }> {
        await this.notificationService.markAllAsRead(tenant.branchId ?? "", req.user.userId);
        return { success: true };
    }

    // ==================== Admin Endpoints ====================

    /**
     * Send notification to a specific user (admin only)
     */
    @Post("send")
    @UseGuards(JwtGuard, TenantGuard, OwnerOrAdminGuard)
    async sendNotification(
        @CurrentTenant() tenant: { branchId?: string },
        @Body() dto: SendNotificationDto,
    ): Promise<NotificationResponseDto> {
        const notification = await this.notificationService.sendNotification(
            tenant.branchId ?? "",
            dto.userId,
            dto.title,
            dto.body,
            dto.data,
        );
        return this.toResponseDto(notification);
    }

    /**
     * Broadcast notification to all users (admin only)
     */
    @Post("broadcast")
    @UseGuards(JwtGuard, TenantGuard, OwnerOrAdminGuard)
    async broadcastNotification(
        @Body() dto: BroadcastNotificationDto,
    ): Promise<BroadcastResultResponseDto> {
        return this.notificationService.broadcastNotification(
            dto.title,
            dto.body,
            dto.data,
        );
    }

    /**
     * Test broadcast - development only
     * 개발/테스트용 엔드포인트
     */
    @Post("test-broadcast")
    @UseGuards(JwtGuard, TenantGuard, OwnerOrAdminGuard)
    async testBroadcast(): Promise<BroadcastResultResponseDto> {
        if (this.configService.get('NODE_ENV') === 'production') {
            throw new ForbiddenException('Test endpoint disabled in production');
        }
        return this.notificationService.broadcastNotification(
            "🎉 테스트 알림",
            "PWA 푸시 알림이 정상 작동합니다!",
            { url: "/clients", timestamp: new Date().toISOString() },
        );
    }

    private toResponseDto(notification: import("domain/entities/notification.entity").NotificationEntity): NotificationResponseDto {
        return {
            id: notification.id,
            title: notification.title,
            body: notification.body,
            data: notification.data,
            sentAt: notification.sentAt.toISOString(),
            readAt: notification.readAt?.toISOString() ?? null,
            isRead: notification.isRead(),
        };
    }
}
