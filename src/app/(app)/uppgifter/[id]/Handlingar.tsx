"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/Button";
import { KONTROLL, Select } from "@/components/ui/Field";
import { Notis } from "@/components/ui/Notis";
import { MEDLEMSROLLER, ROLL_ETIKETT, ROLL_FORKLARING, type Lage } from "@/lib/uppgifter";
import {
  ateroppna,
  avbryt,
  bjudIn,
  bocka,
  godkann,
  koppla,
  paborja,
  returnera,
  skapaUppgift,
  type UppgiftState,
} from "../actions";

type Val = { id: string; namn: string };

/**
 * Knapparna på en uppgift.
 *
 * VILKA SOM SYNS AVGÖRS PÅ SERVERN. Komponenten får booleaner och ritar det den
 * blir tillsagd — samma uppdelning som coachningens `Handlingar`, och av samma
 * skäl: ett godkännande som bara doldes med CSS är inget godkännande.
 */
export function Handlingar({
  id,
  lage,
  granskare,
  kanArbeta,
  kanGranska,
  kanAvbryta,
  kanAteroppna,
}: {
  id: string;
  lage: Lage;
  granskare: number;
  kanArbeta: boolean;
  kanGranska: boolean;
  kanAvbryta: boolean;
  kanAteroppna: boolean;
}) {
  return (
    <div className="flex flex-col gap-5">
      {kanArbeta && lage === "ej_paborjad" && <Enkel id={id} action={paborja} etikett="Jag sätter igång" />}

      {/*
        BOCKFORMULÄRET STÅR BARA NÄR DET FINNS EN GRANSKARE.

        Utan granskare gör det exakt samma sak som ringen vid rubriken, och
        två knappar för samma handling på samma sida får folk att undra vad
        skillnaden är. Med granskare tillför det något ringen inte kan: ett
        meddelande till den som ska ta ställning.
      */}
      {kanArbeta && lage !== "granskas" && granskare > 0 && (
        <Bockformular id={id} granskare={granskare} returnerad={lage === "returnerad"} />
      )}

      {kanGranska && lage === "granskas" && <Granskning id={id} />}


      {kanAteroppna && <Enkel id={id} action={ateroppna} etikett="Öppna igen" variant="sekundar" />}

      {kanAvbryta && <Avbryt id={id} />}
    </div>
  );
}

function Enkel({
  id,
  action,
  etikett,
  variant = "primar",
}: {
  id: string;
  action: (prev: UppgiftState, form: FormData) => Promise<UppgiftState>;
  etikett: string;
  variant?: "primar" | "sekundar";
}) {
  const [state, kor, vantar] = useActionState<UppgiftState, FormData>(action, {});
  return (
    <form action={kor} className="flex flex-col gap-2">
      {state.fel && <Notis ton="danger">{state.fel}</Notis>}
      <input type="hidden" name="id" value={id} />
      <div>
        <Button type="submit" variant={variant} size="sm" laddar={vantar} disabled={vantar}>
          {etikett}
        </Button>
      </div>
    </form>
  );
}

/**
 * Bocken, med sina två utfall.
 *
 * TEXTEN SÄGER VAD SOM FAKTISKT HÄNDER. Finns en granskare heter knappen
 * "Lämna in för godkännande" och inte "Klar" — den som tror sig ha bockat av
 * något som i själva verket ligger och väntar hos någon annan slutar lita på
 * listan, och en lista man inte litar på är en lista man dubbelkollar i huvudet.
 */
function Bockformular({
  id,
  granskare,
  returnerad,
}: {
  id: string;
  granskare: number;
  returnerad: boolean;
}) {
  const [state, kor, vantar] = useActionState<UppgiftState, FormData>(bocka, {});

  return (
    <form action={kor} className="flex flex-col gap-2">
      {state.fel && <Notis ton="danger">{state.fel}</Notis>}
      {state.ok && <Notis ton="ok">{state.ok}</Notis>}
      <input type="hidden" name="id" value={id} />

      {granskare > 0 && (
        <label htmlFor="bocka-note" className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Kommentar till granskaren (valfri)</span>
          <textarea id="bocka-note" name="note" rows={2} className={KONTROLL} />
        </label>
      )}

      <div>
        <Button type="submit" size="sm" laddar={vantar} disabled={vantar}>
          {granskare > 0 ? "Lämna in för godkännande" : returnerad ? "Klar igen" : "Markera som klar"}
        </Button>
      </div>

      {granskare > 0 && (
        <p className="text-small text-ink-500">
          Uppgiften räknas som klar först när en granskare godkänt den.
        </p>
      )}
    </form>
  );
}

