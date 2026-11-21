"use client";

import type { JSX } from "react";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { EnvironmentRule, FlagState, FlagSummary, ObsoleteReason } from "@ff/domain";
import { apiFetch } from "@/lib/api";
import { EnvironmentBadge } from "@/components/flags/environment-badge";
import { ReasonDialog } from "@/components/reason-dialog";
import { useToast } from "@/components/toast";
import { setKillSwitch } from "@/lib/flags-api";

const FLAG_LIST_STATUSES = ["active", "archived", "all"] as const;
type FlagListStatus = (typeof FLAG_LIST_STATUSES)[number];

interface Filters {
  q: string;
  status: FlagListStatus;
  obsolete: boolean;
}

interface ObsoleteItem {
  key: string;
  name: string;
  owner: string;
  reasons: ObsoleteReason[];
  lastChangedAt: string;
}

interface DashboardSummary {
  activeCount: number;
  archivedCount: number;
  obsoleteCount: number;
  obsolete: ObsoleteItem[];
}

type DashboardView =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; items: FlagSummary[]; summary: DashboardSummary };

const REASON_LABELS = {
  EXPIRED: "Vencida",
  STALE_PRODUCTION: "30+ días sin cambios en production",
} as const satisfies Record<ObsoleteReason, string>;

const DATE_FORMAT = new Intl.DateTimeFormat("es", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "UTC",
});

function isFlagListStatus(value: string | null): value is FlagListStatus {
  return value === "active" || value === "archived" || value === "all";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isObsoleteReason(value: unknown): value is ObsoleteReason {
  return value === "EXPIRED" || value === "STALE_PRODUCTION";
}

function readFilters(params: { get(name: string): string | null }): Filters {
  const status = params.get("status");
  return {
    q: params.get("q") ?? "",
    status: isFlagListStatus(status) ? status : "active",
    obsolete: params.get("obsolete") === "true",
  };
}

function sameFilters(left: Filters, right: Filters): boolean {
  return left.q === right.q && left.status === right.status && left.obsolete === right.obsolete;
}

function toHref(filters: Filters): string {
  const params = new URLSearchParams();
  if (filters.q.length > 0) {
    params.set("q", filters.q);
  }
  params.set("status", filters.status);
  if (filters.obsolete) {
    params.set("obsolete", "true");
  }
  return `/?${params.toString()}`;
}

function flagsPath(filters: Filters): string {
  const params = new URLSearchParams();
  if (filters.q.length > 0) {
    params.set("q", filters.q);
  }
  params.set("status", filters.status);
  if (filters.obsolete) {
    params.set("obsolete", "true");
  }
  return `/api/admin/flags?${params.toString()}`;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return DATE_FORMAT.format(date);
}

function parseReasons(value: unknown): ObsoleteReason[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const reasons: ObsoleteReason[] = [];
  for (const item of value) {
    if (!isObsoleteReason(item)) {
      return undefined;
    }
    reasons.push(item);
  }
  return reasons;
}

function parseEnvironmentRule(value: unknown): EnvironmentRule | undefined {
  if (!isRecord(value) || typeof value.enabled !== "boolean" || typeof value.rolloutPercentage !== "number") {
    return undefined;
  }
  if (!isStringArray(value.allowCompanies) || !isStringArray(value.denyCompanies) || typeof value.updatedAt !== "string") {
    return undefined;
  }
  return {
    enabled: value.enabled,
    rolloutPercentage: value.rolloutPercentage,
    allowCompanies: value.allowCompanies,
    denyCompanies: value.denyCompanies,
    updatedAt: value.updatedAt,
  };
}

function parseFlagSummary(value: unknown): FlagSummary | undefined {
  if (!isRecord(value) || !isRecord(value.environments)) {
    return undefined;
  }
  const development = parseEnvironmentRule(value.environments.development);
  const staging = parseEnvironmentRule(value.environments.staging);
  const production = parseEnvironmentRule(value.environments.production);
  const obsolescence = parseReasons(value.obsolescence);
  const description = value.description === null || typeof value.description === "string" ? value.description : undefined;
  if (
    development === undefined ||
    staging === undefined ||
    production === undefined ||
    obsolescence === undefined ||
    description === undefined ||
    typeof value.key !== "string" ||
    typeof value.name !== "string" ||
    typeof value.owner !== "string" ||
    typeof value.expiresAt !== "string" ||
    typeof value.killSwitch !== "boolean" ||
    typeof value.archived !== "boolean" ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string" ||
    typeof value.lastChangedAt !== "string"
  ) {
    return undefined;
  }
  return {
    key: value.key,
    name: value.name,
    description,
    owner: value.owner,
    expiresAt: value.expiresAt,
    killSwitch: value.killSwitch,
    archived: value.archived,
    environments: { development, staging, production },
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    obsolescence,
    lastChangedAt: value.lastChangedAt,
  };
}

function parseFlagList(value: unknown): FlagSummary[] | undefined {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    return undefined;
  }
  const items: FlagSummary[] = [];
  for (const item of value.items) {
    const parsed = parseFlagSummary(item);
    if (parsed === undefined) {
      return undefined;
    }
    items.push(parsed);
  }
  return items;
}

