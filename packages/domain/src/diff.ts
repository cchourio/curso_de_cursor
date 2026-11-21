import { ENVIRONMENTS } from "./index";
import type { AuditAction, FlagState } from "./types";

export interface FieldChange {
  path: string;
  before: unknown;
  after: unknown;
}

export interface AuditEntry {
  id: number;
  flagKey: string;
  action: AuditAction;
  reason: string;
  createdAt: string;
  before: FlagState | null;
  after: FlagState;
  changes: FieldChange[];
  rollbackOfId: number | null;
}

const GENERAL_FIELDS = ["name", "description", "owner", "expiresAt", "killSwitch", "archived"] as const;
const RULE_FIELDS = ["enabled", "rolloutPercentage", "allowCompanies", "denyCompanies"] as const;

type RuleField = (typeof RULE_FIELDS)[number];

function sameIds(left: readonly unknown[], right: readonly unknown[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const rightIds = new Set(right);
  return left.every((id) => rightIds.has(id));
}

function sameValue(before: unknown, after: unknown): boolean {
  if (Array.isArray(before) && Array.isArray(after)) {
    return sameIds(before, after);
  }
  return Object.is(before, after);
}

function ruleValue(rule: FlagState["environments"]["development"], field: RuleField): unknown {
  return rule[field];
}

export function diffFlagStates(before: FlagState | null, after: FlagState): FieldChange[] {
  if (before === null) {
    return [{ path: "*", before: null, after }];
  }
  const changes: FieldChange[] = [];
  for (const field of GENERAL_FIELDS) {
    const previous = before[field];
    const next = after[field];
    if (!sameValue(previous, next)) {
      changes.push({ path: field, before: previous, after: next });
    }
  }
  for (const environment of ENVIRONMENTS) {
    const previousRule = before.environments[environment];
    const nextRule = after.environments[environment];
    if (previousRule === undefined || nextRule === undefined) {
      throw new Error(`Falta el ambiente ${environment}`);
    }
    for (const field of RULE_FIELDS) {
      const previous = ruleValue(previousRule, field);
      const next = ruleValue(nextRule, field);
      if (!sameValue(previous, next)) {
        changes.push({ path: `environments.${environment}.${field}`, before: previous, after: next });
      }
    }
  }
  return changes;
}
