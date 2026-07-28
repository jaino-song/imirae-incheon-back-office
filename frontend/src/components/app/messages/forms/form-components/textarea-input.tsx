import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface TextareaInputProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  required?: boolean;
}

export const TextareaInput = ({
  value,
  onChange,
  label,
  placeholder,
  required,
}: TextareaInputProps) => {
  return (
    <div className="space-y-2" data-component="desktop_messages_sections_form-textarea">
      <Label>
        {label}
        {required && <span className="text-destructive ml-1">*</span>}
      </Label>
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        rows={4}
      />
    </div>
  );
};
