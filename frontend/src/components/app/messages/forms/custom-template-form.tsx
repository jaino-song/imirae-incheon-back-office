"use client";

import { useEffect, useState } from "react";
import { MessageTemplate } from "@/lib/template/types";
import { renderTemplate } from "@/lib/template/variable-parser";
import { useFormStore } from "@/stores/form-store";
import { useTemplateStore } from "@/stores/template-store";
import { useLocale } from "@/providers/LocaleProvider";
import { t } from "@/lib/i18n/translations";
import { AutoFillMsgCard } from "../templates/AutoFillMsgCard";
import { DynamicInput } from "./form-components/dynamic-input";
import { TemplateFieldGridItem } from "./form-components/TemplateFieldGrid";
import {
    TemplateMessageFormFrame,
    type TemplateMessageFormLayout,
} from "./form-components/TemplateMessageFormLayout";

interface CustomTemplateFormProps {
    template: MessageTemplate;
    onPreviewMessageChange?: (message: string) => void;
    renderLayout?: TemplateMessageFormLayout;
    showMessageSide?: boolean;
}

export const CustomTemplateForm = ({
    template,
    onPreviewMessageChange,
    renderLayout,
    showMessageSide = true,
}: CustomTemplateFormProps) => {
    const locale = useLocale();
    const formStore = useFormStore();
    const { variableValues, setVariableValue } = useTemplateStore();
    const [messageOverride, setMessageOverride] = useState<string | null>(null);

    const formStoreSetters: Partial<Record<keyof typeof FORM_STORE_MAPPING, (value: string) => void>> = {
        name: formStore.setName,
        phone: formStore.setPhone,
        address: formStore.setAddress,
        birthday: formStore.setBirthday,
        employeeName: formStore.setEmployeeName,
        employeePhone: formStore.setEmployeePhone,
        employee2Name: formStore.setEmployee2Name,
        employee2Phone: formStore.setEmployee2Phone,
        startDate: formStore.setStartDate,
        endDate: formStore.setEndDate,
        fullPrice: formStore.setFullPrice,
        grant: formStore.setGrant,
        actualPrice: formStore.setActualPrice,
        area: formStore.setArea,
        voucherType: formStore.setVoucherType,
        voucherDuration: formStore.setVoucherDuration,
    };

    const FORM_STORE_MAPPING: Record<string, keyof typeof formStore> = {
        name: "name",
        phone: "phone",
        address: "address",
        birthday: "birthday",
        employeeName: "employeeName",
        employeePhone: "employeePhone",
        employee2Name: "employee2Name",
        employee2Phone: "employee2Phone",
        startDate: "startDate",
        endDate: "endDate",
        fullPrice: "fullPrice",
        grant: "grant",
        actualPrice: "actualPrice",
        area: "area",
        voucherType: "voucherType",
        voucherDuration: "voucherDuration",
    };

    const getVariableValue = (key: string): string => {
        const storeKey = FORM_STORE_MAPPING[key];
        if (storeKey && typeof formStore[storeKey] === "string") {
            return formStore[storeKey] as string;
        }
        return variableValues[key] || "";
    };

    const handleVariableChange = (key: string, value: string) => {
        setMessageOverride(null);
        const storeKey = FORM_STORE_MAPPING[key];
        if (storeKey) {
            const setter = formStoreSetters[storeKey];
            if (typeof setter === "function") {
                setter(value);
                return;
            }
        }
        setVariableValue(key, value);
    };

    const templateValues = template.variables.reduce<Record<string, string>>((acc, variable) => {
        acc[variable.key] = getVariableValue(variable.key);
        return acc;
    }, {});
    const templateMessage = renderTemplate(template.content, templateValues);
    const generatedMessage = messageOverride ?? templateMessage;

    const handleCopy = () => {
        return navigator.clipboard.writeText(generatedMessage);
    };

    const variableItems = template.variables
        .map((variable) => ({
            token: `{{${variable.key}}}`,
            label: variable.label,
            value: getVariableValue(variable.key).trim() || "-",
        }));

    useEffect(() => {
        if (generatedMessage) {
            onPreviewMessageChange?.(generatedMessage);
        }
    }, [generatedMessage, onPreviewMessageChange]);

    const visibleVariables = renderLayout
        ? template.variables.filter((variable) => variable.key !== "name" && variable.key !== "phone")
        : template.variables;
    const requiresRecipientName = template.variables.some((variable) => variable.key === "name");

    const fields = (
        <>
            {visibleVariables.map((variable) => (
                <TemplateFieldGridItem key={variable.key}>
                    <DynamicInput
                        variable={variable}
                        value={getVariableValue(variable.key)}
                        onChange={(value) => handleVariableChange(variable.key, value)}
                        forceRequired={Boolean(renderLayout)}
                    />
                </TemplateFieldGridItem>
            ))}
        </>
    );

    const messageCard = (
        <AutoFillMsgCard
            title={t(locale, "common.generated-message-title")}
            copyButtonText={t(locale, "common.copy-button")}
            copySuccessMessage={t(locale, "common.copy-success-message")}
            message={generatedMessage}
            bodyDescription={`${template.name} 템플릿의 본문과 변수를 함께 검토할 수 있습니다.`}
            metaItems={[
                { label: "템플릿 유형", value: "사용자 템플릿" },
                { label: "템플릿 이름", value: template.name },
                { label: "활성 변수", value: `${variableItems.length}개` },
            ]}
            variableItems={variableItems}
            variableEmptyText="입력된 변수 값이 없습니다."
            onMessageChange={setMessageOverride}
            handleCopy={handleCopy}
            showSide={showMessageSide}
        />
    );

    return (
        <TemplateMessageFormFrame
            dataComponent="desktop_messages_sections_custom-template-form"
            fields={fields}
            messageCard={messageCard}
            requiresRecipientName={requiresRecipientName}
            renderLayout={renderLayout}
        />
    );
};
