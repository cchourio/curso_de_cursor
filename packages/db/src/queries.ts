import { ENVIRONMENTS, type Company, type Environment, type EnvironmentRule, type FlagState } from "@ff/domain";
import { eq } from "drizzle-orm";
import type { Db } from "./client";
import { companies, flagEnvironmentCompanies, flagEnvironments, flags } from "./schema";

interface FlagRow {
  key: string;
  name: string;
  description: string | null;
  owner: string;
  expiresAt: string;
  killSwitch: boolean;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

interface EnvironmentRow {
  flagKey: string;
  environment: string;
  enabled: boolean;
  rolloutPercentage: number;
  updatedAt: string;
}

interface CompanyListRow {
  flagKey: string;
  environment: string;
  companyId: string;
  list: string;
}

function ruleKey(flagKey: string, environment: string): string {
  return `${flagKey}\u0000${environment}`;
}

function assemble(flagRows: FlagRow[], environmentRows: EnvironmentRow[], companyRows: CompanyListRow[]): FlagState[] {
  const allows = new Map<string, string[]>();
  const denies = new Map<string, string[]>();
  for (const row of companyRows) {
    const key = ruleKey(row.flagKey, row.environment);
    const target = row.list === "allow" ? allows : denies;
    const current = target.get(key) ?? [];
    current.push(row.companyId);
    target.set(key, current);
  }

  const rulesByFlag = new Map<string, Map<string, EnvironmentRule>>();
  for (const row of environmentRows) {
    const key = ruleKey(row.flagKey, row.environment);
    const byEnv = rulesByFlag.get(row.flagKey) ?? new Map<string, EnvironmentRule>();
    byEnv.set(row.environment, {
      enabled: row.enabled,
      rolloutPercentage: row.rolloutPercentage,
      allowCompanies: (allows.get(key) ?? []).slice().sort((a, b) => a.localeCompare(b)),
      denyCompanies: (denies.get(key) ?? []).slice().sort((a, b) => a.localeCompare(b)),
      updatedAt: row.updatedAt,
    });
    rulesByFlag.set(row.flagKey, byEnv);
  }

  return flagRows.map((flag) => {
    const byEnv = rulesByFlag.get(flag.key) ?? new Map<string, EnvironmentRule>();
    const environments = {} as Record<Environment, EnvironmentRule>;
    for (const environment of ENVIRONMENTS) {
      const rule = byEnv.get(environment);
      if (rule === undefined) {
        throw new Error(`La flag ${flag.key} no tiene fila para el ambiente ${environment}`);
      }
      environments[environment] = rule;
    }
    return {
      key: flag.key,
      name: flag.name,
      description: flag.description,
      owner: flag.owner,
      expiresAt: flag.expiresAt,
      killSwitch: flag.killSwitch,
      archived: flag.archived,
      environments,
      createdAt: flag.createdAt,
      updatedAt: flag.updatedAt,
    };
  });
}

export async function getFlagState(db: Db, key: string): Promise<FlagState | null> {
  const flagRows = await db.select().from(flags).where(eq(flags.key, key));
  const flag = flagRows[0];
  if (flag === undefined) {
    return null;
  }
  const environmentRows = await db.select().from(flagEnvironments).where(eq(flagEnvironments.flagKey, key));
  const companyRows = await db.select().from(flagEnvironmentCompanies).where(eq(flagEnvironmentCompanies.flagKey, key));
  const states = assemble([flag], environmentRows, companyRows);
  const state = states[0];
  if (state === undefined) {
    throw new Error(`La flag ${key} no tiene estado`);
  }
  return state;
}

export async function listFlagStates(db: Db): Promise<FlagState[]> {
  const flagRows = await db.select().from(flags).orderBy(flags.key);
  const environmentRows = await db.select().from(flagEnvironments);
  const companyRows = await db.select().from(flagEnvironmentCompanies);
  return assemble(flagRows, environmentRows, companyRows);
}

export async function listCompanies(db: Db): Promise<Company[]> {
  return db.select().from(companies).orderBy(companies.name);
}
