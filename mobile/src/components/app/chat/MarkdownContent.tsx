"use client";

import { ReactNode } from "react";

interface MarkdownContentProps {
    /** Caller-context canonical value for this node. */
    "data-component": string;
    children: ReactNode;
}

export function MarkdownContent({ "data-component": dataComponent, children }: MarkdownContentProps) {
    return (
        <div data-component={dataComponent} className="markdown-content select-text">
            {children}
        </div>
    );
}
