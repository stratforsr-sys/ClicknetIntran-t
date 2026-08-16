"use client";

import { Markdown } from "@/components/Markdown";

/**
 * Egen fil for att kunna laddas med next/dynamic. Markdown-parsern ar 48 kB
 * och behovs forst nar nagon trycker Forhandsgranska — den ska inte ligga i
 * forsta laddningen av redigeringsvyn.
 */
export default function Forhandsvisning({ text }: { text: string }) {
  return <Markdown text={text} />;
}
