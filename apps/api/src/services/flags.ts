import { AUDIT_ACTIONS, ENVIRONMENTS, diffFlagStates, getLastChangedAt, getObsolescence } from "@ff/domain";
import type {
  AuditAction,
  AuditEntry,
  CreateFlagInput,
  Environment,
  EnvironmentRule,
  EnvironmentRuleInput,
  FieldChange,
  FlagState,
  FlagSummary,
  KillSwitchInput,
  ObsoleteReason,
  ReasonOnlyInput,
  RollbackInput,
  UpdateFlagInput,
} from "@ff/domain";
import { getFlagState, listFlagStates, schema, type Db } from "@ff/db";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { ApiError } from "../http/errors";

export const FLAG_LIST_STATUSES = ["active", "archived", "all"] as const;
export type FlagListStatus = (typeof FLAG_LIST_STATUSES)[number];

export function parseFlagListStatus(value: string | undefined): FlagListStatus {
  if (value === undefined) {
    return "active";
  }
  if (value === "active" || value === "archived" || value === "all") {
    return value;
  }
  throw new ApiError(400, "VALIDATION_ERROR", "El estado no es válido", [
    { path: "status", message: "El estado debe ser active, archived o all" },
  ]);
}

function isConstraintError(error: unknown): boolean {
  const messages: string[] = [];
  if (error instanceof Error) {
    messages.push(error.message);
    if (error.cause instanceof Error) {
      messages.push(error.cause.message);
    }
  }
  return /constraint/i.test(messages.join("\n"));
}

async function inTransaction<T>(db: Db, run: () => Promise<T>): Promise<T> {
  // db.transaction() cambia de conexión en libSQL y con :memory: deja de ver las tablas.
  await db.run(sql`begin`);
  try {
    const result = await run();
    await db.run(sql`commit`);
    return result;
  } catch (error) {
    try {
      await db.run(sql`rollback`);
    } catch {
      // La transacción ya no estaba abierta.
    }
    throw error;
  }
}

function comparable(state: FlagState): string {
  const environments: Record<
    string,
    { enabled: boolean; rolloutPercentage: number; allowCompanies: string[]; denyCompanies: string[] }
  > = {};
  for (const environment of ENVIRONMENTS) {
    const rule = state.environments[environment];
    if (rule === undefined) {
      throw new Error(`La flag ${state.key} no tiene el ambiente ${environment}`);
    }
    environments[environment] = {
      enabled: rule.enabled,
      rolloutPercentage: rule.rolloutPercentage,
      allowCompanies: rule.allowCompanies,
      denyCompanies: rule.denyCompanies,
    };
  }
  return JSON.stringify({
    key: state.key,
    name: state.name,
    description: state.description,
    owner: state.owner,
    expiresAt: state.expiresAt,
    killSwitch: state.killSwitch,
    archived: state.archived,
    environments,
  });
}

function sameState(left: FlagState, right: FlagState): boolean {
  return comparable(left) === comparable(right);
}

async function requireFlag(db: Db, key: string): Promise<FlagState> {
  const state = await getFlagState(db, key);
  if (state === null) {
    throw new ApiError(404, "NOT_FOUND", "Flag no encontrada");
  }
  return state;
}

async function readWrittenFlag(db: Db, key: string): Promise<FlagState> {
  const state = await getFlagState(db, key);
  if (state === null) {
    throw new Error(`La flag ${key} no quedó persistida`);
  }
  return state;
}

async function writeAudit(
  db: Db,
  entry: {
    flagKey: string;
    action: AuditAction;
    reason: string;
    before: FlagState | null;
    after: FlagState;
    createdAt: string;
    rollbackOfId?: number;
  },
): Promise<void> {
  await db.insert(schema.auditLog).values({
    flagKey: entry.flagKey,
    action: entry.action,
    reason: entry.reason,
    beforeState: entry.before === null ? null : JSON.stringify(entry.before),
    afterState: JSON.stringify(entry.after),
    createdAt: entry.createdAt,
    rollbackOfId: entry.rollbackOfId ?? null,
  });
}

function assertFutureExpiry(expiresAt: string, clock: () => Date): void {
  const today = clock().toISOString().slice(0, 10);
  if (expiresAt < today) {
    throw new ApiError(400, "VALIDATION_ERROR", "La fecha de expiración debe ser hoy o posterior", [
      { path: "expiresAt", message: "La fecha de expiración debe ser hoy o posterior" },
    ]);
  }
}

