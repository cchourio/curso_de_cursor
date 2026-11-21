"use client";

import type { FormEvent, JSX } from "react";
import { useEffect, useState } from "react";
import { createCompanyInputSchema, updateCompanyInputSchema, type Company } from "@ff/domain";
import { ApiClientError } from "@/lib/api";
import { createCompany, listCompanies, updateCompany } from "@/lib/flags-api";

interface CompanyForm {
  id: string;
  name: string;
}

type CompanyField = keyof CompanyForm;

function issuesByField(
  issues: readonly { path: ReadonlyArray<PropertyKey>; message: string }[],
): Partial<Record<CompanyField, string>> {
  const errors: Partial<Record<CompanyField, string>> = {};
  for (const issue of issues) {
    const field = issue.path[0];
    if ((field === "id" || field === "name") && errors[field] === undefined) {
      errors[field] = issue.message;
    }
  }
  return errors;
}

function FieldError({ message }: { message: string | undefined }): JSX.Element | null {
  if (message === undefined) {
    return null;
  }
  return (
    <p role="alert" className="text-sm text-red-700">
      {message}
    </p>
  );
}

function byName(left: Company, right: Company): number {
  return left.name.localeCompare(right.name, "es");
}

export function CompaniesManager(): JSX.Element {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [form, setForm] = useState<CompanyForm>({ id: "", name: "" });
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<CompanyField, string>>>({});
  const [formError, setFormError] = useState<string | undefined>();
  const [loadError, setLoadError] = useState<string | undefined>();
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState(false);
  const [editingId, setEditingId] = useState<string | undefined>();
  const [editingName, setEditingName] = useState("");
  const [renameError, setRenameError] = useState<string | undefined>();

  useEffect(() => {
    let active = true;
    setLoadError(undefined);
    void listCompanies()
      .then((items) => {
        if (active) {
          setCompanies(items);
        }
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }
        setLoadError(error instanceof Error ? error.message : "No se pudieron cargar las empresas");
      });
    return () => {
      active = false;
    };
  }, [attempt]);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const parsed = createCompanyInputSchema.safeParse(form);
    if (!parsed.success) {
      setFieldErrors(issuesByField(parsed.error.issues));
      return;
    }
    setFieldErrors({});
    setFormError(undefined);
    setPending(true);
    try {
      const created = await createCompany(parsed.data);
      setCompanies((current) => [...current, created].sort(byName));
      setForm({ id: "", name: "" });
    } catch (error: unknown) {
      if (error instanceof ApiClientError && error.status === 409) {
        setFieldErrors({ id: "Ya existe una empresa con ese ID" });
        return;
      }
      setFormError(error instanceof Error ? error.message : "No se pudo crear la empresa");
    } finally {
      setPending(false);
    }
  }

  function startEdit(company: Company): void {
    setEditingId(company.id);
    setEditingName(company.name);
    setRenameError(undefined);
  }

  function cancelEdit(): void {
    setEditingId(undefined);
    setRenameError(undefined);
  }

  async function saveName(id: string): Promise<void> {
    const parsed = updateCompanyInputSchema.safeParse({ name: editingName });
    if (!parsed.success) {
      setRenameError(parsed.error.issues[0]?.message ?? "Nombre inválido");
      return;
    }
    setRenameError(undefined);
    try {
      const updated = await updateCompany(id, parsed.data);
      setCompanies((current) => current.map((company) => (company.id === updated.id ? updated : company)).sort(byName));
      setEditingId(undefined);
    } catch (error: unknown) {
      setRenameError(error instanceof Error ? error.message : "No se pudo renombrar la empresa");
    }
  }

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 p-6">
      <h1 className="text-2xl font-semibold">Empresas</h1>
      {loadError === undefined ? null : (
        <div role="alert">
          <p>{loadError}</p>
          <button type="button" className="mt-2 rounded border px-3 py-1" onClick={() => setAttempt((current) => current + 1)}>
            Reintentar
          </button>
        </div>
      )}
      <table className="w-full border-collapse text-left">
        <thead>
          <tr>
            <th className="border-b px-2 py-2">ID</th>
            <th className="border-b px-2 py-2">Nombre</th>
          </tr>
        </thead>
        <tbody>
          {companies.map((company) => (
            <tr key={company.id}>
              <td className="border-b px-2 py-2 font-mono">{company.id}</td>
              <td className="border-b px-2 py-2">
                {editingId === company.id ? (
                  <input
                    aria-label={`Nombre de ${company.id}`}
                    className="rounded border px-3 py-1"
                    value={editingName}
                    onChange={(event) => setEditingName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void saveName(company.id);
                      }
                      if (event.key === "Escape") {
                        event.preventDefault();
                        cancelEdit();
                      }
                    }}
                  />
                ) : (
                  <button type="button" className="underline" onClick={() => startEdit(company)}>
                    {company.name}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {renameError === undefined ? null : <FieldError message={renameError} />}

      <form className="flex flex-col gap-3" aria-label="Nueva empresa" onSubmit={(event) => void submit(event)}>
        <h2 className="text-lg font-semibold">Nueva empresa</h2>
        <label className="text-sm" htmlFor="company-id">
          ID
        </label>
        <input
          id="company-id"
          className="rounded border px-3 py-2"
          value={form.id}
          onChange={(event) => setForm({ ...form, id: event.target.value })}
        />
        <FieldError message={fieldErrors.id} />
        <label className="text-sm" htmlFor="company-name">
          Nombre
        </label>
        <input
          id="company-name"
          className="rounded border px-3 py-2"
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
        />
        <FieldError message={fieldErrors.name} />
        {formError === undefined ? null : <FieldError message={formError} />}
        <button type="submit" className="w-fit rounded bg-black px-3 py-2 text-white disabled:opacity-60" disabled={pending}>
          Crear empresa
        </button>
      </form>
    </main>
  );
}
