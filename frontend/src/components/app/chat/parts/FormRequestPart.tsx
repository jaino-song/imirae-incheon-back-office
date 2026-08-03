"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type FormField = { name: string; label: string; type: "text" | "number" | "date" | "textarea" | "boolean"; required?: boolean };
type FormRequestPartProps = { formId: string; title: string; fields?: FormField[]; onSubmit?: (formId: string, values: Record<string, unknown>) => void };

export function FormRequestPart({ formId, title, fields = [], onSubmit }: FormRequestPartProps) {
    const [values, setValues] = useState<Record<string, unknown>>({});
    const setValue = (name: string, value: unknown) => setValues((current) => ({ ...current, [name]: value }));
    return <form data-component="desktop_chat_agent-form-request" data-source-component="FormRequestPart" className="flex flex-col gap-3 rounded-xl border bg-card p-4" onSubmit={(event) => { event.preventDefault(); onSubmit?.(formId, values); }}><h3 data-slot="title" className="font-semibold">{title}</h3>{fields.map((field) => field.type === "textarea" ? <Textarea key={field.name} aria-label={field.label} required={field.required} value={String(values[field.name] ?? "")} onChange={(event) => setValue(field.name, event.target.value)} placeholder={field.label} /> : field.type === "boolean" ? <div key={field.name} className="flex items-center gap-2"><Checkbox id={`${formId}-${field.name}`} aria-label={field.label} checked={Boolean(values[field.name])} onCheckedChange={(checked) => setValue(field.name, checked === true)} /><Label htmlFor={`${formId}-${field.name}`}>{field.label}</Label></div> : <Input key={field.name} aria-label={field.label} required={field.required} type={field.type} value={String(values[field.name] ?? "")} onChange={(event) => setValue(field.name, field.type === "number" ? Number(event.target.value) : event.target.value)} placeholder={field.label} />)}<Button type="submit" size="sm">입력 제출</Button></form>;
}
