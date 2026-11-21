"use client";

import type { JSX } from "react";
import { useEffect, useId, useState } from "react";
import {
  ENVIRONMENTS,
  type Company,
  type Environment,
  type EnvironmentRule,
  type FlagState,
} from "@ff/domain";
import { listCompanies, updateEnvironmentRule } from "@/lib/flags-api";
import { ReasonDialog } from "@/components/reason-dialog";
import { useToast } from "@/components/toast";

interface RuleDraft {
  enabled: boolean;
  rolloutPercentage: number;
  allowCompanies: string[];
  denyCompanies: string[];
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const rightIds = new Set(right);
  return left.every((id) => rightIds.has(id));
}

function ruleOf(flag: FlagState, environment: Environment): EnvironmentRule {
  const rule = flag.environments[environment];
  if (rule === undefined) {
    throw new Error(`La flag ${flag.key} no tiene el ambiente ${environment}`);
  }
  return rule;
}

function draftFrom(rule: EnvironmentRule): RuleDraft {
  return {
    enabled: rule.enabled,
    rolloutPercentage: rule.rolloutPercentage,
    allowCompanies: [...rule.allowCompanies],
    denyCompanies: [...rule.denyCompanies],
  };
}

function sameDraft(rule: EnvironmentRule, draft: RuleDraft): boolean {
  return (
    rule.enabled === draft.enabled &&
    rule.rolloutPercentage === draft.rolloutPercentage &&
    sameIds(rule.allowCompanies, draft.allowCompanies) &&
    sameIds(rule.denyCompanies, draft.denyCompanies)
  );
}

function parseRollout(value: string): number | undefined {
  if (!/^\d{1,3}$/.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed > 100) {
    return undefined;
  }
  return parsed;
}

