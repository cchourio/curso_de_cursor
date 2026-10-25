export type { AuditAction, Company, EnvironmentRule, FlagState } from "./types";
export { AUDIT_ACTIONS } from "./types";

export type {
  CreateCompanyInput,
  CreateFlagInput,
  KillSwitchInput,
  ReasonOnlyInput,
  UpdateCompanyInput,
  UpdateFlagInput,
} from "./validation";
export {
  companyIdSchema,
  createCompanyInputSchema,
  createFlagInputSchema,
  flagKeySchema,
  isoDateSchema,
  killSwitchInputSchema,
  reasonOnlyInputSchema,
  reasonSchema,
  updateCompanyInputSchema,
  updateFlagInputSchema,
} from "./validation";

export const ENVIRONMENTS = ["development", "staging", "production"] as const;
export type Environment = (typeof ENVIRONMENTS)[number];
export function isEnvironment(value: string): value is Environment {
  return (ENVIRONMENTS as readonly string[]).includes(value);
}
