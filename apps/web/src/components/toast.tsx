"use client";

import type { JSX, ReactNode } from "react";
import { createContext, useContext, useEffect, useRef, useState } from "react";

type ToastTone = "success" | "error";

interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
}

interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
}

const ToastContext = createContext<ToastApi | undefined>(undefined);

export function useToast(): ToastApi {
  const value = useContext(ToastContext);
  if (value === undefined) {
    throw new Error("useToast debe usarse dentro de ToastProvider");
  }
  return value;
}

export function ToastProvider({ children }: { children: ReactNode }): JSX.Element {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const activeTimers = timers.current;
    return () => {
      for (const timer of activeTimers) {
        window.clearTimeout(timer);
      }
    };
  }, []);

  function push(tone: ToastTone, message: string): void {
    const id = nextId.current;
    nextId.current += 1;
    setToasts((current) => [...current, { id, tone, message }]);
    const timer = window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 4000);
    timers.current.push(timer);
  }

  const api: ToastApi = {
    success: (message) => push("success", message),
    error: (message) => push("error", message),
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="fixed bottom-4 right-4 z-40 flex w-80 flex-col gap-2">
        {toasts.map((toast) => (
          <p
            key={toast.id}
            role={toast.tone === "error" ? "alert" : "status"}
            className={toast.tone === "error" ? "rounded border border-red-200 bg-red-50 px-3 py-2" : "rounded border border-green-200 bg-green-50 px-3 py-2"}
          >
            {toast.message}
          </p>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
