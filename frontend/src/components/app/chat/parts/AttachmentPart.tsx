type AttachmentPartProps = {
    id: string;
    name: string;
    mediaType: string;
    size: number;
};

function formatBytes(size: number): string {
    if (size < 1024) return `${size.toLocaleString()} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/** Metadata-only file rendering. Signed or external URLs are deliberately absent. */
export function AttachmentPart({ id, name, mediaType, size }: AttachmentPartProps) {
    return (
        <section
            data-component="desktop_chat_agent_attachment-part"
            data-source-component="AttachmentPart"
            data-slot="attachment"
            aria-label={`첨부 파일 ${name}`}
            className="rounded-xl border bg-muted/30 p-3"
        >
            <p data-slot="name" className="break-words text-sm font-medium">{name}</p>
            <p data-slot="metadata" className="mt-1 text-xs text-muted-foreground">{mediaType} · {formatBytes(size)}</p>
            <p data-slot="identifier" className="mt-1 break-all text-xs text-muted-foreground">파일 ID {id}</p>
        </section>
    );
}
