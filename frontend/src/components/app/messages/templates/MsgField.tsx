import { Textarea } from "@/components/ui/textarea";

interface MsgFieldProps {
  value: string;
  label: string;
  onChange?: (value: string) => void;
}

export const MsgField = ({ value, label, onChange }: MsgFieldProps) => {
  return (
    <Textarea
      aria-label={label}
      data-component="desktop_messages_sections_msg-field"
      value={value}
      readOnly={!onChange}
      onChange={(e) => onChange?.(e.target.value)}
      rows={12}
      className="scrollbar-hide min-h-[calc(280px*var(--glint-ui-scale,1))] rounded-none border-0 bg-transparent px-0 py-0 font-sans text-[calc(14.08px*var(--glint-ui-scale,1))] leading-[calc(28px*var(--glint-ui-scale,1))] text-v3-dark shadow-none resize-none focus-visible:ring-0 focus-visible:ring-offset-0"
    />
  );
};
