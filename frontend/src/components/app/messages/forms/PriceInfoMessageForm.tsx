"use client";
import { useState, useEffect, useRef, type ReactNode } from "react";
import voucherOptions from "../templates/json/voucher.json";
import { AutoFillMsgCard } from "../templates/AutoFillMsgCard";
import bankAccountJSON from "../templates/json/bank-account.json";
import { priceInfoMsgTemplate } from "../templates/messageTemplate/priceInfoMsg";
import { t } from "@/lib/i18n/translations";
import { useFormStore } from "@/stores/form-store";
import { useLocale } from "@/providers/LocaleProvider";
import { useBankAccountInfos, useVoucherPriceInfos, type VoucherPriceInfo } from "@/hooks";
import { useSystemTemplate } from "@/features/system-templates/hooks";
import { renderTemplate } from "@/lib/template-utils";
import { NameInput } from "./form-components/NameInput";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { TemplateFieldGridItem } from "./form-components/TemplateFieldGrid";
import {
  TemplateMessageFormFrame,
  type TemplateMessageFormLayout,
} from "./form-components/TemplateMessageFormLayout";

interface PriceInfoFormData {
  name: string;
  weeks: number;
  duration: string;
  type: string;
  voucherId: number | null;
  fullPrice: string;
  grant: string;
  actualPrice: string;
  area: string;
  bankName: string;
  accNum: string;
}

interface BankAccountInfo {
  area: string;
  bankName: string;
  accNum: string;
}

// 가격 포맷팅 (천 단위 콤마)
function formatPrice(price: string): string {
  const num = parseInt(price.replace(/[,원\s]/g, ""), 10);
  if (isNaN(num)) return price;
  return num.toLocaleString("ko-KR");
}

function getWeeksFromDuration(duration: string) {
  const days = Number(duration);
  return Number.isFinite(days) ? Math.floor(days / 5) : 0;
}

function getVoucherDerivedFields(selectedVoucher: VoucherPriceInfo) {
  const duration = selectedVoucher.duration;

  return {
    duration,
    weeks: getWeeksFromDuration(duration),
    voucherId: selectedVoucher.id,
    fullPrice: selectedVoucher.fullPrice?.toString() ?? "",
    grant: selectedVoucher.grant?.toString() ?? "",
    actualPrice: selectedVoucher.actualPrice?.toString() ?? "",
  };
}

interface PriceInfoMessageFormProps {
  onPreviewMessageChange?: (message: string) => void;
  renderLayout?: TemplateMessageFormLayout;
  showMessageSide?: boolean;
}

function RequiredLabel({ children }: { children: ReactNode }) {
  return (
    <Label>
      {children}
      <span className="text-destructive ml-1">*</span>
    </Label>
  );
}

