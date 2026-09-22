"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/Button";
import { KONTROLL } from "@/components/ui/Field";
import { Ikon } from "@/components/shell/Ikon";
import { Notis } from "@/components/ui/Notis";
import { PRIORITET_ETIKETT, tidstext } from "@/lib/uppgifter";
import { dagKort } from "@/lib/kalender";
import { forhandsbild, mallsammanfattning, momentdatum, type Mallmoment } from "@/lib/mallar";
import { Arkivknapp, Mallformular } from "./Mallformular";
import { anvandUppgiftsmall, type MallState } from "./actions";

export type Mallkort = {
  id: string;
  name: string;
  description_md: string;
  shared: boolean;
  arkiverad: boolean;
  minEgen: boolean;
  moment: Mallmoment[];
};

export type Person = { id: string; namn: string };
export type Projekt = { id: string; name: string };

type Oppen = { id: string; lage: "anvand" | "andra" } | null;

/**
 * Mallarna.
 *
 * ===========================================================================
 * MALLEN MAN LÄSER ÄR MALLEN MAN ANVÄNDER
 *
 * Första utkastet hade ett eget kort överst — "Använd en mall" — med en
 * rullgardin, ett startdatum, en ansvarig och en förhandsbild, och DÄRUNDER en
 * lista med samma mallar en gång till. Två fel i ett:
 *
 *   1. MAN VALDE MALL PÅ NAMNET. Innehållet stod i listan längre ner, alltså
 *      på ett annat ställe än valet. Den som har fyra mallar och inte minns
 *      vilken som är vilken fick scrolla, läsa, scrolla tillbaka och välja i en
 *      rullgardin — och hoppas att det var samma rad.
 *
 *   2. MOMENTEN RITADES TVÅ GÅNGER, i två olika format, av två komponenter.
 *      Den sortens dubblering glider isär vid första ändringen.
 *
 * Nu är listan hela gränssnittet. Varje mall visar sina moment, och "Använd"
 * fäller ut startdagen under just den mallen. **Samma tidslinje man just läste
 * byter då ut "dag 3" mot "fre 26 sep"** — förhandsbilden är alltså inte en
 * andra vy utan samma vy, upplyst. Det är den enda platsen där en mall med ett
 * moment på dag 365 avslöjar sig innan den lägger ett årsgammalt datum i någons
 * lista.
 *
 * ETT ÖPPET FÖNSTER I TAGET. Tillståndet ligger här och inte i varje kort, för
 * annars kan tre paneler stå öppna med tre olika startdagar och det är inte
 * längre uppenbart vilken knapp som gör vad.
 * ===========================================================================
 */
