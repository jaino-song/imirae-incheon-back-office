export type FieldState = "default" | "invalid" | "success" | "disabled";

export interface FieldContract {
    label: string;
    required?: boolean;
    state?: FieldState;
    helperText?: string;
    errorMessage?: string;
}
