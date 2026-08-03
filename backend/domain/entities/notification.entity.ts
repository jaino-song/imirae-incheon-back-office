/**
 * Notification Entity
 *
 * 발송된 알림의 이력을 관리하는 엔티티.
 * 알림 내용과 읽음 상태를 추적.
 */
export class NotificationEntity {
    constructor(
        public readonly id: number,
        public readonly userId: string,
        public readonly title: string,
        public readonly body: string,
        public readonly data: Record<string, unknown> | null, // URL, action 등 추가 데이터
        public readonly sentAt: Date,
        public readAt: Date | null,
    ) {}

    /**
     * Create a new notification
     */
    static create(
        userId: string,
        title: string,
        body: string,
        data?: Record<string, unknown>,
    ): NotificationEntity {
        return new NotificationEntity(
            0,
            userId,
            title,
            body,
            data || null,
            new Date(),
            null,
        );
    }

    /**
     * Reconstitute from persistence layer
     */
    static reconstitute(
        id: number,
        userId: string,
        title: string,
        body: string,
        data: Record<string, unknown> | null,
        sentAt: Date,
        readAt: Date | null,
    ): NotificationEntity {
        return new NotificationEntity(
            id,
            userId,
            title,
            body,
            data,
            sentAt,
            readAt,
        );
    }

    /**
     * Mark notification as read
     */
    markAsRead(): void {
        if (!this.readAt) {
            this.readAt = new Date();
        }
    }

    /**
     * Check if notification has been read
     */
    isRead(): boolean {
        return this.readAt !== null;
    }

    withData(data: Record<string, unknown>): NotificationEntity {
        return NotificationEntity.reconstitute(
            this.id,
            this.userId,
            this.title,
            this.body,
            data,
            this.sentAt,
            this.readAt,
        );
    }

    /**
     * Convert to web push payload format
     */
    toWebPushPayload(): string {
        return JSON.stringify({
            title: this.title,
            body: this.body,
            icon: '/icon-192.png',
            badge: '/badge-72.png',
            data: this.data,
        });
    }
}
