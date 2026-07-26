"use client";

import { useState } from "react";
import { TitleTextInputMolecule } from "./TitleTextInputMolecule";

// Regex to allow only letters (Korean, English, spaces)
// Includes:
// - a-zA-Z: English letters
// - ㄱ-ㅎ: Korean consonants (Jamo)
// - ㅏ-ㅣ: Korean vowels (Jamo)
// - 가-힣: Complete Korean syllables (Hangul)
// - ᄀ-ᇿ: Hangul compatibility Jamo (for IME composition)
// - \s: Whitespace
const NAME_REGEX = /^[a-zA-Z\u1100-\u11FF\u3130-\u318F\uAC00-\uD7A3·\s]*$/;

interface NameInputProps {
  name: string;
  setName: (name: string) => void;
  label: string;
  placeholder: string;
  required?: boolean;
}

export const NameInput = ({
  name,
  setName,
  label,
  placeholder,
  required = false,
}: NameInputProps) => {
  const [error, setError] = useState(false);

  const handleChange = (value: string) => {
    // Check if input contains only valid characters
    if (NAME_REGEX.test(value)) {
      setName(value);
      setError(false);
    } else {
      // Show error but don't update the value
      setError(true);
    }
  };

  return (
    <TitleTextInputMolecule
      label={label}
      value={name}
      onValueChange={handleChange}
      placeholder={placeholder}
      required={required}
      error={error}
      helperText={error ? "숫자나 특수문자는 입력할 수 없습니다" : undefined}
      dataComponent="desktop_messages_sections_form-name-input"
    />
  );
};
