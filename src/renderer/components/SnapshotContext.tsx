import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Snapshot } from "../../shared/types";

type SnapshotApi = {
  snapshot: Snapshot | null;
  setSnapshot: (next: Snapshot) => void;
  refresh: () => Promise<void>;
  api: NonNullable<Window["api"]>;
};

const SnapshotContext = createContext<SnapshotApi | null>(null);

export function SnapshotProvider({ children }: { children: ReactNode }) {
  const api = window.api;
  if (!api) {
    throw new Error("预加载失败，窗口没有接到主进程接口");
  }

  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);

  const refresh = useCallback(async () => {
    setSnapshot(await api.getSnapshot());
  }, [api]);

  useEffect(() => {
    const unsub = api.onSnapshot(setSnapshot);
    void refresh();
    return unsub;
  }, [api, refresh]);

  useEffect(() => {
    if (snapshot?.resolvedTheme) {
      document.documentElement.dataset.theme = snapshot.resolvedTheme;
    }
  }, [snapshot?.resolvedTheme]);

  const value = useMemo(
    () => ({ snapshot, setSnapshot, refresh, api }),
    [snapshot, refresh, api],
  );

  return <SnapshotContext.Provider value={value}>{children}</SnapshotContext.Provider>;
}

export function useSnapshot(): SnapshotApi {
  const ctx = useContext(SnapshotContext);
  if (!ctx) {
    throw new Error("useSnapshot must be used within SnapshotProvider");
  }
  return ctx;
}
