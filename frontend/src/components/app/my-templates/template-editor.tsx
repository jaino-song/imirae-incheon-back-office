"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { ContentPaper } from "../root/content-paper";
import { useCreateMessageTemplate, useUpdateMessageTemplate } from "@/hooks/use-message-templates";
import { useLocale } from "@/providers/LocaleProvider";
import { t } from "@/lib/i18n/translations";
import { useNavigationPending } from "@/lib/hooks/use-navigation-pending";
import { MessageTemplate, TemplateVariable } from "@/lib/template/types";
import { extractVariables } from "@/lib/template/variable-parser";
import { getTextByteLength, MAX_BODY_LENGTH, SMS_BYTE_LIMIT } from "@/lib/message/byte-length";
import { VariableConfigurator } from "./variable-configurator";
import { VariableInserter, PRESET_VARIABLES } from "./variable-inserter";
import { VariableChipEditor, type VariableChipEditorHandle } from "./variable-chip-editor";
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
    const [activeVariableKey, setActiveVariableKey] = useState<string | null>(null);
    const chipEditorRef = useRef<VariableChipEditorHandle>(null);

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
                        label: PRESET_VARIABLES.find(p => p.key === key)?.label ?? key,
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

    const handleInsertVariable = (key: string) => {
        chipEditorRef.current?.insertVariable(key);
    };

    const handleVariableClick = (key: string) => {
        setActiveVariableKey(key);
    };

    // Suggestion picker offers presets alongside variables already used in the
    // content, without duplicating keys that are already tracked in state.
    const chipVariables = useMemo<TemplateVariable[]>(() => {
        const existingKeys = new Set(variables.map(v => v.key));
        const presetOnly: TemplateVariable[] = PRESET_VARIABLES
            .filter(preset => !existingKeys.has(preset.key))
            .map(preset => ({
                key: preset.key,
                label: preset.label,
                type: "text",
                required: false,
            }));
        return [...variables, ...presetOnly];
    }, [variables]);

    const activeVariable = variables.find(v => v.key === activeVariableKey) ?? null;

    const contentByteLength = getTextByteLength(content);
    const isOverSmsLimit = contentByteLength > SMS_BYTE_LIMIT;
    const isOverBodyLimit = content.length > MAX_BODY_LENGTH;

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
                        <VariableInserter onInsert={handleInsertVariable} />
                    </div>

                    <div className="flex flex-col gap-2">
                        <Label htmlFor="template-content">
                            {t(locale, "template-editor.content-label")}
                            <span className="text-destructive ml-1">*</span>
                        </Label>
                        <Popover
                            open={Boolean(activeVariable)}
                            onOpenChange={(open) => {
                                if (!open) setActiveVariableKey(null);
                            }}
                        >
                            <PopoverAnchor asChild>
                                <div data-component="desktop_my-templates_editor_content-anchor">
                                    <VariableChipEditor
                                        ref={chipEditorRef}
                                        id="template-content"
                                        value={content}
                                        onChange={setContent}
                                        variables={chipVariables}
                                        onVariableClick={handleVariableClick}
                                        placeholder={t(locale, "template-editor.content-placeholder")}
                                    />
                                </div>
                            </PopoverAnchor>
                            {activeVariable ? (
                                <PopoverContent
                                    data-component="desktop_my-templates_editor_variable-popover"
                                    side="bottom"
                                    align="start"
                                    sideOffset={8}
                                    avoidCollisions
                                    className="w-80"
                                    onOpenAutoFocus={(e) => e.preventDefault()}
                                    onFocusOutside={(e) => e.preventDefault()}
                                >
                                    <VariableConfigurator
                                        variant="popover"
                                        variable={activeVariable}
                                        onChange={handleVariableChange}
                                    />
                                </PopoverContent>
                            ) : null}
                        </Popover>
                        <div
                            data-component="desktop_my-templates_editor_content-footer"
                            className="flex justify-end text-xs text-muted-foreground"
                        >
                            {isOverBodyLimit ? (
                                <span className="text-destructive">
                                    {t(locale, "template-editor.body-too-long")}
                                </span>
                            ) : (
                                <span>
                                    {contentByteLength} bytes ·{" "}
                                    {isOverSmsLimit
                                        ? t(locale, "template-editor.byte-count-lms")
                                        : t(locale, "template-editor.byte-count-sms")}
                                </span>
                            )}
                        </div>
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
                    disabled={!name || !content || isPending || isOverBodyLimit}
                >
                    {isPending ? t(locale, "common.saving") : t(locale, "common.save")}
                </Button>
            </div>
        </div>
    );
};
