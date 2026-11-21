import { ENVIRONMENTS, type Environment, type FlagState } from "@ff/domain";
import { getFlagState, schema, seed, type Db } from "@ff/db";
import { createTestDb } from "@ff/db/testing";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createTestApp } from "../test/helpers";

const NOW = new Date("2026-10-13T12:00:00.000Z");
const clock = (): Date => NOW;

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Se esperaba un objeto");
  }
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    result[key] = entry;
  }
  return result;
}

async function readBody(response: Response): Promise<unknown> {
  const body: unknown = await response.json();
  return body;
}

function errorOf(value: unknown): { code: string; details: { path: string; message: string }[] } {
  const error = record(record(value).error);
  if (typeof error.code !== "string") {
    throw new Error("error sin code");
  }
  const details: { path: string; message: string }[] = [];
  if (Array.isArray(error.details)) {
    for (const detail of error.details) {
      const item = record(detail);
      if (typeof item.path !== "string" || typeof item.message !== "string") {
        throw new Error("detalle mal formado");
      }
      details.push({ path: item.path, message: item.message });
    }
  }
  return { code: error.code, details };
}

function isEnvironment(value: string): value is Environment {
  return value === "development" || value === "staging" || value === "production";
}

function environmentRule(value: unknown, environment: Environment): FlagState["environments"][Environment] {
  const rule = record(value);
  if (
    typeof rule.enabled !== "boolean" ||
    typeof rule.rolloutPercentage !== "number" ||
    !Array.isArray(rule.allowCompanies) ||
    !Array.isArray(rule.denyCompanies) ||
    typeof rule.updatedAt !== "string"
  ) {
    throw new Error(`regla inválida para ${environment}`);
  }
  return {
    enabled: rule.enabled,
    rolloutPercentage: rule.rolloutPercentage,
    allowCompanies: rule.allowCompanies.filter((company): company is string => typeof company === "string"),
    denyCompanies: rule.denyCompanies.filter((company): company is string => typeof company === "string"),
    updatedAt: rule.updatedAt,
  };
}

function asFlag(value: unknown): FlagState {
  const body = record(value);
  const environments = record(body.environments);
  const parsed = {
    development: environmentRule(environments.development, "development"),
    staging: environmentRule(environments.staging, "staging"),
    production: environmentRule(environments.production, "production"),
  };
  if (
    typeof body.key !== "string" ||
    typeof body.name !== "string" ||
    !(body.description === null || typeof body.description === "string") ||
    typeof body.owner !== "string" ||
    typeof body.expiresAt !== "string" ||
    typeof body.killSwitch !== "boolean" ||
    typeof body.archived !== "boolean" ||
    typeof body.createdAt !== "string" ||
    typeof body.updatedAt !== "string"
  ) {
    throw new Error("La respuesta no es un FlagState");
  }
  for (const environment of Object.keys(environments)) {
    if (!isEnvironment(environment)) {
      throw new Error(`ambiente desconocido ${environment}`);
    }
  }
  return {
    key: body.key,
    name: body.name,
    description: body.description,
    owner: body.owner,
    expiresAt: body.expiresAt,
    killSwitch: body.killSwitch,
    archived: body.archived,
    environments: parsed,
    createdAt: body.createdAt,
    updatedAt: body.updatedAt,
  };
}

function asSummary(value: unknown): { key: string; obsolescence: string[]; lastChangedAt: string } {
  const flag = asFlag(value);
  const body = record(value);
  if (!Array.isArray(body.obsolescence) || typeof body.lastChangedAt !== "string") {
    throw new Error("La respuesta no es un FlagSummary");
  }
  const obsolescence: string[] = [];
  for (const reason of body.obsolescence) {
    if (typeof reason !== "string") {
      throw new Error("motivo inválido");
    }
    obsolescence.push(reason);
  }
  return { key: flag.key, obsolescence, lastChangedAt: body.lastChangedAt };
}

function summaryOf(value: unknown): {
  activeCount: number;
  archivedCount: number;
  obsoleteCount: number;
  owner: string;
  reasons: string[];
} {
  const body = record(value);
  if (
    typeof body.activeCount !== "number" ||
    typeof body.archivedCount !== "number" ||
    typeof body.obsoleteCount !== "number" ||
    !Array.isArray(body.obsolete)
  ) {
    throw new Error("resumen inválido");
  }
  const first = body.obsolete[0];
  if (first === undefined) {
    throw new Error("sin obsoletas");
  }
  const item = record(first);
  if (typeof item.owner !== "string" || !Array.isArray(item.reasons)) {
    throw new Error("obsoleta inválida");
  }
  const reasons: string[] = [];
  for (const reason of item.reasons) {
    if (typeof reason !== "string") {
      throw new Error("motivo inválido");
    }
    reasons.push(reason);
  }
  return {
    activeCount: body.activeCount,
    archivedCount: body.archivedCount,
    obsoleteCount: body.obsoleteCount,
    owner: item.owner,
    reasons,
  };
}

