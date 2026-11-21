"use client";

import type { JSX } from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createFlagInputSchema } from "@ff/domain";
import { ApiClientError } from "@/lib/api";
import { createFlag } from "@/lib/flags-api";
import { useToast } from "@/components/toast";

const CREATE_FIELDS = ["key", "name", "description", "owner", "expiresAt", "reason"] as const;
type CreateField = (typeof CREATE_FIELDS)[number];

interface CreateForm {
  key: string;
  name: string;
  description: string;
  owner: string;
  expiresAt: string;
  reason: string;
}

type FieldErrors = Partial<Record<CreateField, string>>;

function plusDaysUtc(days: number): string {
  const now = new Date();
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days));
  return date.toISOString().slice(0, 10);
}

function isCreateField(value: string): value is CreateField {
  return value === "key" || value === "name" || value === "description" || value === "owner" || value === "expiresAt" || value === "reason";
}

function issuesByField(issues: readonly { path: ReadonlyArray<PropertyKey>; message: string }[]): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of issues) {
    const field = issue.path[0];
    if (typeof field !== "string" || !isCreateField(field) || errors[field] !== undefined) {
      continue;
    }
    errors[field] = issue.message;
  }
  return errors;
}

function detailsToErrors(details: unknown): FieldErrors {
  if (!Array.isArray(details)) {
    return {};
  }
  const errors: FieldErrors = {};
  for (const detail of details) {
    if (typeof detail !== "object" || detail === null) {
      continue;
    }
    const path = "path" in detail && typeof detail.path === "string" ? detail.path : undefined;
    const message = "message" in detail && typeof detail.message === "string" ? detail.message : undefined;
    if (path === undefined || message === undefined || !isCreateField(path) || errors[path] !== undefined) {
      continue;
    }
    errors[path] = message;
  }
  return errors;
}

function FieldError({ message }: { message: string | undefined }): JSX.Element | null {
  if (message === undefined) {
    return null;
  }
  return (
    <p role="alert" className="text-sm text-red-700">
      {message}
    </p>
  );
}

export function CreateFlagForm(): JSX.Element {
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState<CreateForm>(() => ({
    key: "",
    name: "",
    description: "",
    owner: "",
    expiresAt: plusDaysUtc(90),
    reason: "",
  }));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);

  function update(field: CreateField, value: string): void {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function onBlur(field: CreateField): void {
    const parsed = createFlagInputSchema.safeParse(form);
    const message = parsed.success ? undefined : issuesByField(parsed.error.issues)[field];
    setErrors((current) => ({ ...current, [field]: message }));
  }

  async function onSubmit(event: { preventDefault(): void }): Promise<void> {
    event.preventDefault();
    const parsed = createFlagInputSchema.safeParse(form);
    if (!parsed.success) {
      setErrors(issuesByField(parsed.error.issues));
      return;
    }
    setErrors({});
    setPending(true);
    try {
      const created = await createFlag({
        key: parsed.data.key,
        name: parsed.data.name,
        description: parsed.data.description === null ? "" : parsed.data.description,
        owner: parsed.data.owner,
        expiresAt: parsed.data.expiresAt,
        reason: parsed.data.reason,
      });
      toast.success("Flag creada");
      router.push(`/flags/${created.key}`);
    } catch (error: unknown) {
      if (error instanceof ApiClientError && error.status === 409) {
        setErrors((current) => ({ ...current, key: "Ya existe una flag con esta key" }));
        return;
      }
      if (error instanceof ApiClientError && error.status === 400) {
        const mapped = detailsToErrors(error.details);
        if (Object.keys(mapped).length > 0) {
          setErrors((current) => ({ ...current, ...mapped }));
          return;
        }
      }
      toast.error(error instanceof Error ? error.message : "No se pudo crear la flag");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="text-2xl font-bold">Nueva flag</h1>
      <form className="mt-6 flex flex-col gap-4" onSubmit={(event) => void onSubmit(event)}>
        <label className="text-sm" htmlFor="flag-key">
          Key
        </label>
        <input
          id="flag-key"
          className="rounded border px-3 py-2 font-mono"
          value={form.key}
          autoComplete="off"
          aria-describedby="flag-key-help"
          onChange={(event) => update("key", event.target.value)}
          onBlur={() => onBlur("key")}
        />
        <span id="flag-key-help" className="text-sm text-gray-600">
          Minúsculas, números, `.`, `_` o `-`. No se puede cambiar después.
        </span>
        <FieldError message={errors.key} />
        <label className="text-sm" htmlFor="flag-name">
          Nombre
        </label>
        <input
          id="flag-name"
          className="rounded border px-3 py-2"
          value={form.name}
          onChange={(event) => update("name", event.target.value)}
          onBlur={() => onBlur("name")}
        />
        <FieldError message={errors.name} />
        <label className="text-sm" htmlFor="flag-description">
          Descripción
        </label>
        <textarea
          id="flag-description"
          className="min-h-24 rounded border px-3 py-2"
          value={form.description}
          onChange={(event) => update("description", event.target.value)}
          onBlur={() => onBlur("description")}
        />
        <FieldError message={errors.description} />
        <label className="text-sm" htmlFor="flag-owner">
          Owner
        </label>
        <input
          id="flag-owner"
          className="rounded border px-3 py-2"
          value={form.owner}
          onChange={(event) => update("owner", event.target.value)}
          onBlur={() => onBlur("owner")}
        />
        <FieldError message={errors.owner} />
        <label className="text-sm" htmlFor="flag-expires">
          Fecha de expiración
        </label>
        <input
          id="flag-expires"
          type="date"
          className="rounded border px-3 py-2"
          value={form.expiresAt}
          onChange={(event) => update("expiresAt", event.target.value)}
          onBlur={() => onBlur("expiresAt")}
        />
        <FieldError message={errors.expiresAt} />
        <label className="text-sm" htmlFor="flag-reason">
          Motivo
        </label>
        <textarea
          id="flag-reason"
          className="min-h-24 rounded border px-3 py-2"
          value={form.reason}
          onChange={(event) => update("reason", event.target.value)}
          onBlur={() => onBlur("reason")}
        />
        <FieldError message={errors.reason} />
        <button type="submit" className="rounded bg-black px-3 py-2 text-white disabled:opacity-60" disabled={pending}>
          Crear flag
        </button>
      </form>
    </main>
  );
}
