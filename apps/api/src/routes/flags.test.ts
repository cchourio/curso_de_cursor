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
});
