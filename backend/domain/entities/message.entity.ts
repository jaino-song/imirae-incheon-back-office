export class MessageEntity {
    constructor(
        public readonly id: number,
        public title: string,
        public text: string,
        public readonly createdAt: Date,
        public editedAt: Date | null,
    ) {}

    edit(title: string, text: string): void {
        this.title = title;
        this.text = text;
        this.editedAt = new Date();
    }

    isEdited(): boolean {
        return this.editedAt !== null && this.editedAt > this.createdAt;
    }

    static create(title: string, text: string): MessageEntity {
        return new MessageEntity(
            0,
            title,
            text,
            new Date(),
            null,
        );
    }

    static fromPrisma(prismaData: { id: number, title: string | null, text: string | null, created_at: Date, edited_at: Date | null }): MessageEntity {
        return new MessageEntity(
            prismaData.id,
            prismaData.title || '',
            prismaData.text || '',
            prismaData.created_at,
            prismaData.edited_at,
        );
    }

    toPrisma(): { id: number, title: string | null, text: string | null, created_at: Date, edited_at: Date | null } {
        return {
            id: this.id,
            title: this.title,
            text: this.text,
            created_at: this.createdAt,
            edited_at: this.editedAt,
        };
    }
}