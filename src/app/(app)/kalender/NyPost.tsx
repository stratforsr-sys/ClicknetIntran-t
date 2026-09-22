"use client";

import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { KONTROLL } from "@/components/ui/Field";
import { Notis } from "@/components/ui/Notis";
import { cn } from "@/components/ui/cn";
import {
  FRIA_TYPER,
  KVITTERARE_ETIKETT,
  TYP_ETIKETT,
  TYP_KRAVER_KALLA,
  UPPGIFTSTYPER,
  arSjalvsann,
  type Uppgiftstyp,
} from "@/lib/coachning";
import { PRIORITETER, PRIORITET_ETIKETT, veckodag } from "@/lib/uppgifter";
import {
  MONSTER,
  MONSTER_ETIKETT,
  VECKODAG_NAMN,
  monstertext,
  type Monster,
} from "@/lib/upprepning";
import type { Posttyp } from "@/lib/kalender";
import { skapaKalenderpost, type KalenderState } from "./actions";

/** Vad den källbundna typen kopplas till, i den form texten behöver det. */
const KALLA_ORD: Record<"course_id" | "module_id" | "document_id", string> = {
  course_id: "en kurs",
  module_id: "en rollspelsmodul",
  document_id: "ett dokument",
};

/**
 * "Uppgift, Manus och Medlyssning" — härledd ur FRIA_TYPER, aldrig handskriven.
 *
 * Egen ihopsättning och inte `Intl.ListFormat`, av samma skäl som i
 * NyUppgift.tsx: den senare faller tillbaka på engelskt "and" om bygget kör med
 * skalad ICU, och ett "and" mitt i en svensk mening är precis den sortens detalj
 * ingen upptäcker.
 */
const FRIA_ORD = (() => {
  const namn = FRIA_TYPER.map((t) => TYP_ETIKETT[t]);
  if (namn.length <= 1) return namn.join("");
  return `${namn.slice(0, -1).join(", ")} och ${namn[namn.length - 1]}`;
})();

/**
 * "Ny post" — kalenderns väg in till uppgifter och coachning.
 *
 * =============================================================================
 * VÄLJAREN STÅR ÖVERST, OCH DET ÄR INTE EN LAYOUTFRÅGA
 *
 * Vad posten ÄR avgör vilka fält som ska ritas: en coachningsuppgift bär en
 * person, en typ, ibland en kurs, en motpart och en kvitterare. Ett val som
 * kommer sist betyder att man fyllt i fel fält först och får börja om — och den
 * som gjort det en gång slutar använda formuläret.
 *
 * =============================================================================
 * COACHNINGSDELEN ÄR `NyUppgift.tsx`:S FORM, INTE EN ANDRA UPPLAGA
 *
 * Fälten, ordningen, hjälptexterna och när de växlar är hämtade därifrån med
 * flit. `TYP_KRAVER_KALLA` avgör vilket av kurs-, modul- och dokumentfältet som
 * ritas, `arSjalvsann()` låser kvitteraren, och båda reglerna läses ur
 * `lib/coachning.ts` — samma fil som `coachning::skapaUppgift` provar mot och
 * samma som check-villkoret i 0043 speglar. Skriver man om regeln på ett av
 * ställena faller de andra två med den, vilket är hela poängen.
 *
 * =============================================================================
 * EN COACHNINGSUPPGIFT LANDAR I DEN ANDRAS KALENDER, OCH DET STÅR UTSKRIVET
 *
 * Bara teamledare, säljchef och VD lägger upp coachningsuppgifter (beslut
 * 2026-09-01), och en teamledare lägger upp åt sitt eget folk — inte åt sig
 * själv. Följden är att valet "Coachningsuppgift" i min kalender skapar något i
 * NÅGON ANNANS dag, och det vore ett obehagligt litet svek att låta det ske
 * tyst. Därför står personväljaren först i den grenen och hjälptexten säger vad
 * som händer. Ledningen kan lägga upp åt sig själv, och står då i sin egen
 * lista — det följer av `can_read_all_employees()` och är inget undantag här.
 * =============================================================================
 */