export interface DashboardObsoleteFlag {
  key: string;
  name: string;
  owner: string;
  reasons: ObsoleteReason[];
  lastChangedAt: string;
}

export interface DashboardSummary {
  activeCount: number;
  archivedCount: number;
  obsoleteCount: number;
  obsolete: DashboardObsoleteFlag[];
}

function summarize(flag: FlagState, now: Date): FlagSummary {
  return {
    ...flag,
    obsolescence: getObsolescence(flag, now),
    lastChangedAt: getLastChangedAt(flag),
  };
}

export async function listFlags(
  db: Db,
  query: { q: string | undefined; status: FlagListStatus; obsolete: boolean },
  clock: () => Date,
): Promise<FlagSummary[]> {
  const now = clock();
  const states = await listFlagStates(db);
  const needle = (query.q ?? "").toLowerCase();
  return states.map((flag) => summarize(flag, now)).filter((flag) => {
    if (query.status === "active" && flag.archived) {
      return false;
    }
    if (query.status === "archived" && !flag.archived) {
      return false;
    }
    if (query.obsolete && flag.obsolescence.length === 0) {
      return false;
    }
    if (needle.length === 0) {
      return true;
    }
    return flag.key.toLowerCase().includes(needle) || flag.name.toLowerCase().includes(needle);
  });
}

export async function getDashboardSummary(db: Db, clock: () => Date): Promise<DashboardSummary> {
  const now = clock();
  const states = await listFlagStates(db);
  let activeCount = 0;
  let archivedCount = 0;
  const obsolete: DashboardObsoleteFlag[] = [];
  for (const flag of states) {
    if (flag.archived) {
      archivedCount += 1;
    } else {
      activeCount += 1;
    }
    const reasons = getObsolescence(flag, now);
    if (reasons.length > 0) {
      obsolete.push({
        key: flag.key,
        name: flag.name,
        owner: flag.owner,
        reasons,
        lastChangedAt: getLastChangedAt(flag),
      });
    }
  }
  obsolete.sort((left, right) => left.lastChangedAt.localeCompare(right.lastChangedAt));
  return {
    activeCount,
    archivedCount,
    obsoleteCount: obsolete.length,
    obsolete,
  };
}

export async function getFlag(db: Db, key: string): Promise<FlagState> {
  return requireFlag(db, key);
}

export async function createFlag(db: Db, input: CreateFlagInput, clock: () => Date): Promise<FlagState> {
  assertFutureExpiry(input.expiresAt, clock);
  return inTransaction(db, async () => {
    const existing = await getFlagState(db, input.key);
    if (existing !== null) {
      throw new ApiError(409, "CONFLICT", "Ya existe una flag con esta key");
    }
    const now = clock().toISOString();
    try {
      await db.insert(schema.flags).values({
        key: input.key,
        name: input.name,
        description: input.description,
        owner: input.owner,
        expiresAt: input.expiresAt,
        killSwitch: false,
        archived: false,
        createdAt: now,
        updatedAt: now,
      });
    } catch (error) {
      if (isConstraintError(error)) {
        throw new ApiError(409, "CONFLICT", "Ya existe una flag con esta key");
      }
      throw error;
    }
    await db.insert(schema.flagEnvironments).values(
      ENVIRONMENTS.map((environment) => ({
        flagKey: input.key,
        environment,
        enabled: false,
        rolloutPercentage: 0,
        updatedAt: now,
      })),
    );
    const after = await readWrittenFlag(db, input.key);
    await writeAudit(db, {
      flagKey: input.key,
      action: "create",
      reason: input.reason,
      before: null,
      after,
      createdAt: now,
    });
    return after;
  });
}

function applyUpdate(current: FlagState, input: UpdateFlagInput): FlagState {
  return {
    ...current,
    name: input.name ?? current.name,
    description: input.description === undefined ? current.description : input.description,
    owner: input.owner ?? current.owner,
    expiresAt: input.expiresAt ?? current.expiresAt,
  };
}

