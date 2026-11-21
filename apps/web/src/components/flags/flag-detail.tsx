"use client";

import type { JSX } from "react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ENVIRONMENTS, updateFlagInputSchema, type Environment, type FlagState, type UpdateFlagInput } from "@ff/domain";
import { ApiClientError } from "@/lib/api";
import { archiveFlag, getFlag, setKillSwitch, unarchiveFlag, updateFlag } from "@/lib/flags-api";
import { EnvironmentBadge } from "@/components/flags/environment-badge";
import { TargetingEditor } from "@/components/targeting/targeting-editor";
import { ReasonDialog } from "@/components/reason-dialog";
import { useToast } from "@/components/toast";

const ENVIRONMENT_LABELS = {
  development: "Development",
  staging: "Staging",
  production: "Production",
} as const satisfies Record<Environment, string>;

interface EditForm {
  name: string;
  description: string;
  owner: string;
  expiresAt: string;
}

interface FieldChanges {
  name?: string;
  description?: string;
  owner?: string;
  expiresAt?: string;
}

type EditField = keyof EditForm;

function formFromFlag(flag: FlagState): EditForm {
  return {
    name: flag.name,
    description: flag.description ?? "",
    owner: flag.owner,
    expiresAt: flag.expiresAt,
  };
}

function normalizeDescription(value: string): string {
  return value.trim();
}

function changedFields(flag: FlagState, form: EditForm): FieldChanges {
  const changes: FieldChanges = {};
  if (form.name.trim() !== flag.name.trim()) {
    changes.name = form.name.trim();
  }
  if (form.owner.trim() !== flag.owner.trim()) {
    changes.owner = form.owner.trim();
  }
  if (form.expiresAt !== flag.expiresAt) {
    changes.expiresAt = form.expiresAt;
  }
  if (normalizeDescription(form.description) !== normalizeDescription(flag.description ?? "")) {
    changes.description = form.description.trim();
  }
  return changes;
}

function hasChanges(changes: FieldChanges): boolean {
  return (
    changes.name !== undefined ||
    changes.description !== undefined ||
    changes.owner !== undefined ||
    changes.expiresAt !== undefined
  );
}

function isEditField(value: string): value is EditField {
  return value === "name" || value === "description" || value === "owner" || value === "expiresAt";
}

