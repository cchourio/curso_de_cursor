"use client";

import type { JSX } from "react";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ENVIRONMENTS,
  diffFlagStates,
  type AuditAction,
  type AuditEntry,
  type Environment,
  type FieldChange,
  type FlagState,
} from "@ff/domain";
import { ApiClientError } from "@/lib/api";
import { getAudit, getFlag, rollback } from "@/lib/flags-api";
import { EnvironmentBadge } from "@/components/flags/environment-badge";
import { ReasonDialog } from "@/components/reason-dialog";
import { useToast } from "@/components/toast";

const DATE_TIME = new Intl.DateTimeFormat("es", { dateStyle: "short", timeStyle: "short" });

const ACTION_LABELS = {
  create: "Creada",
  update: "Información editada",
  archive: "Archivada",
  unarchive: "Desarchivada",
  kill_switch_on: "Kill switch activado",
  kill_switch_off: "Kill switch desactivado",
  targeting_update: "Targeting modificado",
  rollback: "Rollback",
} as const satisfies Record<AuditAction, string>;

const FIELD_LABELS: Record<string, string> = {
  name: "Nombre",
  description: "Descripción",
  owner: "Owner",
  expiresAt: "Expiración",
  killSwitch: "Kill switch",
  archived: "Archivada",
  enabled: "Habilitada",
  rolloutPercentage: "Rollout",
  allowCompanies: "Permitidas",
  denyCompanies: "Bloqueadas",
};

function titleCase(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function labelOf(path: string): string {
  const parts = path.split(".");
  const environment = parts[1];
  const field = parts[2];
  if (parts[0] === "environments" && environment !== undefined && field !== undefined) {
    const fieldLabel = FIELD_LABELS[field] ?? field;
    return `${titleCase(environment)} · ${fieldLabel}`;
  }
  return FIELD_LABELS[path] ?? path;
}

function formatScalar(value: unknown): string {
  if (typeof value === "boolean") {
    return value ? "Sí" : "No";
  }
  if (value === null || value === undefined) {
    return "—";
  }
  if (typeof value === "number" || typeof value === "string") {
    return String(value);
  }
  return "";
}

function formatFieldValue(path: string, value: unknown): string {
  if (path.endsWith("rolloutPercentage") && typeof value === "number") {
    return `${value} %`;
  }
  return formatScalar(value);
}

function asStrings(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      ids.push(item);
    }
  }
  return ids;
}

function listDiff(before: unknown, after: unknown): string {
  const previous = asStrings(before);
  const next = asStrings(after);
  const previousSet = new Set(previous);
  const nextSet = new Set(next);
  const parts: string[] = [];
  for (const id of next) {
    if (!previousSet.has(id)) {
      parts.push(`+${id}`);
    }
  }
  for (const id of previous) {
    if (!nextSet.has(id)) {
      parts.push(`−${id}`);
    }
  }
  return parts.join(", ");
}

function isListPath(path: string): boolean {
  return path.endsWith("allowCompanies") || path.endsWith("denyCompanies");
}

function previewOf(changes: readonly FieldChange[]): string {
  return changes
    .map((change) => {
      if (isListPath(change.path)) {
        return `${labelOf(change.path)}: ${listDiff(change.before, change.after)}`;
      }
      return `${labelOf(change.path)}: ${formatFieldValue(change.path, change.before)} → ${formatFieldValue(change.path, change.after)}`;
    })
    .join("\n");
}

function initialSummary(value: unknown): string {
  if (typeof value !== "object" || value === null) {
    return "";
  }
  const name = Object.getOwnPropertyDescriptor(value, "name")?.value;
  const owner = Object.getOwnPropertyDescriptor(value, "owner")?.value;
  if (typeof name !== "string" || typeof owner !== "string") {
    return "";
  }
  return `${name} · ${owner}`;
}

function ChangeList({ changes }: { changes: readonly FieldChange[] }): JSX.Element {
  return (
    <ul className="flex flex-col gap-1">
      {changes.map((change) => {
        if (change.path === "*") {
          return (
            <li key="*">
              <p>Estado inicial</p>
              <p>{initialSummary(change.after)}</p>
            </li>
          );
        }
        if (isListPath(change.path)) {
          return (
            <li key={change.path}>
              {labelOf(change.path)} {listDiff(change.before, change.after)}
            </li>
          );
        }
        return (
          <li key={change.path}>
            {labelOf(change.path)} <s>{formatFieldValue(change.path, change.before)}</s>{" "}
            <strong>{formatFieldValue(change.path, change.after)}</strong>
          </li>
        );
      })}
    </ul>
  );
}

