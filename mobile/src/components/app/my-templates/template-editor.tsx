"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ContentPaper } from "../root/content-paper";
import { useCreateMessageTemplate, useUpdateMessageTemplate } from "@/hooks/use-message-templates";
import { useLocale } from "@/providers/LocaleProvider";
import { t } from "@/lib/i18n/translations";
import { MessageTemplate, TemplateVariable } from "@/lib/template/types";
import { extractVariables } from "@/lib/template/variable-parser";
import { VariableConfigurator } from "./variable-configurator";
import { VariableInserter } from "./variable-inserter";
import { TemplatePreview } from "./template-preview";

interface TemplateEditorProps {
    initialData?: MessageTemplate;
}

export const TemplateEditor = ({ initialData }: TemplateEditorProps) => {
    const router = useRouter();
    const locale = useLocale();
    const { mutate: createTemplate, isPending: isCreating } = useCreateMessageTemplate();
    const { mutate: updateTemplate, isPending: isUpdating } = useUpdateMessageTemplate();

    const [name, setName] = useState(initialData?.name || "");
    const [content, setContent] = useState(initialData?.content || "");
    const [variables, setVariables] = useState<TemplateVariable[]>(initialData?.variables || []);

    const detectedKeys = useMemo(() => extractVariables(content), [content]);
    const visibleVariables = useMemo(() => {
        const existingMap = new Map(variables.map((variable) => [variable.key, variable]));
        return detectedKeys.map((key) => {
            const existing = existingMap.get(key);
            if (existing) return existing;
            return {
                key,
                label: key,
                type: "text" as const,
                required: true,
            };
        });
    }, [detectedKeys, variables]);

    const handleSave = () => {
        const data = { name, content, variables: visibleVariables };
        if (initialData) {
            updateTemplate({ id: initialData.id, request: data }, {
                onSuccess: () => router.push("/messages/templates")
            });
        } else {
            createTemplate(data, {
                onSuccess: () => router.push("/messages/templates")
            });
        }
    };

    const handleVariableChange = (updatedVar: TemplateVariable) => {
        setVariables(prev => {
            const exists = prev.some((variable) => variable.key === updatedVar.key);
            if (!exists) return [...prev, updatedVar];
            return prev.map(v => v.key === updatedVar.key ? updatedVar : v);
        });
    };

    const insertVariable = (key: string) => {
        setContent(prev => prev + `{{${key}}}`);
    };

    const isPending = isCreating || isUpdating;

    return (
        <div className="flex flex-col gap-6">
            <ContentPaper data-component="mobile_my-templates_editor" className="p-6" disableAnimation>
                <div className="flex flex-col gap-5">
                    <div className="flex flex-col gap-2">
                        <Label htmlFor="template-name">
                            {t(locale, "template-editor.name-label")}
                            <span className="text-destructive ml-1">*</span>
                        </Label>
                        <Input
                            id="template-name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder={t(locale, "template-editor.name-placeholder")}
                        />
                    </div>

                    <div>
                        <p className="text-sm font-medium mb-2">
                            {t(locale, "template-editor.quick-insert")}
                        </p>
                        <VariableInserter data-component="mobile_my-templates_editor_variable-inserter" onInsert={insertVariable} />
                    </div>

                    <div className="flex flex-col gap-2">
                        <Label htmlFor="template-content">
                            {t(locale, "template-editor.content-label")}
                            <span className="text-destructive ml-1">*</span>
                        </Label>
                        <Textarea
                            id="template-content"
                            rows={10}
                            value={content}
                            onChange={(e) => setContent(e.target.value)}
                            placeholder={t(locale, "template-editor.content-placeholder")}
                        />
                    </div>
                </div>
            </ContentPaper>

            {visibleVariables.length > 0 && (
                <div>
                    <h3 className="text-lg font-semibold mb-3 px-1">
                        {t(locale, "template-editor.variable-settings")}
                    </h3>
                    <div className="flex flex-col gap-3">
                        {visibleVariables.map((variable) => (
                            <VariableConfigurator
                                data-component="mobile_my-templates_editor_variable-config"
                                key={variable.key}
                                variable={variable}
                                onChange={handleVariableChange}
                            />
                        ))}
                    </div>
                </div>
            )}

            {detectedKeys.length === 0 && content.length > 0 && (
                <Alert>
                    <AlertTitle>Tip</AlertTitle>
                    <AlertDescription>
                        {t(locale, "template-editor.no-variables-hint")}
                    </AlertDescription>
                </Alert>
            )}

            <div className="p-6 border rounded-2xl">
                <h3 className="text-lg font-semibold mb-2">
                    {t(locale, "template-editor.preview")}
                </h3>
                <Separator className="mb-4" />
                <TemplatePreview data-component="mobile_my-templates_editor_preview" content={content} variables={visibleVariables} />
            </div>

            <div className="flex justify-end gap-3 pb-6">
                <Button variant="outline" onClick={() => router.back()}>
                    {t(locale, "common.cancel")}
                </Button>
                <Button
                    onClick={handleSave}
                    disabled={!name || !content || isPending}
                >
                    {isPending ? t(locale, "common.saving") : t(locale, "common.save")}
                </Button>
            </div>
        </div>
    );
};
