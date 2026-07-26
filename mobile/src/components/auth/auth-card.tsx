import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface AuthCardProps {
  children: React.ReactNode;
  title?: string;
  description?: string;
  className?: string;
  contentClassName?: string;
  disableAnimation?: boolean;
  variant?: "default" | "v3";
  /** Canonical data-component value for the surface that renders this card. */
  "data-component": string;
}

export function AuthCard({
  children,
  title,
  description,
  className,
  contentClassName,
  disableAnimation = false,
  variant = "default",
  "data-component": dataComponent,
}: AuthCardProps) {
  const isV3 = variant === "v3";

  return (
    <div data-component={dataComponent} className="flex min-h-screen items-center justify-center">
      <Card
        className={cn(
          isV3
            ? "w-full max-w-[440px] rounded-2xl border-[1.5px] border-v3-border bg-white shadow-v3"
            : "w-full max-w-[400px] shadow-lg",
          !disableAnimation && "animate-scale-in",
          className
        )}
      >
        {(title || description) && (
          <CardHeader className={cn("flex flex-col gap-1 text-center", isV3 && "pt-8 px-8 pb-2")}>
            {title && (
              <CardTitle className={cn("text-2xl font-bold", isV3 && "text-xl font-extrabold text-v3-dark")}>{title}</CardTitle>
            )}
            {description && (
              <CardDescription className={cn("text-base", isV3 && "text-[0.85rem] text-v3-text-muted")}>{description}</CardDescription>
            )}
          </CardHeader>
        )}
        <CardContent
          className={cn(
            !(title || description) && "pt-6",
            isV3 && "px-8 pb-8 pt-4",
            contentClassName
          )}
        >
          {children}
        </CardContent>
      </Card>
    </div>
  );
}
