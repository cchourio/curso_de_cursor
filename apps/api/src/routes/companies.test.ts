import { describe, expect, it } from "vitest";
import { createTestApp } from "../test/helpers";

const NOW = new Date("2026-10-13T12:00:00.000Z");
const clock = (): Date => NOW;

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Se esperaba un objeto");
  }
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    result[key] = entry;
  }
  return result;
}

async function readBody(response: Response): Promise<unknown> {
  const body: unknown = await response.json();
  return body;
}

describe("empresas", () => {
  it("crea, rechaza el id duplicado, responde 404 al editar una inexistente y lista por nombre", async () => {
    const { request } = await createTestApp({ clock });
    const zeta = await request("/api/admin/companies", {
      method: "POST",
      body: JSON.stringify({ id: "zeta", name: "Zeta" }),
    });
    expect(zeta.status).toBe(201);
    expect(record(await readBody(zeta)).name).toBe("Zeta");

    const acme = await request("/api/admin/companies", {
      method: "POST",
      body: JSON.stringify({ id: "acme", name: "  Acme  " }),
    });
    expect(acme.status).toBe(201);
    expect(record(await readBody(acme)).name).toBe("Acme");

    const duplicate = await request("/api/admin/companies", {
      method: "POST",
      body: JSON.stringify({ id: "acme", name: "Otra" }),
    });
    expect(duplicate.status).toBe(409);
    expect(record(record(await readBody(duplicate)).error).code).toBe("CONFLICT");

    const missing = await request("/api/admin/companies/no-existe", {
      method: "PATCH",
      body: JSON.stringify({ name: "Nadie" }),
    });
    expect(missing.status).toBe(404);
    expect(record(record(await readBody(missing)).error).code).toBe("NOT_FOUND");

    const renamed = await request("/api/admin/companies/acme", {
      method: "PATCH",
      body: JSON.stringify({ name: "Acme Corp" }),
    });
    expect(renamed.status).toBe(200);
    expect(record(await readBody(renamed)).name).toBe("Acme Corp");

    const listed = await request("/api/admin/companies");
    expect(listed.status).toBe(200);
    const items = record(await readBody(listed)).items;
    if (!Array.isArray(items)) {
      throw new Error("items no es una lista");
    }
    expect(items.map((item) => record(item).name)).toEqual(["Acme Corp", "Zeta"]);
  });
});
