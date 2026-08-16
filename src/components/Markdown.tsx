import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Delad renderare for dokumentens brodtext. Anvands bade av lasvyn (server)
 * och av redaktorens forhandsvisning (klient), sa att det som skrivs och det
 * som lases aldrig kan se olika ut.
 *
 * react-markdown renderar till React-element och slapper inte igenom ra HTML,
 * sa ett dokument kan inte smuggla in skript — vi behover aldrig
 * dangerouslySetInnerHTML.
 */
const komponenter = {
  // En bred tabell far rulla i sin egen ruta. Utan det skjuter en prislista
  // med manga kolumner ut hela sidan i sidled pa en telefon (AC-5.10).
  table: ({ children }: { children?: ReactNode }) => (
    <div className="prosa-tabell">
      <table>{children}</table>
    </div>
  ),
  // Externa lankar ska inte kunna na tillbaka till navets flik.
  a: ({ href, children }: { href?: string; children?: ReactNode }) => {
    const externt = !!href && /^https?:\/\//i.test(href);
    return (
      <a
        href={href}
        {...(externt ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      >
        {children}
      </a>
    );
  },
};

export function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={komponenter}>
      {text}
    </ReactMarkdown>
  );
}