export async function updateFlag(db: Db, key: string, input: UpdateFlagInput, clock: () => Date): Promise<FlagState> {
  return inTransaction(db, async () => {
    const before = await requireFlag(db, key);
    if (before.archived) {
      throw new ApiError(409, "FLAG_ARCHIVED", "La flag está archivada");
    }
    const next = applyUpdate(before, input);
    if (sameState(before, next)) {
      throw new ApiError(400, "NO_CHANGES", "La flag no tiene cambios");
    }
    const now = clock().toISOString();
    await db
      .update(schema.flags)
      .set({
        name: next.name,
        description: next.description,
        owner: next.owner,
        expiresAt: next.expiresAt,
        updatedAt: now,
      })
      .where(eq(schema.flags.key, key));
    const after = await readWrittenFlag(db, key);
    await writeAudit(db, {
      flagKey: key,
      action: "update",
      reason: input.reason,
      before,
      after,
      createdAt: now,
    });
    return after;
  });
}

async function setArchived(
  db: Db,
  key: string,
  input: ReasonOnlyInput,
  clock: () => Date,
  archived: boolean,
): Promise<FlagState> {
  return inTransaction(db, async () => {
    const before = await requireFlag(db, key);
    if (archived && before.archived) {
      throw new ApiError(409, "CONFLICT", "La flag ya está archivada");
    }
    if (!archived && !before.archived) {
      throw new ApiError(409, "CONFLICT", "La flag no está archivada");
    }
    const now = clock().toISOString();
    await db.update(schema.flags).set({ archived, updatedAt: now }).where(eq(schema.flags.key, key));
    const after = await readWrittenFlag(db, key);
    const action: AuditAction = archived ? "archive" : "unarchive";
    await writeAudit(db, {
      flagKey: key,
      action,
      reason: input.reason,
      before,
      after,
      createdAt: now,
    });
    return after;
  });
}

export async function archiveFlag(db: Db, key: string, input: ReasonOnlyInput, clock: () => Date): Promise<FlagState> {
  return setArchived(db, key, input, clock, true);
}

export async function unarchiveFlag(
  db: Db,
  key: string,
  input: ReasonOnlyInput,
  clock: () => Date,
): Promise<FlagState> {
  return setArchived(db, key, input, clock, false);
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const rightIds = new Set(right);
  return left.every((id) => rightIds.has(id));
}

export async function updateEnvironmentRule(
  db: Db,
  key: string,
  environment: Environment,
  input: EnvironmentRuleInput,
  clock: () => Date,
): Promise<FlagState> {
  return inTransaction(db, async () => {
    const before = await requireFlag(db, key);
    if (before.archived) {
      throw new ApiError(409, "FLAG_ARCHIVED", "La flag está archivada");
    }
    const knownRows = await db.select({ id: schema.companies.id }).from(schema.companies);
    const known = new Set(knownRows.map((row) => row.id));
    const missing: { companyId: string }[] = [];
    const seen = new Set<string>();
    for (const companyId of [...input.allowCompanies, ...input.denyCompanies]) {
      if (seen.has(companyId)) {
        continue;
      }
      seen.add(companyId);
      if (!known.has(companyId)) {
        missing.push({ companyId });
      }
    }
    if (missing.length > 0) {
      throw new ApiError(400, "UNKNOWN_COMPANY", "Hay empresas que no existen en el catálogo", missing);
    }
    const current = before.environments[environment];
    if (current === undefined) {
      throw new Error(`La flag ${key} no tiene el ambiente ${environment}`);
    }
    if (
      current.enabled === input.enabled &&
      current.rolloutPercentage === input.rolloutPercentage &&
      sameIds(current.allowCompanies, input.allowCompanies) &&
      sameIds(current.denyCompanies, input.denyCompanies)
    ) {
      throw new ApiError(400, "NO_CHANGES", "La flag no tiene cambios");
    }
    const now = clock().toISOString();
    await db
      .update(schema.flagEnvironments)
      .set({
        enabled: input.enabled,
        rolloutPercentage: input.rolloutPercentage,
        updatedAt: now,
      })
      .where(and(eq(schema.flagEnvironments.flagKey, key), eq(schema.flagEnvironments.environment, environment)));
    await db
      .delete(schema.flagEnvironmentCompanies)
      .where(
        and(eq(schema.flagEnvironmentCompanies.flagKey, key), eq(schema.flagEnvironmentCompanies.environment, environment)),
      );
    if (input.allowCompanies.length > 0 || input.denyCompanies.length > 0) {
      await db.insert(schema.flagEnvironmentCompanies).values([
        ...input.allowCompanies.map((companyId) => ({
          flagKey: key,
          environment,
          companyId,
          list: "allow",
        })),
        ...input.denyCompanies.map((companyId) => ({
          flagKey: key,
          environment,
          companyId,
          list: "deny",
        })),
      ]);
    }
    await db.update(schema.flags).set({ updatedAt: now }).where(eq(schema.flags.key, key));
    const after = await readWrittenFlag(db, key);
    await writeAudit(db, {
      flagKey: key,
      action: "targeting_update",
      reason: input.reason,
      before,
      after,
      createdAt: now,
    });
    return after;
  });
}

