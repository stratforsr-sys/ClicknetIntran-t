"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/Button";
import { KONTROLL } from "@/components/ui/Field";
import { Notis } from "@/components/ui/Notis";
import {
  FRIA_TYPER,
  KVITTERARE_ETIKETT,
  TYP_ETIKETT,
  TYP_KRAVER_KALLA,
  UPPGIFTSTYPER,
  arSjalvsann,
  type Uppgiftstyp,
} from "@/lib/coachning";
import { skapaUppgift, type CoachState } from "./actions";

/** Vad den kallbundna typen ska kopplas till, i den form texten behover det. */
const KALLA_ORD: Record<"course_id" | "module_id" | "document_id", string> = {
  course_id: "en kurs",
  module_id: "en rollspelsmodul",
  document_id: "ett dokument",
};

/**
 * "Uppgift, Manus och Medlyssning" — harledd ur FRIA_TYPER, aldrig handskriven.
 *
 * Egen ihopsattning och inte `Intl.ListFormat`: den senare faller tillbaka pa
 * engelskt "and" om bygget kor med skalad ICU, och en hjalptext som sager "and"
 * mitt i en svensk mening ar precis den sortens detalj ingen upptacker.
 */
const FRIA_ORD = (() => {
  const namn = FRIA_TYPER.map((t) => TYP_ETIKETT[t]);
  if (namn.length <= 1) return namn.join("");
  return `${namn.slice(0, -1).join(", ")} och ${namn[namn.length - 1]}`;
})();

/**
 * Formularet for en ny coachningsuppgift.
 *
 * TVA FALT AR HELA BESTALLNINGEN: motparten och kvitteraren. "Tilldela en
 * teamledare, eller att saljaren sjalv gor det, eller med den som satt upp
 * tasken" beskriver inte tre uppgiftstyper — det beskriver vem som ar MED, och
 * vem som satter bocken. Darfor tva separata val och inte en enda lista.
 *
 * FALTEN VAXLAR MED TYPEN. En kurs behover en kurs, ett rollspel en modul med
 * en rubrik, en lasning ett dokument. Att visa alla tre samtidigt hade bett den
 * som lagger upp uppgiften att fylla i tva falt som inte anvands.
 */
