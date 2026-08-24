"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Check } from "lucide-react";
import { useMemo, useState } from "react";
import { useController, useForm } from "react-hook-form";
import { z } from "zod";

import { FormDialogShell } from "@/components/app/ui/FormDialogShell";
import {
  FormChip,
  FormField,
  FormGrid,
  FormHelperText,
  FormNativeSelect,
  FormSection,
} from "@/components/app/ui/form-section";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { SystemAdminUser } from "@/lib/api/users";

type EditableAccountRole = "admin" | "manager" | "user";

const EDITABLE_ACCOUNT_ROLES = ["admin", "manager", "user"] as const;

export interface SystemAdminAccountEditBranchOption {
  id: string;
  name: string;
  isActive: boolean;
}

export interface SystemAdminAccountEditInput {
  role: EditableAccountRole;
  branchIds: string[];
  expectedRole: EditableAccountRole;
  expectedBranchIds: string[];
}

interface SystemAdminAccountEditDialogProps {
  "data-component"?: string;
  open: boolean;
  account: SystemAdminUser;
  branches: readonly SystemAdminAccountEditBranchOption[];
  ownedBranchIds: readonly string[];
  isPending: boolean;
  errorMessage?: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: SystemAdminAccountEditInput) => void;
}

const ACCOUNT_ROLE_OPTIONS = [
  { value: "manager", label: "매니저" },
  { value: "user", label: "직원" },
] as const;

const ADMIN_ACCOUNT_ROLE_OPTIONS = [
  { value: "admin", label: "지점장" },
  ...ACCOUNT_ROLE_OPTIONS,
] as const;

function resolveInitialRole(role: string | null): EditableAccountRole | "" {
  return role === "admin" || role === "manager" || role === "user" ? role : "";
}

function createAccountEditFormSchema({
  activeBranchIds,
  initialAccountRole,
  initialBranchIds,
}: {
  activeBranchIds: readonly string[];
  initialAccountRole: EditableAccountRole | "";
  initialBranchIds: readonly string[];
}) {
  const activeBranchIdSet = new Set(activeBranchIds);

  return z
    .object({
      role: z.union([z.literal(""), z.enum(EDITABLE_ACCOUNT_ROLES)]),
      branchIds: z.array(z.string()),
    })
    .superRefine((values, context) => {
      if (!initialAccountRole) {
        context.addIssue({
          code: "custom",
          message: "현재 계정 권한을 확인할 수 없습니다. 목록을 새로고침해 주세요.",
          path: ["role"],
        });
      } else if (!values.role) {
        context.addIssue({
          code: "custom",
          message: "권한을 선택해 주세요.",
          path: ["role"],
        });
      }

      if (!values.branchIds.some((branchId) => activeBranchIdSet.has(branchId))) {
        context.addIssue({
          code: "custom",
          message:
            values.branchIds.length === 0
              ? "지점을 한 곳 이상 선택해 주세요."
              : "활성 지점을 한 곳 이상 선택해 주세요.",
          path: ["branchIds"],
        });
      }
    })
    .transform((values) => {
      if (!values.role || !initialAccountRole) {
        return z.NEVER;
      }

      return {
        role: values.role,
        branchIds: values.branchIds,
        expectedRole: initialAccountRole,
        expectedBranchIds: [...initialBranchIds],
      };
    });
}

type AccountEditFormSchema = ReturnType<typeof createAccountEditFormSchema>;
type AccountEditFormInput = z.input<AccountEditFormSchema>;
type AccountEditFormOutput = z.output<AccountEditFormSchema>;

