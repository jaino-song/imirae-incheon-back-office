'use client';

import { ReactNode } from 'react';
import { useGetAuthUser } from '@/hooks/useGetAuthUser';
import { AccessDenied } from './AccessDenied';

interface AdminGuardProps {
  children: ReactNode;
  fallback?: ReactNode;
}

export function AdminGuard({ children, fallback }: AdminGuardProps) {
  const { data: user, isLoading } = useGetAuthUser();
  
  if (isLoading) {
    return <div data-component="mobile_auth_admin-guard" className="flex items-center justify-center min-h-screen">Loading...</div>;
  }
  
  const isAdmin = user?.role === 'admin' || user?.role === 'owner';
  
  if (!isAdmin) {
    return fallback ?? <AccessDenied />;
  }
  
  return <>{children}</>;
}