function CompanyMultiSelect({
  legend,
  searchLabel,
  companies,
  selected,
  blocked,
  readOnly,
  onAdd,
  onRemove,
}: {
  legend: string;
  searchLabel: string;
  companies: readonly Company[];
  selected: readonly string[];
  blocked: readonly string[];
  readOnly: boolean;
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
}): JSX.Element {
  const inputId = useId();
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  const visible = companies.filter((company) => {
    if (query.length === 0) {
      return true;
    }
    return company.id.toLowerCase().includes(query) || company.name.toLowerCase().includes(query);
  });

  return (
    <fieldset className="flex flex-col gap-2 rounded border p-3">
      <legend className="px-1 text-sm font-medium">{legend}</legend>
      <ul className="flex flex-wrap gap-2">
        {selected.map((id) => (
          <li key={id} className="flex items-center gap-1 rounded bg-gray-100 px-2 py-1 text-sm">
            {id}
            <button type="button" aria-label={`Quitar ${id}`} disabled={readOnly} onClick={() => onRemove(id)}>
              Quitar
            </button>
          </li>
        ))}
      </ul>
      <label className="text-sm" htmlFor={inputId}>
        {searchLabel}
      </label>
      <input
        id={inputId}
        className="rounded border px-3 py-2 disabled:bg-gray-100"
        value={search}
        disabled={readOnly}
        onChange={(event) => setSearch(event.target.value)}
      />
      <div className="flex max-h-48 flex-col gap-1 overflow-auto">
        {visible.map((company) => {
          const inOther = blocked.includes(company.id);
          const already = selected.includes(company.id);
          return (
            <button
              key={company.id}
              type="button"
              className="rounded border px-2 py-1 text-left text-sm disabled:opacity-60"
              disabled={readOnly || inOther || already}
              onClick={() => onAdd(company.id)}
            >
              {company.name} ({company.id})
              {inOther ? " (en la otra lista)" : null}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export function TargetingEditor({
  flag,
  onUpdated,
}: {
  flag: FlagState;
  onUpdated: (flag: FlagState) => void;
}): JSX.Element {
  const toast = useToast();
  const sliderId = useId();
  const numberId = useId();
  const [environment, setEnvironment] = useState<Environment>("development");
  const [draft, setDraft] = useState<RuleDraft>(() => draftFrom(ruleOf(flag, "development")));
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyError, setCompanyError] = useState<string | undefined>();
  const [companyAttempt, setCompanyAttempt] = useState(0);
  const [saveOpen, setSaveOpen] = useState(false);
  const readOnly = flag.archived;
  const saved = ruleOf(flag, environment);
  const dirty = !sameDraft(saved, draft);

  useEffect(() => {
    let active = true;
    setCompanyError(undefined);
    void listCompanies()
      .then((items) => {
        if (active) {
          setCompanies(items);
        }
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }
        setCompanies([]);
        setCompanyError(error instanceof Error ? error.message : "No se pudieron cargar las empresas");
      });
    return () => {
      active = false;
    };
  }, [companyAttempt]);

  function selectEnvironment(next: Environment): void {
    if (next === environment) {
      return;
    }
    if (dirty && !window.confirm(`¿Descartar cambios de ${environment}?`)) {
      return;
    }
    setEnvironment(next);
    setDraft(draftFrom(ruleOf(flag, next)));
  }

  function setRollout(value: string): void {
    const parsed = parseRollout(value);
    if (parsed === undefined) {
      return;
    }
    setDraft({ ...draft, rolloutPercentage: parsed });
  }

  function addCompany(list: "allow" | "deny", id: string): void {
    if (readOnly || draft.allowCompanies.includes(id) || draft.denyCompanies.includes(id)) {
      return;
    }
    if (list === "allow") {
      setDraft({ ...draft, allowCompanies: [...draft.allowCompanies, id] });
      return;
    }
    setDraft({ ...draft, denyCompanies: [...draft.denyCompanies, id] });
  }

  function removeCompany(list: "allow" | "deny", id: string): void {
    if (readOnly) {
      return;
    }
    if (list === "allow") {
      setDraft({ ...draft, allowCompanies: draft.allowCompanies.filter((companyId) => companyId !== id) });
      return;
    }
    setDraft({ ...draft, denyCompanies: draft.denyCompanies.filter((companyId) => companyId !== id) });
  }

  const confirmSave = async (reason: string): Promise<void> => {
    const updated = await updateEnvironmentRule(flag.key, environment, {
      enabled: draft.enabled,
      rolloutPercentage: draft.rolloutPercentage,
      allowCompanies: draft.allowCompanies,
      denyCompanies: draft.denyCompanies,
      reason,
    });
    onUpdated(updated);
    setSaveOpen(false);
    toast.success("Targeting guardado");
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Ambientes">
        {ENVIRONMENTS.map((item) => (
          <div key={item} className="flex items-center gap-2">
            <button
              type="button"
              role="tab"
              aria-selected={environment === item}
              className={environment === item ? "rounded border border-black px-3 py-1" : "rounded border px-3 py-1"}
              onClick={() => selectEnvironment(item)}
            >
              {item}
              {item === "production" ? (
                <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-xs font-semibold text-red-800">Producción</span>
              ) : null}
            </button>
            {environment === item && dirty ? <span>Cambios sin guardar</span> : null}
          </div>
        ))}
      </div>

      {flag.killSwitch ? <p>Kill switch activo: esta regla no se aplica hasta desactivarlo</p> : null}
      {draft.enabled ? null : <p>Mientras esté deshabilitada, todas las empresas reciben `false`</p>}
      {companyError === undefined ? null : (
        <div role="alert">
          <p>{companyError}</p>
          <button type="button" className="mt-2 rounded border px-3 py-1" onClick={() => setCompanyAttempt((current) => current + 1)}>
            Reintentar
          </button>
        </div>
      )}

      <div className="flex items-center gap-3">
        <span>Habilitada en {environment}</span>
        <button
          type="button"
          role="switch"
          aria-checked={draft.enabled}
          aria-label={`Habilitada en ${environment}`}
          className="rounded border px-3 py-1 disabled:opacity-60"
          disabled={readOnly}
          onClick={() => setDraft({ ...draft, enabled: !draft.enabled })}
        >
          {draft.enabled ? "Sí" : "No"}
        </button>
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-sm" htmlFor={sliderId}>
          Rollout
        </label>
        <input
          id={sliderId}
          type="range"
          min={0}
          max={100}
          step={1}
          value={draft.rolloutPercentage}
          disabled={readOnly}
          onChange={(event) => setRollout(event.target.value)}
        />
        <label className="text-sm" htmlFor={numberId}>
          Porcentaje
        </label>
        <input
          id={numberId}
          type="number"
          min={0}
          max={100}
          step={1}
          className="w-24 rounded border px-3 py-2 disabled:bg-gray-100"
          value={draft.rolloutPercentage}
          disabled={readOnly}
          onChange={(event) => setRollout(event.target.value)}
        />
        <p>{draft.rolloutPercentage} % de las empresas recibirán la feature</p>
      </div>

      <CompanyMultiSelect
        legend="Empresas permitidas"
        searchLabel="Buscar permitidas"
        companies={companies}
        selected={draft.allowCompanies}
        blocked={draft.denyCompanies}
        readOnly={readOnly}
        onAdd={(id) => addCompany("allow", id)}
        onRemove={(id) => removeCompany("allow", id)}
      />
      <CompanyMultiSelect
        legend="Empresas bloqueadas"
        searchLabel="Buscar bloqueadas"
        companies={companies}
        selected={draft.denyCompanies}
        blocked={draft.allowCompanies}
        readOnly={readOnly}
        onAdd={(id) => addCompany("deny", id)}
        onRemove={(id) => removeCompany("deny", id)}
      />

      <div className="flex gap-2">
        <button
          type="button"
          className="rounded bg-black px-3 py-2 text-white disabled:opacity-60"
          disabled={!dirty || readOnly}
          onClick={() => setSaveOpen(true)}
        >
          Guardar
        </button>
        <button
          type="button"
          className="rounded border px-3 py-2 disabled:opacity-60"
          disabled={!dirty || readOnly}
          onClick={() => setDraft(draftFrom(saved))}
        >
          Descartar
        </button>
      </div>

      <ReasonDialog
        open={saveOpen}
        title={environment === "production" ? "Guardar cambios en PRODUCCIÓN" : `Guardar cambios en ${environment}`}
        confirmLabel="Confirmar"
        tone={environment === "production" ? "danger" : "default"}
        onCancel={() => setSaveOpen(false)}
        onConfirm={confirmSave}
      />
    </div>
  );
}
