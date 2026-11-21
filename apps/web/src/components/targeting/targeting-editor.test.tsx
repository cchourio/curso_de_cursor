import type { Company, EnvironmentRule, FlagState } from "@ff/domain";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/toast";
import { TargetingEditor } from "./targeting-editor";

const TIMESTAMP = "2026-10-13T12:00:00.000Z";

const COMPANIES: Company[] = [
  { id: "acme", name: "Acme Corp", createdAt: TIMESTAMP, updatedAt: TIMESTAMP },
  { id: "globex", name: "Globex", createdAt: TIMESTAMP, updatedAt: TIMESTAMP },
  { id: "initech", name: "Initech", createdAt: TIMESTAMP, updatedAt: TIMESTAMP },
];

function rule(enabled: boolean, rolloutPercentage: number, allow: string[] = [], deny: string[] = []): EnvironmentRule {
  return { enabled, rolloutPercentage, allowCompanies: allow, denyCompanies: deny, updatedAt: TIMESTAMP };
}

function makeFlag(overrides: { killSwitch?: boolean } = {}): FlagState {
  return {
    key: "checkout.new-flow",
    name: "Checkout",
    description: null,
    owner: "Equipo Checkout",
    expiresAt: "2027-01-01",
    killSwitch: overrides.killSwitch ?? false,
    archived: false,
    environments: {
      development: rule(true, 100, ["acme"]),
      staging: rule(false, 0),
      production: rule(true, 30),
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

function installFetch(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (init?.method === "PUT") {
      return Promise.resolve(json(makeFlag()));
    }
    if (requestUrl(input).includes("/companies")) {
      return Promise.resolve(json({ items: COMPANIES }));
    }
    return Promise.resolve(json({ items: [] }));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderEditor(flag: FlagState = makeFlag()): void {
  render(
    <ToastProvider>
      <TargetingEditor flag={flag} onUpdated={() => undefined} />
    </ToastProvider>,
  );
}

describe("editor de targeting", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sincroniza el slider con el porcentaje y descartar restaura el valor", () => {
    installFetch();
    renderEditor();
    fireEvent.change(screen.getByRole("slider"), { target: { value: "40" } });
    expect(screen.getByRole("spinbutton")).toHaveValue(40);
    expect(screen.getByText("40 % de las empresas recibirán la feature")).toBeInTheDocument();
    expect(screen.getByText("Cambios sin guardar")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Descartar" }));
    expect(screen.getByRole("spinbutton")).toHaveValue(100);
    expect(screen.queryByText("Cambios sin guardar")).not.toBeInTheDocument();
  });

  it("deshabilita en bloqueadas una empresa que ya está permitida", async () => {
    installFetch();
    renderEditor();
    const deny = screen.getByRole("group", { name: "Empresas bloqueadas" });
    const option = await within(deny).findByRole("button", { name: /acme/i });
    expect(option).toBeDisabled();
    expect(option).toHaveTextContent("(en la otra lista)");
  });

  it("al guardar en production abre el diálogo de producción y envía el PUT", async () => {
    const user = userEvent.setup({ delay: null });
    const fetchMock = installFetch();
    renderEditor();
    await user.click(screen.getByRole("tab", { name: /production/i }));
    fireEvent.change(screen.getByRole("slider"), { target: { value: "40" } });
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    expect(screen.getByRole("heading", { name: "Guardar cambios en PRODUCCIÓN" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("Motivo"), "Subir rollout");
    await user.click(screen.getByRole("button", { name: "Confirmar" }));
    const put = fetchMock.mock.calls.find((call) => call[1]?.method === "PUT");
    if (put === undefined) {
      throw new Error("sin PUT");
    }
    expect(requestUrl(put[0])).toBe("/api/admin/flags/checkout.new-flow/environments/production");
    const init = put[1];
    if (init === undefined || typeof init.body !== "string") {
      throw new Error("sin body");
    }
    const parsed: unknown = JSON.parse(init.body);
    expect(parsed).toEqual({
      enabled: true,
      rolloutPercentage: 40,
      allowCompanies: [],
      denyCompanies: [],
      reason: "Subir rollout",
    });
  });

  it("avisa cuando el kill switch está activo", () => {
    installFetch();
    renderEditor(makeFlag({ killSwitch: true }));
    expect(screen.getByText("Kill switch activo: esta regla no se aplica hasta desactivarlo")).toBeInTheDocument();
  });

  it("pide confirmación antes de cambiar de pestaña con cambios sin guardar", async () => {
    const user = userEvent.setup({ delay: null });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    installFetch();
    renderEditor();
    fireEvent.change(screen.getByRole("slider"), { target: { value: "40" } });
    await user.click(screen.getByRole("tab", { name: "staging" }));
    expect(confirm).toHaveBeenCalledWith("¿Descartar cambios de development?");
    expect(screen.getByRole("tab", { name: "development" })).toHaveAttribute("aria-selected", "true");
  });
});
