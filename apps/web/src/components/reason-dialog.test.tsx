import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ReasonDialog } from "./reason-dialog";

describe("ReasonDialog", () => {
  it("deshabilita confirmar con abc, lo habilita con un motivo válido y Escape cancela", async () => {
    const user = userEvent.setup({ delay: null });
    const onCancel = vi.fn();
    render(
      <ReasonDialog
        open
        title="Activar kill switch"
        confirmLabel="Confirmar"
        onConfirm={vi.fn().mockResolvedValue(undefined)}
        onCancel={onCancel}
      />,
    );
    const confirm = screen.getByRole("button", { name: "Confirmar" });
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText("Motivo"), "abc");
    expect(confirm).toBeDisabled();
    await user.clear(screen.getByLabelText("Motivo"));
    await user.type(screen.getByLabelText("Motivo"), "Activar para QA");
    expect(confirm).toBeEnabled();
    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("muestra el error y mantiene el modal abierto si onConfirm falla", async () => {
    const user = userEvent.setup({ delay: null });
    const onCancel = vi.fn();
    const onConfirm = vi.fn().mockRejectedValue(new Error("No se pudo activar"));
    render(
      <ReasonDialog open title="Activar kill switch" confirmLabel="Confirmar" onConfirm={onConfirm} onCancel={onCancel} />,
    );
    await user.type(screen.getByLabelText("Motivo"), "Activar para QA");
    await user.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo activar");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onCancel).not.toHaveBeenCalled();
    expect(onConfirm).toHaveBeenCalledWith("Activar para QA");
  });
});
