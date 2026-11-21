import type { JSX } from "react";
import { LoginForm } from "@/components/auth/login-form";

interface LoginPageProps {
  searchParams: Promise<{ next?: string | string[] }>;
}

function firstNext(value: string | string[] | undefined): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (value === undefined) {
    return undefined;
  }
  return value[0];
}

export default async function LoginPage({ searchParams }: LoginPageProps): Promise<JSX.Element> {
  const params = await searchParams;
  return <LoginForm nextPath={firstNext(params.next)} />;
}