export const PriceInfoMessageForm = ({
  onPreviewMessageChange,
  renderLayout,
  showMessageSide = true,
}: PriceInfoMessageFormProps) => {
  const locale = useLocale();
  const [messageOverride, setMessageOverride] = useState<string | null>(null);
  const [durationTooltipOpen, setDurationTooltipOpen] = useState<boolean>(false);
  const tooltipTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current);
    };
  }, []);
  const { data: systemTemplate } = useSystemTemplate("PRICE_INFO");
 
  // Subscribe to Zustand store
  const {
    name,
    voucherType,
    voucherDuration,
    voucherYear,
    fullPrice,
    grant,
    actualPrice,
    area,
    setName,
    setVoucherType,
    setVoucherDuration,
    setFullPrice,
    setActualPrice,
    setGrant,
    setVoucherYear,
    setArea,
  } = useFormStore();

  const [formData, setFormData] = useState<PriceInfoFormData>({
    name: name,
    weeks: 0,
    duration: voucherDuration,
    type: voucherType,
    voucherId: null,
    fullPrice,
    grant,
    actualPrice,
    area,
    bankName: "",
    accNum: "",
  });

  // Sync local state with Zustand store when store changes
  useEffect(() => {
    queueMicrotask(() => {
      setFormData(prev => ({
        ...prev,
        name: name,
        weeks: voucherDuration ? getWeeksFromDuration(voucherDuration) : 0,
        duration: voucherDuration,
        type: voucherType,
        fullPrice,
        grant,
        actualPrice,
        area,
      }));
    });
  }, [name, voucherType, voucherDuration, fullPrice, grant, actualPrice, area]);

  // Bank account info query
  const { data: bankAccountInfos = [] } = useBankAccountInfos();

  // Voucher price info query (연도 필터 적용)
  const { data: voucherPriceInfos = [], isLoading: isVoucherPriceInfosLoading } = useVoucherPriceInfos(formData.type, voucherYear);

  // Voucher type change handler
  const handleVoucherTypeChange = (value: string) => {
    setFormData(prev => ({
      ...prev,
      type: value,
      weeks: 0,
      duration: "",
      voucherId: null,
      fullPrice: "",
      grant: "",
      actualPrice: "",
    }));
    setMessageOverride(null);
    setVoucherType(value); // Update Zustand store
    setVoucherDuration(""); // Reset duration in store when type changes
    setFullPrice("");
    setGrant("");
    setActualPrice("");
  };

  const handleDurationChange = (duration: string) => {
    const selectedVoucher = voucherPriceInfos.find(v => v.duration === duration);
    if (selectedVoucher) {
      const derivedFields = getVoucherDerivedFields(selectedVoucher);

      setFormData(prev => ({
        ...prev,
        ...derivedFields,
      }));
      setMessageOverride(null);
      // Update Zustand store
      setVoucherDuration(derivedFields.duration);
      setFullPrice(derivedFields.fullPrice);
      setGrant(derivedFields.grant);
      setActualPrice(derivedFields.actualPrice);
    }
  };

  const handleAreaChange = (value: string) => {
    setFormData(prev => ({
      ...prev,
      area: value ?? "",
      bankName: bankAccountInfos.find(b => b.area === value)?.bankName ?? "",
      accNum: bankAccountInfos.find(b => b.area === value)?.accNum ?? "",
    }));
    setMessageOverride(null);
    setArea(value ?? "");
  };

  useEffect(() => {
    if (!formData.duration) return;

    const selectedVoucher = voucherPriceInfos.find(v => v.duration === formData.duration);
    if (!selectedVoucher) return;

    const derivedFields = getVoucherDerivedFields(selectedVoucher);

    queueMicrotask(() => {
      setFormData(prev => {
        if (
          prev.weeks === derivedFields.weeks &&
          prev.voucherId === derivedFields.voucherId &&
          prev.fullPrice === derivedFields.fullPrice &&
          prev.grant === derivedFields.grant &&
          prev.actualPrice === derivedFields.actualPrice
        ) {
          return prev;
        }

        return {
          ...prev,
          ...derivedFields,
        };
      });

      setFullPrice(derivedFields.fullPrice);
      setGrant(derivedFields.grant);
      setActualPrice(derivedFields.actualPrice);
    });
  }, [formData.duration, voucherPriceInfos, setFullPrice, setGrant, setActualPrice]);

  useEffect(() => {
    if (!formData.area) return;

    const bankAccountInfo = bankAccountInfos.find(b => b.area === formData.area);
    if (!bankAccountInfo) return;

    queueMicrotask(() => {
      setFormData(prev => {
        if (prev.bankName === bankAccountInfo.bankName && prev.accNum === bankAccountInfo.accNum) {
          return prev;
        }

        return {
          ...prev,
          bankName: bankAccountInfo.bankName,
          accNum: bankAccountInfo.accNum,
        };
      });
    });
  }, [bankAccountInfos, formData.area]);

  const handleDurationTooltipOpen = (open: boolean) => {
    if (!formData.type && open) {
      setDurationTooltipOpen(true);
      if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current);
      tooltipTimerRef.current = setTimeout(() => setDurationTooltipOpen(false), 3000);
    } else {
      setDurationTooltipOpen(false);
    }
  };

  const normalizedName = formData.name.trim();
  const templateMessage = systemTemplate?.content
    ? renderTemplate(systemTemplate.content, {
        name: normalizedName,
        weeks: formData.weeks || undefined,
        duration: formData.duration,
        type: formData.type,
        fullPrice: formData.fullPrice ? formatPrice(formData.fullPrice) : undefined,
        grant: formData.grant ? formatPrice(formData.grant) : undefined,
        actualPrice: formData.actualPrice ? formatPrice(formData.actualPrice) : undefined,
        bankName: formData.bankName,
        accNum: formData.accNum,
      })
    : priceInfoMsgTemplate({
        name: normalizedName || "{{name}}",
        weeks: formData.weeks || "{{weeks}}",
        duration: formData.duration || "{{duration}}",
        type: formData.type || "{{type}}",
        fullPrice: formData.fullPrice ? formatPrice(formData.fullPrice) : "{{fullPrice}}",
        grant: formData.grant ? formatPrice(formData.grant) : "{{grant}}",
        actualPrice: formData.actualPrice ? formatPrice(formData.actualPrice) : "{{actualPrice}}",
        bankName: formData.bankName || "{{bankName}}",
        accNum: formData.accNum || "{{accNum}}",
      });
  const generatedMessage = messageOverride ?? templateMessage;

  const handleCopy = () => {
    return navigator.clipboard.writeText(generatedMessage);
  };

  const priceMetaItems = [
    { label: "템플릿 유형", value: "요금 안내" },
    { label: t(locale, "price-info-msg.name-label"), value: formData.name || "-" },
    { label: t(locale, "price-info-msg.voucher-type-label"), value: formData.type || "-" },
    { label: t(locale, "price-info-msg.duration-label"), value: formData.duration ? `${formData.duration}일` : "-" },
    { label: t(locale, "price-info-msg.area-label"), value: formData.area || "-" },
  ];

  const priceVariableItems = [
    { token: "{{name}}", label: t(locale, "price-info-msg.name-label"), value: formData.name || "-" },
    { token: "{{type}}", label: t(locale, "price-info-msg.voucher-type-label"), value: formData.type || "-" },
    { token: "{{weeks}}", label: t(locale, "price-info-msg.weeks-label"), value: formData.weeks ? `${formData.weeks}주` : "-" },
    { token: "{{duration}}", label: t(locale, "price-info-msg.duration-label"), value: formData.duration ? `${formData.duration}일` : "-" },
    { token: "{{fullPrice}}", label: t(locale, "price-info-msg.full-price-label"), value: formData.fullPrice ? `${formatPrice(formData.fullPrice)}${t(locale, "common.currency-symbol")}` : "-" },
    { token: "{{grant}}", label: t(locale, "price-info-msg.grant-price-label"), value: formData.grant ? `${formatPrice(formData.grant)}${t(locale, "common.currency-symbol")}` : "-" },
    { token: "{{actualPrice}}", label: t(locale, "price-info-msg.actual-price-label"), value: formData.actualPrice ? `${formatPrice(formData.actualPrice)}${t(locale, "common.currency-symbol")}` : "-" },
    { token: "{{bankName}}", label: "은행명", value: formData.bankName || "-" },
    { token: "{{accNum}}", label: "계좌번호", value: formData.accNum || "-" },
  ];

  useEffect(() => {
    if (generatedMessage) {
      onPreviewMessageChange?.(generatedMessage);
    }
  }, [generatedMessage, onPreviewMessageChange]);

  const fields = (
    <>
      {renderLayout ? null : (
        <TemplateFieldGridItem>
          <NameInput
            name={name}
            setName={(value) => {
              setName(value);
              setMessageOverride(null);
            }}
            label={t(locale, "price-info-msg.name-label")}
            placeholder={t(locale, "price-info-msg.name-placeholder")}
            required
          />
        </TemplateFieldGridItem>
      )}
      <TemplateFieldGridItem>
        <RequiredLabel>
          {isVoucherPriceInfosLoading
            ? t(locale, "common.loading")
            : t(locale, "price-info-msg.voucher-type-label")}
        </RequiredLabel>
        <Select
          value={formData.type}
          onValueChange={handleVoucherTypeChange}
          disabled={isVoucherPriceInfosLoading}
          required
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder={t(locale, "price-info-msg.voucher-type-label")} />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(voucherOptions.voucherOptions).map(([groupName, types]) => (
              <div key={groupName}>
                <div className="px-2 py-1.5 text-sm font-semibold text-muted-foreground">
                  {groupName}
                </div>
                {Object.entries(types).map(([typeValue, typeData]) => (
                  <SelectItem key={typeValue} value={typeValue} className="pl-6">
                    {typeData.label}
                  </SelectItem>
                ))}
              </div>
            ))}
          </SelectContent>
        </Select>
      </TemplateFieldGridItem>

      <TemplateFieldGridItem>
        <RequiredLabel>{t(locale, "price-info-msg.duration-label")}</RequiredLabel>
        <TooltipProvider delayDuration={0}>
          <Tooltip open={durationTooltipOpen} onOpenChange={handleDurationTooltipOpen}>
            <TooltipTrigger asChild>
              <div tabIndex={!formData.type ? 0 : -1}>
                <Select
                  value={formData.duration || undefined}
                  onValueChange={handleDurationChange}
                  disabled={!formData.type || voucherPriceInfos.length === 0}
                  required
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t(locale, "price-info-msg.duration-label")} />
                  </SelectTrigger>
                  <SelectContent>
                    {voucherPriceInfos.map((v) => (
                      <SelectItem key={v.id} value={v.duration}>
                        {v.duration}일
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p>바우처 유형을 선택하세요</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </TemplateFieldGridItem>

      <TemplateFieldGridItem>
        <RequiredLabel>{t(locale, "price-info-msg.area-label")}</RequiredLabel>
        <Select value={formData.area || undefined} onValueChange={handleAreaChange} required>
          <SelectTrigger className="w-full">
            <SelectValue placeholder={t(locale, "price-info-msg.area-label")} />
          </SelectTrigger>
          <SelectContent>
            {Object.values(bankAccountInfos).map((bankAccountInfo: BankAccountInfo) => (
              <SelectItem key={bankAccountInfo.area} value={bankAccountInfo.area}>
                {bankAccountJSON[bankAccountInfo.area as keyof typeof bankAccountJSON].area}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TemplateFieldGridItem>

      <TemplateFieldGridItem>
        <RequiredLabel>
          {t(locale, "price-info-msg.voucher-year-label")}
        </RequiredLabel>
        <Select
          value={String(voucherYear)}
          onValueChange={(value: string) => {
            setVoucherYear(Number(value));
            setFormData((prev) => ({
              ...prev,
              weeks: 0,
              duration: "",
              voucherId: null,
              fullPrice: "",
              grant: "",
              actualPrice: "",
            }));
            setMessageOverride(null);
            setVoucherDuration("");
            setFullPrice("");
            setGrant("");
            setActualPrice("");
          }}
          required
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder={t(locale, "price-info-msg.voucher-year-label")} />
          </SelectTrigger>
          <SelectContent>
            {[voucherYear - 1, voucherYear, voucherYear + 1].map((year) => (
              <SelectItem key={year} value={String(year)}>
                {year}년
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TemplateFieldGridItem>

    </>
  );

  const messageCard = (
    <AutoFillMsgCard
      title={t(locale, "common.generated-message-title")}
      copyButtonText={t(locale, "common.copy-button")}
      copySuccessMessage={t(locale, "common.copy-success-message")}
      message={generatedMessage}
      bodyDescription={systemTemplate?.description || "요금 안내 문구와 가격 변수를 한눈에 검토할 수 있습니다."}
      metaItems={priceMetaItems}
      variableItems={priceVariableItems}
      onMessageChange={setMessageOverride}
      handleCopy={handleCopy}
      showSide={showMessageSide}
    />
  );

  return (
    <TemplateMessageFormFrame
      dataComponent="desktop_messages_sections_price-info-form"
      fields={fields}
      messageCard={messageCard}
      requiresRecipientName
      renderLayout={renderLayout}
    />
  );
};
