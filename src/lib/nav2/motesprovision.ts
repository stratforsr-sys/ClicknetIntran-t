/**
 * Möten: mötesprovisionen i Provision-vyn — ren logik (uppgift 7).
 *
 * Ingen hämtning och inget belopp räknas här: raderna kommer färdiga ur
 * `mote_provision` (låsta av `mote_las_provision`/`mote_andra_provision`, 0288) och
 * motorn (`raknaUnderlag`) räknar in dem i månaden. Filen ordnar bara vad vyn visar:
 * en rad per möte, de tre talen, "väntar på bedömning" och var en ändring i efterhand
 * bokförts. Ren så att samma kod körs i Next och i `tests/nav2-provisionforma.mjs`.
 */

import { fordela, omfattas, ursprungligBokare, type MotenInst } from "./motesflode.ts";

/** En av betraktarens egna rader i `mote_provision`, med det vyn behöver bredvid. */
export type MotesvyRad = {
  moteId: string;
  bolag: string;
  /** Mötesdagen, "YYYY-MM-DD" i installationens tidszon. */
  dag: string;
  /** Den som höll mötet, för- och efternamn. */
  saljare: string;
  niva: "kvalificerat" | "hallet" | null;
  belopp: number;
  mojligt: number;
  /** Skälet: för ett tappat möte raden egen, för ett hållet de frågor som besvarats med nej. */
  skal: string | null;
  delatMed: string | null;
  /** Mötestidens månad, "YYYY-MM-01". */
  manad: string;
  ifragasattNar: string | null;
  beslutNar: string | null;
};

/** Ett hållet möte utan nivå där betraktaren skulle få provision. */
export type MotesvyVantar = { moteId: string; bolag: string; dag: string; saljare: string; manad: string };

export type MotesvyIndata = {
  /** Står betraktaren i `moten.mottagare` just nu? */
  mottagare: boolean;
  rader: MotesvyRad[];
  vantar: MotesvyVantar[];
};

export type NdMotesrad = {
  dag: string;
  bolag: string;
  saljare: string;
  niva: string | null;
  belopp: number;
  mojligt: number;
  skal: string | null;
  delatMed: string | null;
  moteId: string;
  kanIfragasatta: boolean;
  vantar: boolean;
  /** Månaden ("YYYY-MM") en ändring i efterhand bokförts i, ur huvudbokens rättelsepost. Annars null. */
  rattadI: string | null;
  /** Mötets månad, "YYYY-MM". Vyn visar en månad i taget. */
  manad: string;
};

export type NdMotesprovision = {
  /** Innevarande månads summa, och talen bakom den. Vyn räknar om dem per vald månad ur `rader`. */
  summa: number;
  hallna: number;
  kvalificerade: number;
  tappade: number;
  rader: NdMotesrad[];
};

/**
 * Mötet och personen en rättelsepost hör till, ur `commission_entry.external_ref`:
 * `<innevarande YYYY-MM-DD>:<person>:rattelse:mote:<mötet>:v<version>` (0288).
 */
export function rattelseForMote(externalRef: string | null | undefined): { moteId: string; version: number } | null {
  const m = /:rattelse:mote:([0-9a-fA-F-]{36}):v(\d+)$/.exec(externalRef ?? "");
  return m ? { moteId: m[1].toLowerCase(), version: Number(m[2]) } : null;
}

/**
 * Skälet till den lägre nivån: frågorna som besvarades med nej, med den text de hade när svaret gavs
 * (`mote.niva_svar`, `[{id, text, ja}]`). Null när inget är besvarat med nej eller svaret är obegripligt.
 */
export function hallatSkal(svar: unknown): string | null {
  if (!Array.isArray(svar)) return null;
  const nej = svar
    .filter((s): s is { text: string; ja: boolean } => typeof s === "object" && s !== null && (s as { ja?: unknown }).ja === false && typeof (s as { text?: unknown }).text === "string")
    .map((s) => s.text.trim())
    .filter(Boolean);
  return nej.length ? `Nej på: ${nej.join(", ")}` : null;
}

/** Ett möte i kedjan, som `ursprungligBokare` vill ha det, med det som behövs för att avgöra vem som får. */
export type VantandeMote = {
  id: string;
  art: string;
  foregaende: string | null;
  bokatAv: string;
  hallsAv: string;
  moteTid: string;
  bolag: string;
  /** Mötesdagen och månaden i installationens tidszon. */
  dag: string;
  manad: string;
  saljare: string;
};