export function NyPost({
  dag,
  tid,
  farCoacha,
  personer,
  kollegor,
  kurser,
  moduler,
  dokument,
  fokus,
  onKlar,
  onAvbryt,
}: {
  dag: string;
  /** Rutan som klickades, "14:30". Null = knappen, alltså hela dagen. */
  tid: string | null;
  farCoacha: boolean;
  /** De jag kan lägga en coachningsuppgift på. Speglar `arChefFor()`. */
  personer: { id: string; namn: string }[];
  kollegor: { id: string; namn: string }[];
  kurser: { id: string; title: string }[];
  moduler: { id: string; title: string }[];
  dokument: { id: string; title: string; doc_type: string }[];
  fokus: { id: string; label: string }[];
  onKlar: () => void;
  onAvbryt: () => void;
}) {
  const [state, action, vantar] = useActionState<KalenderState, FormData>(skapaKalenderpost, {});
  const [typ, setTyp] = useState<Posttyp>("uppgift");
  const [kind, setKind] = useState<Uppgiftstyp>("uppgift");

  /**
   * 0062. Upprepningen.
   *
   * ===========================================================================
   * DAGEN MAN KLICKADE PÅ ÄR FÖRVALD SOM VECKODAG, OCH DET ÄR BESTÄLLNINGEN
   *
   * Beställarens ord: *"om man kan välja en dag, så tex måndag, då upprepas ju
   * den varje måndag"*. Den som klickar i måndagens ruta och kryssar i
   * "Återkommer" ska alltså få en måndagsrutin utan att välja måndag en gång
   * till — dagen är redan vald, det var så formuläret öppnades.
   *
   * Tillståndet läses därför ur `dag` och inte ur ett tomt förval. Det är också
   * skälet att mönstret börjar på `veckovis` i stället för `dagligen`: det
   * senare hade varit det "enklaste" förvalet och hade tyst gjort en
   * måndagsplan till femtiosju uppgifter.
   * ===========================================================================
   */
  const [upprepas, setUpprepas] = useState(false);
  const [monster, setMonster] = useState<Monster>("veckovis");
  const [dagar, setDagar] = useState<number[]>(() => [veckodag(dag)]);
  const [slut, setSlut] = useState("");

  /**
   * DAGEN ÄR KONTROLLERAD SEDAN UPPREPNINGEN KOM IN.
   *
   * Fältet klarade sig med ett `defaultValue` så länge posten gällde en enda
   * dag — servern läste `due_date` ur formuläret och ingen annan text i rutan
   * påstod något om det. Nu skriver förhandsraden nedan ut vad regeln betyder,
   * och den måste utgå från den dag som FAKTISKT står i fältet. Läste den
   * `dag`-propen i stället skulle den som flyttat datumet en vecka fram få läsa
   * ett löfte om den gamla dagen och se en annan i kalendern.
   *
   * Veckodagskryssen följer INTE med när datumet ändras. De är ett eget val så
   * snart rutan är ikryssad, och att skriva om någons kryss för att hon rättade
   * ett datum är den sortens hjälpsamhet som tar bort det hon nyss valde.
   */
  const [dagVald, setDagVald] = useState(dag);

  useEffect(() => {
    if (state.ok) onKlar();
  }, [state.ok, onKlar]);

  const kravs = TYP_KRAVER_KALLA[kind];
  const sjalvsann = arSjalvsann(kind);
  const kanCoacha = farCoacha && personer.length > 0;

  return (
    <form action={action} className="flex flex-col gap-4 rounded-md bg-surface p-4 shadow-elev-2">
      {state.fel && <Notis ton="danger">{state.fel}</Notis>}

      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-h2 text-ink-900">Ny post</h3>
        <p className="tnum text-small text-ink-500">
          {dag}
          {tid ? ` · ${tid}` : " · hela dagen"}
        </p>
      </div>

      {/* Väljaren. Två knappar och inte en select: valet styr hela resten av
          formuläret, och en rullgardin gör en förgrening till en detalj. */}
      <input type="hidden" name="typ" value={typ} />
      {kanCoacha ? (
        <div role="group" aria-label="Vad posten blir" className="flex gap-1 rounded-full bg-canvas p-1">
          {(
            [
              ["uppgift", "Uppgift"],
              ["coachning", "Coachningsuppgift"],
            ] as const
          ).map(([v, etikett]) => (
            <button
              key={v}
              type="button"
              onClick={() => setTyp(v)}
              aria-pressed={typ === v}
              className={cn(
                "flex-1 rounded-full px-4 py-1.5 text-small transition-colors duration-fast",
                typ === v
                  ? "bg-surface font-semibold text-ink-900 shadow-elev-1"
                  : "text-ink-500 hover:text-ink-900",
              )}
            >
              {etikett}
            </button>
          ))}
        </div>
      ) : (
        /* Den som inte coachar någon får ingen väljare att fundera på. Raden
           finns ändå, så att posten går att läsa som "det här blir en uppgift". */
        <p className="text-small text-ink-500">Posten blir en uppgift i din egen lista.</p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {typ === "coachning" && (
          <label htmlFor="assignee_id" className="flex flex-col gap-1 sm:col-span-2">
            <span className="text-micro text-ink-500">Vem den gäller</span>
            <select id="assignee_id" name="assignee_id" required className={KONTROLL}>
              <option value="">Välj person</option>
              {personer.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.namn}
                </option>
              ))}
            </select>
            <span className="text-small text-ink-500">
              Uppgiften hamnar i hennes kalender och på hennes coachningskort, inte i din.
            </span>
          </label>
        )}

        <label htmlFor="title" className="flex flex-col gap-1 sm:col-span-2">
          <span className="text-micro text-ink-500">Rubrik</span>
          <input
            id="title"
            name="title"
            required
            autoFocus
            maxLength={200}
            placeholder={typ === "coachning" ? "Rollspel: invändningen om pris" : "Ring Nordic om avtalet"}
            className={KONTROLL}
          />
        </label>

        <label htmlFor="due_date" className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Dag</span>
          <input
            id="due_date"
            name="due_date"
            type="date"
            required
            value={dagVald}
            onChange={(e) => setDagVald(e.target.value)}
            className={KONTROLL}
          />
        </label>

        <label htmlFor="due_time" className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Klockslag</span>
          {/* Förifyllt ur rutan som klickades. Tomt betyder hela dagen — posten
              hamnar då i raden ovanför rutnätet och inte i det. */}
          <input
            id="due_time"
            name="due_time"
            type="time"
            step={1800}
            defaultValue={tid ?? ""}
            className={KONTROLL}
          />
          <span className="text-small text-ink-500">Lämna tomt för hela dagen.</span>
        </label>

        <label htmlFor="estimate_minutes" className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Tar (minuter)</span>
          <input
            id="estimate_minutes"
            name="estimate_minutes"
            type="number"
            min={1}
            max={1440}
            step={5}
            placeholder="30"
            className={KONTROLL}
          />
          {/* Talet är det som räknas in i "Planerat 4 h av 6 h". En gissning
              hade gjort summan till något annat än vad användaren skrivit, så
              fältet är tomt som förval och räknas som noll när det är tomt. */}
          <span className="text-small text-ink-500">Räknas in i dagens summa. Tomt räknas som noll.</span>
        </label>

        {typ === "uppgift" && (
          <label htmlFor="priority" className="flex flex-col gap-1">
            <span className="text-micro text-ink-500">Prioritet</span>
            <select id="priority" name="priority" defaultValue="3" className={KONTROLL}>
              {PRIORITETER.map((p) => (
                <option key={p} value={p}>
                  {PRIORITET_ETIKETT[p]}
                </option>
              ))}
            </select>
          </label>
        )}

        {typ === "coachning" && (
          <>
            <label htmlFor="kind" className="flex flex-col gap-1">
              <span className="text-micro text-ink-500">Vad det är</span>
              <select
                id="kind"
                name="kind"
                className={KONTROLL}
                value={kind}
                onChange={(e) => setKind(e.target.value as Uppgiftstyp)}
              >
                {UPPGIFTSTYPER.map((t) => (
                  <option key={t} value={t}>
                    {TYP_ETIKETT[t]}
                  </option>
                ))}
              </select>
              <span className="text-small text-ink-500">
                {kravs === null
                  ? "Står för sig själv — ingen kurs, modul eller dokument behövs."
                  : `Kopplas till ${KALLA_ORD[kravs]} som redan finns i navet. ${FRIA_ORD} står för sig själva.`}
              </span>
            </label>

            {kravs === "course_id" && (
              <label htmlFor="course_id" className="flex flex-col gap-1">
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
              <label htmlFor="module_id" className="flex flex-col gap-1">
                <span className="text-micro text-ink-500">Rollspelsmodul</span>
                <select id="module_id" name="module_id" required className={KONTROLL}>
                  <option value="">Välj modul</option>
                  {moduler.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.title}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {kravs === "document_id" && (
              <label htmlFor="document_id" className="flex flex-col gap-1">
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
                {(sjalvsann ? (["sjalv"] as const) : (["sjalv", "motpart", "skapare", "chef"] as const)).map(
                  (v) => (
                    <option key={v} value={v}>
                      {KVITTERARE_ETIKETT[v]}
                    </option>
                  ),
                )}
              </select>
              {sjalvsann && (
                <>
                  <span className="text-small text-ink-500">
                    Den här typen kvitteras inte för hand. Läget hämtas ur certifikatet, bedömningen eller
                    kvittensen.
                  </span>
                  {/* Ett avstängt fält skickar ingenting. Utan den här raden
                      hade `verify_by` saknats i posten, och 0043:s standardvärde
                      hade fått avgöra något användaren faktiskt såg. */}
                  <input type="hidden" name="verify_by" value="sjalv" />
                </>
              )}
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
          </>
        )}

        <label htmlFor="description_md" className="flex flex-col gap-1 sm:col-span-2">
          <span className="text-micro text-ink-500">Vad som ska göras</span>
          <textarea id="description_md" name="description_md" rows={2} className={KONTROLL} />
        </label>
      </div>

      {/* ---------------------------------------------------------------------
          Upprepningen.

          EN KRYSSRUTA SOM FÄLLER UT, och inte tre fält som alltid står där. De
          allra flesta poster är engångshändelser, och ett mönsterval som
          alltid syns är ett val man måste avfärda varje gång man skriver ner
          något litet. Det är precis den friktion `tolkaSnabbrad()` finns för
          att slippa.

          FÄLTEN RITAS INTE ALLS NÄR RUTAN ÄR OKRYSSAD, i stället för att gömmas
          med CSS. En dold kryssruta skickar ingenting i en `FormData` — men ett
          dolt `monster` med ett värde skickar sitt värde, och det hade betytt
          att en avbockad upprepning ändå bar en regel in i handlingen.
          --------------------------------------------------------------------- */}
      <fieldset className="flex flex-col gap-3 rounded-md bg-canvas p-3">
        <label className="inline-flex items-center gap-2 text-small text-ink-700">
          <input
            type="checkbox"
            name="upprepas"
            value="ja"
            checked={upprepas}
            onChange={(e) => setUpprepas(e.target.checked)}
            className="size-4 accent-brand-600"
          />
          <span className="font-semibold text-ink-900">Återkommer</span>
        </label>

        {!upprepas ? (
          <p className="text-small text-ink-500">Posten läggs upp en gång.</p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <label htmlFor="monster" className="flex flex-col gap-1">
                <span className="text-micro text-ink-500">Hur ofta</span>
                <select
                  id="monster"
                  name="monster"
                  className={KONTROLL}
                  value={monster}
                  onChange={(e) => setMonster(e.target.value as Monster)}
                >
                  {MONSTER.map((m) => (
                    <option key={m} value={m}>
                      {MONSTER_ETIKETT[m]}
                    </option>
                  ))}
                </select>
              </label>

              <label htmlFor="serie_ends_on" className="flex flex-col gap-1">
                <span className="text-micro text-ink-500">Slutar (valfritt)</span>
                <input
                  id="serie_ends_on"
                  name="serie_ends_on"
                  type="date"
                  min={dagVald}
                  value={slut}
                  onChange={(e) => setSlut(e.target.value)}
                  className={KONTROLL}
                />
                <span className="text-small text-ink-500">Tomt betyder att den löper vidare.</span>
              </label>
            </div>

            {monster === "veckovis" && (
              <fieldset className="flex flex-col gap-2">
                <legend className="text-micro text-ink-500">Vilka dagar</legend>
                <div className="flex flex-wrap gap-3">
                  {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                    <label key={d} className="inline-flex items-center gap-2 text-small text-ink-700">
                      <input
                        type="checkbox"
                        name="veckodag"
                        value={d}
                        checked={dagar.includes(d)}
                        onChange={(e) =>
                          setDagar((forra) =>
                            e.target.checked ? [...forra, d] : forra.filter((x) => x !== d),
                          )
                        }
                        className="size-4 accent-brand-600"
                      />
                      {VECKODAG_NAMN[d]}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}

            {/* Regeln utskriven, av samma funktion som servern sparar den med.
                Den som kryssar i tre rutor ska kunna läsa vad de tillsammans
                betyder INNAN hon trycker — åtta veckors uppgifter är en sak man
                vill ha rätt första gången. */}
            <p className="text-small text-ink-500">
              {monster === "veckovis" && dagar.length === 0
                ? "Kryssa i minst en veckodag."
                : `${monstertext({ monster, veckodagar: dagar, starts_on: dagVald, ends_on: slut || null })} från ${dagVald}${
                    slut ? ` till ${slut}` : ""
                  }. Åtta veckor läggs upp nu, resten fylls på efter hand.`}
            </p>
          </>
        )}
      </fieldset>

      {typ === "coachning" && fokus.length > 0 && (
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

      <div className="flex items-center gap-2">
        <Button type="submit" laddar={vantar} disabled={vantar}>
          {typ === "coachning" ? "Lägg upp coachningsuppgiften" : "Lägg upp uppgiften"}
        </Button>
        <Button type="button" variant="sekundar" onClick={onAvbryt} disabled={vantar}>
          Avbryt
        </Button>
      </div>
    </form>
  );
}
