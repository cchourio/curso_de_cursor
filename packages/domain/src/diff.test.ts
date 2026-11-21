import { describe, expect, it } from "vitest";
import { diffFlagStates, type FlagState } from "./index";

const TIMESTAMP = "2026-10-13T12:00:00.000Z";

function rule(rolloutPercentage: number, allowCompanies: string[] = []): FlagState["environments"]["development"] {
  return {
    enabled: true,
    rolloutPercentage,
    allowCompanies,
    denyCompanies: [],
    updatedAt: TIMESTAMP,
  };
}

function flag(rolloutPercentage: number, allowCompanies: string[] = []): FlagState {
  return {
    key: "checkout.new-flow",
    name: "Checkout",
    description: null,
    owner: "Equipo Checkout",
    expiresAt: "2027-01-01",
    killSwitch: false,
    archived: false,
    environments: {
      development: rule(0),
      staging: rule(0),
      production: rule(rolloutPercentage, allowCompanies),
    },
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
  };
}

describe("diferencias de una flag", () => {
  it("devuelve solo el rollout de production cuando es el único cambio", () => {
    const changes = diffFlagStates(flag(10), flag(80));
    expect(changes).toEqual([{ path: "environments.production.rolloutPercentage", before: 10, after: 80 }]);
  });

  it("ignora el orden de las listas y los updatedAt", () => {
    const left = flag(10, ["a", "b"]);
    const right = flag(10, ["b", "a"]);
    right.updatedAt = "2026-11-01T00:00:00.000Z";
    right.environments.production.updatedAt = "2026-11-01T00:00:00.000Z";
    right.environments.staging.updatedAt = "2026-11-02T00:00:00.000Z";
    expect(diffFlagStates(left, right)).toEqual([]);
  });

  it("pone los campos generales antes que los ambientes y marca el alta con *", () => {
    const before = flag(10);
    const after = flag(80);
    after.name = "Nuevo checkout";
    expect(diffFlagStates(before, after).map((change) => change.path)).toEqual([
      "name",
      "environments.production.rolloutPercentage",
    ]);
    const created = flag(10);
    expect(diffFlagStates(null, created)).toEqual([{ path: "*", before: null, after: created }]);
  });
});