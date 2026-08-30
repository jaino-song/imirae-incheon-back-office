/**
 * ChatMessage represents a single message in a chat session
 */
export interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: string;
}

/**
 * ChatSessionEntity represents a chat session with Gemini AI
 * Sessions expire after 1 day and have a maximum of 100 messages
 */
export class ChatSessionEntity {
    public static readonly MAX_MESSAGES = 100;
    public static readonly SESSION_DURATION_MS = 24 * 60 * 60 * 1000; // 1 day
    public static readonly retention_duration_ms = 3 * 24 * 60 * 60 * 1000; // 3 days

    // Backwards-compatible alias
    public static readonly RETENTION_DURATION_MS = ChatSessionEntity.retention_duration_ms;

    constructor(
        public readonly id: string,
        public readonly userId: string,
        public messages: ChatMessage[],
        public readonly createdAt: Date,
        public expiresAt: Date,
        /**
         * Nullable only for legacy rows created before branch binding existed.
         * Such rows are intentionally not addressable through owner-scoped repositories.
         */
        public readonly branchId: string | null = null,
    ) {}

    /**
     * Check if the session has expired
     */
    isExpired(): boolean {
        return new Date() > this.expiresAt;
    }

    /**
     * Check if the session can accept more messages
     */
    canAddMessage(): boolean {
        return this.messages.length < ChatSessionEntity.MAX_MESSAGES;
    }

    /**
     * Add a message to the session
     * @throws Error if session is expired or at max capacity
     */
    addMessage(role: 'user' | 'assistant', content: string): void {
        if (this.isExpired()) {
            throw new Error('Session has expired');
        }
        if (!this.canAddMessage()) {
            throw new Error(`Session has reached maximum message limit of ${ChatSessionEntity.MAX_MESSAGES}`);
        }
        this.messages.push({
            role,
            content,
            timestamp: new Date().toISOString(),
        });
    }

    /**
     * Get the message count
     */
    getMessageCount(): number {
        return this.messages.length;
    }

    /**
     * get total message count
     */
    gettotalmessagecount(): number {
        return this.messages.length;
    }

    /**
     * get paginated messages from the end of the array (newest first for pagination)
     * offset=0, limit=20 -> returns last 20 messages
     * offset=20, limit=20 -> returns messages before those
     *
     * @param offset - number of messages to skip from the end
     * @param limit - maximum number of messages to return
     * @returns array of messages in chronological order
     */
    getmessagespaginated(offset: number, limit: number): ChatMessage[] {
        const total = this.messages.length;
        if (offset >= total) {
            return [];
        }

        // calculate slice indices from the end
        const endindex = total - offset;
        const startindex = Math.max(0, endindex - limit);

        return this.messages.slice(startindex, endindex);
    }

    getTotalMessageCount(): number {
        return this.messages.length;
    }

    getMessagesPaginated(offset: number, limit: number): ChatMessage[] {
        const total = this.messages.length;
        if (offset >= total) {
            return [];
        }
        const endIndex = total - offset;
        const startIndex = Math.max(0, endIndex - limit);
        return this.messages.slice(startIndex, endIndex);
    }

    /**
     * Create a new chat session
     */
    static create(userId: string, branchId?: string): ChatSessionEntity {
        const now = new Date();
        const expiresAt = new Date(now.getTime() + ChatSessionEntity.SESSION_DURATION_MS);
        
        return new ChatSessionEntity(
            '', // ID will be assigned by repository
            userId,
            [],
            now,
            expiresAt,
            branchId ?? null,
        );
    }

    /**
     * Reconstitute an entity from persistence data (used by Mapper)
     */
    static reconstitute(
        id: string,
        userId: string,
        messages: ChatMessage[],
        createdAt: Date,
        expiresAt: Date,
        branchId?: string | null,
    ): ChatSessionEntity {
        return new ChatSessionEntity(
            id,
            userId,
            messages,
            createdAt,
            expiresAt,
            branchId ?? null,
        );
    }
}
