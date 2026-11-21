import type { FlagState } from "./types";

export type ObsoleteReason = "EXPIRED" | "STALE_PRODUCTION";

export const STALE_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export type FlagSummary = FlagState & {
  obsolescence: ObsoleteReason[];
  lastChangedAt: string;
};

export function getObsolescence(flag: FlagState, now: Date): ObsoleteReason[] {
  if (flag.archived) {
    return [];
  }
  const reasons: ObsoleteReason[] = [];
  const today = now.toISOString().slice(0, 10);
  if (flag.expiresAt < today) {
    reasons.push("EXPIRED");
  }
  const production = flag.environments.production;
  const staleRollout = production.rolloutPercentage === 0 || production.rolloutPercentage === 100;
  const ageMs = now.getTime() - Date.parse(production.updatedAt);
  if (staleRollout && ageMs >= STALE_DAYS * DAY_MS) {
    reasons.push("STALE_PRODUCTION");
  }
  return reasons;
}

export function getLastChangedAt(flag: FlagState): string {
  const timestamps = [
    flag.updatedAt,
    flag.environments.development.updatedAt,
    flag.environments.staging.updatedAt,
    flag.environments.production.updatedAt,
  ];
  let latest = timestamps[0];
  if (latest === undefined) {
    throw new Error(`La flag ${flag.key} no tiene timestamps`);
  }
  for (const timestamp of timestamps) {
    if (timestamp > latest) {
      latest = timestamp;
    }
  }
  return latest;
}
