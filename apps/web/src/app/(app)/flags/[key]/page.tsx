import type { JSX } from "react";
import { FlagDetail } from "@/components/flags/flag-detail";

export default async function FlagPage({ params }: { params: Promise<{ key: string }> }): Promise<JSX.Element> {
  const { key } = await params;
  return <FlagDetail flagKey={key} />;
}
