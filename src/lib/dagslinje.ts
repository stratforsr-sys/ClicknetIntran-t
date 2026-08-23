/**
 * E5.4: dagens tidslinje pa startsidan. Ren logik, inga anrop.
 *
 * Vad den ar till for: den som stamplat in vill veta tre saker utan att oppna
 * en vy — ar jag inne, hur lange har jag varit det, och nar gar jag hem. Fram
 * till nu har startsidan svarat pa den forsta och gett en summa i text. Linjen
 * ger den tredje, och den ar den enda av de tre som inte gick att fa nagonstans
 * i navet.
 *
 * ===========================================================================
 * LINJEN AR EN AVBILDNING, INTE EN BEDOMNING.
 *
 * Den ritar vad som stamplats. Den sager ingenting om huruvida det var ratt:
 * ingen sen ankomst, ingen rastavvikelse, ingen fargning av det som avviker
 * fran schemat. Bedomningen bor i avvikelsemotorn (`raster.ts`), som har
 * toleranser, kvittenskrav och en logg over varje chefsoppning omkring sig.
 *
 * Skalet ar K19 och AC-2.29. En linje som blir rod nar rasten drog over ar en
 * bedomning utan de skyddsatgarderna — och den skulle dessutom sta pa
 * startsidan, alltsa framfor nasan pa den som just kom tillbaka fran lunch.
 * ===========================================================================
 */

import { svenskaMinuter } from "./klocka.ts";
import { gallande, type Handelse } from "./tid.ts";

/** Minuter sedan svensk midnatt. Hela dygnet ar 1440. */
export const DYGNET = 24 * 60;

export type Segment = {
  typ: "arbete" | "rast";
  /** Minuter sedan midnatt. */
  fran: number;
  till: number;
  /** Sant nar segmentet inte har nagot slut an — det pagar just nu. */
  oppen: boolean;
};

/**
 * Dagens stamplingar som segment.
 *
 * Ett oppet segment ritas fram till `nu`. Renderas sidan efter midnatt med en
 * stampling som fortfarande ar oppen blir `nu` mindre an starten — da fylls
 * segmentet till dygnets slut i stallet, eftersom arbetet uppenbart pagick
 * hela dygnet ut. Det ar precis fallet med Zens oppna mandagsstampling.
 */
export function segment(handelser: Handelse[], nu: Date = new Date()): Segment[] {
  const giltiga = gallande(handelser);
  const nuM = svenskaMinuter(nu);
  const ut: Segment[] = [];

  let start: number | null = null;
  let typ: Segment["typ"] = "arbete";

  for (const h of giltiga) {
    const m = svenskaMinuter(h.occurred_at);

    if (h.kind === "in") {
      start = m;
      typ = "arbete";
    } else if (h.kind === "break_start") {
      if (start !== null) ut.push({ typ: "arbete", fran: start, till: m, oppen: false });
      start = m;
      typ = "rast";
    } else if (h.kind === "break_end") {
      if (start !== null) ut.push({ typ: "rast", fran: start, till: m, oppen: false });
      start = m;
      typ = "arbete";
    } else if (h.kind === "out" && start !== null) {
      ut.push({ typ, fran: start, till: m, oppen: false });
      start = null;
    }
  }

  if (start !== null) {
    ut.push({ typ, fran: start, till: nuM >= start ? nuM : DYGNET, oppen: true });
  }

  return ut;
}

export type Fonster = { fran: number; till: number };

/**
 * Vilken del av dygnet linjen visar.
 *
 * Utgar fran schemat, men vidgas alltid sa att allt som faktiskt stamplats far
 * plats. Den som borjade en timme fore schemat ska se den timmen — annars ser
 * linjen ut att ljuga, och en linje man inte litar pa ar samre an ingen linje.
 */
