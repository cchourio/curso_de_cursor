import { ENVIRONMENTS, type Environment, type EnvironmentRule, type FlagState } from "@ff/domain";
import { sql } from "drizzle-orm";
import type { Db } from "./client";
import { auditLog, companies, flagEnvironmentCompanies, flagEnvironments, flags } from "./schema";

const DAY_MS = 24 * 60 * 60 * 1000;

function shift(now: Date, days: number): Date {
  return new Date(now.getTime() + days * DAY_MS);
}

function rule(now: Date, enabled: boolean, rolloutPercentage: number, allowCompanies: string[] = [], denyCompanies: string[] = []): EnvironmentRule {
  return { enabled, rolloutPercentage, allowCompanies, denyCompanies, updatedAt: now.toISOString() };
}

function environments(rules: Record<Environment, EnvironmentRule>): Record<Environment, EnvironmentRule> {
  return rules;
}

function buildFlags(now: Date): FlagState[] {
  const timestamp = now.toISOString();
  const checkoutRules = environments({
    development: rule(now, true, 100),
    staging: rule(now, true, 100),
    production: rule(now, true, 30, ["acme"], ["globex"]),
  });
  const searchRules = environments({
    development: rule(now, false, 0),
    staging: rule(now, false, 0),
    production: rule(now, false, 0),
  });
  const legacyProduction = rule(shift(now, -45), true, 100);
  const legacyRules = environments({
    development: rule(now, false, 0),
    staging: rule(now, false, 0),
    production: legacyProduction,
  });

  return [
    {
      key: "checkout.new-flow",
      name: "checkout.new-flow",
      description: null,
      owner: "Equipo Checkout",
      expiresAt: shift(now, 90).toISOString().slice(0, 10),
      killSwitch: false,
      archived: false,
      environments: checkoutRules,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      key: "search.v2",
      name: "search.v2",
      description: null,
      owner: "Equipo Search",
      expiresAt: shift(now, 60).toISOString().slice(0, 10),
      killSwitch: false,
      archived: false,
      environments: searchRules,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      key: "legacy.banner",
      name: "legacy.banner",
      description: null,
      owner: "Equipo Growth",
      expiresAt: "2026-01-01",
      killSwitch: false,
      archived: false,
      environments: legacyRules,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ];
}

export async function seed(db: Db, now: Date = new Date()): Promise<void> {
  const timestamp = now.toISOString();
  const companyRows = [
    { id: "acme", name: "Acme Corp" },
    { id: "globex", name: "Globex" },
    { id: "initech", name: "Initech" },
    { id: "umbrella", name: "Umbrella Corp" },
    { id: "hooli", name: "Hooli" },
  ];
  const flagStates = buildFlags(now);

  await db.run(sql`begin`);
  try {
    await db.delete(flagEnvironmentCompanies);
    await db.delete(flagEnvironments);
    await db.delete(auditLog);
    await db.delete(flags);
    await db.delete(companies);

    await db.insert(companies).values(
      companyRows.map((company) => ({
        ...company,
        createdAt: timestamp,
        updatedAt: timestamp,
      })),
    );

    for (const flag of flagStates) {
      await db.insert(flags).values({
        key: flag.key,
        name: flag.name,
        description: flag.description,
        owner: flag.owner,
        expiresAt: flag.expiresAt,
        killSwitch: flag.killSwitch,
        archived: flag.archived,
        createdAt: flag.createdAt,
        updatedAt: flag.updatedAt,
      });

      for (const environment of ENVIRONMENTS) {
        const environmentRule = flag.environments[environment];
        await db.insert(flagEnvironments).values({
          flagKey: flag.key,
          environment,
          enabled: environmentRule.enabled,
          rolloutPercentage: environmentRule.rolloutPercentage,
          updatedAt: environmentRule.updatedAt,
        });
        const memberships = [
          ...environmentRule.allowCompanies.map((companyId) => ({ companyId, list: "allow" })),
          ...environmentRule.denyCompanies.map((companyId) => ({ companyId, list: "deny" })),
        ];
        if (memberships.length > 0) {
          await db.insert(flagEnvironmentCompanies).values(
            memberships.map((membership) => ({
              flagKey: flag.key,
              environment,
              companyId: membership.companyId,
              list: membership.list,
            })),
          );
        }
      }

      await db.insert(auditLog).values({
        flagKey: flag.key,
        action: "create",
        reason: "Seed inicial",
        beforeState: null,
        afterState: JSON.stringify(flag),
        createdAt: timestamp,
      });
    }
    await db.run(sql`commit`);
  } catch (error) {
    await db.run(sql`rollback`);
    throw error;
  }
}
