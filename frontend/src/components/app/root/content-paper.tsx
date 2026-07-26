"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export interface ContentPaperProps extends React.HTMLAttributes<HTMLDivElement> {
    children: React.ReactNode;
    title?: string;
    subtitle?: string;
    header?: React.ReactNode;
    contentClassName?: string;
    /** @deprecated Use className instead. Kept for backward compatibility. */
    elevation?: number;
    disableAnimation?: boolean;
    // sx prop for backwards compatibility - mapped to className
    sx?: Record<string, unknown>;
    /** @deprecated Use standard HTML element types with className. */
    component?: string;
    variant?: "default" | "v3";
}

export const ContentPaper = React.forwardRef<HTMLDivElement, ContentPaperProps>(
    (
        {
            children,
            title,
            subtitle,
            header,
            contentClassName,
            elevation, // Kept for backward compatibility, not used
            disableAnimation = false, // Enable fade-in by default
            className,
            sx,
            component, // Kept for backward compatibility, not used
            variant = "default",
            ...props
        },
        ref
    ) => {
        void elevation;
        void component;

        // Build additional classes from sx prop for backwards compatibility
        const sxClasses = React.useMemo(() => {
            if (!sx) return "";
            const classes: string[] = [];

            // Map common sx properties to Tailwind classes
            if (sx.minHeight === "70vh") classes.push("min-h-[70vh]");
            if (sx.flexGrow === 1) classes.push("flex-grow");
            if (sx.width === "100%") classes.push("w-full");

            return classes.join(" ");
        }, [sx]);

        const renderHeader = () => {
            if (header) {
                return header;
            }

            if (title || subtitle) {
                return (
                    <CardHeader variant={variant}>
                        {title && (
                            <CardTitle className="text-xl font-bold text-primary">
                                {title}
                            </CardTitle>
                        )}
                        {subtitle && (
                            <CardDescription className="text-sm text-muted-foreground">
                                {subtitle}
                            </CardDescription>
                        )}
                    </CardHeader>
                );
            }

            return null;
        };

        const content = (
            <>
                {renderHeader()}
                <CardContent className={cn(!title && !subtitle && !header && "pt-6", contentClassName)}>
                    {children}
                </CardContent>
            </>
        );

        return (
            <Card
                ref={ref}
                variant={variant}
                data-component="desktop_chrome_content-paper"
                data-testid="ContentPaper"
                className={cn(
                    variant !== "v3" && "rounded-lg", // 8px radius - reference design match (only for default)
                    !disableAnimation && (variant === "v3" ? "animate-v3-slide-up" : "animate-fade-in"),
                    sxClasses,
                    className
                )}
                {...props}
            >
                {content}
            </Card>
        );
    }
);

ContentPaper.displayName = "ContentPaper";
