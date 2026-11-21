import { describe, expect, it } from "vitest";
import { STALE_DAYS, getLastChangedAt, getObsolescence } from "./index";
import type { EnvironmentRule, FlagState } from "./types";

const NOW = new Date("2026-10-13T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

function rule(updatedAt: string, rolloutPercentage: number): EnvironmentRule {
  return {
    enabled: true,
    rolloutPercentage,
    allowCompanies: [],
    denyCompanies: [],
    updatedAt,
  };
}

interface FlagOverrides {
  expiresAt?: string;
  archived?: boolean;
  updatedAt?: string;
  developmentUpdatedAt?: string;
  stagingUpdatedAt?: string;
  productionUpdatedAt?: string;
  productionRollout?: number;
}

function makeFlag(overrides: FlagOverrides = {}): FlagState {
  const updatedAt = overrides.updatedAt ?? NOW.toISOString();
  return {
    key: "demo.flag",
    name: "Demo",
    description: null,
    owner: "Equipo Demo",
    expiresAt: overrides.expiresAt ?? "2026-12-31",
    killSwitch: false,
    archived: overrides.archived ?? false,
    environments: {
      development: rule(overrides.developmentUpdatedAt ?? updatedAt, 100),
      staging: rule(overrides.stagingUpdatedAt ?? updatedAt, 100),
      production: rule(overrides.productionUpdatedAt ?? updatedAt, overrides.productionRollout ?? 50),
    },
    createdAt: updatedAt,
    updatedAt,
  };
}

describe("obsolescencia", () => {
  it("no marca EXPIRED si vence hoy y sí si venció ayer", () => {
    expect(STALE_DAYS).toBe(30);
    expect(getObsolescence(makeFlag({ expiresAt: "2026-10-13" }), NOW)).not.toContain("EXPIRED");
    expect(getObsolescence(makeFlag({ expiresAt: "2026-10-12" }), NOW)).toEqual(["EXPIRED"]);
  });

  it("marca STALE_PRODUCTION a los 30 días en 0 o 100, no a los 29 ni con rollout parcial", () => {
    const ago29 = new Date(NOW.getTime() - 29 * DAY_MS).toISOString();
    const ago30 = new Date(NOW.getTime() - 30 * DAY_MS).toISOString();
    const ago90 = new Date(NOW.getTime() - 90 * DAY_MS).toISOString();
    expect(getObsolescence(makeFlag({ productionRollout: 100, productionUpdatedAt: ago29 }), NOW)).not.toContain(
      "STALE_PRODUCTION",
    );
    expect(getObsolescence(makeFlag({ productionRollout: 100, productionUpdatedAt: ago30 }), NOW)).toEqual([
      "STALE_PRODUCTION",
    ]);
    expect(getObsolescence(makeFlag({ productionRollout: 0, productionUpdatedAt: ago30 }), NOW)).toEqual([
      "STALE_PRODUCTION",
    ]);
    expect(getObsolescence(makeFlag({ productionRollout: 30, productionUpdatedAt: ago90 }), NOW)).not.toContain(
      "STALE_PRODUCTION",
    );
  });

  it("una flag archivada vencida devuelve un arreglo vacío", () => {
    const ago90 = new Date(NOW.getTime() - 90 * DAY_MS).toISOString();
    expect(
      getObsolescence(
        makeFlag({
          archived: true,
          expiresAt: "2020-01-01",
          productionRollout: 100,
          productionUpdatedAt: ago90,
        }),
        NOW,
      ),
    ).toEqual([]);
  });

  it("ordena EXPIRED antes de STALE_PRODUCTION", () => {
    const ago30 = new Date(NOW.getTime() - 30 * DAY_MS).toISOString();
    expect(
      getObsolescence(makeFlag({ expiresAt: "2026-10-12", productionRollout: 100, productionUpdatedAt: ago30 }), NOW),
    ).toEqual(["EXPIRED", "STALE_PRODUCTION"]);
  });

  it("getLastChangedAt devuelve el mayor de los cuatro timestamps", () => {
    expect(
      getLastChangedAt(
        makeFlag({
          updatedAt: "2026-12-01T00:00:00.000Z",
          developmentUpdatedAt: "2026-01-01T00:00:00.000Z",
          stagingUpdatedAt: "2026-02-01T00:00:00.000Z",
          productionUpdatedAt: "2026-03-01T00:00:00.000Z",
        }),
      ),
    ).toBe("2026-12-01T00:00:00.000Z");
    expect(
      getLastChangedAt(
        makeFlag({
          updatedAt: "2026-01-01T00:00:00.000Z",
          developmentUpdatedAt: "2026-09-01T00:00:00.000Z",
          stagingUpdatedAt: "2026-02-01T00:00:00.000Z",
          productionUpdatedAt: "2026-03-01T00:00:00.000Z",
        }),
      ),
    ).toBe("2026-09-01T00:00:00.000Z");
    expect(
      getLastChangedAt(
        makeFlag({
          updatedAt: "2026-01-01T00:00:00.000Z",
          developmentUpdatedAt: "2026-02-01T00:00:00.000Z",
          stagingUpdatedAt: "2026-11-01T00:00:00.000Z",
          productionUpdatedAt: "2026-03-01T00:00:00.000Z",
        }),
      ),
    ).toBe("2026-11-01T00:00:00.000Z");
    expect(
      getLastChangedAt(
        makeFlag({
          updatedAt: "2026-01-01T00:00:00.000Z",
          developmentUpdatedAt: "2026-02-01T00:00:00.000Z",
          stagingUpdatedAt: "2026-03-01T00:00:00.000Z",
          productionUpdatedAt: "2026-10-01T00:00:00.000Z",
        }),
      ),
    ).toBe("2026-10-01T00:00:00.000Z");
  });
});
