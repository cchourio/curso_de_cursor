export type { AuditAction, Company, EnvironmentRule, FlagState } from "./types";
export { AUDIT_ACTIONS } from "./types";

export const ENVIRONMENTS = ["development", "staging", "production"] as const;
export type Environment = (typeof ENVIRONMENTS)[number];
export function isEnvironment(value: string): value is Environment {
  return (ENVIRONMENTS as readonly string[]).includes(value);
}
