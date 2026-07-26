"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Save, Loader2 } from "lucide-react";
import { useDebouncedCallback } from "use-debounce";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { ContentPaper } from "@/components/app/root/content-paper";
import type { MessageTemplate, TemplateVariable, CreateTemplateDto, UpdateTemplateDto } from "@/features/message-templates";

interface TemplateFormProps {
    mode: "create" | "edit";
    initialData?: MessageTemplate;
    onSubmit: (data: CreateTemplateDto | UpdateTemplateDto) => Promise<void>;
    isPending: boolean;
}

const detectVariables = (content: string): string[] => {
    const regex = /\{\{([^}]+)\}\}/g;
    const matches = Array.from(content.matchAll(regex));
    return [...new Set(matches.map(m => m[1]?.trim() ?? "").filter(Boolean))];
};

export function TemplateForm({ mode, initialData, onSubmit, isPending }: TemplateFormProps) {
    const router = useRouter();
    const [name, setName] = useState(initialData?.name || "");
    const [content, setContent] = useState(initialData?.content || "");
    const [variables, setVariables] = useState<TemplateVariable[]>(initialData?.variables || []);
    const [detectedKeys, setDetectedKeys] = useState<string[]>([]);

    const validateVariables = useCallback((contentVars: string[], definedVars: TemplateVariable[]) => {
        const errors: string[] = [];
        const definedKeys = new Set(definedVars.map(v => v.key));

        for (const varKey of contentVars) {
            if (!definedKeys.has(varKey)) {
                errors.push(`템플릿에 정의되지 않은 변수: {{${varKey}}}`);
            }
        }

        const contentVarsSet = new Set(contentVars);
        for (const variable of definedVars) {
            if (!contentVarsSet.has(variable.key)) {
                errors.push(`사용되지 않는 변수 정의: ${variable.key}`);
            }
        }

        return errors;
    }, []);

    const debouncedDetect = useDebouncedCallback((text: string) => {
        const detected = detectVariables(text);
        setDetectedKeys(detected);

        setVariables(prev => {
            const existingMap = new Map(prev.map(v => [v.key, v]));
            const newVariables: TemplateVariable[] = detected.map(key => {
                if (existingMap.has(key)) {
                    return existingMap.get(key)!;
                }
                return {
                    key,
                    label: key,
                    type: "text",
                    required: true,
                };
            });
            return newVariables;
        });
    }, 300);

    useEffect(() => {
        debouncedDetect(content);
    }, [content, debouncedDetect]);

    const validationErrors = useMemo(
        () => validateVariables(detectedKeys, variables),
        [detectedKeys, variables, validateVariables]
    );
    const uniqueValidationErrors = useMemo(
        () => Array.from(new Set(validationErrors)),
        [validationErrors]
    );

    const handleVariableChange = (key: string, field: keyof TemplateVariable, value: string | boolean) => {
        setVariables(prev =>
            prev.map(v =>
                v.key === key ? { ...v, [field]: value } : v
            )
        );
    };

    const handleSubmit = async () => {
        if (validationErrors.length > 0) return;
        if (!name.trim()) return;

        await onSubmit({
            name: name.trim(),
            content,
            variables,
        });
    };

    const handleCancel = () => {
        router.push("/messages/templates");
    };

    const isValid = name.trim() !== "" && validationErrors.length === 0;

    return (
        <div className="bg-background">
            <div className="px-4 sm:px-6 md:px-12 py-6 sm:py-8 mx-auto">
                <ContentPaper
                    className="min-h-[70vh] flex-grow w-full"
                    header={
                        <div className="mb-6 flex justify-between items-center">
                            <div className="flex items-center gap-3">
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={handleCancel}
                                >
                                    <ArrowLeft className="h-5 w-5" />
                                </Button>
                                <h2 className="text-2xl font-bold text-primary">
                                    {mode === "create" ? "새 템플릿 만들기" : "템플릿 수정"}
                                </h2>
                            </div>
                            <div className="flex gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={handleCancel}
                                    disabled={isPending}
                                >
                                    취소
                                </Button>
                                <Button
                                    size="sm"
                                    onClick={handleSubmit}
                                    disabled={isPending || !isValid}
                                >
                                    {isPending ? (
                                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                    ) : (
                                        <Save className="h-4 w-4 mr-2" />
                                    )}
                                    저장
                                </Button>
                            </div>
                        </div>
                    }
                >
                    <div className="mb-5">
                        <Label htmlFor="template-name" className="text-sm font-semibold mb-2 block">
                            템플릿 이름 <span className="text-destructive">*</span>
                        </Label>
                        <Input
                            id="template-name"
                            placeholder="예: 서비스 안내 메시지"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className={name.trim() === "" ? "border-destructive" : ""}
                        />
                    </div>

                    {validationErrors.length > 0 && (
                        <Alert variant="warning" className="mb-5">
                            <AlertTitle className="font-semibold">변수 불일치 오류</AlertTitle>
                            <AlertDescription>
                                <ul className="mt-2 space-y-1">
                                    {uniqueValidationErrors.map((err) => (
                                        <li key={err}>• {err}</li>
                                    ))}
                                </ul>
                                <p className="mt-2 text-sm text-muted-foreground">
                                    템플릿 내용과 변수 목록이 일치해야 저장할 수 있습니다.
                                </p>
                            </AlertDescription>
                        </Alert>
                    )}

                    <div className="flex flex-col md:flex-row gap-5">
                        <div className="flex-1">
                            <Label htmlFor="template-content" className="text-sm font-semibold mb-2 block">
                                템플릿 내용 <span className="text-destructive">*</span>
                            </Label>
                            <Textarea
                                id="template-content"
                                rows={15}
                                placeholder={`안녕하세요 {{고객명}}님,\n\n{{서비스유형}} 서비스가 {{서비스일자}}에 예정되어 있습니다.\n\n감사합니다.`}
                                value={content}
                                onChange={(e) => setContent(e.target.value)}
                                className="font-mono text-sm"
                            />
                            <p className="mt-2 text-sm text-muted-foreground">
                                💡 {"{{변수명}}"} 형식으로 변수를 입력하면 자동으로 감지됩니다
                            </p>
                        </div>

                        <Card
                            data-component="desktop_messages_sections_template-form-variables"
                            className="flex-1 p-4 max-h-[500px] overflow-y-auto bg-muted/50"
                        >
                            <p className="text-sm font-semibold mb-4">
                                감지된 변수 ({variables.length}개)
                            </p>

                            {variables.length === 0 ? (
                                <div className="text-muted-foreground text-center py-8">
                                    템플릿에 {"{{변수명}}"} 형식으로<br />
                                    변수를 추가하세요
                                </div>
                            ) : (
                                <div className="flex flex-col gap-4">
                                    {variables.map((variable, index) => (
                                        <div
                                            key={variable.key}
                                            className="p-4 bg-card rounded-md border"
                                        >
                                            <p className="text-sm font-semibold mb-3 text-primary">
                                                {index + 1}. {variable.key}
                                            </p>

                                            <div className="flex flex-col gap-3">
                                                <div>
                                                    <Label className="text-xs text-muted-foreground mb-1 block">
                                                        라벨
                                                    </Label>
                                                    <Input
                                                        value={variable.label}
                                                        onChange={(e) => handleVariableChange(variable.key, "label", e.target.value)}
                                                    />
                                                </div>

                                                <div>
                                                    <Label className="text-xs text-muted-foreground mb-1 block">
                                                        타입
                                                    </Label>
                                                    <Select
                                                        value={variable.type}
                                                        onValueChange={(value: string) => handleVariableChange(variable.key, "type", value)}
                                                    >
                                                        <SelectTrigger>
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="text">텍스트</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </div>

                                                <div className="flex items-center gap-2">
                                                    <Checkbox
                                                        id={`required-${variable.key}`}
                                                        checked={variable.required}
                                                        onCheckedChange={(checked) => handleVariableChange(variable.key, "required", !!checked)}
                                                    />
                                                    <Label htmlFor={`required-${variable.key}`} className="text-sm">
                                                        필수
                                                    </Label>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </Card>
                    </div>
                </ContentPaper>
            </div>
        </div>
    );
}
