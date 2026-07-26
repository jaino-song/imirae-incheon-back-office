"use client";
import { useEffect, useState } from "react";
import { thanksMsgTemplate } from "../templates/messageTemplate/thanksMsg";
import { t } from "@/lib/i18n/translations";
import { useFormStore } from "@/stores/form-store";
import { useLocale } from "@/providers/LocaleProvider";
import { useSystemTemplate } from "@/features/system-templates/hooks";
import { renderTemplate } from "@/lib/template-utils";
import { AutoFillMsgCard } from "../templates/AutoFillMsgCard";
import { NameInput } from "./form-components/NameInput";
import { TemplateFieldGridItem } from "./form-components/TemplateFieldGrid";
import {
  TemplateMessageFormFrame,
  type TemplateMessageFormLayout,
} from "./form-components/TemplateMessageFormLayout";

interface ThanksMessageFormProps {
  onPreviewMessageChange?: (message: string) => void;
  renderLayout?: TemplateMessageFormLayout;
  showMessageSide?: boolean;
}

export const ThanksMessageForm = ({
  onPreviewMessageChange,
  renderLayout,
  showMessageSide = true,
}: ThanksMessageFormProps) => {
  const locale = useLocale();
  const [messageOverride, setMessageOverride] = useState<string | null>(null);
  const { name, setName } = useFormStore();
  const { data: systemTemplate } = useSystemTemplate("THANKS");
  const normalizedName = name.trim();
  const templateMessage = systemTemplate?.content
    ? renderTemplate(systemTemplate.content, { name: normalizedName })
    : thanksMsgTemplate({ name: normalizedName || "{{name}}" });
  const generatedMessage = messageOverride ?? templateMessage;

  const handleCopy = () => {
    return navigator.clipboard.writeText(generatedMessage);
  };

  const variableItems = [
    { token: "{{name}}", label: t(locale, "thanks-msg.name-label"), value: name.trim() || "-" },
  ];

  useEffect(() => {
    if (generatedMessage) {
      onPreviewMessageChange?.(generatedMessage);
    }
  }, [generatedMessage, onPreviewMessageChange]);

  const fields = renderLayout ? null : (
    <TemplateFieldGridItem>
      <NameInput
        name={name}
        setName={(value) => {
          setName(value);
          setMessageOverride(null);
        }}
        label={t(locale, "thanks-msg.name-label")}
        placeholder={t(locale, "thanks-msg.name-placeholder")}
      />
    </TemplateFieldGridItem>
  );

  const messageCard = (
    <AutoFillMsgCard
      title={t(locale, "common.generated-message-title")}
      copyButtonText={t(locale, "common.copy-button")}
      copySuccessMessage={t(locale, "common.copy-success-message")}
      message={generatedMessage}
      bodyDescription={systemTemplate?.description || "감사 메시지를 검토하고 수신자 기준으로 다듬을 수 있습니다."}
      metaItems={[
        { label: "템플릿 유형", value: "감사 메시지" },
        { label: t(locale, "thanks-msg.name-label"), value: name.trim() || "-" },
      ]}
      variableItems={variableItems}
      onMessageChange={setMessageOverride}
      handleCopy={handleCopy}
      showSide={showMessageSide}
    />
  );

  return (
    <TemplateMessageFormFrame
      dataComponent="desktop_messages_sections_thanks-form"
      fields={fields}
      messageCard={messageCard}
      requiresRecipientName
      renderLayout={renderLayout}
    />
  );
};
