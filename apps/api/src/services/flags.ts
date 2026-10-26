import {
  ENVIRONMENTS,
  type AuditAction,
  type CreateFlagInput,
  type FlagState,
  type KillSwitchInput,
  type ReasonOnlyInput,
  type UpdateFlagInput,
} from "@ff/domain";
import { getFlagState, listFlagStates, schema, type Db } from "@ff/db";
import { eq, sql } from "drizzle-orm";
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
  },
): Promise<void> {
  await db.insert(schema.auditLog).values({
    flagKey: entry.flagKey,
    action: entry.action,
    reason: entry.reason,
    beforeState: entry.before === null ? null : JSON.stringify(entry.before),
    afterState: JSON.stringify(entry.after),
    createdAt: entry.createdAt,
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

export async function listFlags(
  db: Db,
  query: { q: string | undefined; status: FlagListStatus },
): Promise<FlagState[]> {
  const states = await listFlagStates(db);
  const needle = (query.q ?? "").toLowerCase();
  return states.filter((flag) => {
    if (query.status === "active" && flag.archived) {
      return false;
    }
    if (query.status === "archived" && !flag.archived) {
      return false;
    }
    if (needle.length === 0) {
      return true;
    }
    return flag.key.toLowerCase().includes(needle) || flag.name.toLowerCase().includes(needle);
  });
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
