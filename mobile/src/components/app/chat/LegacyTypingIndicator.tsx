type LegacyTypingIndicatorProps = {
  className?: string;
};

export function LegacyTypingIndicator({ className }: LegacyTypingIndicatorProps) {
  return (
    <span data-component="mobile_chat_legacy-typing-indicator" data-source-component="LegacyTypingIndicator" className={className} aria-label="응답 작성 중">
      <span />
      <span />
      <span />
    </span>
  );
}
