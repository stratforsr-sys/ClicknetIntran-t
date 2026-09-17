"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Notis } from "@/components/ui/Notis";
import { Ikon } from "@/components/shell/Ikon";
import { lamnaQuiz, type KursState, type Quizresultat } from "../../../actions";

const TOM: KursState = {};

type Fraga = { id: string; prompt: string; alternativ: { id: string; label: string }[] };

/**
 * Alternativen kommer hit utan facit — `quiz_option` ar stangd for klienten och
 * lases av server actionen. Det finns alltsa inget ratt svar att hitta i
 * sidkallan, hur mycket man an letar.
 *
 * Efter inlamningen kommer ett `Quizresultat` tillbaka: antal ratt, och ett
 * ratt/fel per fraga. VILKET alternativ som var det ratta foljer med forst nar
 * provet ar klarat (`facitId`) — efter ett underkant forsok ar faltet null hela
 * vagen hit. Vyn kan darfor inte visa facit for tidigt aven om den ville.
 */
export function Quiz({
  kursId,
  modulId,
  fragor,
  nastaHref,
}: {
  kursId: string;
  modulId: string;
  fragor: Fraga[];
  nastaHref: string;
}) {
  const router = useRouter();
  const [state, skicka, vantar] = useActionState(lamnaQuiz, TOM);

  // Ett avfardat resultat ar det man tryckt "Gor om provet" pa. Nasta
  // inlamning ger ett NYTT objekt, som alltsa inte ar det avfardade — darav
  // jamforelsen pa identitet i stallet for ett flaggfalt som maste nollas.
  const [avfardat, setAvfardat] = useState<Quizresultat | null>(null);
  const [omgang, setOmgang] = useState(0);

  const resultat = state.resultat && state.resultat !== avfardat ? state.resultat : null;

  if (resultat) {
    return (
      <Resultat
        resultat={resultat}
        fragor={fragor}
        onFortsatt={() => router.push(nastaHref)}
        onGorOm={() => {
          setAvfardat(resultat);
          setOmgang((n) => n + 1);
        }}
      />
    );
  }

  return (
    <form key={omgang} action={skicka} className="flex flex-col gap-6">
      <input type="hidden" name="kurs_id" value={kursId} />
      <input type="hidden" name="modul_id" value={modulId} />

      {state.fel && !state.resultat && <Notis ton="danger">{state.fel}</Notis>}

      {fragor.map((f, i) => (
        <fieldset key={f.id} className="flex flex-col gap-2">
          <legend className="mb-2 text-body font-semibold text-ink-900">
            {i + 1}. {f.prompt}
          </legend>
          {f.alternativ.map((a) => (
            <label
              key={a.id}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-sm px-3 text-body text-ink-700 transition-colors duration-fast hover:bg-surface-alt has-checked:bg-brand-tint has-checked:text-brand-ink"
            >
              <input
                type="radio"
                name={`fraga_${f.id}`}
                value={a.id}
                required
                className="size-4 accent-brand-600"
              />
              <span>{a.label}</span>
            </label>
          ))}
        </fieldset>
      ))}

      <div>
        <Button type="submit" laddar={vantar}>
          Lämna in
        </Button>
      </div>
    </form>
  );
}

/**
 * Rattningen, fraga for fraga.
 *
 * Underkant visar VILKA fragor som blev fel och vad du svarade — inte vad som
 * var ratt. Det racker for att veta vad man ska lasa om, och det gor inte
 * omtaget till en avskrivning.
 */
function Resultat({
  resultat,
  fragor,
  onFortsatt,
  onGorOm,
}: {
  resultat: Quizresultat;
  fragor: Fraga[];
  onFortsatt: () => void;
  onGorOm: () => void;
}) {
  const perFraga = new Map(resultat.fragor.map((f) => [f.id, f]));
  const fel = resultat.antal - resultat.ratt;

  return (
    <div className="flex flex-col gap-5">
      <Notis ton={resultat.godkant ? "ok" : "danger"}>
        {resultat.ratt} av {resultat.antal} rätt — {resultat.poang} %.{" "}
        {resultat.godkant
          ? "Godkänt."
          : `Gränsen är ${resultat.grans} %. Läs igenom modulen ovanför en gång till och gör om provet.`}
      </Notis>

      {resultat.granskning && (
        <Notis ton="warn">
          Kursen är ett utkast, så provet rättades utan att sparas. Inget försök
          är bokfört och ingen certifiering delas ut förrän kursen är publicerad.
        </Notis>
      )}

      <div className="flex flex-col gap-4">
        {fragor.map((f, i) => {
          const svar = perFraga.get(f.id);
          if (!svar) return null;

          const valt = f.alternativ.find((a) => a.id === svar.valtId);
          const facit = svar.facitId ? f.alternativ.find((a) => a.id === svar.facitId) : null;

          return (
            <div key={f.id} className="flex gap-3">
              <span
                className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full ${
                  svar.ratt ? "bg-ok text-ink-inv" : "bg-danger text-ink-inv"
                }`}
                aria-hidden
              >
                <Ikon namn={svar.ratt ? "kontroll" : "kryss"} className="size-3.5" />
              </span>

              <div className="min-w-0 flex-1">
                <p className="text-body text-ink-900">
                  {i + 1}. {f.prompt}
                </p>
                <p className="mt-1 text-small text-ink-500">
                  <span className="sr-only">{svar.ratt ? "Rätt. " : "Fel. "}</span>
                  Du svarade: {valt?.label ?? "—"}
                </p>
                {!svar.ratt && facit && (
                  <p className="mt-1 text-small font-semibold text-ok-ink">
                    Rätt svar: {facit.label}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {!resultat.godkant && fel > 0 && (
        <p className="text-small text-ink-500">
          Rätt svar visas när du klarat provet. {fel === 1 ? "Frågan" : "De " + fel + " frågor"}{" "}
          som lyser rött är {fel === 1 ? "den" : "de"} du ska läsa om — svaren står i modulen.
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        {resultat.godkant ? (
          <Button onClick={onFortsatt}>Fortsätt</Button>
        ) : (
          <Button onClick={onGorOm}>Gör om provet</Button>
        )}
      </div>
    </div>
  );
}
