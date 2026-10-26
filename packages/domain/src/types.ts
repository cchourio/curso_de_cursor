import type { Environment } from "./index";

export const AUDIT_ACTIONS = [
  "create",
  "update",
  "archive",
  "unarchive",
  "kill_switch_on",
  "kill_switch_off",
  "targeting_update",
  "rollback",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface EnvironmentRule {
  enabled: boolean;
  rolloutPercentage: number;
  allowCompanies: string[];
  denyCompanies: string[];
  updatedAt: string;
}

export interface FlagState {
  key: string;
  name: string;
  description: string | null;
  owner: string;
  expiresAt: string;
  killSwitch: boolean;
  archived: boolean;
  environments: Record<Environment, EnvironmentRule>;
  createdAt: string;
  updatedAt: string;
}

export interface Company {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}
