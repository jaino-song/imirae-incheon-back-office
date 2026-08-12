"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { PwaLaunchScreen } from "./pwa-launch-screen";

export function PwaDashboardRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/dashboard");
  }, [router]);

  return <PwaLaunchScreen data-component="mobile_home_dashboard-redirect" />;
}
