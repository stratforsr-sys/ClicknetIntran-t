"use client";

import { useActionState, type ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/components/ui/cn";
import { Ikon } from "@/components/shell/Ikon";
import {
  LAGE_ETIKETT,
  PRIORITET_ETIKETT,
  arStangd,
  fristtext,
  tidstext,
  visaPrioritet,
  type Lage,
  type Prioritet,
} from "@/lib/uppgifter";
import { bocka, planera, type UppgiftState } from "./actions";

/**
 * Uppgiftslistan.
 *
 * ===========================================================================
 * RADEN SVARAR PÅ TRE FRÅGOR OCH INTE FLER
 *
 * Vad ska göras, när, och vem väntar. Allt annat — beskrivningen, historiken,
 * de inbjudna, kopplingarna — ligger ett klick bort. En lista där varje rad bär
 * allt om sin uppgift är en lista man läser i stället för att beta av, och då
 * har den blivit en rapport.
 *
 * DÄRFÖR ÄR OCKSÅ DET MESTA OMÄRKT. Prioritetsstrimman ritas bara för de två
 * högsta stegen, lägesetiketten bara när läget inte är det självklara, och
 * ansvarig bara i vyer där raderna kan tillhöra olika personer. Ett märke som
 * sitter på varje rad har slutat betyda något.
 * ===========================================================================
 */

export type Listrad = {
  id: string;
  title: string;
  assignee_id: string | null;
  project_id: string | null;
  due_date: string | null;
  due_time: string | null;
  estimate_minutes: number | null;
  priority: Prioritet;
  lage: Lage;
  granskare: number;
  /** Namn på det uppgiften handlar om. Max två ritas. */
  kopplingar: { etikett: string; slag: string }[];
  delar: { id: string; title: string; lage: Lage }[];
};

export type Projektkarta = Record<string, { namn: string; farg: string }>;

const FARG_PRICK: Record<string, string> = {
  brand: "bg-brand-500",
  info: "bg-info",
  accent: "bg-accent",
  ok: "bg-ok",
  warn: "bg-warn",
  danger: "bg-danger",
};

export function Lista({
  rader,
  namn,
  projekt,
  idag,
  visaAnsvarig = false,
}: {
  rader: Listrad[];
  namn: Record<string, string>;
  projekt: Projektkarta;
  idag: string;
  visaAnsvarig?: boolean;
}) {
  return (
    <ul className="-mx-2">
      {rader.map((u) => (
        <Rad key={u.id} u={u} namn={namn} projekt={projekt} idag={idag} visaAnsvarig={visaAnsvarig} />
      ))}
    </ul>
  );
}

function Rad({
  u,
  namn,
  projekt,
  idag,
  visaAnsvarig,
}: {
  u: Listrad;
  namn: Record<string, string>;
  projekt: Projektkarta;
  idag: string;
  visaAnsvarig: boolean;
}) {
  const stangd = arStangd(u.lage);
  const forsen = Boolean(u.due_date && !stangd && u.due_date < idag);
  const idagsrad = u.due_date === idag && !stangd;

  const frist = fristtext(u.due_date, idag);
  const langd = tidstext(u.estimate_minutes);
  const proj = u.project_id ? projekt[u.project_id] : null;
  const klaraDelar = u.delar.filter((d) => arStangd(d.lage)).length;

  return (
    <li
      className={cn(
        "group relative border-b border-canvas transition-colors duration-fast last:border-0",
        "hover:bg-surface-alt",
      )}
    >
      {/* Prioritetsstrimman. Bara steg 1 och 2 — se rubriken överst. */}
      {visaPrioritet(u.priority) && !stangd && (
        <span
          aria-hidden
          className={cn(
            "absolute top-3 bottom-3 left-0 w-[3px] rounded-full",
            u.priority === 1 ? "bg-danger" : "bg-warn",
          )}
        />
      )}

      <div className="flex items-start gap-3 py-3 pr-2 pl-3">
        <Bock id={u.id} lage={u.lage} granskare={u.granskare} />

        <div className="min-w-0 flex-1">
          <Link href={`/uppgifter/${u.id}`} className="block">
            <span
              className={cn(
                "text-body transition-colors duration-fast",
                stangd ? "text-ink-300 line-through" : "text-ink-900 group-hover:text-brand-700",
              )}
            >
              {u.title}
            </span>
          </Link>

          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1">
            {frist && (
              <span
                className={cn(
                  "tnum text-small",
                  forsen ? "font-semibold text-danger-ink" : idagsrad ? "font-semibold text-brand-700" : "text-ink-500",
                )}
              >
                {frist}
                {u.due_time ? ` ${u.due_time}` : ""}
              </span>
            )}

            {langd && <Meta>{langd}</Meta>}

            {proj && (
              <span className="inline-flex items-center gap-1.5 text-small text-ink-500">
                <span aria-hidden className={cn("size-2 rounded-full", FARG_PRICK[proj.farg] ?? "bg-brand-500")} />
                {proj.namn}
              </span>
            )}

            {u.kopplingar.slice(0, 2).map((k, i) => (
              <span
                key={`${k.slag}-${i}`}
                className="inline-flex max-w-[14rem] items-center truncate rounded-full bg-canvas px-2 py-0.5 text-micro text-ink-500"
              >
                {k.etikett}
              </span>
            ))}

            {u.delar.length > 0 && (
              <Meta>
                {klaraDelar}/{u.delar.length} delar
              </Meta>
            )}

            {visaAnsvarig && u.assignee_id && <Meta>{namn[u.assignee_id] ?? "Okänd"}</Meta>}

            {/* Läget skrivs bara ut när det INTE är det självklara. "Ej
                påbörjad" på varje ny rad är brus; "Väntar på godkännande" är
                information. */}
            {u.lage !== "ej_paborjad" && u.lage !== "klar" && (
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-micro",
                  u.lage === "returnerad"
                    ? "bg-danger-tint text-danger-ink"
                    : u.lage === "granskas"
                      ? "bg-warn-tint text-warn-ink"
                      : u.lage === "pagar"
                        ? "bg-info-tint text-info-ink"
                        : "bg-canvas text-ink-500",
                )}
              >
                {LAGE_ETIKETT[u.lage]}
              </span>
            )}

            {visaPrioritet(u.priority) && !stangd && (
              <span className="sr-only">{PRIORITET_ETIKETT[u.priority]}</span>
            )}
          </div>

          {u.delar.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1 border-l border-canvas pl-3">
              {u.delar.map((d) => (
                <li key={d.id} className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className={cn(
                      "size-1.5 rounded-full",
                      arStangd(d.lage) ? "bg-ok" : "bg-ink-300",
                    )}
                  />
                  <span className={cn("text-small", arStangd(d.lage) ? "text-ink-300 line-through" : "text-ink-700")}>
                    {d.title}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {!stangd && !u.due_date && <Snabbplan id={u.id} idag={idag} />}

        <Link
          href={`/uppgifter/${u.id}`}
          aria-label={`Öppna ${u.title}`}
          className="mt-1 shrink-0 rounded-full p-2 text-ink-300 transition-colors duration-fast hover:text-brand-700"
        >
          <Ikon namn="tillbaka" className="size-4 rotate-180" />
        </Link>
      </div>
    </li>
  );
}

function Meta({ children }: { children: ReactNode }) {
  return <span className="text-small text-ink-500">{children}</span>;
}

/**
 * Bocken.
 *
 * EN CIRKEL OCH INTE EN KRYSSRUTA, och skillnaden är inte estetisk. Träffytan
 * är 44 px (AC-U5.5) medan ringen är 20 — en riktig `<input type=checkbox>`
 * hade behövt en osynlig utvidgning ändå, och på köpet gett två olika
 * fokusringar beroende på webbläsare.
 *
 * FINNS DET GRANSKARE BYTER KNAPPEN BETYDELSE. Servern avgör vad som faktiskt
 * händer (`bocka()` i actions.ts); här ändras bara ordet, så att den som
 * trycker vet att uppgiften går vidare till någon annan och inte blir klar.
 */
function Bock({ id, lage, granskare }: { id: string; lage: Lage; granskare: number }) {
  const [state, action, vantar] = useActionState<UppgiftState, FormData>(bocka, {});
  const klar = lage === "klar";
  const vantarPaGranskare = lage === "granskas";

  const etikett = klar
    ? "Klar"
    : vantarPaGranskare
      ? "Väntar på godkännande"
      : granskare > 0
        ? "Lämna in för godkännande"
        : "Markera som klar";

  return (
    <form action={action} className="shrink-0">
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        disabled={vantar || klar || vantarPaGranskare}
        aria-label={etikett}
        title={state.fel ?? etikett}
        className={cn(
          "flex size-11 -translate-x-2 items-center justify-center rounded-full transition-transform duration-fast",
          !klar && !vantarPaGranskare && "active:scale-90",
        )}
      >
        <span
          className={cn(
            "flex size-5 items-center justify-center rounded-full ring-2 transition-colors duration-fast",
            klar
              ? "bg-ok text-ink-inv ring-ok"
              : vantarPaGranskare
                ? "bg-warn-tint ring-warn"
                : "ring-ink-300 group-hover:ring-brand-600",
            state.fel && "ring-danger",
          )}
        >
          {klar && <Ikon namn="kontroll" className="size-3" />}
          {vantarPaGranskare && <span aria-hidden className="size-1.5 rounded-full bg-warn" />}
        </span>
      </button>
    </form>
  );
}

/**
 * "Idag" och "I morgon" direkt i listan.
 *
 * SYNS BARA PÅ RADER UTAN DATUM, och det är hela avsikten. En uppgift utan ett
 * NÄR blir gjord i ungefär hälften så många fall som en med — det är den enda
 * siffran i den här modulen som är hämtad ur forskning och inte ur tyckande
 * (Gollwitzer, d = 0,65). Knapparna är därför inte en bekvämlighet utan en
 * knuff: det ska vara mindre arbete att ge raden en dag än att låta bli.
 *
 * De ligger bakom `opacity-0 group-hover:opacity-100` på pekdon och står alltid
 * framme på pekskärm, där det inte finns något hovra.
 */
function Snabbplan({ id, idag }: { id: string; idag: string }) {
  const [, action, vantar] = useActionState<UppgiftState, FormData>(planera, {});

  const imorgon = new Date(Date.parse(`${idag}T12:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10);

  return (
    <form
      action={action}
      className="mt-0.5 flex shrink-0 gap-1 opacity-100 transition-opacity duration-fast md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
    >
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        name="due_date"
        value={idag}
        disabled={vantar}
        className="rounded-full px-2.5 py-1 text-micro text-ink-500 transition-colors duration-fast hover:bg-brand-100 hover:text-brand-700"
      >
        Idag
      </button>
      <button
        type="submit"
        name="due_date"
        value={imorgon}
        disabled={vantar}
        className="rounded-full px-2.5 py-1 text-micro text-ink-500 transition-colors duration-fast hover:bg-brand-100 hover:text-brand-700"
      >
        I morgon
      </button>
    </form>
  );
}
