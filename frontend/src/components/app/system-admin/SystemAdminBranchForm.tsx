"use client";

import { useState, type FormEvent } from "react";
import { z } from "zod";

import { FormCard } from "@/components/app/v3";
import { FormNativeSelect } from "@/components/app/ui/form-section";
import { FormCheckboxField } from "@/components/molecules/forms/FormCheckboxField";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { TitleTextInputMolecule } from "@/components/ui/title-text-input-molecule";
import type { SystemAdminBranchInput, SystemAdminBranchRequest } from "@/lib/api/system-admin";

interface BranchManagerOption {
  id: string;
  label: string;
}

interface SystemAdminBranchFormProps {
  mode: "create" | "edit";
  branch?: SystemAdminBranchRequest;
  managerOptions: readonly BranchManagerOption[];
  isSubmitting: boolean;
  submitError?: string;
  onCancel: () => void;
  onSubmit: (input: SystemAdminBranchInput) => void;
}

const branchFormSchema = z.object({
  name: z.string().trim().min(1, "지점명을 입력해 주세요.").max(100),
  slug: z
    .string()
    .trim()
    .min(1, "영문 지점 코드를 입력해 주세요.")
    .max(100)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "영문 소문자, 숫자, 하이픈만 사용할 수 있어요."),
  ownerId: z.string().transform((value) => (value ? value : null)),
  region: z.string().trim().max(100).optional(),
  district: z.string().trim().max(100).optional(),
  address: z.string().trim().max(255).optional(),
  phone: z.string().trim().max(30).optional(),
  email: z
    .string()
    .trim()
    .max(255)
    .refine((value) => value.length === 0 || z.string().email().safeParse(value).success, {
      message: "올바른 이메일 주소를 입력해 주세요.",
    })
    .optional(),
  isActive: z.boolean(),
});

type BranchFormField = keyof z.infer<typeof branchFormSchema>;
type BranchFormErrors = Partial<Record<BranchFormField, string>>;

function optionalValue(formData: FormData, name: string): string | undefined {
  const value = String(formData.get(name) ?? "").trim();
  return value || undefined;
}

