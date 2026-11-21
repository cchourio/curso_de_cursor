import { describe, expect, it } from "vitest";
import { environmentRuleInputSchema } from "./index";
import {
  companyIdSchema,
  createFlagInputSchema,
  flagKeySchema,
  isoDateSchema,
  reasonSchema,
  updateFlagInputSchema,
} from "./validation";

const validFlag = {
  key: "checkout.new-flow",
  name: "  Checkout  ",
  description: "",
  owner: "Equipo Checkout",
  expiresAt: "2026-10-13",
  reason: "  Crear flag  ",
};

describe("validación de dominio", () => {
  it("acepta una key de flag válida y rechaza mayúsculas, claves cortas y guiones iniciales", () => {
    expect(flagKeySchema.parse("checkout.new-flow")).toBe("checkout.new-flow");
    for (const key of ["Checkout", "ab", "-abc"]) {
      const result = flagKeySchema.safeParse(key);
      expect(result.success).toBe(false);
    }
  });

  it("recorta el motivo y exige al menos 5 caracteres", () => {
    expect(reasonSchema.parse("  abcde  ")).toBe("abcde");
    const result = reasonSchema.safeParse("abc");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("El motivo debe tener al menos 5 caracteres");
    }
  });

  it("acepta una fecha real y rechaza 2026-02-30", () => {
    expect(isoDateSchema.parse("2026-10-13")).toBe("2026-10-13");
    expect(isoDateSchema.parse("2024-02-29")).toBe("2024-02-29");
    expect(isoDateSchema.safeParse("2026-02-30").success).toBe(false);
    expect(isoDateSchema.safeParse("2026-02-29").success).toBe(false);
  });

  it("convierte la descripción vacía en null al crear una flag", () => {
    const created = createFlagInputSchema.parse(validFlag);
    expect(created.name).toBe("Checkout");
    expect(created.description).toBeNull();
    expect(created.reason).toBe("Crear flag");

    const omitted = createFlagInputSchema.parse({ ...validFlag, description: undefined });
    expect(omitted.description).toBeNull();
  });

  it("exige al menos un campo además del motivo al editar", () => {
    const onlyReason = updateFlagInputSchema.safeParse({ reason: "Sin otro campo" });
    expect(onlyReason.success).toBe(false);
    if (!onlyReason.success) {
      expect(onlyReason.error.issues[0]?.path).toEqual(["name"]);
    }

    const cleared = updateFlagInputSchema.parse({ description: "", reason: "Quitar descripción" });
    expect(cleared.description).toBeNull();
  });

  it("acepta un id de empresa en minúsculas", () => {
    expect(companyIdSchema.parse("acme")).toBe("acme");
    expect(companyIdSchema.safeParse("Acme").success).toBe(false);
    expect(companyIdSchema.safeParse("a").success).toBe(false);
  });

  it("acepta un rollout de 0 y 100 y rechaza valores fuera de rango, decimales y empresas en ambas listas", () => {
    const base = {
      enabled: true,
      allowCompanies: [] as string[],
      denyCompanies: [] as string[],
      reason: "Abrir en staging",
    };
    expect(environmentRuleInputSchema.parse({ ...base, rolloutPercentage: 0 }).rolloutPercentage).toBe(0);
    expect(environmentRuleInputSchema.parse({ ...base, rolloutPercentage: 100 }).rolloutPercentage).toBe(100);
    for (const rolloutPercentage of [-1, 101, 12.5]) {
      expect(environmentRuleInputSchema.safeParse({ ...base, rolloutPercentage }).success).toBe(false);
    }
    const overlap = environmentRuleInputSchema.safeParse({
      ...base,
      rolloutPercentage: 10,
      allowCompanies: ["acme"],
      denyCompanies: ["acme"],
    });
    expect(overlap.success).toBe(false);
    if (!overlap.success) {
      const issue = overlap.error.issues.find((item) => item.path.includes("denyCompanies"));
      expect(issue?.message).toBe("La empresa acme no puede estar en ambas listas");
    }
  });
});
