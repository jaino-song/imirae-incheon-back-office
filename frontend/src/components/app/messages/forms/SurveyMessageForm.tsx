"use client";
import { useEffect, useState } from "react";
import { surveyMsgTemplate } from "../templates/messageTemplate/surveyMsg";
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

interface SurveyMessageFormProps {
  onPreviewMessageChange?: (message: string) => void;
  renderLayout?: TemplateMessageFormLayout;
  showMessageSide?: boolean;
}

export const SurveyMessageForm = ({
  onPreviewMessageChange,
  renderLayout,
  showMessageSide = true,
}: SurveyMessageFormProps) => {
  const locale = useLocale();
  const [messageOverride, setMessageOverride] = useState<string | null>(null);
  const { name, setName } = useFormStore();
  const { data: systemTemplate } = useSystemTemplate("SURVEY");
  const normalizedName = name.trim();
  const templateMessage = systemTemplate?.content
    ? renderTemplate(systemTemplate.content, { name: normalizedName })
    : surveyMsgTemplate({ name: normalizedName || "{{name}}" });
  const generatedMessage = messageOverride ?? templateMessage;

  const handleCopy = () => {
    return navigator.clipboard.writeText(generatedMessage);
  };

  const variableItems = [
    { token: "{{name}}", label: t(locale, "survey-msg.name-label"), value: name.trim() || "-" },
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
        label={t(locale, "survey-msg.name-label")}
        placeholder={t(locale, "survey-msg.name-placeholder")}
      />
    </TemplateFieldGridItem>
  );

  const messageCard = (
    <AutoFillMsgCard
      title={t(locale, "common.generated-message-title")}
      copyButtonText={t(locale, "common.copy-button")}
      copySuccessMessage={t(locale, "common.copy-success-message")}
      message={generatedMessage}
      bodyDescription={systemTemplate?.description || "설문 안내 문구를 검토하고 수신자별 안내를 조정할 수 있습니다."}
      metaItems={[
        { label: "템플릿 유형", value: "모니터링 설문" },
        { label: t(locale, "survey-msg.name-label"), value: name.trim() || "-" },
      ]}
      variableItems={variableItems}
      onMessageChange={setMessageOverride}
      handleCopy={handleCopy}
      showSide={showMessageSide}
    />
  );

  return (
    <TemplateMessageFormFrame
      dataComponent="desktop_messages_sections_survey-form"
      fields={fields}
      messageCard={messageCard}
      requiresRecipientName
      renderLayout={renderLayout}
    />
  );
};
