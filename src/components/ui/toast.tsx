"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

export type ToastKind = "info" | "success" | "error";

type Toast = {
  id: number;
  message: string;
  kind: ToastKind;
};

type ToastListener = (toast: Toast) => void;

let listeners: ToastListener[] = [];
let counter = 0;

export function showToast(message: string, kind: ToastKind = "info") {
  counter += 1;
  const toast: Toast = { id: counter, message, kind };
  for (const listener of listeners) listener(toast);
}

export function ToastHost() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const listener: ToastListener = (toast) => {
      setToasts((previous) => [...previous, toast].slice(-4));
      window.setTimeout(() => {
        setToasts((previous) => previous.filter((item) => item.id !== toast.id));
      }, 3200);
    };
    listeners.push(listener);
    return () => {
      listeners = listeners.filter((item) => item !== listener);
    };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-[90] flex flex-col items-center gap-2 px-4"
      style={{
        bottom:
          "calc(var(--dopa-tabbar-offset, 0px) + 7rem + env(safe-area-inset-bottom))",
      }}
      aria-live="polite"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={cn(
            "animate-slide-up pointer-events-auto max-w-full truncate rounded-full border px-4 py-2 text-xs font-semibold shadow-xl backdrop-blur",
            toast.kind === "error"
              ? "border-red-500/40 bg-red-950/90 text-red-200"
              : toast.kind === "success"
                ? "border-emerald-500/40 bg-emerald-950/90 text-emerald-200"
                : "border-dopa-700 bg-dopa-900/95 text-zinc-200",
          )}
        >
          {toast.message}
        </div>
      ))}
    </div>
  );
}
