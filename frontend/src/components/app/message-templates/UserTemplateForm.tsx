"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { MessageTemplate } from "@/features/message-templates";
import { AutoFillMsgCard } from "../messages/templates/AutoFillMsgCard";
import { TemplateFieldGrid, TemplateFieldGridItem } from "../messages/forms/form-components/TemplateFieldGrid";
import { useLocale } from "@/providers/LocaleProvider";
import { t } from "@/lib/i18n/translations";

interface UserTemplateFormProps {
    template: MessageTemplate;
}

const substituteVariables = (content: string, values: Record<string, string>): string => {
    return content.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
        return values[key.trim()] || `{{${key}}}`;
    });
};

export function UserTemplateForm({ template }: UserTemplateFormProps) {
    const [values, setValues] = useState<Record<string, string>>({});
    const [generatedMessage, setGeneratedMessage] = useState("");
    const locale = useLocale();

    const handleValueChange = (key: string, value: string) => {
        setValues(prev => ({ ...prev, [key]: value }));
    };

    const handleGenerate = () => {
        const message = substituteVariables(template.content, values);
        setGeneratedMessage(message);
    };

    const allRequiredFilled = template.variables
        .filter(v => v.required)
        .every(v => values[v.key]?.trim());

    const handleCopy = async () => {
        await navigator.clipboard.writeText(generatedMessage);
    };

    const variableItems = template.variables
        .map((variable) => ({
            token: `{{${variable.key}}}`,
            label: variable.label,
            value: values[variable.key] || "",
        }))
        .filter((variable) => variable.value.trim().length > 0);

    return (
        <div className="flex flex-col gap-5" data-component="desktop_messages_sections_user-template-form">
            <TemplateFieldGrid>
                {template.variables.map((variable) => (
                    <TemplateFieldGridItem key={variable.key}>
                        <Label htmlFor={`var-${variable.key}`}>
                            {variable.label}
                            {variable.required && <span className="text-destructive ml-1">*</span>}
                        </Label>
                        <Input
                            id={`var-${variable.key}`}
                            value={values[variable.key] || ""}
                            onChange={(e) => handleValueChange(variable.key, e.target.value)}
                        />
                    </TemplateFieldGridItem>
                ))}
            </TemplateFieldGrid>

            {template.variables.length === 0 && (
                <p className="text-sm text-muted-foreground">
                    이 템플릿에는 입력 변수가 없습니다.
                </p>
            )}

            <Button
                size="lg"
                onClick={handleGenerate}
                disabled={!allRequiredFilled && template.variables.some(v => v.required)}
            >
                {t(locale, "common.generate-button")}
            </Button>

            {generatedMessage && (
                <AutoFillMsgCard
                    title={t(locale, "common.generated-message-title")}
                    copyButtonText={t(locale, "common.copy-button")}
                    message={generatedMessage}
                    bodyDescription={`${template.name} 템플릿 결과를 검토하고 바로 수정할 수 있습니다.`}
                    metaItems={[
                        { label: "템플릿 유형", value: "지점 템플릿" },
                        { label: "템플릿 이름", value: template.name },
                        { label: "활성 변수", value: `${variableItems.length}개` },
                    ]}
                    variableItems={variableItems}
                    variableEmptyText="입력된 변수 값이 없습니다."
                    onMessageChange={setGeneratedMessage}
                    handleCopy={handleCopy}
                />
            )}
        </div>
    );
}
