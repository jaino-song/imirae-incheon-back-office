"use client";
import { usePathname } from "next/navigation";
import { Header } from "./Header";
import { useInitialUser } from "@/providers/UserProvider";
import { isPublicAuthPath } from "@/lib/auth/routes";

// ConditionalHeader는 UserProvider 내부에서 렌더링될 때
// 서버에서 prefetch된 user 데이터를 자동으로 Header에 전달
export const ConditionalHeader = () => {
  const pathname = usePathname();
  const hiddenPaths = ["/", "/login", "/chat"];
  // Hide header on specific paths or any public auth page (login, register, verify, etc.)
  const shouldHide = hiddenPaths.includes(pathname) || isPublicAuthPath(pathname);

  // UserProvider가 있으면 prefetch된 user 데이터 사용
  // 없으면 null (Header에서 client-side fetch)
  const initialUser = useInitialUser();

  if (shouldHide) {
    return null;
  }

  return (
    <div data-component="mobile_shell_app-header">
      <Header initialUser={initialUser} />
    </div>
  );
};
