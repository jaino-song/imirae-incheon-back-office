export const SMS_BYTE_LIMIT = 90;
export const MAX_LMS_TITLE_BYTES = 44;
export const MAX_BODY_LENGTH = 2000;
const DEFAULT_LMS_TITLE = "안내";

export function getTextByteLength(text: string) {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(text).length;
  }

  return Array.from(text).reduce((size, char) => {
    const codePoint = char.codePointAt(0) ?? 0;
    if (codePoint <= 0x7f) return size + 1;
    if (codePoint <= 0x7ff) return size + 2;
    if (codePoint <= 0xffff) return size + 3;
    return size + 4;
  }, 0);
}

export function getLmsTitle(templateName: string) {
  return getTextByteLength(templateName) <= MAX_LMS_TITLE_BYTES ? templateName : DEFAULT_LMS_TITLE;
}
