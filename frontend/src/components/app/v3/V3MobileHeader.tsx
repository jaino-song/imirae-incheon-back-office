"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";
import { isLayoutExcluded } from "@/lib/constants/v3-layout";
import { NotificationBell } from "@/components/app/notifications/NotificationBell";

export function V3MobileHeader() {
  const pathname = usePathname();
  if (!pathname || isLayoutExcluded(pathname)) return null;

  return (
    <header data-component="desktop_chrome_mobile-header" className="fixed top-0 left-0 right-0 z-[1000] flex md:hidden items-center justify-between px-4 py-3 bg-white shadow-v3" style={{ borderRadius: '0 0 24px 24px' }}>
      <div data-component="desktop_chrome_mobile-header_logo" className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center overflow-hidden">
          <Image src="/assets/logo.svg" alt="아가잼잼 로고" width={36} height={36} className="w-full h-full object-cover" />
        </div>
        <span className="text-base font-bold text-v3-primary">아가잼잼</span>
      </div>

      <div data-component="desktop_chrome_mobile-header_notifications">
        <NotificationBell />
      </div>
    </header>
  );
}
