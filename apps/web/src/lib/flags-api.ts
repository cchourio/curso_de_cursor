import type {
  AuditEntry,
  Company,
  CreateCompanyInput,
  CreateFlagInput,
  Environment,
  EnvironmentRuleInput,
  FlagState,
  KillSwitchInput,
  ReasonOnlyInput,
  UpdateCompanyInput,
  UpdateFlagInput,
} from "@ff/domain";
import { apiFetch } from "./api";

function property(value: object, key: string): unknown {
  return Object.getOwnPropertyDescriptor(value, key)?.value;
}

function isCompany(value: unknown): value is Company {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  return (
    typeof property(value, "id") === "string" &&
    typeof property(value, "name") === "string" &&
    typeof property(value, "createdAt") === "string" &&
    typeof property(value, "updatedAt") === "string"
  );
}

function flagPath(key: string): string {
  return `/api/admin/flags/${encodeURIComponent(key)}`;
}

export function createFlag(input: CreateFlagInput): Promise<FlagState> {
  return apiFetch<FlagState>("/api/admin/flags", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getFlag(key: string): Promise<FlagState> {
  return apiFetch<FlagState>(flagPath(key));
}

export function updateFlag(key: string, input: UpdateFlagInput): Promise<FlagState> {
  return apiFetch<FlagState>(flagPath(key), {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function setKillSwitch(key: string, input: KillSwitchInput): Promise<FlagState> {
  return apiFetch<FlagState>(`${flagPath(key)}/kill-switch`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function archiveFlag(key: string, input: ReasonOnlyInput): Promise<FlagState> {
  return apiFetch<FlagState>(`${flagPath(key)}/archive`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function unarchiveFlag(key: string, input: ReasonOnlyInput): Promise<FlagState> {
  return apiFetch<FlagState>(`${flagPath(key)}/unarchive`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateEnvironmentRule(key: string, env: Environment, input: EnvironmentRuleInput): Promise<FlagState> {
  return apiFetch<FlagState>(`${flagPath(key)}/environments/${encodeURIComponent(env)}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function listCompanies(): Promise<Company[]> {
  const body = await apiFetch<{ items: unknown }>("/api/admin/companies");
  if (!Array.isArray(body.items)) {
    throw new Error("No se pudieron cargar las empresas");
  }
  const companies: Company[] = [];
  for (const item of body.items) {
    if (!isCompany(item)) {
      throw new Error("No se pudieron cargar las empresas");
    }
    companies.push(item);
  }
  return companies;
}

export function createCompany(input: CreateCompanyInput): Promise<Company> {
  return apiFetch<Company>("/api/admin/companies", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateCompany(id: string, input: UpdateCompanyInput): Promise<Company> {
  return apiFetch<Company>(`/api/admin/companies/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function getAudit(key: string, cursor?: number): Promise<{ items: AuditEntry[]; nextCursor: number | null }> {
  const params = new URLSearchParams();
  if (cursor !== undefined) {
    params.set("cursor", String(cursor));
  }
  const query = params.size > 0 ? `?${params.toString()}` : "";
  return apiFetch<{ items: AuditEntry[]; nextCursor: number | null }>(`${flagPath(key)}/audit${query}`);
}

export function rollback(key: string, auditId: number, reason: string): Promise<FlagState> {
  return apiFetch<FlagState>(`${flagPath(key)}/rollback`, {
    method: "POST",
    body: JSON.stringify({ auditId, reason }),
  });
}
