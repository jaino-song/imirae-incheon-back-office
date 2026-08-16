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
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-white"
    >
      <div
        className="flex flex-col items-center gap-4"
        data-component={`${dataComponent}_content`}
        data-slot="pwa-launch-content"
      >
        <Image
          alt="아가잼잼"
          className="h-auto w-[136px]"
          data-component={`${dataComponent}_content_logo`}
          data-slot="brand-logo"
          height={136}
          priority
          src="/assets/logo.svg"
          width={136}
        />
        <Spinner
          aria-hidden="true"
          className="text-primary"
          data-component={`${dataComponent}_content_spinner`}
        />
      </div>
    </section>
  );
}