export async function setKillSwitch(
  db: Db,
  key: string,
  input: KillSwitchInput,
  clock: () => Date,
): Promise<FlagState> {
  return inTransaction(db, async () => {
    const before = await requireFlag(db, key);
    if (before.archived) {
      throw new ApiError(409, "FLAG_ARCHIVED", "La flag está archivada");
    }
    if (before.killSwitch === input.enabled) {
      throw new ApiError(400, "NO_CHANGES", "La flag no tiene cambios");
    }
    const now = clock().toISOString();
    await db.update(schema.flags).set({ killSwitch: input.enabled, updatedAt: now }).where(eq(schema.flags.key, key));
    const after = await readWrittenFlag(db, key);
    const action: AuditAction = input.enabled ? "kill_switch_on" : "kill_switch_off";
    await writeAudit(db, {
      flagKey: key,
      action,
      reason: input.reason,
      before,
      after,
      createdAt: now,
    });
    return after;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAuditAction(value: string): value is AuditAction {
  for (const action of AUDIT_ACTIONS) {
    if (action === value) {
      return true;
    }
  }
  return false;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error("La lista de empresas no es válida");
  }
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      throw new Error("La lista de empresas no es válida");
    }
    ids.push(item);
  }
  return ids;
}

function parseRule(value: unknown): EnvironmentRule {
  if (
    !isRecord(value) ||
    typeof value.enabled !== "boolean" ||
    typeof value.rolloutPercentage !== "number" ||
    typeof value.updatedAt !== "string"
  ) {
    throw new Error("La regla de ambiente no es válida");
  }
  return {
    enabled: value.enabled,
    rolloutPercentage: value.rolloutPercentage,
    allowCompanies: stringList(value.allowCompanies),
    denyCompanies: stringList(value.denyCompanies),
    updatedAt: value.updatedAt,
  };
}

