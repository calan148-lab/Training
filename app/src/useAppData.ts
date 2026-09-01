import { useCallback, useEffect, useRef, useState } from 'react';
import { loadData, saveData } from './db';
import { newBadges } from './domain/progress';
import type { AppData } from './domain/types';

export interface Store {
  data: AppData | null;
  /** Apply a change and persist it. */
  update: (fn: (d: AppData) => AppData) => void;
  /** Replace wholesale — used by backup restore. */
  replace: (d: AppData) => void;
  toast: string | null;
  say: (msg: string) => void;
}

export function useAppData(): Store {
  const [data, setData] = useState<AppData | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);

  useEffect(() => {
    void loadData().then(setData);
  }, []);

  const say = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 1900);
  }, []);

  const persist = useCallback(
    (next: AppData) => {
      // Award any badge newly earned by this change, then save once.
      const earned = newBadges(next);
      const withBadges = earned.length ? { ...next, seen: [...next.seen, ...earned.map((b) => b.id)] } : next;
      setData(withBadges);
      void saveData(withBadges);
      if (earned[0]) window.setTimeout(() => say(`🏅 ${earned[0]!.n} unlocked`), 900);
    },
    [say],
  );

  const update = useCallback(
    (fn: (d: AppData) => AppData) => {
      setData((cur) => {
        if (!cur) return cur;
        const next = fn(cur);
        const earned = newBadges(next);
        const withBadges = earned.length ? { ...next, seen: [...next.seen, ...earned.map((b) => b.id)] } : next;
        void saveData(withBadges);
        if (earned[0]) window.setTimeout(() => say(`🏅 ${earned[0]!.n} unlocked`), 900);
        return withBadges;
      });
    },
    [say],
  );

  return { data, update, replace: persist, toast, say };
}
