import Link from "next/link";
import { cn } from "@/lib/utils";

interface AuthInlineLinkProps {
  href: string;
  linkLabel: string;
  prefixText?: string;
  dataComponent: string;
  paragraphClassName?: string;
  linkClassName?: string;
}

export function AuthInlineLink({
  href,
  linkLabel,
  prefixText,
  dataComponent,
  paragraphClassName,
  linkClassName,
}: AuthInlineLinkProps) {
  return (
    <p
      data-component={dataComponent}
      className={cn("text-center text-sm text-muted-foreground", paragraphClassName)}
    >
      {prefixText && (
        <>
          {prefixText}{" "}
        </>
      )}
      <Link
        href={href}
        className={cn(
          "text-primary font-medium hover:underline",
          linkClassName
        )}
      >
        {linkLabel}
      </Link>
    </p>
  );
}