export function Mallista({
  mallar,
  arkiverade,
  personer,
  projekt,
  mig,
  idag,
}: {
  mallar: Mallkort[];
  arkiverade: Mallkort[];
  personer: Person[];
  projekt: Projekt[];
  mig: string;
  idag: string;
}) {
  const [oppen, setOppen] = useState<Oppen>(null);
  const [nyOppen, setNyOppen] = useState(false);

  const vaxla = (id: string, lage: "anvand" | "andra") =>
    setOppen((f) => (f?.id === id && f.lage === lage ? null : { id, lage }));

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-h2 text-ink-900">
          {mallar.length === 0 ? "Inga mallar än" : `${mallar.length} ${mallar.length === 1 ? "mall" : "mallar"}`}
        </h2>
        <Button
          variant={mallar.length === 0 ? "primar" : "sekundar"}
          size="sm"
          onClick={() => setNyOppen((v) => !v)}
        >
          <Ikon namn={nyOppen ? "kryss" : "plus"} className="size-4" />
          {nyOppen ? "Stäng" : "Ny mall"}
        </Button>
      </div>

      {nyOppen && (
        <div className="rounded-md bg-surface p-4 shadow-elev-1 md:p-6">
          <Mallformular onKlar={() => setNyOppen(false)} />
        </div>
      )}

      {mallar.length === 0 && !nyOppen && (
        <div className="rounded-md bg-surface p-6 shadow-elev-1">
          <p className="max-w-prose text-body text-ink-700">
            En mall är värd att skriva <span className="font-semibold">andra gången</span> du gör samma sak.
            Uppstart av en ny kund, en reklamation, en månadsavstämning — allt som har fler än tre steg och
            återkommer.
          </p>
          <p className="mt-2 max-w-prose text-small text-ink-500">
            Du skriver den som text, ett moment per rad, och ser raderna tolkas medan du skriver.
          </p>
        </div>
      )}

      {mallar.map((m) => (
        <Mallrad
          key={m.id}
          mall={m}
          oppen={oppen?.id === m.id ? oppen.lage : null}
          vaxla={vaxla}
          personer={personer}
          projekt={projekt}
          mig={mig}
          idag={idag}
        />
      ))}

      {arkiverade.length > 0 && (
        <section className="flex flex-col gap-3 pt-2">
          <div>
            <h2 className="text-h2 text-ink-900">Arkiverade</h2>
            <p className="max-w-prose text-small text-ink-500">
              Bara du ser dina arkiverade mallar. De går inte att använda förrän de tagits fram igen — men
              uppgifterna de redan skapat vet fortfarande varifrån de kom.
            </p>
          </div>
          {arkiverade.map((m) => (
            <Mallrad
              key={m.id}
              mall={m}
              oppen={oppen?.id === m.id ? oppen.lage : null}
              vaxla={vaxla}
              personer={personer}
              projekt={projekt}
              mig={mig}
              idag={idag}
            />
          ))}
        </section>
      )}
    </div>
  );
}

function Mallrad({
  mall,
  oppen,
  vaxla,
  personer,
  projekt,
  mig,
  idag,
}: {
  mall: Mallkort;
  oppen: "anvand" | "andra" | null;
  vaxla: (id: string, lage: "anvand" | "andra") => void;
  personer: Person[];
  projekt: Projekt[];
  mig: string;
  idag: string;
}) {
  const [start, setStart] = useState(idag);
  const tom = mall.moment.length === 0;

  return (
    <article
      className={
        "flex flex-col gap-4 rounded-md bg-surface p-4 shadow-elev-1 md:p-6 " +
        (mall.arkiverad ? "opacity-70" : "")
      }
    >
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-h2 text-ink-900">{mall.name}</h3>
            {!mall.shared && (
              <span className="rounded-full bg-canvas px-2.5 py-0.5 text-micro text-ink-500">Bara du</span>
            )}
          </div>
          <p className="text-small text-ink-500">{mallsammanfattning(mall.moment)}</p>
          {mall.description_md && <p className="mt-1 max-w-prose text-small text-ink-700">{mall.description_md}</p>}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {mall.minEgen && (
            <button
              type="button"
              onClick={() => vaxla(mall.id, "andra")}
              aria-expanded={oppen === "andra"}
              className="rounded-full px-3 py-1.5 text-small text-ink-500 transition-colors duration-fast hover:bg-surface-alt hover:text-ink-900"
            >
              {oppen === "andra" ? "Stäng" : "Ändra"}
            </button>
          )}
          {!mall.arkiverad && !tom && (
            <Button
              variant={oppen === "anvand" ? "sekundar" : "primar"}
              size="sm"
              onClick={() => vaxla(mall.id, "anvand")}
              aria-expanded={oppen === "anvand"}
            >
              {oppen === "anvand" ? "Stäng" : "Använd"}
            </Button>
          )}
        </div>
      </header>

      {tom ? (
        <p className="rounded-sm bg-danger-tint px-4 py-3 text-small text-danger-ink">
          Mallen har inga moment och går inte att använda.
        </p>
      ) : (
        <Tidslinje moment={mall.moment} start={oppen === "anvand" ? start : null} />
      )}

      {oppen === "anvand" && (
        <Anvandpanel
          mall={mall}
          personer={personer}
          projekt={projekt}
          mig={mig}
          start={start}
          setStart={setStart}
        />
      )}

      {oppen === "andra" && (
        <div className="flex flex-col gap-4 border-t border-canvas pt-4">
          <Mallformular
            mall={{
              id: mall.id,
              name: mall.name,
              description_md: mall.description_md,
              shared: mall.shared,
              moment: mall.moment,
            }}
            onKlar={() => vaxla(mall.id, "andra")}
          />
          <div className="flex items-center justify-between gap-3 border-t border-canvas pt-3">
            <p className="text-micro text-ink-500">
              Ändringen gäller nästa gång mallen används. Uppgifter den redan skapat rörs inte.
            </p>
            <Arkivknapp id={mall.id} arkiverad={mall.arkiverad} />
          </div>
        </div>
      )}
    </article>
  );
}

