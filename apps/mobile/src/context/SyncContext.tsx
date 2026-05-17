import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { useDatabase } from '../data/local/DatabaseProvider';
import { getPendingSyncOperations } from '../data/local/syncRepository';
import { processSyncQueue } from '../data/remote/firestoreSync';

type SyncStatusCounts = {
  pending: number;
  synced: number;
  failed: number;
};

type SyncContextType = {
  syncStatus: SyncStatusCounts;
  triggerSync: () => Promise<void>;
  isSyncing: boolean;
};

const SyncContext = createContext<SyncContextType | null>(null);

export function useSyncStatus(): SyncContextType {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error('useSyncStatus must be used within SyncProvider');
  return ctx;
}

async function countSyncOperations(db: any): Promise<SyncStatusCounts> {
  try {
    const pending = await getPendingSyncOperations(db);
    return {
      pending: pending.filter(op => op.status === 'pending').length,
      synced: pending.filter(op => op.status === 'synced').length,
      failed: pending.filter(op => op.status === 'failed').length,
    };
  } catch {
    return { pending: 0, synced: 0, failed: 0 };
  }
}

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const db = useDatabase();
  const { user, localUserId } = useAuth();
  const [syncStatus, setSyncStatus] = useState<SyncStatusCounts>({ pending: 0, synced: 0, failed: 0 });
  const [isSyncing, setIsSyncing] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const triggerSync = useCallback(async () => {
    if (!user || !localUserId || isSyncing) return;
    setIsSyncing(true);
    try {
      await processSyncQueue(db, user.uid, localUserId);
      const counts = await countSyncOperations(db);
      setSyncStatus(counts);
    } catch (error) {
      console.warn('Sync error:', error);
    } finally {
      setIsSyncing(false);
    }
  }, [db, user, localUserId, isSyncing]);

  // Auto-sync every 30 seconds if there are pending operations
  useEffect(() => {
    const checkAndSync = async () => {
      const counts = await countSyncOperations(db);
      setSyncStatus(counts);
      if (counts.pending > 0) {
        triggerSync();
      }
    };

    // Check on mount
    checkAndSync();

    intervalRef.current = setInterval(checkAndSync, 30000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [db, triggerSync]);

  return (
    <SyncContext.Provider value={{ syncStatus, triggerSync, isSyncing }}>
      {children}
    </SyncContext.Provider>
  );
}