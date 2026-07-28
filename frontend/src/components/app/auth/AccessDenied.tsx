'use client';

import Link from 'next/link';

export function AccessDenied() {
  return (
    <div data-component="desktop_shell_access-denied" className="flex items-center justify-center min-h-screen bg-background">
      <div className="text-center px-6 py-12 max-w-md">
        <div className="mb-6 flex justify-center">
          <svg
            className="w-20 h-20 text-muted-foreground"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
            />
          </svg>
        </div>

        <h1 className="text-3xl font-bold text-foreground mb-3">
          접근 권한이 없습니다
        </h1>

        <p className="text-muted-foreground mb-8">
          이 페이지는 관리자만 접근할 수 있습니다.
        </p>

        <Link
          href="/"
          className="inline-flex items-center justify-center px-6 py-3 bg-primary text-primary-foreground font-medium rounded-lg hover:bg-primary/90 transition-colors duration-200 shadow-sm hover:shadow-md"
        >
          <svg
            className="w-5 h-5 mr-2"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10 19l-7-7m0 0l7-7m-7 7h18"
            />
          </svg>
          대시보드로 돌아가기
        </Link>
      </div>
    </div>
  );
}
