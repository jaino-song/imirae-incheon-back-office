"use client";

import { useState } from "react";
import type { AgentFormField } from "@babyjamjam/shared";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type FormRequestPartProps = { "data-component": string; formId: string; title: string; fields?: AgentFormField[]; onSubmit?: (formId: string, values: Record<string, unknown>) => void };

function normalizeFormValues(fields: AgentFormField[], values: Record<string, unknown>) {
    const normalized: Record<string, unknown> = {
        ...Object.fromEntries(fields.filter((field) => field.type === "boolean").map((field) => [field.name, false])),
    };

    for (const field of fields) {
        if (!Object.prototype.hasOwnProperty.call(values, field.name)) continue;
        const value = values[field.name];

        if (field.type === "number") {
            const numericValue = typeof value === "number"
                ? value
                : typeof value === "string" && value.trim() !== ""
                    ? Number(value)
                    : undefined;
            if (numericValue !== undefined && Number.isFinite(numericValue)) normalized[field.name] = numericValue;
            continue;
        }

        normalized[field.name] = value;
    }

    return normalized;
}

export function FormRequestPart({ "data-component": dataComponent, formId, title, fields = [], onSubmit }: FormRequestPartProps) {
    const [values, setValues] = useState<Record<string, unknown>>({});
    const setValue = (name: string, value: unknown) => setValues((current) => ({ ...current, [name]: value }));
    return <form data-component={dataComponent} data-source-component="FormRequestPart" className="flex flex-col gap-3 rounded-xl border bg-card p-4" onSubmit={(event) => { event.preventDefault(); if (!event.currentTarget.checkValidity()) return; onSubmit?.(formId, normalizeFormValues(fields, values)); }}><h3 data-component={`${dataComponent}_title`} data-slot="title" className="font-semibold">{title}</h3>{fields.map((field) => field.type === "textarea" ? <Textarea key={field.name} data-component={`${dataComponent}_field_control`} aria-label={field.label} required={field.required} inputMode={field.inputMode} maxLength={field.maxLength} value={String(values[field.name] ?? "")} onChange={(event) => setValue(field.name, event.target.value)} placeholder={field.placeholder ?? field.label} /> : field.type === "boolean" ? <div key={field.name} data-component={`${dataComponent}_field`} className="flex items-center gap-2"><Checkbox data-component={`${dataComponent}_field_control`} id={`${formId}-${field.name}`} aria-label={field.label} checked={Boolean(values[field.name])} onCheckedChange={(checked) => setValue(field.name, checked === true)} /><Label data-component={`${dataComponent}_field_label`} htmlFor={`${formId}-${field.name}`}>{field.label}</Label></div> : <Input key={field.name} data-component={`${dataComponent}_field_control`} aria-label={field.label} required={field.required} type={field.type} inputMode={field.inputMode} maxLength={field.maxLength} value={String(values[field.name] ?? "")} onChange={(event) => setValue(field.name, event.target.value)} placeholder={field.placeholder ?? field.label} />)}<Button data-component={`${dataComponent}_submit`} type="submit" size="sm">입력 제출</Button></form>;
}
