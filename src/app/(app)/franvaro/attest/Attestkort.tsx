"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { KONTROLL } from "@/components/ui/Field";
import { Notis } from "@/components/ui/Notis";
import { beslutaAnsokan, type FranvaroState } from "../actions";

export type Attestvy = {
  id: string;
  namn: string;
  typ: string;
  period: string;
  omfattning: string;
  start: string;
  brådskar: boolean;
  skal: string | null;
  brott: string[];
  bemanning: { text: string; over: boolean } | null;
  saldo: string | null;
};

/**
 * ============================================================================
 * EN ANSÖKAN, MED ALLT SOM BEHÖVS FÖR ATT SÄGA JA ELLER NEJ — OCH KNAPPARNA.
 *
 * Kön hade före 2026-09-07 en rad per ansökan: namn, typ, period och en siffra
 * som sa "2 regelbrott". Allt annat låg bakom en klickning, och beslutet låg
 * bakom klickningen efter den. Beställarens invändning var att kön därför inte
 * gick att arbeta i — man klickade in, tillbaka, in igen, och tappade bort
 * vilken av dem man redan tittat på.
 *
 * DÄRFÖR STÅR UNDERLAGET UTSKRIVET OCH BESLUTET I SAMMA KORT. Skälet, vilka
 * regler som bröts i klartext, hur många andra som är borta samma dagar, och
 * saldot om typen har ett. Detaljsidan finns kvar för historiken; den behövs
 * inte längre för att fatta beslutet.
 *
 * MOTIVERINGEN KRÄVS PÅ EXAKT SAMMA VILLKOR SOM FÖRUT — avslag alltid,
 * godkännande när en regel bröts (AC-3.12, AC-3.13). Villkoret står också i
 * `beslutaAnsokan` och i databasen; det här är det tredje bältet och inte det
 * enda. Fältet öppnas av sig självt när det krävs, för en textruta som redan
 * står öppen läses som frivillig.
 * ============================================================================
 */
export function Attestkort({ post }: { post: Attestvy }) {
  const [state, action, vantar] = useActionState<FranvaroState, FormData>(beslutaAnsokan, {});
  const [beslut, setBeslut] = useState<"" | "godkann" | "avsla">("");

  const kraverMotivering = beslut === "avsla" || (beslut === "godkann" && post.brott.length > 0);

  // Ett fattat beslut lämnar kortet på plats men tomt på knappar. Att låta det
  // försvinna hade flyttat allt under det uppåt mitt under läsningen.
  if (state.ok) {
    return (
      <li className="border-b border-canvas py-4 last:border-0">
        <p className="text-body text-ink-900">
          {post.namn} · {post.typ}
        </p>
        <p className="text-small text-ink-500">{post.period}</p>
        <div className="mt-2">
          <Notis ton="ok">{state.ok}</Notis>
        </div>
      </li>
    );
  }

  return (
    <li className="border-b border-canvas py-4 last:border-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-h2 text-ink-900">{post.namn}</p>
          <p className="text-small text-ink-500">
            {post.typ} · {post.period} · {post.omfattning}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {post.brott.length > 0 && (
            <Badge ton="warn">
              {post.brott.length === 1 ? "1 regelbrott" : `${post.brott.length} regelbrott`}
            </Badge>
          )}
          <Badge ton={post.brådskar ? "danger" : "neutral"}>{post.start}</Badge>
        </div>
      </div>

      {/* Skälet i citatform och inte som ännu en etikett-och-värde-rad. Det är
          det enda på kortet som är skrivet av en människa till en annan. */}
      <blockquote className="mt-3 border-l-2 border-brand-500 pl-3">
        {post.skal ? (
          <p className="whitespace-pre-line text-body text-ink-900">{post.skal}</p>
        ) : (
          <p className="text-body text-ink-500">
            Inskickad innan navet frågade efter ett skäl.
          </p>
        )}
      </blockquote>

      <dl className="mt-3 flex flex-col gap-2 text-small">
        {post.bemanning && (
          <div className="flex gap-2">
            <dt className="shrink-0 text-ink-500">Bemanning</dt>
            <dd className={post.bemanning.over ? "font-semibold text-warn-ink" : "text-ink-900"}>
              {post.bemanning.text}
            </dd>
          </div>
        )}
        {post.saldo && (
          <div className="flex gap-2">
            <dt className="shrink-0 text-ink-500">Saldo</dt>
            <dd className="text-ink-900">{post.saldo}</dd>
          </div>
        )}
      </dl>

      {post.brott.length > 0 && (
        <div className="mt-3">
          <Notis ton="warn">
            <span className="block font-semibold">Ansökan bryter mot följande:</span>
            <ul className="mt-1 list-disc pl-5">
              {post.brott.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </Notis>
        </div>
      )}

      <form action={action} className="mt-4 flex flex-col gap-3">
        {state.fel && <Notis ton="danger">{state.fel}</Notis>}

        <input type="hidden" name="id" value={post.id} />
        <input type="hidden" name="beslut" value={beslut} />

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant={beslut === "godkann" ? "primar" : "sekundar"}
            onClick={() => setBeslut("godkann")}
          >
            Godkänn
          </Button>
          <Button
            type="button"
            size="sm"
            variant={beslut === "avsla" ? "destruktiv" : "sekundar"}
            onClick={() => setBeslut("avsla")}
          >
            Avslå
          </Button>
          <Link
            href={`/franvaro/${post.id}`}
            className="ml-1 text-small font-semibold text-ink-500 hover:text-ink-900"
          >
            Öppna ansökan
          </Link>
        </div>

        {beslut !== "" && (
          <>
            <label htmlFor={`motivering-${post.id}`} className="flex flex-col gap-1.5">
              <span className="text-small font-semibold text-ink-700">
                {beslut === "avsla"
                  ? "Varför avslås ansökan?"
                  : post.brott.length > 0
                    ? "Varför godkänns den trots reglerna?"
                    : "Vill du skriva något till beslutet? (frivilligt)"}
              </span>
              {/* Rakt <textarea> och inte <Field>: kön visar flera kort på samma
                  sida, och `Field` sätter id ur `namn` — då hade alla motiveringar
                  delat id. Samma undantag som `Chefshandlingar` gör. */}
              <textarea
                id={`motivering-${post.id}`}
                name="motivering"
                rows={2}
                required={kraverMotivering}
                className={KONTROLL}
                placeholder={
                  beslut === "avsla"
                    ? "Till exempel: tre i teamet är redan lediga den veckan."
                    : "Till exempel: bemanningen löses med vikarie."
                }
              />
              <span className="text-small text-ink-500">
                {kraverMotivering
                  ? "Den anställda ser texten. Skriv om beslutet och reglerna — aldrig om någons hälsa eller privatliv."
                  : "Ansökan följer reglerna, så motivering krävs inte."}
              </span>
            </label>

            <div>
              <Button
                type="submit"
                size="sm"
                laddar={vantar}
                variant={beslut === "avsla" ? "destruktiv" : "primar"}
              >
                {beslut === "avsla" ? "Avslå ansökan" : "Godkänn ledigheten"}
              </Button>
            </div>
          </>
        )}
      </form>
    </li>
  );
}