function environmentRule(flag: FlagState, environment: Environment): FlagState["environments"][Environment] | undefined {
  return flag.environments[environment];
}

export function FlagHistory({ flagKey }: { flagKey: string }): JSX.Element {
  const toast = useToast();
  const [flag, setFlag] = useState<FlagState | undefined>();
  const [items, setItems] = useState<AuditEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [attempt, setAttempt] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selected, setSelected] = useState<AuditEntry | undefined>();

  useEffect(() => {
    let active = true;
    setPhase("loading");
    void Promise.all([getFlag(flagKey), getAudit(flagKey)])
      .then(([loaded, page]) => {
        if (!active) {
          return;
        }
        setFlag(loaded);
        setItems(page.items);
        setNextCursor(page.nextCursor);
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
        setErrorMessage(error instanceof Error ? error.message : "No se pudo cargar el historial");
        setPhase("error");
      });
    return () => {
      active = false;
    };
  }, [flagKey, attempt]);

  async function loadMore(): Promise<void> {
    if (nextCursor === null || loadingMore) {
      return;
    }
    setLoadingMore(true);
    try {
      const page = await getAudit(flagKey, nextCursor);
      setItems((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "No se pudo cargar más");
    } finally {
      setLoadingMore(false);
    }
  }

  const confirmRestore = async (reason: string): Promise<void> => {
    if (selected === undefined) {
      return;
    }
    await rollback(flagKey, selected.id, reason);
    const [loaded, page] = await Promise.all([getFlag(flagKey), getAudit(flagKey)]);
    setFlag(loaded);
    setItems(page.items);
    setNextCursor(page.nextCursor);
    setSelected(undefined);
    toast.success("Estado restaurado");
  };

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

  if (phase === "error" || flag === undefined) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <div role="alert">
          <p>{errorMessage ?? "No se pudo cargar el historial"}</p>
          <button type="button" className="mt-3 rounded border px-3 py-2" onClick={() => setAttempt((current) => current + 1)}>
            Reintentar
          </button>
        </div>
      </main>
    );
  }

  const previewChanges = selected?.before === null || selected === undefined ? [] : diffFlagStates(flag, selected.before);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-mono text-2xl">{flag.key}</h1>
        <Link href={`/flags/${flag.key}`} className="underline">
          Volver al detalle
        </Link>
        <p>
          {flag.name} · {flag.owner}
        </p>
        <ul className="flex flex-wrap gap-3">
          {ENVIRONMENTS.map((environment) => {
            const rule = environmentRule(flag, environment);
            if (rule === undefined) {
              return null;
            }
            return (
              <li key={environment} className="flex items-center gap-2">
                <span>{titleCase(environment)}</span>
                <EnvironmentBadge rule={rule} />
              </li>
            );
          })}
        </ul>
      </header>

      <ol className="flex flex-col gap-4">
        {items.map((entry) => {
          const restoreChanges = entry.before === null ? [] : diffFlagStates(flag, entry.before);
          return (
            <li key={entry.id}>
              <article className="flex flex-col gap-2 rounded border p-4">
                <h2 className="text-lg font-semibold">{ACTION_LABELS[entry.action]}</h2>
                <p>{DATE_TIME.format(new Date(entry.createdAt))}</p>
                <p>"{entry.reason}"</p>
                {entry.rollbackOfId === null ? null : <p>Restaura el estado previo a la entrada #{entry.rollbackOfId}</p>}
                <ChangeList changes={entry.changes} />
                {entry.before === null ? null : (
                  <button
                    type="button"
                    className="w-fit rounded border border-red-700 px-3 py-2 text-red-800 disabled:opacity-60"
                    disabled={restoreChanges.length === 0}
                    title={restoreChanges.length === 0 ? "El estado actual ya coincide" : undefined}
                    onClick={() => setSelected(entry)}
                  >
                    Restaurar estado anterior
                  </button>
                )}
              </article>
            </li>
          );
        })}
      </ol>

      {nextCursor === null ? null : (
        <button type="button" className="w-fit rounded border px-3 py-2" disabled={loadingMore} onClick={() => void loadMore()}>
          Cargar más
        </button>
      )}

      <ReasonDialog
        open={selected !== undefined}
        title="Restaurar estado anterior"
        description={previewChanges.length === 0 ? undefined : previewOf(previewChanges)}
        confirmLabel="Restaurar"
        tone="danger"
        onCancel={() => setSelected(undefined)}
        onConfirm={confirmRestore}
      />
    </main>
  );
}
