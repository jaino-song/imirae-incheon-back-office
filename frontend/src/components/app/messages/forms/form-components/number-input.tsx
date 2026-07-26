import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface NumberInputProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  required?: boolean;
  min?: number;
  max?: number;
}

export const NumberInput = ({
  value,
  onChange,
  label,
  placeholder,
  required,
  min,
  max,
}: NumberInputProps) => {
  return (
    <div className="space-y-2" data-component="desktop_messages_sections_form-number-input">
      <Label>
        {label}
        {required && <span className="text-destructive ml-1">*</span>}
      </Label>
      <Input
        variant="v3"
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        min={min}
        max={max}
      />
    </div>
  );
};
