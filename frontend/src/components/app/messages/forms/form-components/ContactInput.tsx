"use client";

import { useEffect, useState } from "react";
import type { ChangeEvent } from "react";

import { formatKoreanPhoneNumber } from "@/lib/phone";
import { TitleTextInputMolecule } from "./TitleTextInputMolecule";

const PHONE_REGEX = /^[0-9-]*$/;

interface ContactInputProps {
  phone: string;
  setPhone: (phone: string) => void;
  label: string;
  placeholder: string;
  required?: boolean;
  disabled?: boolean;
  dataComponent?: string;
  containerClassName?: string;
  inputClassName?: string;
  labelClassName?: string;
}

export const ContactInput = ({
  phone,
  setPhone,
  label,
  placeholder,
  required = false,
  disabled = false,
  dataComponent = "desktop_messages_form_contact-input",
  containerClassName,
  inputClassName,
  labelClassName,
}: ContactInputProps) => {
  const [error, setError] = useState(false);
  const formattedPhone = formatKoreanPhoneNumber(phone);

  useEffect(() => {
    if (phone && formattedPhone !== phone) {
      setPhone(formattedPhone);
    }
  }, [formattedPhone, phone, setPhone]);

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;

    if (PHONE_REGEX.test(value)) {
      setPhone(formatKoreanPhoneNumber(value));
      setError(false);
    } else {
      setError(true);
    }
  };

  return (
    <TitleTextInputMolecule
      dataComponent={dataComponent}
      label={label}
      value={formattedPhone}
      onChange={handleChange}
      placeholder={placeholder}
      required={required}
      disabled={disabled}
      error={error}
      helperText={error ? "숫자만 입력할 수 있습니다" : undefined}
      containerClassName={containerClassName}
      inputClassName={inputClassName}
      labelClassName={labelClassName}
    />
  );
};
