import type { Company } from "@ff/domain";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompaniesManager } from "./companies-manager";

const TIMESTAMP = "2026-10-13T12:00:00.000Z";

const HOOLI: Company = { id: "hooli", name: "Hooli", createdAt: TIMESTAMP, updatedAt: TIMESTAMP };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

describe("catálogo de empresas", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("muestra el conflicto si el ID ya existe", async () => {
    const user = userEvent.setup({ delay: null });
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        if (init?.method === "POST") {
          return Promise.resolve(json({ error: { code: "CONFLICT", message: "Ya existe una empresa con este id" } }, 409));
        }
        if (requestUrl(input).includes("/companies")) {
          return Promise.resolve(json({ items: [HOOLI] }));
        }
        return Promise.resolve(json({ items: [] }));
      }),
    );
    render(<CompaniesManager />);
    expect(await screen.findByText("hooli")).toBeInTheDocument();
    await user.type(screen.getByLabelText("ID"), "hooli");
    await user.type(screen.getByLabelText("Nombre"), "Otra");
    await user.click(screen.getByRole("button", { name: "Crear empresa" }));
    expect(await screen.findByText("Ya existe una empresa con ese ID")).toBeInTheDocument();
  });
});
