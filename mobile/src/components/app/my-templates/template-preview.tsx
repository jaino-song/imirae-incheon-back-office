"use client";

import { TemplateVariable } from "@/lib/template/types";

interface TemplatePreviewProps {
  /** Caller-context canonical value for this node. */
  "data-component": string;

    content: string;
    variables: TemplateVariable[];
}

export const TemplatePreview = ({ "data-component": dataComponent, content, variables }: TemplatePreviewProps) => {
    const renderPreview = () => {
        let preview = content;
        variables.forEach((v) => {
            const regex = new RegExp(`\\{\\{\\s*${v.key}\\s*\\}\\}`, "g");
            preview = preview.replace(regex, `[${v.label}]`);
        });

        return preview.split("\n").map((line, i) => (
            <span key={i}>
                {line}
                <br />
            </span>
        ));
    };

    return (
        <div data-component={dataComponent} className="p-4 bg-card rounded-2xl border min-h-[100px] whitespace-pre-wrap break-words">
            <p className="font-mono text-sm">
                {renderPreview()}
            </p>
        </div>
    );
};
