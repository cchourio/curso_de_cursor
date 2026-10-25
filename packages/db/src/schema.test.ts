import { describe, expect, it } from "vitest";
import type { Db } from "./client";
import { getFlagState, listFlagStates } from "./queries";
import { auditLog, companies, flagEnvironmentCompanies, flagEnvironments, flags } from "./schema";
import { seed } from "./seed";
import { createTestDb } from "./testing";

const NOW = new Date("2026-10-13T12:00:00Z");

async function expectConstraint(run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (error) {
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : "";
    const message = error instanceof Error ? error.message : String(error);
    expect(`${message}\n${cause}`).toMatch(/constraint/i);
    return;
  }
  expect.fail("debió fallar por una restricción");
}

async function insertFlag(db: Db, key: string): Promise<void> {
  await db.insert(flags).values({
    key,
    name: key,
    description: null,
    owner: "Equipo",
    expiresAt: "2026-12-31",
    killSwitch: false,
    archived: false,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  });
}

describe("schema y seed", () => {
  it("crea las cinco tablas", async () => {
    const db = await createTestDb();
    const rows = await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'");
    const names = rows.map((row) => row.name);
    expect(names).toEqual(expect.arrayContaining([
      "companies",
      "flags",
      "flag_environments",
      "flag_environment_companies",
      "audit_log",
    ]));
  });

  it("rechaza una key de flag duplicada", async () => {
    const db = await createTestDb();
    await insertFlag(db, "checkout.new-flow");
    await expectConstraint(() => insertFlag(db, "checkout.new-flow"));
  });

  it("rechaza un rollout fuera de rango", async () => {
    const db = await createTestDb();
    await insertFlag(db, "checkout.new-flow");
    await expectConstraint(() =>
      db.insert(flagEnvironments).values({
        flagKey: "checkout.new-flow",
        environment: "production",
        enabled: true,
        rolloutPercentage: 101,
        updatedAt: NOW.toISOString(),
      }),
    );
  });

  it("rechaza la misma empresa en allow y deny", async () => {
    const db = await createTestDb();
    await insertFlag(db, "checkout.new-flow");
    await db.insert(companies).values({
      id: "acme",
      name: "Acme Corp",
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });
    await db.insert(flagEnvironments).values({
      flagKey: "checkout.new-flow",
      environment: "production",
      enabled: true,
      rolloutPercentage: 30,
      updatedAt: NOW.toISOString(),
    });
    await db.insert(flagEnvironmentCompanies).values({
      flagKey: "checkout.new-flow",
      environment: "production",
      companyId: "acme",
      list: "allow",
    });
    await expectConstraint(() =>
      db.insert(flagEnvironmentCompanies).values({
        flagKey: "checkout.new-flow",
        environment: "production",
        companyId: "acme",
        list: "deny",
      }),
    );
  });

  it("rechaza una empresa que no existe en el catálogo", async () => {
    const db = await createTestDb();
    await insertFlag(db, "checkout.new-flow");
    await db.insert(flagEnvironments).values({
      flagKey: "checkout.new-flow",
      environment: "production",
      enabled: true,
      rolloutPercentage: 0,
      updatedAt: NOW.toISOString(),
    });
    await expectConstraint(() =>
      db.insert(flagEnvironmentCompanies).values({
        flagKey: "checkout.new-flow",
        environment: "production",
        companyId: "missing",
        list: "allow",
      }),
    );
  });

  it("reconstruye el estado de checkout.new-flow y devuelve null si no existe", async () => {
    const db = await createTestDb();
    await seed(db, NOW);
    const state = await getFlagState(db, "checkout.new-flow");
    expect(state?.environments.production).toMatchObject({
      enabled: true,
      rolloutPercentage: 30,
      allowCompanies: ["acme"],
      denyCompanies: ["globex"],
    });
    expect(state?.environments.production.updatedAt).toBe(NOW.toISOString());
    expect(await getFlagState(db, "no-existe")).toBeNull();
  });

  it("lista las flags por key y deja legacy.banner 45 días atrás en production", async () => {
    const db = await createTestDb();
    await seed(db, NOW);
    await seed(db, NOW);
    const states = await listFlagStates(db);
    expect(states.map((state) => state.key)).toEqual(["checkout.new-flow", "legacy.banner", "search.v2"]);
    expect(states[1]?.environments.production.updatedAt).toBe("2026-08-29T12:00:00.000Z");
    expect(await db.select().from(companies)).toHaveLength(5);
    expect(await db.select().from(flags)).toHaveLength(3);
    expect(await db.select().from(flagEnvironments)).toHaveLength(9);
    expect(await db.select().from(auditLog)).toHaveLength(3);
  });
});
