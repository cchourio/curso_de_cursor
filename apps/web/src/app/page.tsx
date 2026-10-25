import type { JSX } from "react";
import { ENVIRONMENTS } from "@ff/domain";

export default function HomePage(): JSX.Element {
  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-bold">Feature Flags</h1>
      <ul className="mt-4 list-disc pl-6">
        {ENVIRONMENTS.map((environment) => (
          <li key={environment}>{environment}</li>
        ))}
      </ul>
    </main>
  );
}