const formatPhoneNumber = (value: string): string => {
  const digits = value.replace(/\D/g, "");

  if (digits.length <= 3) {
    return digits;
  } else if (digits.length <= 7) {
    return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  } else {
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7, 11)}`;
  }
};

export function SystemAdminBranchForm({
  mode,
  branch,
  managerOptions,
  isSubmitting,
  submitError,
  onCancel,
  onSubmit,
}: SystemAdminBranchFormProps) {
  const [errors, setErrors] = useState<BranchFormErrors>({});
  const [phone, setPhone] = useState(branch?.phone ?? "");

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const result = branchFormSchema.safeParse({
      name: String(formData.get("name") ?? ""),
      slug: String(formData.get("slug") ?? ""),
      ownerId: String(formData.get("ownerId") ?? ""),
      region: optionalValue(formData, "region"),
      district: branch?.district,
      address: optionalValue(formData, "address"),
      phone: optionalValue(formData, "phone"),
      email: optionalValue(formData, "email"),
      isActive: formData.get("isActive") === "on",
    });

    if (!result.success) {
      const nextErrors: BranchFormErrors = {};
      result.error.issues.forEach((issue) => {
        const field = issue.path[0] as BranchFormField | undefined;
        if (field && !nextErrors[field]) nextErrors[field] = issue.message;
      });
      setErrors(nextErrors);
      return;
    }

    setErrors({});
    onSubmit(result.data);
  };

  return (
    <form
      data-component="desktop_system-admin_sections_branch-form"
      className="space-y-5"
      noValidate
      onSubmit={handleSubmit}
    >
      <FormCard
        title="기본 정보"
        description="목록과 외부 경로에서 사용할 지점 정보를 입력해 주세요."
        contentClassName="grid gap-4 sm:grid-cols-2"
      >
        <TitleTextInputMolecule
          name="name"
          label="지점명"
          required
          defaultValue={branch?.name ?? ""}
          error={Boolean(errors.name)}
          helperText={errors.name}
          disabled={isSubmitting}
          autoComplete="organization"
          dataComponent="desktop_system-admin_sections_branch-form-field"
          inputDataComponent="desktop_system-admin_sections_branch-form_name"
        />
        <TitleTextInputMolecule
          name="slug"
          label="영문 지점 코드"
          labelTrailing={
            <span className="text-[calc(11.5px*var(--glint-ui-scale,1))] font-semibold text-v3-text-muted">
              영문 소문자, 숫자, 하이픈으로 입력해 주세요.
            </span>
          }
          labelTrailingDataComponent="desktop_system-admin_sections_branch-form_slug-guide"
          required
          defaultValue={branch?.slug ?? ""}
          error={Boolean(errors.slug)}
          helperText={errors.slug}
          disabled={isSubmitting}
          autoComplete="off"
          dataComponent="desktop_system-admin_sections_branch-form-field"
          inputDataComponent="desktop_system-admin_sections_branch-form_slug"
        />
        <div data-component="desktop_system-admin_sections_branch-form_manager" className="grid gap-[calc(7px*var(--glint-ui-scale,1))] sm:col-span-2">
          <Label
            htmlFor="system-admin-branch-manager"
            className="text-[calc(12px*var(--glint-ui-scale,1))] font-semibold leading-[1.3] text-v3-text-muted"
          >
            지점장
          </Label>
          <FormNativeSelect
            id="system-admin-branch-manager"
            name="ownerId"
            selectDataComponent="desktop_system-admin_sections_branch-form_manager-select"
            defaultValue={branch?.owner?.id ?? ""}
            disabled={isSubmitting || managerOptions.length === 0}
            aria-invalid={Boolean(errors.ownerId)}
            aria-describedby={errors.ownerId ? "system-admin-branch-manager-error" : undefined}
            options={[
              { value: "", label: "지정 안함" },
              ...managerOptions.map((manager) => ({ value: manager.id, label: manager.label })),
            ]}
          />
          {errors.ownerId ? (
            <p
              id="system-admin-branch-manager-error"
              data-component="desktop_system-admin_sections_branch-form_manager_error"
              className="text-[calc(11.5px*var(--glint-ui-scale,1))] font-semibold text-destructive"
              role="alert"
            >
              {errors.ownerId}
            </p>
          ) : null}
        </div>
      </FormCard>

      <FormCard title="연락처 및 운영 정보" contentClassName="grid gap-4 sm:grid-cols-2">
        <TitleTextInputMolecule
          name="region"
          label="지역"
          defaultValue={branch?.region ?? ""}
          error={Boolean(errors.region)}
          helperText={errors.region}
          disabled={isSubmitting}
          containerClassName="sm:col-span-2"
          dataComponent="desktop_system-admin_sections_branch-form-field"
          inputDataComponent="desktop_system-admin_sections_branch-form_region"
        />
        <TitleTextInputMolecule
          name="address"
          label="사무실 주소"
          defaultValue={branch?.address ?? ""}
          error={Boolean(errors.address)}
          helperText={errors.address}
          disabled={isSubmitting}
          autoComplete="street-address"
          containerClassName="sm:col-span-2"
          dataComponent="desktop_system-admin_sections_branch-form-field"
          inputDataComponent="desktop_system-admin_sections_branch-form_address"
        />
        <TitleTextInputMolecule
          name="phone"
          label="대표 전화"
          value={phone}
          onValueChange={(value) => setPhone(formatPhoneNumber(value))}
          error={Boolean(errors.phone)}
          helperText={errors.phone}
          disabled={isSubmitting}
          type="tel"
          inputMode="numeric"
          maxLength={13}
          autoComplete="tel"
          dataComponent="desktop_system-admin_sections_branch-form-field"
          inputDataComponent="desktop_system-admin_sections_branch-form_phone"
        />
        <TitleTextInputMolecule
          name="email"
          label="이메일"
          defaultValue={branch?.email ?? ""}
          error={Boolean(errors.email)}
          helperText={errors.email}
          disabled={isSubmitting}
          type="email"
          autoComplete="email"
          dataComponent="desktop_system-admin_sections_branch-form-field"
          inputDataComponent="desktop_system-admin_sections_branch-form_email"
        />
        <FormCheckboxField
          name="isActive"
          label="운영 중인 지점"
          defaultChecked={branch?.isActive ?? true}
          disabled={isSubmitting}
          data-component="desktop_system-admin_sections_branch-form-active"
          className="sm:col-span-2"
        />
      </FormCard>

      {submitError ? (
        <p
          data-component="desktop_system-admin_sections_branch-form-submit-error"
          className="rounded-[13px] bg-destructive/10 px-4 py-3 text-sm font-semibold text-destructive"
          role="alert"
        >
          {submitError}
        </p>
      ) : null}

      <div
        data-component="desktop_system-admin_sections_branch-form_actions"
        className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"
      >
        <Button type="button" variant="outline" disabled={isSubmitting} onClick={onCancel}>
          취소
        </Button>
        <Button type="submit" variant="default" disabled={isSubmitting}>
          {isSubmitting ? "저장 중…" : mode === "create" ? "지점 추가" : "변경사항 저장"}
        </Button>
      </div>
    </form>
  );
}