export function fonster(
  segmenten: Segment[],
  schema: { start_time: string; end_time: string } | null,
  nu: Date = new Date(),
): Fonster {
  // Utan schema: en normal kontorsdag som ram. Bara en ram — se vidgningen
  // nedan, som gor att inget stamplat hamnar utanfor anda.
  const bas: Fonster = schema
    ? { fran: minuter(schema.start_time), till: minuter(schema.end_time) }
    : { fran: 8 * 60, till: 17 * 60 };

  let { fran, till } = bas;
  for (const s of segmenten) {
    fran = Math.min(fran, s.fran);
    till = Math.max(till, s.till);
  }
  // Klockan just nu ska ocksa rymmas, annars hamnar markoren utanfor linjen
  // for den som inte stamplat in an.
  const nuM = svenskaMinuter(nu);
  fran = Math.min(fran, nuM);
  till = Math.max(till, nuM);

  // Luft, sa att en stampel precis vid kanten inte klipps av.
  return {
    fran: Math.max(0, Math.floor((fran - 30) / 30) * 30),
    till: Math.min(DYGNET, Math.ceil((till + 30) / 30) * 30),
  };
}

/** Var i fonstret en tidpunkt ligger, i procent. Alltid inom 0-100. */
export function andel(minut: number, f: Fonster): number {
  const bredd = Math.max(1, f.till - f.fran);
  return Math.min(100, Math.max(0, ((minut - f.fran) / bredd) * 100));
}

/** "HH:MM" till minuter sedan midnatt. */
export function minuter(tid: string): number {
  const [t, m] = tid.split(":").map(Number);
  return t * 60 + (m || 0);
}

/** Minuter sedan midnatt till "HH:MM". */
export function klockslag(minut: number): string {
  const m = Math.max(0, Math.min(DYGNET, Math.round(minut)));
  return `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export type Rastlage = {
  /** Rastens schemalagda langd i minuter. */
  langd: number;
  gatt: number;
  /** Negativt nar rasten dragit over. */
  kvar: number;
  over: boolean;
};

/**
 * Nedrakningen for den som ar pa rast just nu.
 *
 * ===========================================================================
 * DEN HAR RAKNAR NER AT DEN SOM AR PA RAST, INTE AT NAGON ANNAN.
 *
 * Siffran syns bara i personens egen vy och nar aldrig en chef. Det ar samma
 * uppgift som avvikelsemotorn skulle rakna fram i efterhand — skillnaden ar
 * att den som far veta det MEDAN rasten pagar kan avsluta i tid, och da blir
 * det ingen avvikelse att bedoma alls.
 *
 * Darfor ar `over` inte ett fel utan ett besked. AC-2.29 och K31 galler ordval
 * ocksa har: texten i granssnittet sager hur lang rasten blivit, inte att
 * nagon gjort fel. Toleransen i rastschemat avgor det, inte den har filen.
 * ===========================================================================
 *
 * Returnerar null nar personen inte ar pa rast, eller nar det inte finns nagon
 * schemalagd rastlangd att rakna mot. En nedrakning mot en gissad langd vore
 * varre an ingen alls.
 */
export function rastnedrakning(
  handelser: Handelse[],
  langd: number | null,
  nu: Date = new Date(),
): Rastlage | null {
  if (!langd || langd <= 0) return null;

  const giltiga = gallande(handelser);
  const senaste = giltiga[giltiga.length - 1];
  if (!senaste || senaste.kind !== "break_start") return null;

  const gatt = Math.max(0, Math.round((nu.getTime() - Date.parse(senaste.occurred_at)) / 60000));
  return { langd, gatt, kvar: langd - gatt, over: gatt > langd };
}

/**
 * Minuter kvar till arbetsdagens slut enligt schemat. Negativt nar tiden
 * passerat, null nar inget schema finns.
 */
export function kvarTillSlut(
  schema: { end_time: string } | null,
  nu: Date = new Date(),
): number | null {
  if (!schema) return null;
  return minuter(schema.end_time) - svenskaMinuter(nu);
}