function snapshotName(value: string | null): string {
  if (value === null) {
    throw new Error("el snapshot es null");
  }
  const parsed: unknown = JSON.parse(value);
  const name = record(parsed).name;
  if (typeof name !== "string") {
    throw new Error("el snapshot no tiene name");
  }
  return name;
}

async function auditRows(db: Db, flagKey: string) {
  return db.select().from(schema.auditLog).where(eq(schema.auditLog.flagKey, flagKey));
}

function auditFlag(value: string | null): FlagState {
  if (value === null) {
    throw new Error("el snapshot es null");
  }
  const parsed: unknown = JSON.parse(value);
  return asFlag(parsed);
}

function companyIdOf(value: unknown): string {
  const error = record(record(value).error);
  if (!Array.isArray(error.details)) {
    throw new Error("sin details");
  }
  const first = error.details[0];
  if (first === undefined) {
    throw new Error("sin details");
  }
  const companyId = record(first).companyId;
  if (typeof companyId !== "string") {
    throw new Error("sin companyId");
  }
  return companyId;
}

interface ListedChange {
  path: string;
  before: unknown;
  after: unknown;
}

interface ListedAudit {
  id: number;
  action: string;
  rollbackOfId: number | null;
  changes: ListedChange[];
}

function listedChanges(value: unknown): ListedChange[] {
  if (!Array.isArray(value)) {
    throw new Error("changes no es una lista");
  }
  return value.map((item) => {
    const change = record(item);
    if (typeof change.path !== "string" || !Object.hasOwn(change, "before") || !Object.hasOwn(change, "after")) {
      throw new Error("cambio inválido");
    }
    return { path: change.path, before: change.before, after: change.after };
  });
}

function auditList(value: unknown): { items: ListedAudit[]; nextCursor: number | null } {
  const body = record(value);
  if (!Array.isArray(body.items)) {
    throw new Error("items no es una lista");
  }
  if (!(body.nextCursor === null || typeof body.nextCursor === "number")) {
    throw new Error("nextCursor inválido");
  }
  const items = body.items.map((item) => {
    const entry = record(item);
    if (typeof entry.id !== "number" || typeof entry.action !== "string") {
      throw new Error("entrada inválida");
    }
    if (!(entry.rollbackOfId === null || typeof entry.rollbackOfId === "number")) {
      throw new Error("rollbackOfId inválido");
    }
    return {
      id: entry.id,
      action: entry.action,
      rollbackOfId: entry.rollbackOfId,
      changes: listedChanges(entry.changes),
    };
  });
  return { items, nextCursor: body.nextCursor };
}

function productionBody(rolloutPercentage: number, reason: string): string {
  return JSON.stringify({
    enabled: true,
    rolloutPercentage,
    allowCompanies: [],
    denyCompanies: [],
    reason,
  });
}

const STAGING_OPEN = {
  enabled: true,
  rolloutPercentage: 100,
  allowCompanies: [] as string[],
  denyCompanies: [] as string[],
  reason: "Abrir en staging",
};

function flagBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    key: "checkout.new-flow",
    name: "  Checkout  ",
    description: "",
    owner: "Equipo Checkout",
    expiresAt: "2026-12-31",
    reason: "Crear flag de checkout",
    ...overrides,
  });
}

