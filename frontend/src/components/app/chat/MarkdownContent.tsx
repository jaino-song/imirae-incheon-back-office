"use client";

import { ReactNode } from "react";

interface MarkdownContentProps {
    children: ReactNode;
}

export function MarkdownContent({ children }: MarkdownContentProps) {
    return (
        <div data-component="desktop_chat_page_markdown" className="markdown-content select-text">
            {children}
        </div>
    );
}
