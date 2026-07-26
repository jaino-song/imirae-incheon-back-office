import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const SOURCE_COMPONENT = "Input"

const inputVariants = cva(
  "flex w-full bg-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "h-10 rounded-2xl border border-input px-3 py-2 text-sm ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 transition-colors",
        v3:
          "box-border h-[44px] w-full rounded-[12px] border-[1.5px] border-input bg-white px-[14px] py-0 text-[0.9rem] font-[inherit] leading-normal text-v3-dark outline-none transition-colors placeholder:text-v3-text-muted placeholder:opacity-60 focus:border-v3-primary focus-visible:ring-0 focus-visible:ring-offset-0 disabled:bg-[hsl(220_20%_97%)] disabled:opacity-55",
        "v3-pill":
          "border border-input px-4 py-3 text-sm rounded-pill transition-all duration-200 ease-in-out focus-visible:border-primary focus-visible:shadow-[0_0_0_3px_hsla(214,100%,34%,0.1)] focus-visible:scale-[1.02]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement>,
    VariantProps<typeof inputVariants> {
  error?: boolean
  "data-component"?: string
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, variant, error, "data-component": dataComponent, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          inputVariants({ variant, className }),
          error && "border-destructive focus-visible:ring-destructive"
        )}
        ref={ref}
        {...props}
        data-component={dataComponent ?? "input"}
        data-source-component={SOURCE_COMPONENT}
      />
    )
  }
)
Input.displayName = "Input"

export { Input, inputVariants }
