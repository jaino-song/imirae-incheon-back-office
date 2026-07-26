"use client";

import { useRouter } from "next/navigation";
import Cookies from "js-cookie";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface LanguageSwitcherProps {
  /** Caller-context canonical value for the switcher root. */
  "data-component": string;
}

export const LanguageSwitcher = ({ "data-component": dataComponent }: LanguageSwitcherProps) => {
  const router = useRouter();
  const currentLang = Cookies.get("language") || "ko";

  const handleLanguageChange = (lang: string) => {
    // Set cookie with 1 year expiry
    Cookies.set("language", lang, { expires: 365 });
    // Refresh the page to re-render with new language
    router.refresh();
  };

  return (
    <div data-component={dataComponent} className="flex border border-sidebar-border rounded-2xl overflow-hidden">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => handleLanguageChange("en")}
        className={cn(
          "flex-1 rounded-none border-r border-sidebar-border text-xs text-sidebar-foreground/80",
          currentLang === "en"
            ? "bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary/90 hover:text-sidebar-primary-foreground"
            : "hover:bg-sidebar-accent hover:text-sidebar-foreground"
        )}
      >
        English
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => handleLanguageChange("ko")}
        className={cn(
          "flex-1 rounded-none text-xs text-sidebar-foreground/80",
          currentLang === "ko"
            ? "bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary/90 hover:text-sidebar-primary-foreground"
            : "hover:bg-sidebar-accent hover:text-sidebar-foreground"
        )}
      >
        한국어
      </Button>
    </div>
  );
};
