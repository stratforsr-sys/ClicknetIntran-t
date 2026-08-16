"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Egen fil for att kunna laddas med next/dynamic. Markdown-parsern ar 48 kB
 * och behovs forst nar nagon trycker Forhandsgranska — den ska inte ligga i
 * forsta laddningen av redigeringsvyn.
 */
export default function Forhandsvisning({ text }: { text: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>;
}