export function NyUppgift({
  assigneeId,
  kollegor,
  kurser,
  moduler,
  dokument,
  fokus,
}: {
  assigneeId: string;
  kollegor: { id: string; namn: string }[];
  kurser: { id: string; title: string }[];
  moduler: { id: string; title: string }[];
  dokument: { id: string; title: string; doc_type: string }[];
  fokus: { id: string; label: string }[];
}) {
  const [state, action, vantar] = useActionState<CoachState, FormData>(skapaUppgift, {});
  const [typ, setTyp] = useState<Uppgiftstyp>("uppgift");

  const kravs = TYP_KRAVER_KALLA[typ];
  const sjalvsann = arSjalvsann(typ);

  return (
    <form action={action} className="flex flex-col gap-4">
      {state.fel && <Notis ton="danger">{state.fel}</Notis>}
      {state.ok && <Notis ton="ok">{state.ok}</Notis>}

      <input type="hidden" name="assignee_id" value={assigneeId} />

      <div className="grid gap-3 sm:grid-cols-2">
        <label htmlFor="title" className="flex flex-col gap-1 sm:col-span-2">
          <span className="text-micro text-ink-500">Rubrik</span>
          <input id="title" name="title" required placeholder="Memorera öppningen i manuset" className={KONTROLL} />
        </label>

        <label htmlFor="kind" className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Vad det är</span>
          <select
            id="kind"
            name="kind"
            className={KONTROLL}
            value={typ}
            onChange={(e) => setTyp(e.target.value as Uppgiftstyp)}
          >
            {UPPGIFTSTYPER.map((t) => (
              <option key={t} value={t}>
                {TYP_ETIKETT[t]}
              </option>
            ))}
          </select>
          {/* Typvalet ar det som drar in kurs-, modul- eller dokumentfaltet, och
              utan den har raden ser det ut som om VARJE coachningsuppgift kraver
              en kurs. De fria typerna namns dar de behovs: nar man star pa en
              kallbunden typ och undrar hur man slipper den. */}
          <span className="text-small text-ink-500">
            {kravs === null
              ? "Står för sig själv — ingen kurs, modul eller dokument behövs."
              : `Kopplas till ${KALLA_ORD[kravs]} som redan finns i navet. ${FRIA_ORD} står för sig själva.`}
          </span>
        </label>

        <label htmlFor="due_date" className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Klar senast</span>
          <input id="due_date" name="due_date" type="date" className={KONTROLL} />
        </label>

        {kravs === "course_id" && (
          <label htmlFor="course_id" className="flex flex-col gap-1 sm:col-span-2">
            <span className="text-micro text-ink-500">Kurs</span>
            <select id="course_id" name="course_id" required className={KONTROLL}>
              <option value="">Välj kurs</option>
              {kurser.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.title}
                </option>
              ))}
            </select>
          </label>
        )}

        {kravs === "module_id" && (
          <label htmlFor="module_id" className="flex flex-col gap-1 sm:col-span-2">
            <span className="text-micro text-ink-500">Rollspelsmodul</span>
            <select id="module_id" name="module_id" required className={KONTROLL}>
              <option value="">Välj modul</option>
              {moduler.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title}
                </option>
              ))}
            </select>
            {/* Rubriken hor till modulen (0024) och ar det som bedoms. Den syns
                for den som ska gora rollspelet innan hon borjar. */}
            <span className="text-small text-ink-500">
              Kriterierna på modulen är det som bedöms, och de syns för personen innan hon börjar.
            </span>
          </label>
        )}

        {kravs === "document_id" && (
          <label htmlFor="document_id" className="flex flex-col gap-1 sm:col-span-2">
            <span className="text-micro text-ink-500">Dokument</span>
            <select id="document_id" name="document_id" required className={KONTROLL}>
              <option value="">Välj dokument</option>
              {dokument.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                  {d.doc_type === "script" ? " (manus)" : ""}
                </option>
              ))}
            </select>
          </label>
        )}

        <label htmlFor="partner_id" className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Motpart</span>
          <select id="partner_id" name="partner_id" className={KONTROLL}>
            <option value="">På egen hand</option>
            {kollegor.map((k) => (
              <option key={k.id} value={k.id}>
                {k.namn}
              </option>
            ))}
          </select>
        </label>

        <label htmlFor="verify_by" className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Vem kvitterar</span>
          <select id="verify_by" name="verify_by" className={KONTROLL} disabled={sjalvsann}>
            {(sjalvsann ? (["sjalv"] as const) : (["sjalv", "motpart", "skapare", "chef"] as const)).map((v) => (
              <option key={v} value={v}>
                {KVITTERARE_ETIKETT[v]}
              </option>
            ))}
          </select>
          {sjalvsann && (
            <span className="text-small text-ink-500">
              {/* Ingen bock finns att satta. Laget hamtas ur certifikatet,
                  bedomningen eller kvittensen — se 0043. */}
              Den här typen kvitteras inte för hand. Läget hämtas ur certifikatet, bedömningen eller kvittensen.
            </span>
          )}
          {sjalvsann && <input type="hidden" name="verify_by" value="sjalv" />}
        </label>

        {!sjalvsann && (
          <label htmlFor="evidence" className="flex flex-col gap-1">
            <span className="text-micro text-ink-500">Kräver</span>
            <select id="evidence" name="evidence" className={KONTROLL}>
              <option value="ingen">Bara en bock</option>
              <option value="kommentar">En kommentar</option>
            </select>
          </label>
        )}

        <label htmlFor="description_md" className="flex flex-col gap-1 sm:col-span-2">
          <span className="text-micro text-ink-500">Vad som ska göras</span>
          <textarea id="description_md" name="description_md" rows={3} className={KONTROLL} />
        </label>
      </div>

      {fokus.length > 0 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="text-micro text-ink-500">Tränar på</legend>
          <div className="flex flex-wrap gap-3">
            {fokus.map((f) => (
              <label key={f.id} className="inline-flex items-center gap-2 text-small text-ink-700">
                <input type="checkbox" name="focus_id" value={f.id} className="size-4 accent-brand-600" />
                {f.label}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <div>
        <Button type="submit" laddar={vantar} disabled={vantar}>
          Lägg upp uppgiften
        </Button>
      </div>
    </form>
  );
}
