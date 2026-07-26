"use client";

import { TemplateVariable } from "@/lib/template/types";
import { AutoFillMsgCard } from "@/components/app/messages/templates/AutoFillMsgCard";

interface TemplatePreviewProps {
    content: string;
    variables: TemplateVariable[];
}

export const TemplatePreview = ({ content, variables }: TemplatePreviewProps) => {
    const renderPreview = () => {
        let preview = content;
        variables.forEach((v) => {
            const escapedKey = v.key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const regex = new RegExp(`\\{\\{\\s*${escapedKey}\\s*\\}\\}`, "g");
            preview = preview.replace(regex, `[${v.label}]`);
        });

        return preview;
    };

    const previewMessage = renderPreview();
    const variableItems = variables.map((variable) => ({
        token: `{{${variable.key}}}`,
        label: variable.label,
        value: `[${variable.label}]`,
    }));

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