export function SystemAdminAccountEditDialog({
  "data-component": dataComponent = "desktop_system-admin_account-edit-dialog",
  open,
  account,
  branches,
  ownedBranchIds,
  isPending,
  errorMessage,
  onOpenChange,
  onSubmit,
}: SystemAdminAccountEditDialogProps) {
  const [initialAccountRole] = useState<EditableAccountRole | "">(() =>
    resolveInitialRole(account.role),
  );
  const [initialBranchIds] = useState<string[]>(() => [
    ...new Set(account.branches.map((branch) => branch.id)),
  ]);
  const availableBranchIds = new Set(branches.map((branch) => branch.id));
  const branchById = new Map(branches.map((branch) => [branch.id, branch]));
  const initialBranchIdSet = new Set(initialBranchIds);
  const hiddenInitialBranchIds = initialBranchIds.filter(
    (branchId) => !availableBranchIds.has(branchId),
  );
  const availableOwnedBranchIds = new Set(
    ownedBranchIds.filter((branchId) => availableBranchIds.has(branchId)),
  );
  const initialSelectedBranchIds = [
    ...new Set([...initialBranchIds, ...availableOwnedBranchIds]),
  ];
  const formSchema = useMemo(
    () =>
      createAccountEditFormSchema({
        activeBranchIds: branches
          .filter((branch) => branch.isActive)
          .map((branch) => branch.id),
        initialAccountRole,
        initialBranchIds,
      }),
    [branches, initialAccountRole, initialBranchIds],
  );
  const {
    clearErrors,
    control,
    formState: { errors },
    handleSubmit,
  } = useForm<AccountEditFormInput, undefined, AccountEditFormOutput>({
    defaultValues: {
      role: initialAccountRole,
      branchIds: initialSelectedBranchIds,
    },
    mode: "onSubmit",
    reValidateMode: "onChange",
    resolver: zodResolver(formSchema, undefined, { mode: "sync" }),
    shouldFocusError: false,
  });
  const { field: roleField } = useController({
    control,
    name: "role",
  });
  const { field: branchIdsField } = useController({
    control,
    name: "branchIds",
  });
  const role = roleField.value;
  const selectedBranchIds = branchIdsField.value;
  const validationError = errors.role?.message ?? errors.branchIds?.message ?? null;
  const formId = `system-admin-account-edit-${account.id}`;
  const validationErrorId = `${formId}-validation-error`;
  const isCurrentAccountAdmin = initialAccountRole === "admin";
  const isPreservingAdminRole = isCurrentAccountAdmin && role === "admin";
  const roleOptions = isCurrentAccountAdmin
    ? ADMIN_ACCOUNT_ROLE_OPTIONS
    : ACCOUNT_ROLE_OPTIONS;
  const hasBranchValidationError = Boolean(errors.branchIds);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && isPending) return;
    onOpenChange(nextOpen);
  };

  const toggleBranch = (branchId: string) => {
    const branch = branches.find((branchOption) => branchOption.id === branchId);
    if (
      !branch?.isActive ||
      (isPreservingAdminRole && availableOwnedBranchIds.has(branchId))
    ) {
      return;
    }

    branchIdsField.onChange(
      selectedBranchIds.includes(branchId)
        ? selectedBranchIds.filter((currentBranchId) => currentBranchId !== branchId)
        : [...selectedBranchIds, branchId],
    );
    clearErrors("branchIds");
  };

  const submitAccountEdit = (values: AccountEditFormOutput) => {
    const selectedBranchIdSet = new Set([
      ...values.branchIds,
      ...(values.role === "admin" ? availableOwnedBranchIds : []),
      ...hiddenInitialBranchIds,
    ]);
    onSubmit({
      role: values.role,
      branchIds: [
        ...branches
          .filter(
            (branch) =>
              selectedBranchIdSet.has(branch.id) &&
              (values.role === "admin" || branch.isActive),
          )
          .map((branch) => branch.id),
        ...hiddenInitialBranchIds,
      ],
      expectedRole: values.expectedRole,
      expectedBranchIds: values.expectedBranchIds,
    });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <FormDialogShell
        data-component={dataComponent}
        eyebrow={account.name ?? account.email ?? "계정"}
        title="계정 수정"
        description="계정 권한과 소속 지점을 수정합니다."
        contentClassName="space-y-5"
        footer={
          <>
            <Button
              type="button"
              variant="neutral"
              disabled={isPending}
              onClick={() => handleOpenChange(false)}
            >
              취소
            </Button>
            <Button type="submit" form={formId} variant="positive" disabled={isPending}>
              {isPending ? "저장 중…" : "저장"}
            </Button>
          </>
        }
      >
        <form
          id={formId}
          data-component={`${dataComponent}_form`}
          onSubmit={handleSubmit(submitAccountEdit)}
          noValidate
        >
          <FormSection
            data-component={`${dataComponent}_form_account-section`}
            title="권한과 소속 지점"
            description="계정이 이용할 권한과 지점을 지정해 주세요. 여러 지점을 선택할 수 있어요."
          >
            <FormGrid data-component={`${dataComponent}_form_account-section_fields`} className="sm:grid-cols-1">
              <FormField
                data-component={`${dataComponent}_form_account-section_fields_role-field`}
                label="권한"
                htmlFor={`${formId}-role`}
                required
              >
                <FormNativeSelect
                  id={`${formId}-role`}
                  data-component={`${dataComponent}_form_account-section_fields_role-field_select`}
                  value={role}
                  placeholder={role ? undefined : "권한 선택"}
                  options={roleOptions}
                  disabled={isPending}
                  name={roleField.name}
                  onBlur={roleField.onBlur}
                  aria-invalid={Boolean(errors.role) || undefined}
                  aria-describedby={errors.role ? validationErrorId : undefined}
                  onValueChange={(value) => {
                    const nextRole = value as EditableAccountRole;
                    roleField.onChange(nextRole);
                    if (nextRole === "admin") {
                      branchIdsField.onChange([
                        ...new Set([
                          ...selectedBranchIds,
                          ...availableOwnedBranchIds,
                          ...hiddenInitialBranchIds,
                        ]),
                      ]);
                    } else if (isCurrentAccountAdmin) {
                      branchIdsField.onChange(
                        selectedBranchIds.filter((branchId) => {
                          const branch = branchById.get(branchId);
                          return branch
                            ? branch.isActive
                            : initialBranchIdSet.has(branchId);
                        }),
                      );
                    }
                    clearErrors();
                  }}
                />
                {isCurrentAccountAdmin ? (
                  <FormHelperText
                    data-component={`${dataComponent}_form_account-section_fields_role-field_admin-help`}
                  >
                    {isPreservingAdminRole
                      ? "지점장으로 임명된 지점은 지점 정보에서만 해제할 수 있어 선택이 고정됩니다. 비활성 소유 지점도 지점 정보에서 관리해 주세요."
                      : "매니저 또는 직원으로 변경해 저장하면 지점장 임명이 해제됩니다. 이후 임명 지점도 소속에서 제외할 수 있어요."}
                  </FormHelperText>
                ) : null}
              </FormField>

              <FormField
                data-component={`${dataComponent}_form_account-section_fields_branches-field`}
                label="소속 지점"
                required
              >
                <fieldset
                  data-component={`${dataComponent}_form_account-section_fields_branches-field_options`}
                  aria-invalid={hasBranchValidationError || undefined}
                  aria-describedby={hasBranchValidationError ? validationErrorId : undefined}
                  className="m-0 flex min-w-0 flex-wrap gap-2 border-0 p-0"
                >
                  <legend
                    data-component={`${dataComponent}_form_account-section_fields_branches-field_options_label`}
                    className="sr-only"
                  >
                    소속 지점
                  </legend>
                  {branches.map((branch) => {
                    const isSelected = selectedBranchIds.includes(branch.id);
                    const isOwnedBranchLocked =
                      isPreservingAdminRole && availableOwnedBranchIds.has(branch.id);
                    const isInactiveBranchDisabled = !branch.isActive;
                    const branchLabel = `${branch.name}${branch.isActive ? "" : " (비활성)"}`;
                    return (
                      <FormChip
                        key={branch.id}
                        data-component={`${dataComponent}_form_account-section_fields_branches-field_options_${branch.id}-chip`}
                        selected={isSelected}
                        disabled={
                          isPending || isOwnedBranchLocked || isInactiveBranchDisabled
                        }
                        className="inline-flex items-center gap-1.5"
                        aria-label={
                          isOwnedBranchLocked
                            ? `${branchLabel} 지점: 지점장 임명으로 선택 고정`
                            : isInactiveBranchDisabled
                              ? `${branchLabel} 지점: 비활성으로 선택 불가`
                              : `${branchLabel} 지점 ${isSelected ? "선택 해제" : "선택"}`
                        }
                        onClick={() => toggleBranch(branch.id)}
                      >
                        {isSelected ? <Check aria-hidden="true" /> : null}
                        {branchLabel}
                      </FormChip>
                    );
                  })}
                </fieldset>
                <FormHelperText
                  data-component={`${dataComponent}_form_account-section_fields_branches-field_help`}
                >
                  로그인 후 선택할 수 있는 소속 지점을 한 곳 이상 지정해 주세요.
                </FormHelperText>
                {hiddenInitialBranchIds.length > 0 ? (
                  <FormHelperText
                    data-component={`${dataComponent}_form_account-section_fields_branches-field_hidden-membership-help`}
                    role="status"
                  >
                    현재 지점 목록에 표시되지 않는 기존 소속 {hiddenInitialBranchIds.length}개를
                    보존 중입니다.
                  </FormHelperText>
                ) : null}
              </FormField>
            </FormGrid>
          </FormSection>

          {validationError ? (
            <FormHelperText
              id={validationErrorId}
              data-component={`${dataComponent}_form_validation-error`}
              tone="error"
              role="alert"
            >
              {validationError}
            </FormHelperText>
          ) : null}
          {errorMessage ? (
            <FormHelperText
              data-component={`${dataComponent}_form_server-error`}
              tone="error"
              role="alert"
            >
              {errorMessage}
            </FormHelperText>
          ) : null}
        </form>
      </FormDialogShell>
    </Dialog>
  );
}
