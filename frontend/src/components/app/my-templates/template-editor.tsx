"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ContentPaper } from "../root/content-paper";
import { useCreateMessageTemplate, useUpdateMessageTemplate } from "@/hooks/use-message-templates";
import { useLocale } from "@/providers/LocaleProvider";
import { t } from "@/lib/i18n/translations";
import { useNavigationPending } from "@/lib/hooks/use-navigation-pending";
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
    const { isPending, beginNavigation } = useNavigationPending(isCreating || isUpdating);

    const [name, setName] = useState(initialData?.name || "");
    const [content, setContent] = useState(initialData?.content || "");
    const [variables, setVariables] = useState<TemplateVariable[]>(initialData?.variables || []);
    const [detectedKeys, setDetectedKeys] = useState<string[]>([]);

    useEffect(() => {
        const keys = extractVariables(content);
        queueMicrotask(() => {
            setDetectedKeys(keys);

            setVariables(prev => {
                const existingKeys = new Set(prev.map(v => v.key));
                const newVars = keys
                    .filter(key => !existingKeys.has(key))
                    .map(key => ({
                        key,
                        label: key,
                        type: "text" as const,
                        required: true
                    }));

                const filtered = prev.filter(v => keys.includes(v.key));
                return [...filtered, ...newVars];
            });
        });
    }, [content]);

    const handleSave = () => {
        const data = { name, content, variables };
        if (initialData) {
            updateTemplate({ id: initialData.id, request: data }, {
                onSuccess: () => {
                    beginNavigation();
                    router.push("/messages/templates");
                }
            });
        } else {
            createTemplate(data, {
                onSuccess: () => {
                    beginNavigation();
                    router.push("/messages/templates");
                }
            });
        }
    };

    const handleVariableChange = (updatedVar: TemplateVariable) => {
        setVariables(prev => prev.map(v => v.key === updatedVar.key ? updatedVar : v));
    };

    const insertVariable = (key: string) => {
        setContent(prev => prev + `{{${key}}}`);
    };

    return (
        <div className="flex flex-col gap-6">
            <ContentPaper data-component="desktop_my-templates_editor" className="p-6" disableAnimation>
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
                        <VariableInserter onInsert={insertVariable} />
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

            {variables.length > 0 && (
                <div>
                    <h3 className="text-lg font-semibold mb-3 px-1">
                        {t(locale, "template-editor.variable-settings")}
                    </h3>
                    <div className="flex flex-col gap-3">
                        {variables.map((variable) => (
                            <VariableConfigurator
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

            <TemplatePreview content={content} variables={variables} />

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