function parseObsoleteItem(value: unknown): ObsoleteItem | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const reasons = parseReasons(value.reasons);
  if (
    reasons === undefined ||
    typeof value.key !== "string" ||
    typeof value.name !== "string" ||
    typeof value.owner !== "string" ||
    typeof value.lastChangedAt !== "string"
  ) {
    return undefined;
  }
  return {
    key: value.key,
    name: value.name,
    owner: value.owner,
    reasons,
    lastChangedAt: value.lastChangedAt,
  };
}

function parseDashboardSummary(value: unknown): DashboardSummary | undefined {
  if (
    !isRecord(value) ||
    typeof value.activeCount !== "number" ||
    typeof value.archivedCount !== "number" ||
    typeof value.obsoleteCount !== "number" ||
    !Array.isArray(value.obsolete)
  ) {
    return undefined;
  }
  const obsolete: ObsoleteItem[] = [];
  for (const item of value.obsolete) {
    const parsed = parseObsoleteItem(item);
    if (parsed === undefined) {
      return undefined;
    }
    obsolete.push(parsed);
  }
  return {
    activeCount: value.activeCount,
    archivedCount: value.archivedCount,
    obsoleteCount: value.obsoleteCount,
    obsolete,
  };
}

function StatusBadges({ flag }: { flag: FlagSummary }): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {flag.killSwitch ? (
        <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">Kill switch</span>
      ) : null}
      {flag.archived ? (
        <span className="rounded bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-700">Archivada</span>
      ) : null}
      {flag.obsolescence.length > 0 ? (
        <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">Obsoleta</span>
      ) : null}
    </div>
  );
}

