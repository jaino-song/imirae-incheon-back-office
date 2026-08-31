"use client";

import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { TemplateVariable, VariableType } from "@/lib/template/types";
import { DATA_SOURCES } from "@/lib/template/data-sources";
import { useLocale } from "@/providers/LocaleProvider";
import { t } from "@/lib/i18n/translations";

interface VariableConfiguratorProps {
    variable: TemplateVariable;
    onChange: (updatedVar: TemplateVariable) => void;
    variant?: "card" | "popover";
}

export const VariableConfigurator = ({ variable, onChange, variant = "card" }: VariableConfiguratorProps) => {
    const locale = useLocale();

    const handleChange = (field: keyof TemplateVariable, value: unknown) => {
        onChange({ ...variable, [field]: value });
    };

    const content = (
        <>
            <div className="flex justify-between items-center">
                <p className="text-base font-semibold text-primary">
                    {`{{${variable.key}}}`}
                </p>
                <div className="flex items-center gap-2">
                    <Checkbox
                        id={`required-${variable.key}`}
                        checked={variable.required}
                        onCheckedChange={(checked) => handleChange("required", checked)}
                    />
                    <Label htmlFor={`required-${variable.key}`} className="text-sm">
                        {t(locale, "template-editor.required-label")}
                    </Label>
                </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="flex flex-col gap-2">
                    <Label htmlFor={`label-${variable.key}`} className="text-sm">
                        {t(locale, "template-editor.variable-label")}
                    </Label>
                    <Input
                        id={`label-${variable.key}`}
                        value={variable.label}
                        onChange={(e) => handleChange("label", e.target.value)}
                    />
                </div>
                <div className="flex flex-col gap-2">
                    <Label className="text-sm">
                        {t(locale, "template-editor.variable-type")}
                    </Label>
                    <Select
                        value={variable.type}
                        onValueChange={(value: string) => handleChange("type", value as VariableType)}
                    >
                        <SelectTrigger>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="text">텍스트</SelectItem>
                            <SelectItem value="phone">연락처</SelectItem>
                            <SelectItem value="select">선택 (드롭다운)</SelectItem>
                            <SelectItem value="date">날짜</SelectItem>
                            <SelectItem value="number">숫자</SelectItem>
                            <SelectItem value="textarea">긴 텍스트</SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                <div className="flex flex-col gap-2 sm:col-span-2">
                    <Label htmlFor={`fallback-${variable.key}`} className="text-sm">
                        {t(locale, "template-editor.fallback-label")}
                    </Label>
                    <Input
                        id={`fallback-${variable.key}`}
                        value={variable.fallback ?? ""}
                        onChange={(e) => handleChange("fallback", e.target.value || undefined)}
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                        {t(locale, "template-editor.fallback-hint")}
                    </p>
                </div>
            </div>

            {variable.type === "select" && (
                <div className="pl-4 border-l-2 border-border">
                    <p className="text-sm font-medium mb-2">
                        {t(locale, "template-editor.option-settings")}
                    </p>
                    <RadioGroup
                        value={variable.optionType || "custom"}
                        onValueChange={(value) => handleChange("optionType", value)}
                        className="flex flex-row gap-4"
                    >
                        <div className="flex items-center space-x-2">
                            <RadioGroupItem value="custom" id={`custom-${variable.key}`} />
                            <Label htmlFor={`custom-${variable.key}`} className="text-sm">
                                직접 입력
                            </Label>
                        </div>
                        <div className="flex items-center space-x-2">
                            <RadioGroupItem value="dataSource" id={`dataSource-${variable.key}`} />
                            <Label htmlFor={`dataSource-${variable.key}`} className="text-sm">
                                시스템 데이터
                            </Label>
                        </div>
                    </RadioGroup>

                    {variable.optionType === "dataSource" ? (
                        <div className="mt-3">
                            <Label className="text-sm mb-2 block">데이터 소스</Label>
                            <Select
                                value={variable.dataSource || ""}
                                onValueChange={(value: string) => handleChange("dataSource", value)}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="데이터 소스 선택" />
                                </SelectTrigger>
                                <SelectContent>
                                    {DATA_SOURCES.map(ds => (
                                        <SelectItem key={ds.id} value={ds.id}>
                                            {ds.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    ) : (
                        <div className="mt-3">
                            <Label htmlFor={`options-${variable.key}`} className="text-sm mb-2 block">
                                옵션 (쉼표로 구분)
                            </Label>
                            <Input
                                id={`options-${variable.key}`}
                                value={variable.options?.join(", ") || ""}
                                onChange={(e) => handleChange("options", e.target.value.split(",").map(s => s.trim()).filter(Boolean))}
                                placeholder="예: VIP, 일반, 신규"
                            />
                        </div>
                    )}
                </div>
            )}

            {variable.type === "number" && (
                <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-2">
                        <Label htmlFor={`min-${variable.key}`} className="text-sm">
                            최소값
                        </Label>
                        <Input
                            id={`min-${variable.key}`}
                            type="number"
                            value={variable.min ?? ""}
                            onChange={(e) => handleChange("min", e.target.value ? Number(e.target.value) : undefined)}
                        />
                    </div>
                    <div className="flex flex-col gap-2">
                        <Label htmlFor={`max-${variable.key}`} className="text-sm">
                            최대값
                        </Label>
                        <Input
                            id={`max-${variable.key}`}
                            type="number"
                            value={variable.max ?? ""}
                            onChange={(e) => handleChange("max", e.target.value ? Number(e.target.value) : undefined)}
                        />
                    </div>
                </div>
            )}
        </>
    );

    if (variant === "popover") {
        return (
            <div data-component="desktop_my-templates_variable-config" className="flex flex-col gap-3">
                {content}
            </div>
        );
    }

    return (
        <Card data-component="desktop_my-templates_variable-config" className="p-4">
            <div className="flex flex-col gap-4">
                {content}
            </div>
        </Card>
    );
};
