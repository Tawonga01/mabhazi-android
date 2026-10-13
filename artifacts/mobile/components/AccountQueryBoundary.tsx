import React, { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';

/** Mount account-owned views only after old private caches/requests are cleared. */
export function AccountQueryBoundary({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth(), queryClient = useQueryClient();
  const owner = user?.id ?? null;
  const [readyOwner, setReadyOwner] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (isLoading) return;
    let current = true;
    queryClient.cancelQueries().then(() => {
      if (!current) return;
      queryClient.clear(); setReadyOwner(owner);
    });
    return () => { current = false; };
  }, [owner, isLoading, queryClient]);
  return isLoading || readyOwner !== owner ? <ActivityIndicator style={{ marginTop: 80 }} /> : children;
}
