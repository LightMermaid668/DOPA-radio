"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";

type ConfirmOptions = {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};

type PromptOptions = {
  title: string;
  description?: string;
  defaultValue?: string;
  confirmLabel?: string;
};

type DialogState =
  | { kind: "confirm"; options: ConfirmOptions; resolve: (value: boolean) => void }
  | { kind: "prompt"; options: PromptOptions; resolve: (value: string | null) => void }
  | null;

let setDialogExternal: ((state: DialogState) => void) | null = null;

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    if (!setDialogExternal) {
      resolve(window.confirm(options.title));
      return;
    }
    setDialogExternal({ kind: "confirm", options, resolve });
  });
}

export function promptDialog(options: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    if (!setDialogExternal) {
      resolve(window.prompt(options.title, options.defaultValue));
      return;
    }
    setDialogExternal({ kind: "prompt", options, resolve });
  });
}

export function DialogHost() {
  const [dialog, setDialog] = useState<DialogState>(null);
  const [inputValue, setInputValue] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setDialogExternal = setDialog;
    return () => {
      setDialogExternal = null;
    };
  }, []);

  useEffect(() => {
    if (dialog?.kind === "prompt") {
      setInputValue(dialog.options.defaultValue ?? "");
      setCopied(false);
    }
  }, [dialog]);

  useEffect(() => {
    if (!dialog) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (dialog.kind === "confirm") dialog.resolve(false);
        else dialog.resolve(null);
        setDialog(null);
        return;
      }
      if (event.key === "Enter" && dialog.kind === "prompt") {
        dialog.resolve(inputValue);
        setDialog(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialog, inputValue]);

  if (!dialog || typeof document === "undefined") return null;

  const cancel = () => {
    if (dialog.kind === "confirm") dialog.resolve(false);
    else dialog.resolve(null);
    setDialog(null);
  };

  const accept = () => {
    if (dialog.kind === "confirm") dialog.resolve(true);
    else dialog.resolve(inputValue);
    setDialog(null);
  };

  const title = dialog.options.title;
  const description = dialog.options.description;

  return createPortal(
    <div
      className="animate-fade fixed inset-0 z-[90] overflow-y-auto overscroll-contain bg-black/70"
      onClick={cancel}
    >
      <div className="flex min-h-full items-center justify-center p-6">
        <div
          className="animate-pop flex w-full max-w-sm flex-col gap-4 rounded-2xl border border-dopa-700 bg-dopa-900 p-5"
          onClick={(event) => event.stopPropagation()}
        >
          <div>
            <h2 className="text-sm font-bold">{title}</h2>
            {description ? (
              <p className="mt-1 text-xs leading-relaxed text-zinc-400">{description}</p>
            ) : null}
          </div>

          {dialog.kind === "prompt" ? (
            <div className="flex flex-col gap-2">
              <input
                value={inputValue}
                onChange={(event) => setInputValue(event.target.value)}
                onFocus={(event) => event.target.select()}
                className="h-10 rounded-xl border border-dopa-700 bg-dopa-950 px-3 text-xs text-zinc-200 outline-none focus:border-accent"
              />
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(inputValue);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  } catch {
                    /* 手動コピー用に選択可能な入力欄を提供 */
                  }
                }}
                className="self-start rounded-full border border-dopa-700 px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-dopa-800"
              >
                {copied ? "コピーしました" : "コピー"}
              </button>
            </div>
          ) : null}

          <div className="flex items-center justify-end gap-2">
            {dialog.kind === "confirm" ? (
              <Button type="button" variant="ghost" size="sm" onClick={cancel}>
                {dialog.options.cancelLabel ?? "キャンセル"}
              </Button>
            ) : null}
            {dialog.kind === "confirm" && dialog.options.danger ? (
              <button
                type="button"
                onClick={accept}
                className="rounded-full bg-red-500/90 px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-red-500"
              >
                {dialog.options.confirmLabel ?? "削除"}
              </button>
            ) : (
              <Button type="button" size="sm" onClick={accept}>
                {dialog.kind === "prompt"
                  ? (dialog.options.confirmLabel ?? "閉じる")
                  : (dialog.options.confirmLabel ?? "OK")}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
