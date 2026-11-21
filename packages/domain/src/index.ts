export type { AuditAction, Company, EnvironmentRule, FlagState } from "./types";
export { AUDIT_ACTIONS } from "./types";

export type {
  CreateCompanyInput,
  CreateFlagInput,
  EnvironmentRuleInput,
  KillSwitchInput,
  ReasonOnlyInput,
  RollbackInput,
  UpdateCompanyInput,
  UpdateFlagInput,
} from "./validation";
export {
  companyIdSchema,
  createCompanyInputSchema,
  createFlagInputSchema,
  environmentRuleInputSchema,
  flagKeySchema,
  isoDateSchema,
  killSwitchInputSchema,
  reasonOnlyInputSchema,
  reasonSchema,
  rollbackInputSchema,
  updateCompanyInputSchema,
  updateFlagInputSchema,
} from "./validation";

export type { FlagSummary, ObsoleteReason } from "./obsolescence";
export { STALE_DAYS, getLastChangedAt, getObsolescence } from "./obsolescence";

export const ENVIRONMENTS = ["development", "staging", "production"] as const;
export type Environment = (typeof ENVIRONMENTS)[number];
export function isEnvironment(value: string): value is Environment {
  return (ENVIRONMENTS as readonly string[]).includes(value);
}

export type { AuditEntry, FieldChange } from "./diff";
export { diffFlagStates } from "./diff";
