"use client";
import { useEffect, useState } from "react";
import { serviceInfoMsgTemplate } from "../templates/messageTemplate/serviceInfoMsg";
import { t } from "@/lib/i18n/translations";
import { useLocale } from "@/providers/LocaleProvider";
import { useSystemTemplate } from "@/features/system-templates/hooks";
import { renderTemplate } from "@/lib/template-utils";
import { useFormStore } from "@/stores/form-store";
import { AutoFillMsgCard } from "../templates/AutoFillMsgCard";
import { TitleTextInputMolecule } from "./form-components/TitleTextInputMolecule";
import { TemplateFieldGridItem } from "./form-components/TemplateFieldGrid";
import {
  TemplateMessageFormFrame,
  type TemplateMessageFormLayout,
} from "./form-components/TemplateMessageFormLayout";

interface ServiceInfoMessageFormProps {
  onPreviewMessageChange?: (message: string) => void;
  renderLayout?: TemplateMessageFormLayout;
  showMessageSide?: boolean;
}

export const ServiceInfoMessageForm = ({
  onPreviewMessageChange,
  renderLayout,
  showMessageSide = true,
}: ServiceInfoMessageFormProps) => {
  const locale = useLocale();
  const [messageOverride, setMessageOverride] = useState<string | null>(null);
  const { name, setName } = useFormStore();
  const { data: systemTemplate } = useSystemTemplate("SERVICE_INFO");

  const handleCopy = () => {
    return navigator.clipboard.writeText(generatedMessage);
  };

  const variableItems = [
    { token: "{{name}}", label: t(locale, "service-info-msg.name-label"), value: name.trim() || "-" },
  ];

  const normalizedName = name.trim();
  const templateMessage = systemTemplate?.content
    ? renderTemplate(systemTemplate.content, { name: normalizedName })
    : serviceInfoMsgTemplate({ name: normalizedName || "{{name}}" });

  const generatedMessage = messageOverride ?? templateMessage;

  useEffect(() => {
    if (generatedMessage) {
      onPreviewMessageChange?.(generatedMessage);
    }
  }, [generatedMessage, onPreviewMessageChange]);

  const fields = renderLayout ? null : (
    <TemplateFieldGridItem>
      <TitleTextInputMolecule
        id="client-name"
        label={t(locale, "service-info-msg.name-label")}
        value={name}
        onValueChange={(value) => {
          setName(value);
          setMessageOverride(null);
        }}
        placeholder={t(locale, "service-info-msg.name-placeholder")}
        dataComponent="desktop_messages_sections_service-info-name-input"
      />
    </TemplateFieldGridItem>
  );

  const messageCard = (
    <AutoFillMsgCard
      title={t(locale, "common.generated-message-title")}
      copyButtonText={t(locale, "common.copy-button")}
      copySuccessMessage={t(locale, "common.copy-success-message")}
      message={generatedMessage}
      bodyDescription={systemTemplate?.description || "메시지 문구를 직접 수정할 수 있어요."}
      metaItems={[
        { label: "템플릿 유형", value: "서비스 안내" },
        { label: t(locale, "service-info-msg.name-label"), value: name.trim() || "-" },
      ]}
      variableItems={variableItems}
      onMessageChange={setMessageOverride}
      handleCopy={handleCopy}
      showSide={showMessageSide}
    />
  );

  return (
    <TemplateMessageFormFrame
      dataComponent="desktop_messages_sections_service-info-form"
      fields={fields}
      messageCard={messageCard}
      requiresRecipientName
      renderLayout={renderLayout}
    />
  );
};