describe("flags", () => {
  it("mantiene GET /api/health", async () => {
    const { request } = await createTestApp({ clock });
    const response = await request("/api/health");
    expect(response.status).toBe(200);
    expect(record(await readBody(response)).status).toBe("ok");
  });

  it("responde 404 NOT_FOUND si la ruta no existe", async () => {
    const { request } = await createTestApp({ clock });
    const response = await request("/api/no-existe");
    expect(response.status).toBe(404);
    expect(errorOf(await readBody(response)).code).toBe("NOT_FOUND");
  });

  it("responde 201, crea los tres ambientes apagados y audita create", async () => {
    const { request, db } = await createTestApp({ clock });
    const response = await request("/api/admin/flags", { method: "POST", body: flagBody() });
    expect(response.status).toBe(201);
    const flag = asFlag(await readBody(response));
    expect(flag.name).toBe("Checkout");
    expect(flag.description).toBeNull();
    expect(flag.killSwitch).toBe(false);
    expect(flag.archived).toBe(false);
    for (const environment of ENVIRONMENTS) {
      expect(flag.environments[environment]).toMatchObject({
        enabled: false,
        rolloutPercentage: 0,
        allowCompanies: [],
        denyCompanies: [],
      });
    }
    const rows = await auditRows(db, flag.key);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe("create");
    expect(rows[0]?.beforeState).toBeNull();
    expect(rows[0]?.reason).toBe("Crear flag de checkout");
    expect(snapshotName(rows[0]?.afterState ?? null)).toBe("Checkout");
  });

  it("responde 409 CONFLICT si la key ya existe", async () => {
    const { request } = await createTestApp({ clock });
    const first = await request("/api/admin/flags", { method: "POST", body: flagBody() });
    expect(first.status).toBe(201);
    const second = await request("/api/admin/flags", { method: "POST", body: flagBody() });
    expect(second.status).toBe(409);
    expect(errorOf(await readBody(second)).code).toBe("CONFLICT");
  });

  it.each(["Checkout", "ab", "-abc"])("responde 400 VALIDATION_ERROR si la key es %s", async (key) => {
    const { request } = await createTestApp({ clock });
    const response = await request("/api/admin/flags", { method: "POST", body: flagBody({ key }) });
    expect(response.status).toBe(400);
    const error = errorOf(await readBody(response));
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.details[0]?.path).toBe("key");
  });

  it("responde 400 VALIDATION_ERROR si el motivo falta o es demasiado corto", async () => {
    const { request } = await createTestApp({ clock });
    const missing = await request("/api/admin/flags", {
      method: "POST",
      body: flagBody({ reason: undefined }),
    });
    expect(missing.status).toBe(400);
    expect(errorOf(await readBody(missing)).details[0]?.path).toBe("reason");

    const short = await request("/api/admin/flags", { method: "POST", body: flagBody({ reason: "abc" }) });
    expect(short.status).toBe(400);
    const shortError = errorOf(await readBody(short));
    expect(shortError.code).toBe("VALIDATION_ERROR");
    expect(shortError.details[0]?.path).toBe("reason");

    const created = await request("/api/admin/flags", { method: "POST", body: flagBody() });
    expect(created.status).toBe(201);
    const patched = await request("/api/admin/flags/checkout.new-flow", {
      method: "PATCH",
      body: JSON.stringify({ name: "Nuevo", reason: "abc" }),
    });
    expect(patched.status).toBe(400);
    expect(errorOf(await readBody(patched)).details[0]?.path).toBe("reason");
  });

  it("responde 400 si expiresAt es anterior a hoy y 201 si es hoy", async () => {
    const { request } = await createTestApp({ clock });
    const past = await request("/api/admin/flags", {
      method: "POST",
      body: flagBody({ expiresAt: "2026-10-12" }),
    });
    expect(past.status).toBe(400);
    expect(errorOf(await readBody(past)).code).toBe("VALIDATION_ERROR");

    const impossible = await request("/api/admin/flags", {
      method: "POST",
      body: flagBody({ key: "fecha.invalida", expiresAt: "2026-02-30" }),
    });
    expect(impossible.status).toBe(400);
    expect(errorOf(await readBody(impossible)).details[0]?.path).toBe("expiresAt");

    const today = await request("/api/admin/flags", {
      method: "POST",
      body: flagBody({ key: "fecha.hoy", expiresAt: "2026-10-13" }),
    });
    expect(today.status).toBe(201);
    expect(asFlag(await readBody(today)).expiresAt).toBe("2026-10-13");
  });

  it("responde 200 al renombrar y audita before_state y after_state", async () => {
    const { request, db } = await createTestApp({ clock });
    const created = await request("/api/admin/flags", { method: "POST", body: flagBody() });
    expect(created.status).toBe(201);
    const response = await request("/api/admin/flags/checkout.new-flow", {
      method: "PATCH",
      body: JSON.stringify({ name: "Nuevo", reason: "Renombrar flag" }),
    });
    expect(response.status).toBe(200);
    expect(asFlag(await readBody(response)).name).toBe("Nuevo");
    const update = (await auditRows(db, "checkout.new-flow")).find((row) => row.action === "update");
    expect(update?.reason).toBe("Renombrar flag");
    expect(snapshotName(update?.beforeState ?? null)).toBe("Checkout");
    expect(snapshotName(update?.afterState ?? null)).toBe("Nuevo");
  });

  it("responde 400 NO_CHANGES y no escribe auditoría si el estado no cambia", async () => {
    const { request, db } = await createTestApp({ clock });
    await request("/api/admin/flags", { method: "POST", body: flagBody() });
    const response = await request("/api/admin/flags/checkout.new-flow", {
      method: "PATCH",
      body: JSON.stringify({ name: "Checkout", reason: "Sin cambios reales" }),
    });
    expect(response.status).toBe(400);
    expect(errorOf(await readBody(response)).code).toBe("NO_CHANGES");
    const rows = await auditRows(db, "checkout.new-flow");
    expect(rows.map((row) => row.action)).toEqual(["create"]);
  });

  it("archiva, bloquea los cambios y unarchive lo revierte", async () => {
    const { request, db } = await createTestApp({ clock });
    await request("/api/admin/flags", { method: "POST", body: flagBody() });
    const archived = await request("/api/admin/flags/checkout.new-flow/archive", {
      method: "POST",
      body: JSON.stringify({ reason: "Archivar flag" }),
    });
    expect(archived.status).toBe(200);
    expect(asFlag(await readBody(archived)).archived).toBe(true);

    const patched = await request("/api/admin/flags/checkout.new-flow", {
      method: "PATCH",
      body: JSON.stringify({ name: "Nuevo", reason: "Renombrar flag" }),
    });
    expect(patched.status).toBe(409);
    expect(errorOf(await readBody(patched)).code).toBe("FLAG_ARCHIVED");

    const killed = await request("/api/admin/flags/checkout.new-flow/kill-switch", {
      method: "POST",
      body: JSON.stringify({ enabled: true, reason: "Activar kill switch" }),
    });
    expect(killed.status).toBe(409);
    expect(errorOf(await readBody(killed)).code).toBe("FLAG_ARCHIVED");

    const again = await request("/api/admin/flags/checkout.new-flow/archive", {
      method: "POST",
      body: JSON.stringify({ reason: "Archivar otra vez" }),
    });
    expect(again.status).toBe(409);
    expect(errorOf(await readBody(again)).code).toBe("CONFLICT");

    const restored = await request("/api/admin/flags/checkout.new-flow/unarchive", {
      method: "POST",
      body: JSON.stringify({ reason: "Recuperar flag" }),
    });
    expect(restored.status).toBe(200);
    expect(asFlag(await readBody(restored)).archived).toBe(false);
    const actions = (await auditRows(db, "checkout.new-flow")).map((row) => row.action);
    expect(actions).toContain("archive");
    expect(actions).toContain("unarchive");
  });

  it("activa el kill switch, lo audita y rechaza repetirlo", async () => {
    const { request, db } = await createTestApp({ clock });
    await request("/api/admin/flags", { method: "POST", body: flagBody() });
    const enabled = await request("/api/admin/flags/checkout.new-flow/kill-switch", {
      method: "POST",
      body: JSON.stringify({ enabled: true, reason: "Activar kill switch" }),
    });
    expect(enabled.status).toBe(200);
    expect(asFlag(await readBody(enabled)).killSwitch).toBe(true);
    const repeated = await request("/api/admin/flags/checkout.new-flow/kill-switch", {
      method: "POST",
      body: JSON.stringify({ enabled: true, reason: "Activar kill switch" }),
    });
    expect(repeated.status).toBe(400);
    expect(errorOf(await readBody(repeated)).code).toBe("NO_CHANGES");
    const actions = (await auditRows(db, "checkout.new-flow")).map((row) => row.action);
    expect(actions.filter((action) => action === "kill_switch_on")).toEqual(["kill_switch_on"]);
  });

  it("filtra el listado por estado y por q", async () => {
    const { request, db } = await createTestApp({ clock });
    await seed(db, NOW);
    const active = await request("/api/admin/flags");
    expect(active.status).toBe(200);
    const activeItems = record(await readBody(active)).items;
    if (!Array.isArray(activeItems)) {
      throw new Error("items no es una lista");
    }
    expect(activeItems.map((item) => asFlag(item).key)).toEqual(["checkout.new-flow", "legacy.banner", "search.v2"]);

    await request("/api/admin/flags/legacy.banner/archive", {
      method: "POST",
      body: JSON.stringify({ reason: "Archivar flag" }),
    });
    const stillActive = record(await readBody(await request("/api/admin/flags"))).items;
    if (!Array.isArray(stillActive)) {
      throw new Error("items no es una lista");
    }
    expect(stillActive.map((item) => asFlag(item).key)).toEqual(["checkout.new-flow", "search.v2"]);

    const archived = record(await readBody(await request("/api/admin/flags?status=archived"))).items;
    if (!Array.isArray(archived)) {
      throw new Error("items no es una lista");
    }
    expect(archived.map((item) => asFlag(item).key)).toEqual(["legacy.banner"]);

    const all = record(await readBody(await request("/api/admin/flags?status=all"))).items;
    if (!Array.isArray(all)) {
      throw new Error("items no es una lista");
    }
    expect(all.map((item) => asFlag(item).key)).toEqual(["checkout.new-flow", "legacy.banner", "search.v2"]);

    const found = record(await readBody(await request("/api/admin/flags?q=CHECK"))).items;
    if (!Array.isArray(found)) {
      throw new Error("items no es una lista");
    }
    expect(found.map((item) => asFlag(item).key)).toEqual(["checkout.new-flow"]);

    const invalid = await request("/api/admin/flags?status=nope");
    expect(invalid.status).toBe(400);
    expect(errorOf(await readBody(invalid)).code).toBe("VALIDATION_ERROR");
  });

  it("responde 404 NOT_FOUND si la flag no existe", async () => {
    const { request } = await createTestApp({ clock });
    const response = await request("/api/admin/flags/no-existe");
    expect(response.status).toBe(404);
    expect(errorOf(await readBody(response)).code).toBe("NOT_FOUND");
  });

  it("no modifica la flag si falla la inserción de auditoría", async () => {
    const db = await createTestDb();
    const setup = await createTestApp({ db, clock });
    const created = await setup.request("/api/admin/flags", { method: "POST", body: flagBody() });
    expect(created.status).toBe(201);
    const failingDb = new Proxy<Db>(db, {
      get(target, property, receiver) {
        if (property === "insert") {
          return (table: Parameters<Db["insert"]>[0]) => {
            if (table === schema.auditLog) {
              throw new Error("fallo de auditoría");
            }
            return target.insert(table);
          };
        }
        const value: unknown = Reflect.get(target, property, receiver);
        if (typeof value === "function") {
          return value.bind(target);
        }
        return value;
      },
    });
    const failing = await createTestApp({ db: failingDb, clock });
    const response = await failing.request("/api/admin/flags/checkout.new-flow", {
      method: "PATCH",
      body: JSON.stringify({ name: "Nuevo", reason: "Renombrar flag" }),
    });
    expect(response.status).toBe(500);
    const body = record(await readBody(response));
    expect(record(body.error).code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(body)).not.toContain("fallo de auditoría");
    const state = await getFlagState(db, "checkout.new-flow");
    expect(state?.name).toBe("Checkout");
    expect((await auditRows(db, "checkout.new-flow")).map((row) => row.action)).toEqual(["create"]);
  });

  it("GET /api/admin/flags?obsolete=true devuelve solo legacy.banner con EXPIRED y STALE_PRODUCTION", async () => {
    const { request, db } = await createTestApp({ clock });
    await seed(db, NOW);
    const response = await request("/api/admin/flags?obsolete=true");
    expect(response.status).toBe(200);
    const items = record(await readBody(response)).items;
    if (!Array.isArray(items)) {
      throw new Error("items no es una lista");
    }
    expect(items).toHaveLength(1);
    const first = items[0];
    if (first === undefined) {
      throw new Error("items vacío");
    }
    const item = asSummary(first);
    expect(item.key).toBe("legacy.banner");
    expect(item.obsolescence).toEqual(["EXPIRED", "STALE_PRODUCTION"]);
    expect(item.lastChangedAt).toBe(NOW.toISOString());

    const filtered = record(await readBody(await request("/api/admin/flags?obsolete=true&q=search"))).items;
    expect(filtered).toEqual([]);
  });

  it("GET /api/admin/dashboard/summary cuenta activas, archivadas y obsoletas del seed", async () => {
    const { request, db } = await createTestApp({ clock });
    await seed(db, NOW);
    const response = await request("/api/admin/dashboard/summary");
    expect(response.status).toBe(200);
    const summary = summaryOf(await readBody(response));
    expect(summary.activeCount).toBe(3);
    expect(summary.archivedCount).toBe(0);
    expect(summary.obsoleteCount).toBe(1);
    expect(summary.owner).toBe("Equipo Growth");
    expect(summary.reasons).toEqual(["EXPIRED", "STALE_PRODUCTION"]);
  });

  it("responde 401 sin sesión en el listado y en el resumen", async () => {
    const { app } = await createTestApp({ clock });
    const flags = await app.request("/api/admin/flags");
    const summary = await app.request("/api/admin/dashboard/summary");
    expect(flags.status).toBe(401);
    expect(summary.status).toBe(401);
    expect(errorOf(await readBody(flags)).code).toBe("UNAUTHORIZED");
    expect(errorOf(await readBody(summary)).code).toBe("UNAUTHORIZED");
  });

  it("PUT de staging guarda la regla y solo actualiza ese ambiente", async () => {
    const later = new Date("2026-10-20T09:00:00.000Z");
    const { request, db } = await createTestApp({ clock: () => later });
    await seed(db, NOW);
    const response = await request("/api/admin/flags/search.v2/environments/staging", {
      method: "PUT",
      body: JSON.stringify(STAGING_OPEN),
    });
    expect(response.status).toBe(200);
    const flag = asFlag(await readBody(response));
    expect(flag.environments.staging).toEqual({
      enabled: true,
      rolloutPercentage: 100,
      allowCompanies: [],
      denyCompanies: [],
      updatedAt: later.toISOString(),
    });
    expect(flag.environments.development.updatedAt).toBe(NOW.toISOString());
    expect(flag.environments.production.updatedAt).toBe(NOW.toISOString());
  });

  it("PUT de staging audita targeting_update y deja los otros ambientes iguales", async () => {
    const later = new Date("2026-10-20T09:00:00.000Z");
    const { request, db } = await createTestApp({ clock: () => later });
    await seed(db, NOW);
    const response = await request("/api/admin/flags/search.v2/environments/staging", {
      method: "PUT",
      body: JSON.stringify(STAGING_OPEN),
    });
    expect(response.status).toBe(200);
    const rows = await auditRows(db, "search.v2");
    const targeting = rows.filter((row) => row.action === "targeting_update");
    expect(targeting).toHaveLength(1);
    const entry = targeting[0];
    if (entry === undefined) {
      throw new Error("sin auditoría");
    }
    const before = auditFlag(entry.beforeState);
    const after = auditFlag(entry.afterState);
    expect(JSON.stringify(before.environments.staging)).not.toBe(JSON.stringify(after.environments.staging));
    expect(JSON.stringify(before.environments.development)).toBe(JSON.stringify(after.environments.development));
    expect(JSON.stringify(before.environments.production)).toBe(JSON.stringify(after.environments.production));
  });

  it("PUT con un ambiente inválido responde 400 INVALID_ENVIRONMENT antes de validar el body", async () => {
    const { request, db } = await createTestApp({ clock });
    await seed(db, NOW);
    const response = await request("/api/admin/flags/search.v2/environments/prod", {
      method: "PUT",
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(400);
    expect(errorOf(await readBody(response)).code).toBe("INVALID_ENVIRONMENT");
  });

  it("PUT con una empresa inexistente responde 400 UNKNOWN_COMPANY", async () => {
    const { request, db } = await createTestApp({ clock });
    await seed(db, NOW);
    const response = await request("/api/admin/flags/search.v2/environments/staging", {
      method: "PUT",
      body: JSON.stringify({ ...STAGING_OPEN, allowCompanies: ["no-existe"] }),
    });
    expect(response.status).toBe(400);
    const body = await readBody(response);
    expect(record(record(body).error).code).toBe("UNKNOWN_COMPANY");
    expect(companyIdOf(body)).toBe("no-existe");
  });

  it("repetir el mismo PUT responde 400 NO_CHANGES y no audita de nuevo", async () => {
    const later = new Date("2026-10-20T09:00:00.000Z");
    const { request, db } = await createTestApp({ clock: () => later });
    await seed(db, NOW);
    const first = await request("/api/admin/flags/search.v2/environments/staging", {
      method: "PUT",
      body: JSON.stringify(STAGING_OPEN),
    });
    expect(first.status).toBe(200);
    const before = (await auditRows(db, "search.v2")).filter((row) => row.action === "targeting_update");
    const second = await request("/api/admin/flags/search.v2/environments/staging", {
      method: "PUT",
      body: JSON.stringify(STAGING_OPEN),
    });
    expect(second.status).toBe(400);
    expect(errorOf(await readBody(second)).code).toBe("NO_CHANGES");
    const after = (await auditRows(db, "search.v2")).filter((row) => row.action === "targeting_update");
    expect(after).toHaveLength(before.length);
  });

  it("compara las listas de empresas como conjuntos", async () => {
    const later = new Date("2026-10-20T09:00:00.000Z");
    const { request, db } = await createTestApp({ clock: () => later });
    await seed(db, NOW);
    const firstBody = {
      enabled: true,
      rolloutPercentage: 30,
      allowCompanies: ["globex", "acme"],
      denyCompanies: [] as string[],
      reason: "Reordenar empresas",
    };
    const first = await request("/api/admin/flags/checkout.new-flow/environments/production", {
      method: "PUT",
      body: JSON.stringify(firstBody),
    });
    expect(first.status).toBe(200);
    const second = await request("/api/admin/flags/checkout.new-flow/environments/production", {
      method: "PUT",
      body: JSON.stringify({ ...firstBody, allowCompanies: ["acme", "globex"] }),
    });
    expect(second.status).toBe(400);
    expect(errorOf(await readBody(second)).code).toBe("NO_CHANGES");
    const targeting = (await auditRows(db, "checkout.new-flow")).filter((row) => row.action === "targeting_update");
    expect(targeting).toHaveLength(1);
  });

  it("PUT sobre una flag archivada responde 409 FLAG_ARCHIVED", async () => {
    const { request, db } = await createTestApp({ clock });
    await seed(db, NOW);
    const archived = await request("/api/admin/flags/search.v2/archive", {
      method: "POST",
      body: JSON.stringify({ reason: "Archivar para la prueba" }),
    });
    expect(archived.status).toBe(200);
    const response = await request("/api/admin/flags/search.v2/environments/staging", {
      method: "PUT",
      body: JSON.stringify(STAGING_OPEN),
    });
    expect(response.status).toBe(409);
    expect(errorOf(await readBody(response)).code).toBe("FLAG_ARCHIVED");
  });

  it("restaura el rollout de 80 a 10, conserva staging y rechaza repetir el rollback", async () => {
    let now = new Date("2026-10-20T09:00:00.000Z");
    const { request, db } = await createTestApp({ clock: () => now });
    await seed(db, NOW);
    const first = await request("/api/admin/flags/checkout.new-flow/environments/production", {
      method: "PUT",
      body: productionBody(10, "Bajar a 10"),
    });
    expect(first.status).toBe(200);
    const stagingUpdatedAt = asFlag(await readBody(first)).environments.staging.updatedAt;
    const second = await request("/api/admin/flags/checkout.new-flow/environments/production", {
      method: "PUT",
      body: productionBody(80, "Subir a 80"),
    });
    expect(second.status).toBe(200);
    const listed = auditList(await readBody(await request("/api/admin/flags/checkout.new-flow/audit")));
    const updated = listed.items.find(
      (item) =>
        item.action === "targeting_update" &&
        item.changes.some((change) => change.path === "environments.production.rolloutPercentage" && change.after === 80),
    );
    if (updated === undefined) {
      throw new Error("sin entrada de 80");
    }
    now = new Date("2026-10-20T10:00:00.000Z");
    const restored = await request("/api/admin/flags/checkout.new-flow/rollback", {
      method: "POST",
      body: JSON.stringify({ auditId: updated.id, reason: "Volver al 10" }),
    });
    expect(restored.status).toBe(200);
    const flag = asFlag(await readBody(restored));
    expect(flag.environments.production.rolloutPercentage).toBe(10);
    expect(flag.environments.production.updatedAt).toBe(now.toISOString());
    expect(flag.environments.staging.updatedAt).toBe(stagingUpdatedAt);

    const history = auditList(await readBody(await request("/api/admin/flags/checkout.new-flow/audit")));
    const rollback = history.items[0];
    if (rollback === undefined) {
      throw new Error("sin rollback");
    }
    expect(rollback.action).toBe("rollback");
    expect(rollback.rollbackOfId).toBe(updated.id);
    expect(rollback.changes).toEqual([{ path: "environments.production.rolloutPercentage", before: 80, after: 10 }]);

    const repeated = await request("/api/admin/flags/checkout.new-flow/rollback", {
      method: "POST",
      body: JSON.stringify({ auditId: updated.id, reason: "Volver al 10 otra vez" }),
    });
    expect(repeated.status).toBe(400);
    expect(errorOf(await readBody(repeated)).code).toBe("NO_CHANGES");
  });

  it("rechaza el rollback de una entrada create", async () => {
    const { request, db } = await createTestApp({ clock });
    await seed(db, NOW);
    const listed = auditList(await readBody(await request("/api/admin/flags/checkout.new-flow/audit")));
    const created = listed.items.find((item) => item.action === "create");
    if (created === undefined) {
      throw new Error("sin alta");
    }
    const response = await request("/api/admin/flags/checkout.new-flow/rollback", {
      method: "POST",
      body: JSON.stringify({ auditId: created.id, reason: "Deshacer el alta" }),
    });
    expect(response.status).toBe(400);
    const body = record(await readBody(response));
    const error = record(body.error);
    expect(error.code).toBe("ROLLBACK_NOT_AVAILABLE");
    expect(error.message).toBe("No hay estado anterior que restaurar");
  });

  it("responde 404 si la entrada es de otra flag y 400 si falta el motivo", async () => {
    const { request, db } = await createTestApp({ clock });
    await seed(db, NOW);
    const listed = auditList(await readBody(await request("/api/admin/flags/search.v2/audit")));
    const foreignEntry = listed.items[0];
    if (foreignEntry === undefined) {
      throw new Error("sin auditoría");
    }
    const foreign = await request("/api/admin/flags/checkout.new-flow/rollback", {
      method: "POST",
      body: JSON.stringify({ auditId: foreignEntry.id, reason: "Entrada ajena" }),
    });
    expect(foreign.status).toBe(404);
    expect(errorOf(await readBody(foreign)).code).toBe("NOT_FOUND");

    const missingReason = await request("/api/admin/flags/checkout.new-flow/rollback", {
      method: "POST",
      body: JSON.stringify({ auditId: foreignEntry.id }),
    });
    expect(missingReason.status).toBe(400);
    expect(errorOf(await readBody(missingReason)).code).toBe("VALIDATION_ERROR");
  });

  it("desarchiva al restaurar la entrada de archive", async () => {
    const { request, db } = await createTestApp({ clock });
    await seed(db, NOW);
    const archived = await request("/api/admin/flags/search.v2/archive", {
      method: "POST",
      body: JSON.stringify({ reason: "Archivar para restaurar" }),
    });
    expect(archived.status).toBe(200);
    const listed = auditList(await readBody(await request("/api/admin/flags/search.v2/audit")));
    const archiveEntry = listed.items.find((item) => item.action === "archive");
    if (archiveEntry === undefined) {
      throw new Error("sin archive");
    }
    const response = await request("/api/admin/flags/search.v2/rollback", {
      method: "POST",
      body: JSON.stringify({ auditId: archiveEntry.id, reason: "Deshacer el archivo" }),
    });
    expect(response.status).toBe(200);
    expect(asFlag(await readBody(response)).archived).toBe(false);
  });

  it("pagina el historial de las más recientes a las más antiguas", async () => {
    const { request, db } = await createTestApp({ clock });
    await seed(db, NOW);
    const renamed = await request("/api/admin/flags/search.v2", {
      method: "PATCH",
      body: JSON.stringify({ name: "Busqueda", reason: "Renombrar la flag" }),
    });
    expect(renamed.status).toBe(200);
    const owned = await request("/api/admin/flags/search.v2", {
      method: "PATCH",
      body: JSON.stringify({ owner: "Equipo Nuevo", reason: "Cambiar el owner" }),
    });
    expect(owned.status).toBe(200);
    const first = auditList(await readBody(await request("/api/admin/flags/search.v2/audit?limit=2")));
    expect(first.items).toHaveLength(2);
    expect(first.items.map((item) => item.action)).toEqual(["update", "update"]);
    expect(typeof first.nextCursor).toBe("number");
    const second = auditList(
      await readBody(await request(`/api/admin/flags/search.v2/audit?limit=2&cursor=${String(first.nextCursor)}`)),
    );
    expect(second.items.map((item) => item.action)).toEqual(["create"]);
    expect(second.nextCursor).toBeNull();
  });

  it("no expone rutas para modificar la auditoría", async () => {
    const { request, db } = await createTestApp({ clock });
    await seed(db, NOW);
    const before = (await db.select().from(schema.auditLog)).length;
    for (const method of ["DELETE", "PATCH", "PUT"] as const) {
      const collection = await request("/api/admin/flags/checkout.new-flow/audit", { method });
      const entry = await request("/api/admin/flags/checkout.new-flow/audit/1", { method });
      expect(collection.status).toBe(404);
      expect(entry.status).toBe(404);
    }
    expect((await db.select().from(schema.auditLog)).length).toBe(before);
  });
});
