import Image from "next/image";

import { Spinner } from "@/components/ui/spinner";

interface PwaLaunchScreenProps {
  "data-component": string;
}

export function PwaLaunchScreen({ "data-component": dataComponent }: PwaLaunchScreenProps) {
  return (
    <section
      aria-label="아가잼잼을 불러오는 중"
      aria-live="polite"
      data-component={dataComponent}
      data-slot="pwa-launch-screen"
      role="status"
      className="fixed inset-0 z-[9999] bg-white"
    >
      <Image
        alt="아가잼잼"
        className="absolute left-1/2 top-1/2 h-auto w-[136px] -translate-x-1/2 -translate-y-1/2"
        data-component={`${dataComponent}_logo`}
        data-slot="brand-logo"
        height={136}
        priority
        src="/assets/logo.svg"
        width={136}
      />
      <Spinner
        aria-hidden="true"
        className="absolute bottom-[calc(env(safe-area-inset-bottom)+2rem)] left-1/2 -translate-x-1/2 text-primary"
        data-component={`${dataComponent}_spinner`}
      />
    </section>
  );
}