/**
 * Godkänn och returnera i SAMMA formulär.
 *
 * Två knappar, ett textfält, en behörighet. Att dela upp dem i två formulär
 * hade betytt två ställen att hålla kontrollen lika på — samma resonemang som
 * coachningens kvittering.
 *
 * SKÄLET ÄR OBLIGATORISKT VID RETUR och frivilligt vid godkännande. Fältet är
 * därför inte `required` i markeringen; det är server action och
 * `task_event_retur_kraver_skal` i 0054 som kräver det, och felet kommer
 * tillbaka i rutan ovanför.
 */
function Granskning({ id }: { id: string }) {
  const [godkantState, godkanna, godkannVantar] = useActionState<UppgiftState, FormData>(godkann, {});
  const [returState, skickaTillbaka, returVantar] = useActionState<UppgiftState, FormData>(returnera, {});
  const [skal, setSkal] = useState("");

  const vantar = godkannVantar || returVantar;

  return (
    <div className="flex flex-col gap-3">
      {godkantState.fel && <Notis ton="danger">{godkantState.fel}</Notis>}
      {returState.fel && <Notis ton="danger">{returState.fel}</Notis>}

      <label htmlFor="granska-note" className="flex flex-col gap-1">
        <span className="text-micro text-ink-500">Motivering — krävs om du skickar tillbaka</span>
        <textarea
          id="granska-note"
          rows={3}
          value={skal}
          onChange={(e) => setSkal(e.target.value)}
          className={KONTROLL}
        />
      </label>

      <div className="flex flex-wrap gap-2">
        <form action={godkanna}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="note" value={skal} />
          <Button type="submit" size="sm" laddar={godkannVantar} disabled={vantar}>
            Godkänn
          </Button>
        </form>

        <form action={skickaTillbaka}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="note" value={skal} />
          <Button
            type="submit"
            size="sm"
            variant="sekundar"
            laddar={returVantar}
            disabled={vantar || skal.trim() === ""}
          >
            Skicka tillbaka
          </Button>
        </form>
      </div>

      <p className="text-small text-ink-500">
        Räcker med en granskare. Godkänner du stängs uppgiften för alla.
      </p>
    </div>
  );
}

function Avbryt({ id }: { id: string }) {
  const [state, kor, vantar] = useActionState<UppgiftState, FormData>(avbryt, {});
  const [oppet, setOppet] = useState(false);

  if (!oppet) {
    return (
      <div className="border-t border-canvas pt-4">
        <Button type="button" variant="diskret" size="sm" onClick={() => setOppet(true)}>
          Ska inte göras
        </Button>
      </div>
    );
  }

  return (
    <form action={kor} className="flex flex-col gap-2 border-t border-canvas pt-4">
      {state.fel && <Notis ton="danger">{state.fel}</Notis>}
      <input type="hidden" name="id" value={id} />
      <label htmlFor="avbryt-note" className="flex flex-col gap-1">
        <span className="text-micro text-ink-500">Varför inte?</span>
        <textarea id="avbryt-note" name="note" rows={2} required className={KONTROLL} />
      </label>
      <div className="flex gap-2">
        <Button type="submit" variant="destruktiv" size="sm" laddar={vantar} disabled={vantar}>
          Avbryt uppgiften
        </Button>
        <Button type="button" variant="diskret" size="sm" onClick={() => setOppet(false)}>
          Nej, låt stå
        </Button>
      </div>
    </form>
  );
}

// -----------------------------------------------------------------------------

/**
 * Ny deluppgift.
 *
 * SAMMA `skapaUppgift` SOM SNABBRADEN, med `parent_id` med på köpet. Tolken
 * följer alltså med hit gratis: "ring leverantören imorgon 15 min" fungerar
 * likadant i en checklista som i huvudfältet, och det finns inget andra ställe
 * där en uppgift kan uppstå med andra regler.
 */
export function Deluppgift({ foralderId }: { foralderId: string }) {
  const [state, kor, vantar] = useActionState<UppgiftState, FormData>(skapaUppgift, {});

  return (
    <form action={kor} className="flex flex-col gap-2">
      {state.fel && <Notis ton="danger">{state.fel}</Notis>}
      <input type="hidden" name="parent_id" value={foralderId} />
      <div className="flex gap-2">
        <input
          name="rad"
          required
          autoComplete="off"
          placeholder="Lägg till ett steg…"
          aria-label="Ny deluppgift"
          className={KONTROLL}
        />
        <Button type="submit" variant="sekundar" size="sm" laddar={vantar} disabled={vantar}>
          Lägg till
        </Button>
      </div>
    </form>
  );
}

/**
 * Bjud in någon.
 *
 * Rollens innebörd står UNDER väljaren och inte i en hjälpikon. "Granskare"
 * betyder att uppgiften inte kan bli klar utan personen, och det är en följd
 * man ska se innan man väljer den — inte upptäcka när uppgiften fastnar.
 */
