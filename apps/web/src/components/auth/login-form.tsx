"use client";

import type { FormEvent, JSX } from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function safeNext(value: string | undefined): string {
  if (value !== undefined && value.startsWith("/") && !value.startsWith("//")) {
    return value;
  }
  return "/";
}

interface LoginFormProps {
  nextPath?: string;
}

export function LoginForm({ nextPath }: LoginFormProps): JSX.Element {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (response.status === 401) {
        setError("Usuario o contraseña incorrectos");
        return;
      }
      if (!response.ok) {
        setError("No se pudo iniciar sesión");
        return;
      }
      router.push(safeNext(nextPath));
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="mx-auto max-w-sm p-8">
      <h1 className="text-2xl font-bold">Entrar</h1>
      <form className="mt-6 flex flex-col gap-4" onSubmit={(event) => void onSubmit(event)}>
        <label className="flex flex-col gap-1" htmlFor="username">
          Usuario
          <input
            id="username"
            name="username"
            autoComplete="username"
            className="rounded border px-3 py-2"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1" htmlFor="password">
          Contraseña
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            className="rounded border px-3 py-2"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error === undefined ? null : <p role="alert">{error}</p>}
        <button className="rounded bg-black px-3 py-2 text-white disabled:opacity-60" type="submit" disabled={pending}>
          Entrar
        </button>
      </form>
    </main>
  );
}
