import * as React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SpinnerProps extends React.SVGAttributes<SVGSVGElement> {
  /** Caller-context canonical value. Omitted when the caller does not name the node. */
  "data-component"?: string;
  size?: "sm" | "default" | "lg";
}

const sizeClasses = {
  sm: "h-4 w-4",
  default: "h-6 w-6",
  lg: "h-8 w-8",
};

const Spinner = React.forwardRef<SVGSVGElement, SpinnerProps>(
  ({ "data-component": dataComponent, className, size = "default", ...props }, ref) => {
    return (
      <Loader2
        ref={ref}
        data-component={dataComponent}
        data-slot="spinner"
        className={cn("animate-spin", sizeClasses[size], className)}
        {...props}
      />
    );
  }
);
Spinner.displayName = "Spinner";

export { Spinner };
