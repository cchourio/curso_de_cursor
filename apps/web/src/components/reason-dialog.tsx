"use client";

import type { JSX } from "react";
import { useEffect, useId, useRef, useState } from "react";
import { reasonSchema } from "@ff/domain";

interface ReasonDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel: string;
  tone?: "default" | "danger";
  onConfirm: (reason: string) => Promise<void>;
  onCancel: () => void;
}

export function ReasonDialog({
  open,
  title,
  description,
  confirmLabel,
  tone = "default",
  onConfirm,
  onCancel,
}: ReasonDialogProps): JSX.Element | null {
  const titleId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [reason, setReason] = useState("");
  const [formError, setFormError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);
  const accepted = reasonSchema.safeParse(reason).success;

  useEffect(() => {
    if (!open) {
      return;
    }
    setReason("");
    setFormError(undefined);
    setPending(false);
    textareaRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape" && !pending) {
        event.preventDefault();
        onCancel();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onCancel, pending]);

  if (!open) {
    return null;
  }

  async function confirm(): Promise<void> {
    const parsed = reasonSchema.safeParse(reason);
    if (!parsed.success || pending) {
      return;
    }
    setPending(true);
    setFormError(undefined);
    try {
      await onConfirm(parsed.data);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "No se pudo guardar";
      setFormError(message);
    } finally {
      setPending(false);
    }
  }

  const confirmClass =
    tone === "danger" ? "rounded bg-red-700 px-3 py-2 text-white disabled:opacity-60" : "rounded bg-black px-3 py-2 text-white disabled:opacity-60";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md rounded bg-white p-6 shadow-lg"
      >
        <h2 id={titleId} className="text-lg font-semibold">
          {title}
        </h2>
        {description === undefined ? null : <p className="mt-2 whitespace-pre-line text-sm text-gray-700">{description}</p>}
        <label className="mt-4 flex flex-col gap-1 text-sm" htmlFor={`${titleId}-reason`}>
          Motivo
          <textarea
            id={`${titleId}-reason`}
            ref={textareaRef}
            className="min-h-24 rounded border px-3 py-2"
            value={reason}
            disabled={pending}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        {formError === undefined ? null : (
          <p role="alert" className="mt-3 text-sm text-red-700">
            {formError}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="rounded border px-3 py-2 disabled:opacity-60" onClick={onCancel} disabled={pending}>
            Cancelar
          </button>
          <button type="button" className={confirmClass} onClick={() => void confirm()} disabled={!accepted || pending}>
            {pending ? "Guardando…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
