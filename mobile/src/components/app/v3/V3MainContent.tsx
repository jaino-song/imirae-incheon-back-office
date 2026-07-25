"use client";

import { usePathname } from "next/navigation";
import { isLayoutExcluded } from "@/lib/constants/v3-layout";
import { cn } from "@/lib/utils";

export function V3MainContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const excluded = isLayoutExcluded(pathname);
  const isClientsNewRoute = pathname.startsWith("/clients/new");
  const isContractsNewRoute = pathname.startsWith("/contracts/new");
  const isForgotPasswordRoute = pathname === "/forgot-password";
  const isLoginRoute = pathname === "/login";

  return (
    <main
      data-component="main-content"
      className={cn(
        "bg-v3-dim-white",
        isLoginRoute
          ? "h-[100dvh] overflow-hidden"
          : isContractsNewRoute
          ? "h-[100dvh] overflow-hidden p-0"
          : isClientsNewRoute
          ? "h-[100dvh] overflow-hidden p-4 pt-20 pb-4"
          : isForgotPasswordRoute
            ? "h-[100dvh] p-4"
            : "min-h-[100dvh] flex flex-col p-4 pb-24",
        !isLoginRoute && !isContractsNewRoute && !isClientsNewRoute && !isForgotPasswordRoute && (excluded ? "pt-4" : "pt-20")
      )}
    >
      {children}
    </main>
  );
}
