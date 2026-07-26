"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { MessageTemplate } from "@/features/message-templates";
import { GeneratedMsg } from "../messages/templates/GeneratedMsg";
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

    return (
        <div className="flex flex-col gap-5" data-component="mobile_messages_user-template-form">
            <div className="flex flex-col gap-4">
                {template.variables.map((variable) => (
                    <div key={variable.key} className="flex flex-col gap-2">
                        <Label htmlFor={`var-${variable.key}`}>
                            {variable.label}
                            {variable.required && <span className="text-destructive ml-1">*</span>}
                        </Label>
                        <Input
                            id={`var-${variable.key}`}
                            value={values[variable.key] || ""}
                            onChange={(e) => handleValueChange(variable.key, e.target.value)}
                        />
                    </div>
                ))}
            </div>

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
                <GeneratedMsg
                    data-component="mobile_messages_user-template-form_generated"
                    title={t(locale, "common.generated-message-title")}
                    copyButtonText={t(locale, "common.copy-button")}
                    message={generatedMessage}
                    onMessageChange={setGeneratedMessage}
                    handleCopy={handleCopy}
                />
            )}
        </div>
    );
}
