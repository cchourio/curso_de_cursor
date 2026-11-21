import type { EnvironmentRule, FlagState } from "@ff/domain";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/toast";
import { FlagDetail } from "./flag-detail";

const TIMESTAMP = "2026-10-13T12:00:00.000Z";

function rule(enabled: boolean, rolloutPercentage: number, allow: string[] = [], deny: string[] = []): EnvironmentRule {
  return {
    enabled,
    rolloutPercentage,
    allowCompanies: allow,
    denyCompanies: deny,
    updatedAt: TIMESTAMP,
  };
}

function makeFlag(overrides: { archived?: boolean; killSwitch?: boolean; owner?: string } = {}): FlagState {
  return {
    key: "checkout.new-flow",
    name: "Checkout",
    description: null,
    owner: overrides.owner ?? "Equipo Checkout",
    expiresAt: "2027-01-01",
    killSwitch: overrides.killSwitch ?? false,
    archived: overrides.archived ?? false,
    environments: {
      development: rule(true, 100),
      staging: rule(true, 100),
      production: rule(true, 30, ["acme"], ["globex"]),
    },
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
  };
}

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

function renderDetail(): void {
  render(
    <ToastProvider>
      <FlagDetail flagKey="checkout.new-flow" />
    </ToastProvider>,
  );
}

describe("detalle de flag", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("deshabilita guardar hasta cambiar el owner y envía un PATCH solo con owner y reason", async () => {
    const base = makeFlag();
    const user = userEvent.setup({ delay: null });
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      if (init?.method === "PATCH") {
        return Promise.resolve(json({ ...base, owner: "Equipo Nuevo" }));
      }
      return Promise.resolve(json(base));
    });
    vi.stubGlobal("fetch", fetchMock);
    renderDetail();
    expect(await screen.findByRole("button", { name: "Guardar cambios" })).toBeDisabled();
    const owner = screen.getByLabelText("Owner");
    await user.clear(owner);
    await user.type(owner, "Equipo Nuevo");
    expect(screen.getByRole("button", { name: "Guardar cambios" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await user.type(screen.getByLabelText("Motivo"), "Cambiar el owner");
    await user.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find((call) => call[1]?.method === "PATCH");
      expect(patch).toBeDefined();
    });
    const patch = fetchMock.mock.calls.find((call) => call[1]?.method === "PATCH");
    if (patch === undefined) {
      throw new Error("sin PATCH");
    }
    expect(requestUrl(patch[0])).toBe("/api/admin/flags/checkout.new-flow");
    const init = patch[1];
    if (init === undefined || typeof init.body !== "string") {
      throw new Error("sin body");
    }
    const parsed: unknown = JSON.parse(init.body);
    expect(parsed).toEqual({ owner: "Equipo Nuevo", reason: "Cambiar el owner" });
  });

  it("envía el kill switch y muestra el badge en la cabecera", async () => {
    const base = makeFlag();
    const user = userEvent.setup({ delay: null });
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      if (init?.method === "POST") {
        return Promise.resolve(json({ ...base, killSwitch: true }));
      }
      return Promise.resolve(json(base));
    });
    vi.stubGlobal("fetch", fetchMock);
    renderDetail();
    await screen.findByRole("switch", { name: "Inactivo" });
    await user.click(screen.getByRole("switch", { name: "Inactivo" }));
    await user.type(screen.getByLabelText("Motivo"), "Activar para QA");
    await user.click(screen.getByRole("button", { name: "Activar" }));
    const header = screen.getByRole("heading", { name: "checkout.new-flow" }).parentElement;
    if (header === null) {
      throw new Error("sin cabecera");
    }
    expect(await within(header).findByText("Kill switch")).toBeInTheDocument();
    const post = fetchMock.mock.calls.find((call) => call[1]?.method === "POST");
    if (post === undefined) {
      throw new Error("sin POST");
    }
    expect(requestUrl(post[0])).toBe("/api/admin/flags/checkout.new-flow/kill-switch");
    const init = post[1];
    if (init === undefined || typeof init.body !== "string") {
      throw new Error("sin body");
    }
    const parsed: unknown = JSON.parse(init.body);
    expect(parsed).toEqual({ enabled: true, reason: "Activar para QA" });
  });

  it("deja la flag archivada en solo lectura salvo desarchivar", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(makeFlag({ archived: true }))));
    renderDetail();
    expect(await screen.findByText("Flag archivada: solo lectura")).toBeInTheDocument();
    expect(screen.getByLabelText("Nombre")).toBeDisabled();
    expect(screen.getByLabelText("Descripción")).toBeDisabled();
    expect(screen.getByLabelText("Owner")).toBeDisabled();
    expect(screen.getByLabelText("Expiración")).toBeDisabled();
    expect(screen.getByRole("switch", { name: "Inactivo" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Guardar cambios" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Desarchivar flag" })).toBeEnabled();
  });

  it("muestra Flag no encontrada cuando la API responde 404", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(json({ error: { code: "NOT_FOUND", message: "Flag no encontrada" } }, 404)),
    );
    renderDetail();
    expect(await screen.findByText("Flag no encontrada")).toBeInTheDocument();
  });
});
