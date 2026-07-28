"use client";

import { UserPlus } from "lucide-react";

import { Autocomplete } from "@/components/app/ui/Autocomplete";
import { FormSection } from "@/components/app/ui/form-section";
import { StatusBadge } from "@/components/app/ui/status-badge";
import { ToggleRow } from "@/components/app/ui/toggle-row";
import { Block, InputField } from "@/components/app/v3";
import type { ContractCreationFlow } from "@/hooks/contracts/useContractCreationFlow";
import type { Employee } from "@/hooks/useEmployees";
import { matchesKoreanSearch } from "@/lib/search/korean-search";

interface ContractCreationEmployeeStepProps {
  flow: ContractCreationFlow;
}

const stripCityPrefix = (area: string): string => area.replace(/^인천\s*/, "");

const formatEmployeePhone = (phone: string): string => {
  const digits = phone.replace(/\D/g, "");
  if (digits.length !== 11) return phone;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7, 11)}`;
};

export function ContractCreationEmployeeStep({ flow }: ContractCreationEmployeeStepProps) {
  const { form, actions } = flow;

  return (
    <Block name="mobile_contracts-new_employee_step" className="space-y-4">
      <FormSection
        title="제공인력 1"
        badge={<StatusBadge variant="danger">필수</StatusBadge>}
        data-component="mobile_contracts-new_employee_primary-section"
      >
        <Autocomplete<Employee>
          name="contracts-new-employee-primary"
          data-component="mobile_contracts-new_employee_primary-autocomplete"
          value={flow.selectedEmployee}
          onChange={(employee) => actions.selectEmployee(employee?.id ?? null, employee)}
          inputValue={form.employeeName}
          onInputValueChange={actions.changeEmployeeName}
          items={flow.employees.filter((employee) => employee.id !== form.employee2Id)}
          getItemKey={(employee) => employee.id}
          getItemLabel={(employee) => employee.name}
          getItemHeaderExtra={(employee) => (
            <span className="text-xs tabular-nums text-muted-foreground">
              {formatEmployeePhone(employee.phone)}
            </span>
          )}
          getItemMeta={(employee) => (
            <Block name="mobile_contracts-new_employee_primary-area-list" className="flex flex-wrap items-center gap-1">
              {employee.workArea.map((area) => (
                <StatusBadge key={area} variant="primary" size="sm">
                  {stripCityPrefix(area)}
                </StatusBadge>
              ))}
            </Block>
          )}
          filter={(employee, query) =>
            matchesKoreanSearch(employee.name, query) ||
            employee.workArea.some((area) => area.toLowerCase().includes(query.toLowerCase())) ||
            employee.phone.includes(query)
          }
          placeholder="제공인력 검색"
          label="이름"
          required
          emptyMessage="검색 결과가 없습니다."
          manualEntry={{
            label: "직접 입력으로 진행",
            description: "입력한 이름으로 제공인력을 지정합니다",
            icon: <UserPlus className="h-4 w-4" />,
            onSelect: actions.useManualEmployee,
          }}
        />
        <InputField
          title="연락처"
          inputProps={{
            id: "contracts-new-employee-primary-phone",
            value: form.employeePhone,
            onChange: (event) => actions.changeEmployeePhone(event.target.value),
            type: "tel",
            inputMode: "numeric",
            maxLength: 13,
            placeholder: "010-1234-5678",
            required: true,
          }}
        />
      </FormSection>

      <FormSection title="추가 제공인력" data-component="mobile_contracts-new_employee_secondary-section">
        <ToggleRow
          title="제공인력 2 추가"
          checked={form.showEmployee2}
          onClick={actions.toggleEmployee2}
          data-component="mobile_contracts-new_employee_secondary-toggle"
        />
        {form.showEmployee2 ? (
          <Block name="mobile_contracts-new_employee_secondary-fields" className="space-y-3">
            <Autocomplete<Employee>
              name="contracts-new-employee-secondary"
              data-component="mobile_contracts-new_employee_secondary-autocomplete"
              value={flow.selectedEmployee2}
              onChange={(employee) => actions.selectEmployee2(employee?.id ?? null, employee)}
              inputValue={form.employee2Name}
              onInputValueChange={actions.changeEmployee2Name}
              items={flow.employees.filter((employee) => employee.id !== form.employeeId)}
              getItemKey={(employee) => employee.id}
              getItemLabel={(employee) => employee.name}
              getItemHeaderExtra={(employee) => (
                <span className="text-xs tabular-nums text-muted-foreground">
                  {formatEmployeePhone(employee.phone)}
                </span>
              )}
              getItemMeta={(employee) => (
                <Block name="mobile_contracts-new_employee_secondary-area-list" className="flex flex-wrap items-center gap-1">
                  {employee.workArea.map((area) => (
                    <StatusBadge key={area} variant="primary" size="sm">
                      {stripCityPrefix(area)}
                    </StatusBadge>
                  ))}
                </Block>
              )}
              filter={(employee, query) =>
                matchesKoreanSearch(employee.name, query) ||
                employee.workArea.some((area) => area.toLowerCase().includes(query.toLowerCase())) ||
                employee.phone.includes(query)
              }
              placeholder="제공인력 검색"
              label="제공인력 2"
              required
              emptyMessage="검색 결과가 없습니다."
              manualEntry={{
                label: "직접 입력으로 진행",
                description: "입력한 이름으로 제공인력 2를 지정합니다",
                icon: <UserPlus className="h-4 w-4" />,
                onSelect: actions.useManualEmployee2,
              }}
            />
            <InputField
              title="연락처"
              inputProps={{
                id: "contracts-new-employee-secondary-phone",
                value: form.employee2Phone,
                onChange: (event) => actions.changeEmployee2Phone(event.target.value),
                type: "tel",
                inputMode: "numeric",
                maxLength: 13,
                placeholder: "010-1234-5678",
                required: true,
              }}
            />
          </Block>
        ) : null}
      </FormSection>
    </Block>
  );
}
