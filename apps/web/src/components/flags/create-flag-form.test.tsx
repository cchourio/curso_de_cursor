import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/toast";
import { CreateFlagForm } from "./create-flag-form";

const navigation = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigation.push, replace: vi.fn() }),
}));

function renderForm(): void {
  render(
    <ToastProvider>
      <CreateFlagForm />
    </ToastProvider>,
  );
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function fillValid(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(screen.getByLabelText("Key"), "checkout.new-flow");
  await user.type(screen.getByLabelText("Nombre"), "Checkout");
  await user.type(screen.getByLabelText("Owner"), "Equipo Checkout");
  await user.type(screen.getByLabelText("Motivo"), "Crear la flag");
}

describe("formulario de creación", () => {
  afterEach(() => {
    navigation.push.mockReset();
    vi.unstubAllGlobals();
  });

  it("muestra el error de formato al salir de una key inválida y no llama a fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup({ delay: null });
    renderForm();
    await user.type(screen.getByLabelText("Key"), "Mal Key");
    await user.tab();
    expect(await screen.findByRole("alert")).toHaveTextContent("must match pattern");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("muestra el conflicto bajo Key si la API responde 409", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(json({ error: { code: "CONFLICT", message: "Ya existe una flag con esta key" } }, 409)),
    );
    const user = userEvent.setup({ delay: null });
    renderForm();
    await fillValid(user);
    await user.click(screen.getByRole("button", { name: "Crear flag" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Ya existe una flag con esta key");
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it("navega al detalle cuando la API responde 201", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ key: "checkout.new-flow" }, 201)));
    const user = userEvent.setup({ delay: null });
    renderForm();
    await fillValid(user);
    await user.click(screen.getByRole("button", { name: "Crear flag" }));
    await waitFor(() => {
      expect(navigation.push).toHaveBeenCalledWith("/flags/checkout.new-flow");
    });
  });
});
