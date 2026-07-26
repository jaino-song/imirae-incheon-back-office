import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface DateInputProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  required?: boolean;
}

export const DateInput = ({
  value,
  onChange,
  label,
  required,
}: DateInputProps) => {
  return (
    <div className="space-y-2" data-component="desktop_messages_sections_form-date-input">
      <Label>
        {label}
        {required && <span className="text-destructive ml-1">*</span>}
      </Label>
      <Input
        variant="v3"
        type="date"
        value={value}
        required={required}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
};