function parseFlagState(value: unknown): FlagState {
  if (
    !isRecord(value) ||
    typeof value.key !== "string" ||
    typeof value.name !== "string" ||
    !(value.description === null || typeof value.description === "string") ||
    typeof value.owner !== "string" ||
    typeof value.expiresAt !== "string" ||
    typeof value.killSwitch !== "boolean" ||
    typeof value.archived !== "boolean" ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string" ||
    !isRecord(value.environments)
  ) {
    throw new Error("El estado guardado no es válido");
  }
  return {
    key: value.key,
    name: value.name,
    description: value.description,
    owner: value.owner,
    expiresAt: value.expiresAt,
    killSwitch: value.killSwitch,
    archived: value.archived,
    environments: {
      development: parseRule(value.environments.development),
      staging: parseRule(value.environments.staging),
      production: parseRule(value.environments.production),
    },
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function parseStoredFlag(value: string | null): FlagState | null {
  if (value === null) {
    return null;
  }
  const parsed: unknown = JSON.parse(value);
  return parseFlagState(parsed);
}

function toAuditEntry(row: {
  id: number;
  flagKey: string;
  action: string;
  reason: string;
  createdAt: string;
  beforeState: string | null;
  afterState: string;
  rollbackOfId: number | null;
}): AuditEntry {
  if (!isAuditAction(row.action)) {
    throw new Error(`Acción de auditoría desconocida: ${row.action}`);
  }
  const before = parseStoredFlag(row.beforeState);
  const after = parseStoredFlag(row.afterState);
  if (after === null) {
    throw new Error("La auditoría no tiene estado posterior");
  }
  return {
    id: row.id,
    flagKey: row.flagKey,
    action: row.action,
    reason: row.reason,
    createdAt: row.createdAt,
    before,
    after,
    changes: diffFlagStates(before, after),
    rollbackOfId: row.rollbackOfId,
  };
}

export async function listAudit(
  db: Db,
  key: string,
  limit: number,
  cursor: number | undefined,
): Promise<{ items: AuditEntry[]; nextCursor: number | null }> {
  const flag = await getFlagState(db, key);
  if (flag === null) {
    throw new ApiError(404, "NOT_FOUND", "Flag no encontrada");
  }
  const where =
    cursor === undefined
      ? eq(schema.auditLog.flagKey, key)
      : and(eq(schema.auditLog.flagKey, key), lt(schema.auditLog.id, cursor));
  const rows = await db.select().from(schema.auditLog).where(where).orderBy(desc(schema.auditLog.id)).limit(limit + 1);
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  return {
    items: page.map((row) => toAuditEntry(row)),
    nextCursor: hasMore && last !== undefined ? last.id : null,
  };
}

function environmentChanged(changes: readonly FieldChange[], environment: Environment): boolean {
  const prefix = `environments.${environment}.`;
  return changes.some((change) => change.path.startsWith(prefix));
}

function missingCompanies(target: FlagState, known: ReadonlySet<string>): { companyId: string }[] {
  const missing: { companyId: string }[] = [];
  const seen = new Set<string>();
  for (const environment of ENVIRONMENTS) {
    const rule = target.environments[environment];
    if (rule === undefined) {
      continue;
    }
    for (const companyId of [...rule.allowCompanies, ...rule.denyCompanies]) {
      if (seen.has(companyId) || known.has(companyId)) {
        seen.add(companyId);
        continue;
      }
      seen.add(companyId);
      missing.push({ companyId });
    }
  }
  return missing;
}

export async function rollbackFlag(db: Db, key: string, input: RollbackInput, clock: () => Date): Promise<FlagState> {
  return inTransaction(db, async () => {
    const current = await requireFlag(db, key);
    const rows = await db.select().from(schema.auditLog).where(eq(schema.auditLog.id, input.auditId));
    const entry = rows[0];
    if (entry === undefined || entry.flagKey !== key) {
      throw new ApiError(404, "NOT_FOUND", "Entrada de auditoría no encontrada");
    }
    const target = parseStoredFlag(entry.beforeState);
    if (target === null) {
      throw new ApiError(400, "ROLLBACK_NOT_AVAILABLE", "No hay estado anterior que restaurar");
    }
    const changes = diffFlagStates(current, target);
    if (changes.length === 0) {
      throw new ApiError(400, "NO_CHANGES", "La flag no tiene cambios");
    }
    const knownRows = await db.select({ id: schema.companies.id }).from(schema.companies);
    const known = new Set(knownRows.map((row) => row.id));
    const missing = missingCompanies(target, known);
    if (missing.length > 0) {
      throw new ApiError(400, "UNKNOWN_COMPANY", "Hay empresas que no existen en el catálogo", missing);
    }
    const now = clock().toISOString();
    await db
      .update(schema.flags)
      .set({
        name: target.name,
        description: target.description,
        owner: target.owner,
        expiresAt: target.expiresAt,
        killSwitch: target.killSwitch,
        archived: target.archived,
        updatedAt: now,
      })
      .where(eq(schema.flags.key, key));
    for (const environment of ENVIRONMENTS) {
      if (!environmentChanged(changes, environment)) {
        continue;
      }
      const rule = target.environments[environment];
      if (rule === undefined) {
        throw new Error(`La flag ${key} no tiene el ambiente ${environment}`);
      }
      await db
        .update(schema.flagEnvironments)
        .set({
          enabled: rule.enabled,
          rolloutPercentage: rule.rolloutPercentage,
          updatedAt: now,
        })
        .where(and(eq(schema.flagEnvironments.flagKey, key), eq(schema.flagEnvironments.environment, environment)));
      await db
        .delete(schema.flagEnvironmentCompanies)
        .where(
          and(eq(schema.flagEnvironmentCompanies.flagKey, key), eq(schema.flagEnvironmentCompanies.environment, environment)),
        );
      if (rule.allowCompanies.length > 0 || rule.denyCompanies.length > 0) {
        await db.insert(schema.flagEnvironmentCompanies).values([
          ...rule.allowCompanies.map((companyId) => ({
            flagKey: key,
            environment,
            companyId,
            list: "allow",
          })),
          ...rule.denyCompanies.map((companyId) => ({
            flagKey: key,
            environment,
            companyId,
            list: "deny",
          })),
        ]);
      }
    }
    const after = await readWrittenFlag(db, key);
    await writeAudit(db, {
      flagKey: key,
      action: "rollback",
      reason: input.reason,
      before: current,
      after,
      createdAt: now,
      rollbackOfId: input.auditId,
    });
    return after;
  });
}
