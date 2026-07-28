import { TemplateVariable } from "@/lib/template/types";
import { DateInput } from "./date-input";
import { NumberInput } from "./number-input";
import { TextareaInput } from "./textarea-input";
import { DynamicSelect } from "./dynamic-select";
import { NameInput } from "./NameInput";
import { ContactInput } from "./ContactInput";
import { TitleTextInputMolecule } from "./TitleTextInputMolecule";

interface DynamicInputProps {
    variable: TemplateVariable;
    value: string;
    onChange: (value: string) => void;
    forceRequired?: boolean;
}

export const DynamicInput = ({ variable, value, onChange, forceRequired = false }: DynamicInputProps) => {
    const { type, label, placeholder, required, optionType, options, dataSource } = variable;
    const fieldRequired = forceRequired || required;

    let content;

    switch (type) {
        case "date":
            content = <DateInput value={value} onChange={onChange} label={label} required={fieldRequired} />;
            break;
        case "number":
            content = (
                <NumberInput 
                    value={value} 
                    onChange={onChange} 
                    label={label} 
                    placeholder={placeholder} 
                    required={fieldRequired}
                    min={variable.min} 
                    max={variable.max} 
                />
            );
            break;
        case "textarea":
            content = <TextareaInput value={value} onChange={onChange} label={label} placeholder={placeholder} required={fieldRequired} />;
            break;
        case "select":
            content = (
                <DynamicSelect 
                    value={value} 
                    onChange={onChange} 
                    label={label} 
                    required={fieldRequired}
                    optionType={optionType} 
                    options={options} 
                    dataSourceId={dataSource} 
                />
            );
            break;
        case "phone":
            content = <ContactInput phone={value} setPhone={onChange} label={label} placeholder={placeholder || ""} required={fieldRequired} />;
            break;
        case "text":
            if (variable.key === "name") {
                content = <NameInput name={value} setName={onChange} label={label} placeholder={placeholder || ""} required={fieldRequired} />;
            } else {
                content = (
                    <TitleTextInputMolecule
                        label={label}
                        value={value}
                        onValueChange={onChange}
                        placeholder={placeholder}
                        required={fieldRequired}
                        dataComponent="desktop_messages_sections_form-dynamic-text-input"
                    />
                );
            }
            break;
        default:
            content = (
                <TitleTextInputMolecule
                    label={label}
                    value={value}
                    onValueChange={onChange}
                    placeholder={placeholder}
                    required={fieldRequired}
                    dataComponent="desktop_messages_sections_form-default-text-input"
                />
            );
    }

    return content;
};
