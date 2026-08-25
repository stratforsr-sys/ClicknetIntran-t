"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/Button";
import { KONTROLL } from "@/components/ui/Field";
import { Notis } from "@/components/ui/Notis";
import type { KvKriterium } from "@/lib/kv";
import type { Omradespoang } from "@/lib/kv-server";
import { sparaBedomning, type KvState } from "../actions";

/**
 * Bedomningsformularet.
 *
 * SUMMAN RAKNAS MEDAN MAN SKRIVER och stalls mot troskeln. Chefen ska se att
 * veckan hamnar under gransen INNAN hen sparar — inte upptacka det nasta manad
 * nar bonusen uteblev.
 *
 * Troskeln galler summan av VECKANS BADA samtal, sa raknaren visar det har
 * samtalets bidrag och vad som da behovs av det andra.
 */
export function Bedomning({
  callId,
  kriterier,
  befintliga,
  kommentar,
  troskel,
  andraSamtalet,
}: {
  callId: string;
  kriterier: KvKriterium[];
  befintliga: Omradespoang[];
  kommentar: string | null;
  troskel: number;
  /** Poangen pa veckans andra samtal, eller null nar det inte ar bedomt. */
  andraSamtalet: number | null;
}) {
  const [state, action, vantar] = useActionState<KvState, FormData>(sparaBedomning, {});

  const [poang, setPoang] = useState<Record<string, string>>(
    Object.fromEntries(
      kriterier.map((k) => [k.id, String(befintliga.find((b) => b.criterion_id === k.id)?.points ?? "")]),
    ),
  );

  const aktiva = kriterier.filter((k) => k.active);
  const varden = aktiva.map((k) => Number(String(poang[k.id] ?? "").replace(",", ".")));
  const summa = varden.reduce((s, v) => s + (Number.isFinite(v) ? v : 0), 0);
  const maxHar = aktiva.reduce((s, k) => s + (k.max_points ?? 0), 0);

  const veckansSumma = andraSamtalet === null ? null : summa + andraSamtalet;
  const behovs = Math.max(0, troskel - summa);

  return (
    <form action={action} className="flex flex-col gap-4">
      {state.fel && <Notis ton="danger">{state.fel}</Notis>}
      {state.ok && <Notis ton="ok">{state.ok}</Notis>}

      <input type="hidden" name="call_id" value={callId} />

      <Notis
        ton={
          veckansSumma === null ? "info" : veckansSumma >= troskel ? "ok" : "warn"
        }
      >
        <strong>
          {summa} av {maxHar} poäng
        </strong>{" "}
        på det här samtalet.{" "}
        {veckansSumma === null ? (
          <>
            Veckans andra samtal är inte bedömt än. Tillsammans behövs {troskel} poäng — alltså{" "}
            {behovs} till.
          </>
        ) : veckansSumma >= troskel ? (
          <>
            Veckan landar på {veckansSumma} poäng och är <strong>godkänd</strong>.
          </>
        ) : (
          <>
            Veckan landar på {veckansSumma} poäng och når <strong>inte</strong> tröskeln {troskel}.
          </>
        )}
      </Notis>

      <ul className="flex flex-col">
        {aktiva.map((k) => (
          <li key={k.id} className="flex flex-col gap-2 border-b border-canvas py-3 last:border-0">
            <div className="flex flex-wrap items-center gap-3">
              <span className="flex-1 text-body text-ink-900">{k.label}</span>
              <label className="flex items-center gap-2">
                <input
                  name={`points_${k.id}`}
                  required
                  inputMode="decimal"
                  value={poang[k.id] ?? ""}
                  onChange={(e) => setPoang((f) => ({ ...f, [k.id]: e.target.value }))}
                  aria-label={`Poäng för ${k.label}`}
                  className={`${KONTROLL} w-20`}
                />
                <span className="text-small text-ink-500">av {k.max_points}</span>
              </label>
            </div>
            <input
              name={`note_${k.id}`}
              defaultValue={befintliga.find((b) => b.criterion_id === k.id)?.note ?? ""}
              placeholder={`Kommentar om ${k.label.toLowerCase()} (frivilligt)`}
              aria-label={`Kommentar om ${k.label}`}
              className={KONTROLL}
            />
          </li>
        ))}
      </ul>

      <label htmlFor="comment" className="flex flex-col gap-1">
        <span className="text-micro text-ink-500">Helhetskommentar</span>
        <textarea
          id="comment"
          name="comment"
          rows={3}
          defaultValue={kommentar ?? ""}
          className={KONTROLL}
        />
        {/* Fraga 38: saljaren ser sin egen bedomning INKLUSIVE fritexten. Det ar
            hela poangen med ett utvecklingsprotokoll. */}
        <span className="text-micro text-ink-500">Säljaren läser det du skriver här.</span>
      </label>

      <div>
        <Button type="submit" laddar={vantar} disabled={vantar}>
          Spara bedömningen
        </Button>
      </div>
    </form>
  );
}