/**
 * Momenten som tidslinje.
 *
 * `start` NULL = mallen läses, och första kolumnen säger "dag 3".
 * `start` satt = mallen ska användas, och samma kolumn säger "fre 26 sep".
 *
 * ETT ENDA STÄLLE RITAR MOMENT i hela modulen, och det är hela poängen med att
 * skicka in `start` i stället för att ha två komponenter. Den dag någon lägger
 * till en kolumn hamnar den på båda ställena, eftersom det bara finns ett.
 */
function Tidslinje({ moment, start }: { moment: Mallmoment[]; start: string | null }) {
  return (
    <ol className="flex flex-col">
      {moment.map((m, i) => (
        <li
          key={m.sort}
          className={
            "flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1.5 " +
            (i > 0 ? "border-t border-canvas" : "")
          }
        >
          <span
            className={
              "tnum w-24 shrink-0 text-small " + (start ? "font-semibold text-brand-700" : "text-ink-500")
            }
          >
            {start ? dagKort(momentdatum(start, m)) : `dag ${m.offset_days}`}
          </span>
          <span className="min-w-0 flex-1 text-body text-ink-900">{m.title}</span>
          <span className="tnum shrink-0 text-micro text-ink-500">
            {[m.due_time, tidstext(m.estimate_minutes), m.priority === 3 ? null : PRIORITET_ETIKETT[m.priority]]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Panelen som tillämpar mallen.
 *
 * TRE FÄLT OCH ETT KVITTO. Startdagen är det enda som verkligen kräver ett
 * beslut — ansvarig är jag och projekt är inget, tills något annat sägs — så
 * den står först och är förifylld med i dag.
 */
function Anvandpanel({
  mall,
  personer,
  projekt,
  mig,
  start,
  setStart,
}: {
  mall: Mallkort;
  personer: Person[];
  projekt: Projekt[];
  mig: string;
  start: string;
  setStart: (d: string) => void;
}) {
  const [state, action, vantar] = useActionState<MallState, FormData>(anvandUppgiftsmall, {});
  const bild = forhandsbild(mall.moment, start);

  return (
    <form action={action} className="flex flex-col gap-4 border-t border-canvas pt-4">
      {state.fel && <Notis ton="danger">{state.fel}</Notis>}
      {state.ok && <Notis ton="ok">{state.ok}</Notis>}

      <input type="hidden" name="template_id" value={mall.id} />

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Startdag</span>
          <input
            type="date"
            name="start_date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            required
            className={KONTROLL}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Ansvarig</span>
          <select name="assignee_id" defaultValue={mig} className={`${KONTROLL} appearance-none pr-10`}>
            {personer.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id === mig ? `${p.namn} (jag)` : p.namn}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Projekt</span>
          <select name="project_id" defaultValue="" className={`${KONTROLL} appearance-none pr-10`}>
            <option value="">— inget —</option>
            {projekt.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-small text-ink-700">
          {bild ? (
            <>
              <span className="font-semibold">
                {bild.antal} {bild.antal === 1 ? "uppgift" : "uppgifter"}
              </span>{" "}
              skapas, {dagKort(bild.forsta)} – {dagKort(bild.sista)}. Datumen står i listan ovanför.
            </>
          ) : (
            "Mallen har inga moment."
          )}
        </p>
        <Button type="submit" laddar={vantar} disabled={vantar || !bild}>
          Skapa uppgifterna
        </Button>
      </div>
    </form>
  );
}
