'use client';

import { ReactNode } from 'react';
import { useGetAuthUser } from '@/hooks/useGetAuthUser';
import { AccessDenied } from './AccessDenied';
import { Skeleton } from '@/components/ui/skeleton';

interface AdminGuardProps {
  children: ReactNode;
  fallback?: ReactNode;
}

export function AdminGuard({ children, fallback }: AdminGuardProps) {
  const { data: user, isLoading } = useGetAuthUser();
  
  if (isLoading) {
    return (
      <div data-component="desktop_shell_admin-guard_loading" className="min-h-screen bg-background p-6">
        <div className="mx-auto max-w-4xl space-y-6">
          <Skeleton className="h-8 w-40 bg-v3-dim-white" />
          <div className="rounded-[24px] border border-v3-border bg-white p-6 shadow-v3">
            <div className="space-y-4">
              <Skeleton className="h-6 w-48 bg-v3-dim-white" />
              <Skeleton className="h-4 w-full bg-v3-dim-white" />
              <Skeleton className="h-4 w-3/4 bg-v3-dim-white" />
            </div>
          </div>
        </div>
      </div>
    );
  }
  
  const isAdmin = user?.role === 'admin' || user?.role === 'owner';
  
  if (!isAdmin) {
    return fallback ?? <AccessDenied />;
  }
  
  return <>{children}</>;
}
