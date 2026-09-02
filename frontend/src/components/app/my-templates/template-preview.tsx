"use client";

import { TemplateVariable } from "@/lib/template/types";
import { AutoFillMsgCard } from "@/components/app/messages/templates/AutoFillMsgCard";
import { renderTemplate } from "@/lib/template/variable-parser";
import { getTextByteLength } from "@/lib/message/byte-length";

interface TemplatePreviewProps {
    content: string;
    variables: TemplateVariable[];
}

export const TemplatePreview = ({ content, variables }: TemplatePreviewProps) => {
    // Variables with a fallback are left out of `values` so renderTemplate's
    // fallback-aware pass fills them in, mirroring real send behavior.
    const values = variables.reduce<Record<string, string>>((acc, v) => {
        const hasFallback = typeof v.fallback === "string" && v.fallback.trim().length > 0;
        if (!hasFallback) {
            acc[v.key] = `[${v.label}]`;
        }
        return acc;
    }, {});

    const previewMessage = renderTemplate(content, values, variables);
    const variableItems = variables.map((variable) => {
        const hasFallback = typeof variable.fallback === "string" && variable.fallback.trim().length > 0;
        return {
            token: `{{${variable.key}}}`,
            label: variable.label,
            value: hasFallback ? (variable.fallback as string) : `[${variable.label}]`,
        };
    });

    const handleCopy = () => {
        navigator.clipboard.writeText(previewMessage);
    };

    return (
        <div data-component="desktop_my-templates_preview">
            <AutoFillMsgCard
                title="실시간 미리보기"
                copyButtonText="복사"
                message={previewMessage}
                bodyTitle="실시간 미리보기"
                bodyDescription="템플릿 변수 치환 결과를 확인할 수 있습니다."
                metaItems={[
                    { label: "메시지 길이", value: `${previewMessage.length}자` },
                    { label: "바이트", value: `${getTextByteLength(previewMessage)} bytes` },
                    { label: "감지 변수", value: `${variables.length}개` },
                    { label: "편집 상태", value: "읽기 전용" },
                ]}
                variableItems={variableItems}
                variableEmptyText="감지된 변수가 없습니다."
                handleCopy={handleCopy}
            />
        </div>
    );
};