/**
 * Hållna möten utan nivå där betraktaren får provision när nivån sätts: samma
 * `fordela` som låsningen använder, med de mottagare som gäller nu, men bara möten
 * som omfattas (`moten.galler-fran`). Kedjorna läses en gång av anroparen (`karta`),
 * ingen fråga per möte. Den som bokade och höll mötet själv, eller bokade ett
 * uppföljningsmöte, får inget och ser ingen rad.
 */
export function vantandeFor(
  jag: string,
  kandidater: readonly VantandeMote[],
  karta: ReadonlyMap<string, { art: string; foregaende: string | null; bokatAv: string }>,
  inst: Pick<MotenInst, "mottagare" | "ombokning" | "gallerFran">,
): MotesvyVantar[] {
  const ut: MotesvyVantar[] = [];
  for (const m of kandidater) {
    if (!omfattas(m.moteTid, inst.gallerFran)) continue;
    const ursprunglig = ursprungligBokare(m.id, karta);
    if (!ursprunglig) continue;
    const andel = fordela({ ursprunglig, bokatAv: m.bokatAv, hallsAv: m.hallsAv, mottagare: inst.mottagare, regel: inst.ombokning, belopp: 0 });
    if (andel.some((a) => a.employeeId === jag)) ut.push({ moteId: m.id, bolag: m.bolag, dag: m.dag, saljare: m.saljare, manad: m.manad });
  }
  return ut;
}

const m7 = (m: string) => m.slice(0, 7);

/**
 * Vyns sektion. Null när betraktaren inte får mötesprovision och aldrig haft en
 * rad: då visas ingen sektion alls. "Väntar" visas bara för den som får
 * mötesprovision nu; en tidigare mottagare ser sina egna rader men inga nya väntande.
 *
 * Rader utan något på spel (belopp och möjligt belopp noll, till exempel när satserna
 * står på noll) tas inte med. `idag` är innevarande månad, "YYYY-MM-01".
 */
export function byggMotenProvision(
  jag: string,
  indata: MotesvyIndata | null | undefined,
  poster: readonly { employee_id: string; period_month: string; external_ref: string | null }[],
  idag: string,
): NdMotesprovision | null {
  if (!indata) return null;
  const egna = indata.rader.filter((r) => r.belopp > 0 || r.mojligt > 0);
  if (!indata.mottagare && egna.length === 0) return null;

  // Var en ändring i efterhand bokförts: den senaste rättelsemånaden per möte, för betraktaren.
  const rattadI = new Map<string, string>();
  for (const p of poster) {
    if (p.employee_id !== jag) continue;
    const r = rattelseForMote(p.external_ref);
    if (!r) continue;
    const m = m7(p.period_month);
    if (m > (rattadI.get(r.moteId) ?? "")) rattadI.set(r.moteId, m);
  }

  const rader: NdMotesrad[] = egna.map((r) => ({
    dag: r.dag,
    bolag: r.bolag,
    saljare: r.saljare,
    niva: r.niva,
    belopp: r.belopp,
    mojligt: r.mojligt,
    skal: r.skal,
    delatMed: r.delatMed,
    moteId: r.moteId,
    kanIfragasatta: r.niva === "hallet" && !r.ifragasattNar && !r.beslutNar,
    vantar: false,
    rattadI: rattadI.get(r.moteId) ?? null,
    manad: m7(r.manad),
  }));
  if (indata.mottagare) {
    const harRad = new Set(egna.map((r) => r.moteId));
    for (const v of indata.vantar) {
      if (harRad.has(v.moteId)) continue;
      rader.push({
        dag: v.dag, bolag: v.bolag, saljare: v.saljare, niva: null, belopp: 0, mojligt: 0, skal: null, delatMed: null,
        moteId: v.moteId, kanIfragasatta: false, vantar: true, rattadI: null, manad: m7(v.manad),
      });
    }
  }
  rader.sort((a, b) => b.dag.localeCompare(a.dag) || a.moteId.localeCompare(b.moteId));

  const nu = rader.filter((r) => !r.vantar && r.manad === m7(idag));
  const hallda = nu.filter((r) => r.niva !== null);
  return {
    summa: Math.round(hallda.reduce((s, r) => s + r.belopp, 0) * 100) / 100,
    hallna: hallda.length,
    kvalificerade: hallda.filter((r) => r.niva === "kvalificerat").length,
    tappade: nu.length - hallda.length,
    rader,
  };
}