function issuesByField(issues: readonly { path: ReadonlyArray<PropertyKey>; message: string }[]): Partial<Record<EditField, string>> {
  const errors: Partial<Record<EditField, string>> = {};
  for (const issue of issues) {
    const field = issue.path[0];
    if (typeof field !== "string" || !isEditField(field) || errors[field] !== undefined) {
      continue;
    }
    errors[field] = issue.message;
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

export function FlagDetail({ flagKey }: { flagKey: string }): JSX.Element {
  const toast = useToast();
  const [flag, setFlag] = useState<FlagState | undefined>();
  const [form, setForm] = useState<EditForm | undefined>();
  const [phase, setPhase] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [attempt, setAttempt] = useState(0);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<EditField, string>>>({});
  const [saveOpen, setSaveOpen] = useState(false);
  const [killOpen, setKillOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);

  useEffect(() => {
    let active = true;
    setPhase("loading");
    setFlag(undefined);
    setForm(undefined);
    void getFlag(flagKey)
      .then((loaded) => {
        if (!active) {
          return;
        }
        setFlag(loaded);
        setForm(formFromFlag(loaded));
        setFieldErrors({});
        setPhase("ready");
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }
        if (error instanceof ApiClientError && error.status === 404) {
          setPhase("missing");
          return;
        }
        setErrorMessage(error instanceof Error ? error.message : "No se pudo cargar la flag");
        setPhase("error");
      });
    return () => {
      active = false;
    };
  }, [flagKey, attempt]);

  async function copyKey(key: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(key);
      toast.success("Key copiada");
    } catch {
      toast.error("No se pudo copiar la key");
    }
  }

  if (phase === "loading") {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <p>Cargando…</p>
      </main>
    );
  }

  if (phase === "missing") {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <p>Flag no encontrada</p>
        <Link href="/" className="mt-4 inline-block underline">
          Volver al listado
        </Link>
      </main>
    );
  }

  if (phase === "error" || flag === undefined || form === undefined) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <div role="alert">
          <p>{errorMessage ?? "No se pudo cargar la flag"}</p>
          <button type="button" className="mt-3 rounded border px-3 py-2" onClick={() => setAttempt((current) => current + 1)}>
            Reintentar
          </button>
        </div>
      </main>
    );
  }

  const changes = changedFields(flag, form);
  const dirty = hasChanges(changes);
  const locked = flag.archived;
  const killTitle = flag.killSwitch ? "Desactivar kill switch" : "Activar kill switch";
  const killLabel = flag.killSwitch ? "Desactivar" : "Activar";

  const openSave = (): void => {
    const nextChanges = changedFields(flag, form);
    if (!hasChanges(nextChanges) || flag.archived) {
      return;
    }
    const parsed = updateFlagInputSchema.safeParse({ ...nextChanges, reason: "validar" });
    if (!parsed.success) {
      setFieldErrors(issuesByField(parsed.error.issues));
      return;
    }
    setFieldErrors({});
    setSaveOpen(true);
  };

  const confirmSave = async (reason: string): Promise<void> => {
    const nextChanges = changedFields(flag, form);
    const input: UpdateFlagInput = {
      reason,
      name: nextChanges.name,
      description: nextChanges.description,
      owner: nextChanges.owner,
      expiresAt: nextChanges.expiresAt,
    };
    const updated = await updateFlag(flag.key, input);
    setFlag(updated);
    setForm(formFromFlag(updated));
    setSaveOpen(false);
    toast.success("Cambios guardados");
  };

  const confirmKill = async (reason: string): Promise<void> => {
    const updated = await setKillSwitch(flag.key, { enabled: !flag.killSwitch, reason });
    setFlag(updated);
    setForm(formFromFlag(updated));
    setKillOpen(false);
    toast.success(updated.killSwitch ? "Kill switch activado" : "Kill switch desactivado");
  };

  const confirmArchive = async (reason: string): Promise<void> => {
    const updated = flag.archived ? await unarchiveFlag(flag.key, { reason }) : await archiveFlag(flag.key, { reason });
    setFlag(updated);
    setForm(formFromFlag(updated));
    setArchiveOpen(false);
    toast.success(updated.archived ? "Flag archivada" : "Flag desarchivada");
  };

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 p-6">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-mono text-2xl">{flag.key}</h1>
          <button type="button" className="rounded border px-3 py-1" onClick={() => void copyKey(flag.key)}>
            Copiar
          </button>
          {flag.killSwitch ? (
            <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">Kill switch</span>
          ) : null}
          {flag.archived ? (
            <span className="rounded bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-700">Archivada</span>
          ) : null}
        </div>
        <p className="text-xl">{flag.name}</p>
        <div className="flex gap-4">
          <Link href={`/flags/${flag.key}/history`} className="underline">
            Historial
          </Link>
          <Link href="/" className="underline">
            Volver al listado
          </Link>
        </div>
      </header>

      {locked ? <p className="rounded border border-gray-300 bg-gray-100 px-3 py-2">Flag archivada: solo lectura</p> : null}

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">Información general</h2>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            openSave();
          }}
        >
          <label className="text-sm" htmlFor="detail-name">
            Nombre
          </label>
          <input
            id="detail-name"
            className="rounded border px-3 py-2 disabled:bg-gray-100"
            value={form.name}
            disabled={locked}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
          <FieldError message={fieldErrors.name} />
          <label className="text-sm" htmlFor="detail-description">
            Descripción
          </label>
          <textarea
            id="detail-description"
            className="min-h-24 rounded border px-3 py-2 disabled:bg-gray-100"
            value={form.description}
            disabled={locked}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
          />
          <FieldError message={fieldErrors.description} />
          <label className="text-sm" htmlFor="detail-owner">
            Owner
          </label>
          <input
            id="detail-owner"
            className="rounded border px-3 py-2 disabled:bg-gray-100"
            value={form.owner}
            disabled={locked}
            onChange={(event) => setForm({ ...form, owner: event.target.value })}
          />
          <FieldError message={fieldErrors.owner} />
          <label className="text-sm" htmlFor="detail-expires">
            Expiración
          </label>
          <input
            id="detail-expires"
            type="date"
            className="rounded border px-3 py-2 disabled:bg-gray-100"
            value={form.expiresAt}
            disabled={locked}
            onChange={(event) => setForm({ ...form, expiresAt: event.target.value })}
          />
          <FieldError message={fieldErrors.expiresAt} />
          <button type="submit" className="w-fit rounded bg-black px-3 py-2 text-white disabled:opacity-60" disabled={!dirty || locked}>
            Guardar cambios
          </button>
        </form>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Kill switch</h2>
        <p>Si está activo, la flag devuelve `false` en todos los ambientes</p>
        <button
          type="button"
          role="switch"
          aria-checked={flag.killSwitch}
          className="w-fit rounded border px-3 py-2 disabled:opacity-60"
          disabled={locked}
          onClick={() => setKillOpen(true)}
        >
          {flag.killSwitch ? "Activo" : "Inactivo"}
        </button>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Ambientes</h2>
        <ul className="flex flex-col gap-2">
          {ENVIRONMENTS.map((environment) => {
            const rule = flag.environments[environment];
            if (rule === undefined) {
              return null;
            }
            return (
              <li key={environment} className="flex flex-wrap items-center gap-3 rounded border px-3 py-2">
                <span>{ENVIRONMENT_LABELS[environment]}</span>
                <EnvironmentBadge rule={rule} />
                <span>{rule.allowCompanies.length} permitidas</span>
                <span>{rule.denyCompanies.length} bloqueadas</span>
              </li>
            );
          })}
        </ul>
        <TargetingEditor flag={flag} onUpdated={setFlag} />
      </section>

      <section>
        <button
          type="button"
          className={locked ? "rounded border px-3 py-2" : "rounded bg-red-700 px-3 py-2 text-white"}
          onClick={() => setArchiveOpen(true)}
        >
          {locked ? "Desarchivar flag" : "Archivar flag"}
        </button>
      </section>

      <ReasonDialog
        open={saveOpen}
        title="Guardar cambios"
        confirmLabel="Confirmar"
        onCancel={() => setSaveOpen(false)}
        onConfirm={confirmSave}
      />
      <ReasonDialog
        open={killOpen}
        title={killTitle}
        confirmLabel={killLabel}
        tone="danger"
        onCancel={() => setKillOpen(false)}
        onConfirm={confirmKill}
      />
      <ReasonDialog
        open={archiveOpen}
        title={locked ? "Desarchivar flag" : "Archivar flag"}
        confirmLabel={locked ? "Desarchivar" : "Archivar"}
        tone={locked ? "default" : "danger"}
        onCancel={() => setArchiveOpen(false)}
        onConfirm={confirmArchive}
      />
    </main>
  );
}