export function FlagsDashboard(): JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();
  const paramsKey = searchParams.toString();
  const replaceRef = useRef(router.replace);
  replaceRef.current = router.replace;

  const [filters, setFilters] = useState<Filters>(() => readFilters(searchParams));
  const [qInput, setQInput] = useState(() => readFilters(searchParams).q);
  const toast = useToast();
  const [view, setView] = useState<DashboardView>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [pendingKill, setPendingKill] = useState<FlagSummary | undefined>();

  useEffect(() => {
    const next = readFilters(searchParams);
    setQInput((current) => (current === next.q ? current : next.q));
    setFilters((current) => (sameFilters(current, next) ? current : next));
    // Solo la query serializada: el objeto de useSearchParams cambia de identidad en cada render.
  }, [paramsKey]);

  useEffect(() => {
    if (qInput === filters.q) {
      return;
    }
    const handle = window.setTimeout(() => {
      const next: Filters = { ...filters, q: qInput };
      setFilters(next);
      replaceRef.current(toHref(next));
    }, 300);
    return () => {
      window.clearTimeout(handle);
    };
  }, [qInput, filters]);

  useEffect(() => {
    let active = true;
    setView({ status: "loading" });
    void Promise.all([apiFetch<unknown>(flagsPath(filters)), apiFetch<unknown>("/api/admin/dashboard/summary")])
      .then(([flagsBody, summaryBody]) => {
        if (!active) {
          return;
        }
        const items = parseFlagList(flagsBody);
        const summary = parseDashboardSummary(summaryBody);
        if (items === undefined || summary === undefined) {
          setView({ status: "error", message: "La respuesta del servidor no es válida" });
          return;
        }
        setView({ status: "ready", items, summary });
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }
        const message = error instanceof Error ? error.message : "No se pudo cargar";
        setView({ status: "error", message });
      });
    return () => {
      active = false;
    };
  }, [filters, attempt]);

  function rememberFlag(state: FlagState): void {
    setView((current) => {
      if (current.status !== "ready") {
        return current;
      }
      return {
        ...current,
        items: current.items.map((item) => {
          if (item.key !== state.key) {
            return item;
          }
          return {
            ...item,
            name: state.name,
            description: state.description,
            owner: state.owner,
            expiresAt: state.expiresAt,
            killSwitch: state.killSwitch,
            archived: state.archived,
            updatedAt: state.updatedAt,
            environments: state.environments,
          };
        }),
      };
    });
  }

  function commit(next: Filters): void {
    setQInput(next.q);
    setFilters(next);
    replaceRef.current(toHref(next));
  }

  function apply(patch: Partial<Filters>): void {
    commit({ ...filters, q: qInput, ...patch });
  }

  const ready = view.status === "ready" ? view : undefined;
  const catalogEmpty = ready !== undefined && ready.summary.activeCount === 0 && ready.summary.archivedCount === 0;

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Flags</h1>
        <Link href="/flags/new" className="rounded bg-black px-3 py-2 text-white">
          Nueva flag
        </Link>
      </div>

      {ready === undefined ? null : (
        <section className="grid gap-4 sm:grid-cols-2" aria-label="Resumen">
          <article className="rounded border p-4">
            <p className="text-sm text-gray-600">Flags activas</p>
            <p className="text-3xl font-semibold">{ready.summary.activeCount}</p>
          </article>
          <article className={ready.summary.obsoleteCount > 0 ? "rounded border border-amber-300 bg-amber-50 p-4" : "rounded border p-4"}>
            <p className="text-sm text-gray-600">Obsoletas</p>
            <p className={ready.summary.obsoleteCount > 0 ? "text-3xl font-semibold text-amber-800" : "text-3xl font-semibold"}>
              {ready.summary.obsoleteCount}
            </p>
          </article>
        </section>
      )}

      {ready !== undefined && ready.summary.obsoleteCount > 0 ? (
        <section className="rounded border border-amber-300 bg-amber-50 p-4">
          <h2 className="text-lg font-semibold">Requieren limpieza</h2>
          <ul className="mt-3 flex flex-col gap-2">
            {ready.summary.obsolete.map((item) => (
              <li key={item.key}>
                <Link href={`/flags/${item.key}`} className="flex flex-wrap items-center gap-3 rounded border bg-white px-3 py-2">
                  <span className="font-mono">{item.key}</span>
                  <span>{item.owner}</span>
                  {item.reasons.map((reason) => (
                    <span key={reason} className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
                      {REASON_LABELS[reason]}
                    </span>
                  ))}
                  <span>{formatDate(item.lastChangedAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <form className="flex flex-wrap items-end gap-4" onSubmit={(event) => event.preventDefault()}>
        <label className="flex min-w-64 flex-col gap-1 text-sm" htmlFor="flag-query">
          Buscar por key o nombre
          <input
            id="flag-query"
            className="rounded border px-3 py-2"
            value={qInput}
            autoComplete="off"
            onChange={(event) => setQInput(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm" htmlFor="flag-status">
          Estado
          <select
            id="flag-status"
            className="rounded border px-3 py-2"
            value={filters.status}
            onChange={(event) => {
              const status = event.target.value;
              apply({ status: isFlagListStatus(status) ? status : "active" });
            }}
          >
            <option value="active">Activas</option>
            <option value="archived">Archivadas</option>
            <option value="all">Todas</option>
          </select>
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input
            type="checkbox"
            checked={filters.obsolete}
            onChange={(event) => apply({ obsolete: event.target.checked })}
          />
          Solo obsoletas
        </label>
      </form>

      {view.status === "loading" ? <p>Cargando…</p> : null}
      {view.status === "error" ? (
        <div role="alert" className="rounded border border-red-200 bg-red-50 p-4">
          <p>{view.message}</p>
          <button type="button" className="mt-3 rounded border px-3 py-2" onClick={() => setAttempt((current) => current + 1)}>
            Reintentar
          </button>
        </div>
      ) : null}

      {ready !== undefined && ready.items.length === 0 ? (
        <div className="rounded border border-dashed p-6">
          {catalogEmpty ? (
            <>
              <p>Aún no hay flags</p>
              <Link href="/flags/new" className="mt-3 inline-block rounded bg-black px-3 py-2 text-white">
                Crear la primera flag
              </Link>
            </>
          ) : (
            <>
              <p>No hay flags que coincidan con los filtros</p>
              <button
                type="button"
                className="mt-3 rounded border px-3 py-2"
                onClick={() => commit({ q: "", status: "active", obsolete: false })}
              >
                Limpiar filtros
              </button>
            </>
          )}
        </div>
      ) : null}

      {ready !== undefined && ready.items.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left" aria-label="Flags">
            <thead>
              <tr className="border-b text-sm text-gray-600">
                <th className="px-3 py-2 font-medium" scope="col">
                  Key
                </th>
                <th className="px-3 py-2 font-medium" scope="col">
                  Nombre
                </th>
                <th className="px-3 py-2 font-medium" scope="col">
                  Owner
                </th>
                <th className="px-3 py-2 font-medium" scope="col">
                  Development
                </th>
                <th className="px-3 py-2 font-medium" scope="col">
                  Staging
                </th>
                <th className="px-3 py-2 font-medium" scope="col">
                  Production
                </th>
                <th className="px-3 py-2 font-medium" scope="col">
                  Estado
                </th>
              </tr>
            </thead>
            <tbody>
              {ready.items.map((flag) => (
                <tr key={flag.key} className="border-b">
                  <td className="px-3 py-2">
                    <Link href={`/flags/${flag.key}`} className="font-mono underline">
                      {flag.key}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{flag.name}</td>
                  <td className="px-3 py-2">{flag.owner}</td>
                  <td className="px-3 py-2">
                    <EnvironmentBadge rule={flag.environments.development} />
                  </td>
                  <td className="px-3 py-2">
                    <EnvironmentBadge rule={flag.environments.staging} />
                  </td>
                  <td className="px-3 py-2">
                    <EnvironmentBadge rule={flag.environments.production} />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadges flag={flag} />
                      {flag.archived ? null : (
                        <button
                          type="button"
                          role="switch"
                          aria-checked={flag.killSwitch}
                          aria-label={`Kill switch de ${flag.key}`}
                          className={
                            flag.killSwitch ? "rounded bg-red-700 px-2 py-1 text-xs text-white" : "rounded border px-2 py-1 text-xs"
                          }
                          onClick={() => setPendingKill(flag)}
                        >
                          {flag.killSwitch ? "On" : "Off"}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <ReasonDialog
        open={pendingKill !== undefined}
        title={pendingKill?.killSwitch === true ? "Desactivar kill switch" : "Activar kill switch"}
        confirmLabel={pendingKill?.killSwitch === true ? "Desactivar" : "Activar"}
        tone="danger"
        onCancel={() => setPendingKill(undefined)}
        onConfirm={async (reason) => {
          if (pendingKill === undefined) {
            return;
          }
          const updated = await setKillSwitch(pendingKill.key, { enabled: !pendingKill.killSwitch, reason });
          rememberFlag(updated);
          setPendingKill(undefined);
          toast.success(updated.killSwitch ? "Kill switch activado" : "Kill switch desactivado");
        }}
      />
    </main>
  );
}