export function Inbjudan({
  id,
  personer,
  nuvarandeAnsvarig,
}: {
  id: string;
  personer: Val[];
  nuvarandeAnsvarig: string | null;
}) {
  const [state, kor, vantar] = useActionState<UppgiftState, FormData>(bjudIn, {});
  const [roll, setRoll] = useState<(typeof MEDLEMSROLLER)[number]>("visare");

  if (personer.length <= 1) {
    return (
      <p className="text-small text-ink-500">
        Du ser bara dig själv i personalregistret, så det finns ingen att bjuda in härifrån. Be din chef lägga
        dig i uppgiften i stället.
      </p>
    );
  }

  return (
    <form action={kor} className="flex flex-col gap-3 border-t border-canvas pt-4">
      {state.fel && <Notis ton="danger">{state.fel}</Notis>}
      {state.ok && <Notis ton="ok">{state.ok}</Notis>}
      <input type="hidden" name="id" value={id} />

      <label htmlFor="employee_id" className="flex flex-col gap-1">
        <span className="text-micro text-ink-500">Vem</span>
        <Select namn="employee_id" required defaultValue="">
          <option value="" disabled>
            Välj person
          </option>
          {personer
            .filter((p) => p.id !== nuvarandeAnsvarig)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.namn}
              </option>
            ))}
        </Select>
      </label>

      <label htmlFor="role" className="flex flex-col gap-1">
        <span className="text-micro text-ink-500">Som</span>
        <Select
          namn="role"
          value={roll}
          onChange={(e) => setRoll(e.target.value as (typeof MEDLEMSROLLER)[number])}
        >
          {MEDLEMSROLLER.map((r) => (
            <option key={r} value={r}>
              {ROLL_ETIKETT[r]}
            </option>
          ))}
        </Select>
      </label>

      <p className="text-small text-ink-500">{ROLL_FORKLARING[roll]}</p>

      <div>
        <Button type="submit" variant="sekundar" size="sm" laddar={vantar} disabled={vantar}>
          Bjud in
        </Button>
      </div>
    </form>
  );
}

/**
 * Koppla uppgiften till något navet redan känner till.
 *
 * FEM SLAG I VÄLJAREN, NIO I DATABASEN. Beställaren namngav kund, säljare,
 * ärende, coachning och utbildning; kolumnerna för rutin, kandidat, avtal och
 * samtal finns i `task_link` men har ingen väljare än. Det är inte en glömska
 * utan ordningsföljd — en väljare för något ingen bett om är en rullgardin till
 * att bläddra förbi.
 *
 * KUNDEN ÄR ORDERN. Navet har inget kundregister; se rubriken i 0054.
 */
export function Kopplingsformular({
  id,
  personer,
  order,
  arenden,
  kurser,
  coachning,
}: {
  id: string;
  personer: Val[];
  order: Val[];
  arenden: Val[];
  kurser: Val[];
  coachning: Val[];
}) {
  const [state, kor, vantar] = useActionState<UppgiftState, FormData>(koppla, {});
  const [slag, setSlag] = useState("order");

  const listor: Record<string, Val[]> = {
    order: order,
    person: personer,
    arende: arenden,
    kurs: kurser,
    coachning: coachning,
  };

  const ETIKETT: Record<string, string> = {
    order: "Order (kund)",
    person: "Person",
    arende: "Ärende",
    kurs: "Utbildning",
    coachning: "Coachningsuppgift",
  };

  const val = listor[slag] ?? [];

  return (
    <form action={kor} className="flex flex-col gap-3 border-t border-canvas pt-4">
      {state.fel && <Notis ton="danger">{state.fel}</Notis>}
      <input type="hidden" name="id" value={id} />

      <label htmlFor="slag" className="flex flex-col gap-1">
        <span className="text-micro text-ink-500">Vad</span>
        <Select namn="slag" value={slag} onChange={(e) => setSlag(e.target.value)}>
          {Object.keys(listor).map((s) => (
            <option key={s} value={s}>
              {ETIKETT[s]}
            </option>
          ))}
        </Select>
      </label>

      <label htmlFor="mal" className="flex flex-col gap-1">
        <span className="text-micro text-ink-500">Vilken</span>
        <Select namn="mal" required defaultValue="">
          <option value="" disabled>
            {val.length === 0 ? "Inget att välja" : "Välj"}
          </option>
          {val.map((v) => (
            <option key={v.id} value={v.id}>
              {v.namn}
            </option>
          ))}
        </Select>
      </label>

      {slag === "person" && (
        <label className="flex items-start gap-2">
          <input type="checkbox" name="visible_to_subject" value="ja" className="mt-1 size-4 accent-brand-600" />
          <span className="text-small text-ink-700">
            Låt personen se uppgiften
            <span className="block text-micro text-ink-500">
              Utan bock syns den inte för hen i navet. Den följer ändå med i hens registerutdrag — en
              anteckning om en anställd är en personuppgift även när den är dold.
            </span>
          </span>
        </label>
      )}

      <div>
        <Button type="submit" variant="sekundar" size="sm" laddar={vantar} disabled={vantar || val.length === 0}>
          Koppla
        </Button>
      </div>
    </form>
  );
}
