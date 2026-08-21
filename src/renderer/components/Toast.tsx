import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { IconName } from "../icons";
import { Icon } from "./Icon";

export type ToastKind = "ok" | "fail" | "busy";

type ToastItem = {
  id: number;
  message: string;
  kind: ToastKind;
};

type ToastApi = {
  toast: (message: string, kind?: ToastKind) => { dismiss: () => void };
  handle: (action: () => Promise<void>, doing: string) => Promise<void>;
};

const ToastContext = createContext<ToastApi | null>(null);

const TOAST_LIFE: Record<ToastKind, number> = { ok: 4000, fail: 9000, busy: 0 };
const MAX_TOASTS = 4;

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, kind: ToastKind = "ok") => {
      const id = nextId++;
      setItems((prev) => {
        const next = [...prev, { id, message, kind }];
        return next.length > MAX_TOASTS ? next.slice(next.length - MAX_TOASTS) : next;
      });
      const life = TOAST_LIFE[kind];
      if (life) {
        window.setTimeout(() => dismiss(id), life);
      }
      return { dismiss: () => dismiss(id) };
    },
    [dismiss],
  );

  const handle = useCallback(
    async (action: () => Promise<void>, doing: string) => {
      const busy = toast(doing, "busy");
      try {
        await action();
      } catch (error) {
        toast(error instanceof Error ? error.message : String(error), "fail");
      } finally {
        busy.dismiss();
      }
    },
    [toast],
  );

  const value = useMemo(() => ({ toast, handle }), [toast, handle]);

  const TOAST_ICON: Record<ToastKind, IconName> = {
    ok: "check",
    fail: "alert",
    busy: "refresh",
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((item) => (
          <div key={item.id} className={`toast toast-${item.kind}`}>
            <Icon name={TOAST_ICON[item.kind]} />
            <span className="toast-text">{item.message}</span>
            {item.kind !== "busy" && (
              <button
                type="button"
                className="toast-close"
                aria-label="关闭"
                onClick={() => dismiss(item.id)}
              >
                <Icon name="close" />
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return ctx;
}
