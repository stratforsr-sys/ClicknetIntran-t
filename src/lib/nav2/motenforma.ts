/**
 * Nav 2.0, Möten: den rena logiken (A4).
 *
 * Inga anrop och ingen Supabase, bara relativa importer med .ts-ändelse, så att
 * servern (moten.ts), rutten och provet (tests/moten.mjs) räknar likadant och
 * filen går att köra med bara `node --experimental-strip-types`.
 *
 * ===========================================================================
 * TVÅ TIDSFORMER, OCH DE BLANDAS ALDRIG. Datum är "YYYY-MM-DD" och tider i
 * `ledigaTider` är svensk lokal tid "YYYY-MM-DD HH:MM". Ingenting här räknar
 * med `Date` i den lokala tidszonen: `idag` kommer in som ett färdigt svenskt
 * datum (rutten räknar det i Europe/Stockholm), så ett möte 00:30 är "i dag"
 * även när servern går på UTC.
 * ===========================================================================
 */

import { arArbetsdag, dagPlus } from "../saljtakt.ts";
import { SKAL } from "./leadsforma.ts";
import { normaliseraEpost, normaliseraTelefon } from "../leads.ts";

export const KOLUMNER = ["bokat", "bekraftat", "utfall_saknas", "folj_upp", "tyst"] as const;
export type Kolumn = (typeof KOLUMNER)[number];
export const KOLUMN_NAMN: Record<Kolumn, string> = {
  bokat: "Bokat",
  bekraftat: "Bekräftat",
  utfall_saknas: "Utfall saknas",
  folj_upp: "Följ upp",
  tyst: "Tyst",
};

export const NULAGE = { ingen: "Ingen SEO", sjalv: "Gör själv", byra: "Har byrå" } as const;

/** Samma skäl som Leads (`lead_skal`), så att ett Nej betyder samma sak på båda ställena. */
export const NEJ_SKAL = SKAL;

/** Fasta värden ur specen. */
export const TYST_EFTER_INGET_SVAR = 3;
export const TYST_EFTER_DAGAR = 21;
export const MOTE_MINUTER = 30;
export const MOTE_PLATS = "Telefon";

/* ------------------------------------------------------------------------ */
/* Domän och telefon                                                         */
/* ------------------------------------------------------------------------ */

/** "https://www.Exempel.se/om-oss?x=1" och "exempel.se" är samma bolag: "exempel.se". */
export function normaliseraDoman(ra: string | null): string | null {
  if (!ra) return null;
  const v = ra
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
    .replace(/^www\./, "");
  const vard = v.split(/[/?#]/)[0].split("@").pop()!.replace(/:\d*$/, "").replace(/\.$/, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(vard) ? vard : null;
}

/**
 * Telefonnumret som E.164, det format Mötens `telefon` och Lynes
 * `phone_call.counterpart_e164` har. `normaliseraTelefon` ger det nationella
 * formatet (0701234567), så det här är ett steg ovanpå: `0…` blir `+46…`, ett
 * nummer som redan har `+` behålls och `46` + nio siffror utan plus får sitt plus.
 * Allt annat är inget nummer vi kan para ihop, och ger null.
 */
export function telefonE164(ra: string | null): string | null {
  // "+46 (0)70-123 45 67": nollan inom parentes är en trunkprefix-nolla som inte ska med.
  const n = normaliseraTelefon(ra ? ra.replace(/\(0\)/g, "") : ra);
  if (!n) return null;
  let e164: string | null = null;
  if (n.startsWith("+")) e164 = n;
  else if (n.startsWith("0")) e164 = "+46" + n.slice(1);
  else if (/^46\d{9}$/.test(n)) e164 = "+" + n;
  // "+460…" är en nolla för mycket efter landskoden, och "00…" är ingen svensk riktning: inget nummer vi kan para ihop.
  if (!e164 || e164.startsWith("+460")) return null;
  // Samma form som `mote_uppslag` godtar (0262).
  return /^\+\d{8,15}$/.test(e164) ? e164 : null;
}

/** E-postdomäner som många delar. De säger inget om bolaget, och sparas därför aldrig som bolagets domän. */
export const FRIMEJL_DOMANER: readonly string[] = [
  "gmail.com", "googlemail.com", "hotmail.com", "hotmail.se", "outlook.com", "outlook.se", "live.com", "live.se",
  "msn.com", "icloud.com", "me.com", "yahoo.com", "yahoo.se", "telia.com", "comhem.se", "bredband.net", "spray.se",
  "passagen.se", "tele2.se", "bahnhof.se", "protonmail.com", "proton.me", "aol.com", "gmx.com", "gmx.net",
];
export const arFrimejl = (doman: string | null): boolean => doman !== null && FRIMEJL_DOMANER.includes(doman);

/** Bolagets domän ur en adress eller ett mejl: normaliserad, och null för det som inte är bolagets egen. */
export function bolagsDoman(ra: string | null): string | null {
  const d = normaliseraDoman(ra);
  return d && !arFrimejl(d) ? d : null;
}

/* ------------------------------------------------------------------------ */
/* Rättigheter                                                               */
/* ------------------------------------------------------------------------ */

export type Aktor = { id: string; roller: string[] };
export type MoteParter = { bokat_av: string; halls_av: string };

/** Chef: får se alla möten. */
export const CHEF_ROLLER = ["team_lead", "sales_manager", "ceo", "admin"] as const;
/** Admin och Superadmin: får sätta utfall åt någon annan (en teamledare får det inte). */
export const UTFALL_ROLLER = ["sales_manager", "ceo", "admin"] as const;

/** Rollerna som får hålla ett möte (samma krets som säljarlistan på tavlan). Ingen annans kalender får fyllas med möten. */
export const HALLARE_ROLLER = ["salesperson", "team_lead", "sales_manager"] as const;
export const arHallare = (roller: readonly string[] | null | undefined): boolean => (roller ?? []).some((r) => (HALLARE_ROLLER as readonly string[]).includes(r));

const harRoll = (u: Aktor, lista: readonly string[]): boolean => u.roller.some((r) => lista.includes(r));

export const farSe = (u: Aktor, m: MoteParter): boolean => u.id === m.bokat_av || u.id === m.halls_av || harRoll(u, CHEF_ROLLER);
/** Samma krets som får se mötet får bekräfta det. */
export const farBekrafta = (u: Aktor, m: MoteParter): boolean => farSe(u, m);
export const farSattaUtfall = (u: Aktor, m: MoteParter): boolean => u.id === m.halls_av || harRoll(u, UTFALL_ROLLER);

/* ------------------------------------------------------------------------ */
/* Art och datum                                                             */
/* ------------------------------------------------------------------------ */

export type MotesArt = "ny" | "ombokning" | "uppfoljning";

/** Har kedjan redan ett hållet möte är nästa en uppföljning, hur den än bokades. */
export function motesArt(kedjaHarHallet: boolean, ombokningAv: string | null): MotesArt {
  if (kedjaHarHallet) return "uppfoljning";
  return ombokningAv ? "ombokning" : "ny";
}

/**
 * Ett antal arbetsdagar framåt (eller bakåt). Samma räkning som `arbetsdagar`
 * i anstalldaforma.ts, som hoppar över helger och helgdagar; den filen
 * importerar `@/lib/saljtakt` och går därför inte att läsa in i Node utan
 * alias. Provet jämför de två mot varandra.
 */
function arbetsdagarFram(fran: string, n: number): string {
  let d = fran;
  const steg = n < 0 ? -1 : 1;
  for (let i = 0; i < Math.abs(n); ) {
    d = dagPlus(d, steg);
    if (arArbetsdag(d)) i++;
  }
  return d;
}

/**
 * Inget svar: samtalet flyttas två arbetsdagar fram. Räknaren `inget_svar_i_rad`
 * stegas i databasen (villkorat på `fore`, så att ett dubbelklick räknas en gång);
 * nollställningen sker i `efterUtfall` och i bokningen (`efterBokning`, när ett möte
 * läggs i en kedja som redan fanns).
 */
export function efterIngetSvar(idag: string): { uppfoljning_datum: string } {
  return { uppfoljning_datum: arbetsdagarFram(idag, 2) };
}

/* ------------------------------------------------------------------------ */
/* Utfall                                                                    */
/* ------------------------------------------------------------------------ */

export type UtfallIn = {
  utfall: "hallet" | "uteblev" | "avbokat";
  /** Bara för `hallet`. `affar` går inte hit: en affär sparas när ordern är lagd (via `kund`). */
  resultat?: "offert" | "uppfoljning" | "nej" | "affar" | null;
  datum?: string | null;
  text?: string | null;
  skal?: string | null;
  /** Bara för `uteblev`: en ny tid, bokad direkt. */
  nyTid?: { dag: string; start: string } | null;
};

/**
 * Det ett utfall ändrar.
 *
 * `mote` är fälten på mötesraden. Rutten lägger själv till `utfall_nar`,
 * `utfall_av`, `resultat_nar` och `resultat_av` (tid och aktör kommer från
 * servern och inloggningen, aldrig från anropet) och villkorar skrivningen på
 * `utfall_nar is null`, så att ett dubbelklick inte sätter utfallet två gånger.
 *
 * `kedja` är fälten på kedjan, eller null när kedjan inte ändras (en ombokning
 * efter Uteblev lämnar kedjan orörd; det nya mötet tar över). Rutten lägger till
 * `uppfoljning_andrad` (villkoret mot dubbelklick) och, vid `avslut`,
 * `avslut_nar` och `avslut_av`. Varje väg som sätter `uppfoljning_datum`
 * nollställer `inget_svar_i_rad`.
 *
 * `nyttMote` är ett möte som ska bokas i samma kedja (`art: "ombokning"`).
 *
 * `nu` är ögonblicket för `offert_nar` (ISO). Det är en parameter för att
 * provet ska kunna vara exakt; utan den tas klockan.
 */
export type Utfallsandring = {
  mote: Record<string, unknown>;
  kedja: Record<string, unknown> | null;
  nyttMote: { art: "ombokning"; dag: string; start: string } | null;
};

/** "2026-10-29" och bara datum som finns: "2026-02-30" och "2026-13-45" är inga. */
export function arDatum(d: unknown): d is string {
  if (typeof d !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const t = new Date(`${d}T00:00:00Z`);
  return Number.isFinite(t.getTime()) && t.toISOString().slice(0, 10) === d;
}

export function efterUtfall(
  inn: UtfallIn,
  idag: string,
  kedjaHarHallet: boolean,
  nu: string = new Date().toISOString(),
): Utfallsandring {
  // En tom eller blank text är en saknad text.
  const text = typeof inn.text === "string" && inn.text.trim() ? inn.text.trim() : null;
  if (inn.utfall === "hallet") {
    if (!inn.resultat) throw new Error("Välj vad mötet ledde till.");
    if (inn.resultat === "affar") throw new Error("Affär sparas när ordern är lagd.");

    if (inn.resultat === "nej") {
      if (!inn.skal || !(NEJ_SKAL as readonly string[]).includes(inn.skal)) throw new Error("Välj ett skäl.");
      return {
        mote: { utfall: "hallet", resultat: "nej", nej_skal: inn.skal },
        kedja: { avslut: "nej", nej_skal: inn.skal },
        nyttMote: null,
      };
    }

    if (inn.resultat === "uppfoljning") {
      if (!arDatum(inn.datum)) throw new Error("Välj ett datum för uppföljningen.");
      return {
        mote: { utfall: "hallet", resultat: "uppfoljning" },
        kedja: { uppfoljning_datum: inn.datum, uppfoljning_text: text, inget_svar_i_rad: 0 },
        nyttMote: null,
      };
    }

    // Offert skickad: förvalt datum är idag + 3 arbetsdagar. Datumet får ändras.
    if (inn.datum != null && inn.datum !== "" && !arDatum(inn.datum)) throw new Error("Välj ett datum för uppföljningen.");
    return {
      mote: { utfall: "hallet", resultat: "offert" },
      kedja: {
        uppfoljning_datum: inn.datum || arbetsdagarFram(idag, 3),
        uppfoljning_text: text ?? "Offert skickad",
        inget_svar_i_rad: 0,
        offert_nar: nu,
      },
      nyttMote: null,
    };
  }

  // Uteblev och Avbokat.
  const mote = { utfall: inn.utfall };

  if (inn.utfall === "uteblev" && inn.nyTid) {
    return { mote, kedja: null, nyttMote: { art: "ombokning", dag: inn.nyTid.dag, start: inn.nyTid.start } };
  }

  // Avbokat före något hållet möte stänger kedjan. Efter ett hållet möte ligger
  // offerten fortfarande ute, så kortet går till Följ upp i stället (Granskningsfokus 5).
  if (inn.utfall === "avbokat" && !kedjaHarHallet) {
    return { mote, kedja: { avslut: "avbokat" }, nyttMote: null };
  }

  return {
    mote,
    kedja: {
      uppfoljning_datum: arbetsdagarFram(idag, 1),
      uppfoljning_text: inn.utfall === "uteblev" ? "Uteblev" : "Avbokat",
      inget_svar_i_rad: 0,
    },
    nyttMote: null,
  };
}

/* ------------------------------------------------------------------------ */
/* Lediga tider                                                              */
/* ------------------------------------------------------------------------ */

export type Upptaget = { fran: string; till: string };
export type LedigTid = { dag: string; start: string; nara: boolean };

const DAG_START_MIN = 8 * 60;
const DAG_SLUT_MIN = 17 * 60;
const STEG_MIN = 30;
const DAGAR_FRAM = 10;
const NARA_DAGAR = 3;
/** Så många arbetsdagar letas det igenom innan sökningen ger upp (allt upptaget ska inte ge en oändlig slinga). */
const SOK_ARBETSDAGAR = 60;

const tid = (min: number): string => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/** Minuter efter midnatt på `dag` som "YYYY-MM-DD HH:MM" (svensk lokal tid). 24:15 blir nästa dag 00:15. */
export function lokalTidpunkt(dag: string, min: number): string {
  const dygn = Math.floor(min / 1440);
  return `${dygn ? dagPlus(dag, dygn) : dag} ${tid(min - dygn * 1440)}`;
}

/**
 * Kalenderns upptagna tid (`Upptaget` i leveranskalender.ts: dag → block i minuter
 * och om personen är ledig hela dagen) som intervall i lokal tid för `ledigaTider`.
 * En frånvarodag räknas som upptagen hela dagen.
 */
export function upptagetTillIntervall(
  dagar: Record<string, { block: { s: number; e: number }[]; ledig: boolean }> | undefined | null,
): Upptaget[] {
  const ut: Upptaget[] = [];
  for (const [dag, d] of Object.entries(dagar ?? {})) {
    if (d.ledig) ut.push({ fran: lokalTidpunkt(dag, 0), till: lokalTidpunkt(dag, 1440) });
    for (const b of d.block) ut.push({ fran: lokalTidpunkt(dag, b.s), till: lokalTidpunkt(dag, b.e) });
  }
  return ut;
}

/**
 * Tiderna en säljare kan bokas på: var 30:e minut 08:00–16:30 på tio arbetsdagar
 * som har lediga tider. Dagens datum är första dagen när det är en arbetsdag och
 * det finns en tid kvar; annars börjar räkningen på nästa arbetsdag. En dag utan
 * någon ledig tid räknas inte. `nara` markerar de tre första av de dagarna
 * (andelen möten som uteblir stiger med tiden till mötet).
 *
 * `upptaget` och `nu` är svensk lokal tid "YYYY-MM-DD HH:MM", så att jämförelsen
 * är en ren strängjämförelse och ingen tidszon kan flytta ett möte över midnatt.
 * En tid före `nu` är borta, och en tid som ger ett möte `[start, start + langd)`
 * som överlappar något upptaget intervall `[fran, till)` likaså. Ett möte får
 * inte sluta efter 17:00.
 */
export function ledigaTider(upptaget: Upptaget[], idag: string, nu: string, langd: number = MOTE_MINUTER): LedigTid[] {
  const ut: LedigTid[] = [];
  let dag = arArbetsdag(idag) ? idag : arbetsdagarFram(idag, 1);
  let dagar = 0;

  for (let sokta = 0; dagar < DAGAR_FRAM && sokta < SOK_ARBETSDAGAR; sokta++) {
    let nagon = false;
    for (let min = DAG_START_MIN; min + langd <= DAG_SLUT_MIN; min += STEG_MIN) {
      const start = `${dag} ${tid(min)}`;
      const slut = `${dag} ${tid(min + langd)}`;
      if (start <= nu) continue;
      if (upptaget.some((u) => start < u.till && slut > u.fran)) continue;
      ut.push({ dag, start: tid(min), nara: dagar < NARA_DAGAR });
      nagon = true;
    }
    if (nagon) dagar++;
    dag = arbetsdagarFram(dag, 1);
  }
  return ut;
}

/* ------------------------------------------------------------------------ */
/* Indata till rutten                                                        */
/* ------------------------------------------------------------------------ */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** "YYYY-MM-DD HH:MM", svensk lokal tid (samma som Leads). */
const LOKAL = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})$/;
const KLOCKA = /^([01]\d|2[0-3]):[0-5]\d$/;

export type Resultat<T> = { ok: true; varden: T } | { ok: false; fel: string };

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const tom = (v: unknown): boolean => v === undefined || v === null || (typeof v === "string" && !v.trim());

/** Dag och start: `start` som "HH:MM" (i hela femminuter) eller hela tiden som "YYYY-MM-DD HH:MM". */
function dagOchStart(dag: unknown, start: unknown): Resultat<{ dag: string; start: string }> {
  let d = dag;
  let s = start;
  const lokal = typeof s === "string" ? LOKAL.exec(s.trim()) : null;
  if (lokal) {
    if (!tom(d) && d !== lokal[1]) return { ok: false, fel: "Välj en starttid." };
    d = lokal[1];
    s = lokal[2];
  }
  if (!arDatum(d)) return { ok: false, fel: "Välj ett datum." };
  if (typeof s !== "string" || !KLOCKA.test(s) || Number(s.slice(3)) % 5 !== 0) return { ok: false, fel: "Välj en starttid." };
  return { ok: true, varden: { dag: d, start: s } };
}

const nej = (fel: string): { ok: false; fel: string } => ({ ok: false, fel });

export type BokaVarden = {
  namn: string;
  kontakt: string | null;
  /** E.164. */
  telefon: string;
  epost: string | null;
  /** Bolagets egen domän; aldrig en frimejlsdomän. */
  doman: string | null;
  kalla: string;
  hallsAv: string;
  dag: string;
  start: string;
  langd: number;
  mal: string | null;
  nulage: keyof typeof NULAGE | null;
  kedja: string | null;
  foregaende: string | null;
};

/** Det `boka` tar emot, prövat och normaliserat. Felen är texter till säljaren. */
export function bokaIndata(body: unknown): Resultat<BokaVarden> {
  if (!body || typeof body !== "object") return nej("Ogiltig begäran.");
  const b = body as Record<string, unknown>;

  const namn = text(b.namn);
  if (!namn) return nej("Skriv bolagets namn.");
  if (namn.length > 150) return nej("Namnet är för långt.");
  const telefon = telefonE164(typeof b.telefon === "string" ? b.telefon : null);
  if (!telefon) return nej("Telefonnumret går inte att tolka.");
  const kalla = text(b.kalla);
  if (!kalla) return nej("Skriv varifrån bolaget kommer.");
  if (kalla.length > 80) return nej("Källan är för lång.");
  if (typeof b.hallsAv !== "string" || !UUID.test(b.hallsAv)) return nej("Välj vem som ska hålla mötet.");

  const tidpunkt = dagOchStart(b.dag, b.start);
  if (!tidpunkt.ok) return tidpunkt;

  let langd: number = MOTE_MINUTER;
  if (!tom(b.langd)) {
    const n = typeof b.langd === "number" ? b.langd : typeof b.langd === "string" && /^\d+$/.test(b.langd.trim()) ? Number(b.langd) : NaN;
    if (!Number.isInteger(n) || n < 15 || n > 480) return nej("Mötets längd stämmer inte.");
    langd = n;
  }

  let nulage: BokaVarden["nulage"] = null;
  if (!tom(b.nulage)) {
    if (typeof b.nulage !== "string" || !Object.prototype.hasOwnProperty.call(NULAGE, b.nulage)) return nej("Välj nuläge.");
    nulage = b.nulage as keyof typeof NULAGE;
  }

  let epost: string | null = null;
  if (!tom(b.epost)) {
    epost = normaliseraEpost(typeof b.epost === "string" ? b.epost : null);
    if (!epost) return nej("E-postadressen går inte att tolka.");
  }

  let kedja: string | null = null;
  if (!tom(b.kedja)) {
    if (typeof b.kedja !== "string" || !UUID.test(b.kedja)) return nej("Kedjan stämmer inte.");
    kedja = b.kedja;
  }
  let foregaende: string | null = null;
  if (!tom(b.foregaende)) {
    if (typeof b.foregaende !== "string" || !UUID.test(b.foregaende)) return nej("Det tidigare mötet stämmer inte.");
    foregaende = b.foregaende;
  }

  const kontakt = text(b.kontakt);
  const mal = text(b.mal);
  if ((kontakt?.length ?? 0) > 200) return nej("Kontaktpersonens namn är för långt.");
  if ((mal?.length ?? 0) > 2000) return nej("Målet är för långt.");

  return {
    ok: true,
    varden: {
      namn,
      kontakt,
      telefon,
      epost,
      doman: bolagsDoman(typeof b.doman === "string" ? b.doman : null),
      kalla,
      hallsAv: b.hallsAv,
      dag: tidpunkt.varden.dag,
      start: tidpunkt.varden.start,
      langd,
      mal,
      nulage,
      kedja,
      foregaende,
    },
  };
}

/* ------------------------------------------------------------------------ */
/* Mötets knappar och uppföljningen (A7, A8)                                 */
/* ------------------------------------------------------------------------ */

/** Kund (en affär): mötet (om det skickas med) blir Hållet/Affär, kedjan avslutas som affär. */
export function andringForKund(harMote: boolean): { mote: { utfall: "hallet"; resultat: "affar" } | null; kedja: { avslut: "affar" } } {
  return { mote: harMote ? { utfall: "hallet", resultat: "affar" } : null, kedja: { avslut: "affar" } };
}

/** Kund och Nej utan möte: den som är med i kedjan, eller en chef. */
export const farAndraKedja = (u: Aktor, deltagare: readonly string[] | null | undefined): boolean => (deltagare ?? []).includes(u.id) || harRoll(u, CHEF_ROLLER);

/**
 * Kund: ordern ska höra till kortet. Den får vara lagd av eller tillhöra någon i kedjan, annars krävs en chef.
 * (`sales_order.salesperson_id` är säljaren, `created_by` den som lade den.)
 */
export function farKopplaOrder(u: Aktor, deltagare: readonly string[] | null | undefined, order: { salesperson_id: string | null; created_by: string | null }): boolean {
  const d = deltagare ?? [];
  return harRoll(u, CHEF_ROLLER) || (order.salesperson_id !== null && d.includes(order.salesperson_id)) || (order.created_by !== null && d.includes(order.created_by));
}

const ID = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

/**
 * `fore`: kedjans `uppfoljning_andrad` så som klienten fick den, eller null när den aldrig ändrats. Det är
 * versionen en skrivning villkoras på (Granskningsfokus 1). Strängen går vidare OFÖRÄNDRAD: databasen
 * har mikrosekunder, och en omräkning via Date skulle tappa dem och göra varje skrivning till 409.
 */
export function foreVarde(v: unknown): Resultat<string | null> {
  if (v === undefined || v === null) return { ok: true, varden: null };
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)$/.test(v) || !Number.isFinite(Date.parse(v))) {
    return nej("Kortet har ändrats. Ladda om tavlan.");
  }
  return { ok: true, varden: v };
}

/**
 * Inget svar som SQL: samma uppdatering som rutten gör (A8), med `$1` kedjan, `$2` `fore` (timestamptz
 * eller null), `$3` det nya datumet och `$4` det nya antalet (det lästa + 1; rutten läser det i samma
 * veva och versionsvillkoret `$2` gör att ingen annan hunnit ändra det). `moten-db.mjs
 * --inget-svar-prov` kör den för att visa att den andra av två lika snabba uppdateringar ger 0 rader.
 */
export const SQL_INGET_SVAR = `update public.mote_kedja
   set uppfoljning_datum = $3::date, inget_svar_i_rad = $4::int, uppfoljning_andrad = now()
 where id = $1 and avslut is null and uppfoljning_andrad is not distinct from $2::timestamptz
 returning inget_svar_i_rad, uppfoljning_andrad::text as uppfoljning_andrad`;

/**
 * Handlingarna som skriver. Står `SKRIVLAGE.moten` på false svarar rutten 423 på dessa och släpper
 * igenom resten (`uppslag`, `lediga`, och `samtal` från B4), som bara läser. En okänd handling är
 * ingen skrivning och får sitt vanliga 400.
 */
export const SKRIVANDE_HANDLINGAR = ["boka", "paminn", "bekrafta", "flytta", "avboka", "utfall", "kund", "nej", "inget_svar", "prova_igen"] as const;
export const arSkrivning = (handling: string): boolean => (SKRIVANDE_HANDLINGAR as readonly string[]).includes(handling);

/**
 * Ett nytt möte i en kedja som redan fanns: Inget svar-räknaren börjar om och kedjans version flyttas
 * fram (så att en Inget svar-knapp i en gammal vy får 409 i stället för att räkna på ett förlegat kort).
 */
export function efterBokning(nu: string): { inget_svar_i_rad: 0; uppfoljning_andrad: string } {
  return { inget_svar_i_rad: 0, uppfoljning_andrad: nu };
}

/**
 * Flytta som SQL: samma uppdatering som rutten gör. Bekräftat nollställs (en ny tid är inte bekräftad
 * av kunden), flyttningsräknaren stegas, och skrivningen villkoras på mötets nuvarande tid. `$1` mötet,
 * `$2` nya tiden, `$3` nya antalet, `$4` nuvarande tid. Provas av `moten-db.mjs --flytt-prov`.
 */
export const SQL_FLYTTA_MOTE = `update public.mote
   set mote_tid = $2::timestamptz, antal_flyttningar = $3::int, bekraftat_nar = null, bekraftat_av = null
 where id = $1 and utfall is null and mote_tid = $4::timestamptz
 returning id`;

export function moteIndata(body: unknown): Resultat<{ mote: string }> {
  const b = (body ?? {}) as Record<string, unknown>;
  return ID(b.mote) ? { ok: true, varden: { mote: b.mote } } : nej("Mötet stämmer inte.");
}

export function flyttaIndata(body: unknown): Resultat<{ mote: string; dag: string; start: string }> {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!ID(b.mote)) return nej("Mötet stämmer inte.");
  const t = dagOchStart(b.dag, b.start);
  return t.ok ? { ok: true, varden: { mote: b.mote, dag: t.varden.dag, start: t.varden.start } } : t;
}

export function utfallIndata(body: unknown): Resultat<{ mote: string; inn: UtfallIn }> {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!ID(b.mote)) return nej("Mötet stämmer inte.");
  if (b.utfall !== "hallet" && b.utfall !== "uteblev" && b.utfall !== "avbokat") return nej("Välj vad som hände med mötet.");
  const inn: UtfallIn = { utfall: b.utfall };
  if (!tom(b.resultat)) {
    if (b.resultat !== "offert" && b.resultat !== "uppfoljning" && b.resultat !== "nej") return nej("Välj vad mötet ledde till.");
    inn.resultat = b.resultat;
  }
  if (!tom(b.datum)) {
    if (!arDatum(b.datum)) return nej("Välj ett datum för uppföljningen.");
    inn.datum = b.datum;
  }
  const t = text(b.text);
  if ((t?.length ?? 0) > 1000) return nej("Texten är för lång.");
  inn.text = t;
  if (!tom(b.skal)) {
    if (typeof b.skal !== "string" || !(NEJ_SKAL as readonly string[]).includes(b.skal)) return nej("Välj ett skäl.");
    inn.skal = b.skal;
  }
  if (!tom(b.nyTid)) {
    if (b.utfall !== "uteblev") return nej("En ny tid går bara att boka efter Uteblev.");
    const n = (b.nyTid ?? {}) as Record<string, unknown>;
    const tid = dagOchStart(n.dag, n.start);
    if (!tid.ok) return tid;
    inn.nyTid = tid.varden;
  }
  return { ok: true, varden: { mote: b.mote, inn } };
}

export function nejIndata(body: unknown): Resultat<{ kedja: string; skal: string }> {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!ID(b.kedja)) return nej("Kedjan stämmer inte.");
  if (typeof b.skal !== "string" || !(NEJ_SKAL as readonly string[]).includes(b.skal)) return nej("Välj ett skäl.");
  return { ok: true, varden: { kedja: b.kedja, skal: b.skal } };
}

export function kundIndata(body: unknown): Resultat<{ kedja: string; order: string; mote: string | null }> {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!ID(b.kedja)) return nej("Kedjan stämmer inte.");
  if (!ID(b.order)) return nej("Välj ordern.");
  if (!tom(b.mote) && !ID(b.mote)) return nej("Mötet stämmer inte.");
  return { ok: true, varden: { kedja: b.kedja, order: b.order, mote: tom(b.mote) ? null : (b.mote as string) } };
}

/** Inget svar och Prova igen: kedjan och versionen den ändras från. */
export function kedjaFore(body: unknown): Resultat<{ kedja: string; fore: string | null }> {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!ID(b.kedja)) return nej("Kedjan stämmer inte.");
  const f = foreVarde(b.fore);
  return f.ok ? { ok: true, varden: { kedja: b.kedja, fore: f.varden } } : f;
}

/* ------------------------------------------------------------------------ */
/* Uppslaget (mote_uppslag, 0262)                                            */
/* ------------------------------------------------------------------------ */

export type Uppslag = {
  samtal: { vem: string | null; nar: string | null; sek: number | null; riktning: string | null }[];
  bokat: { namn: string; mote_tid: string; halls_av_namn: string | null }[];
  kund: boolean;
};

/** Svaret från `mote_uppslag`, tolkat försiktigt: det som saknas eller har fel form blir tomt, aldrig ett fel. */
export function tolkaUppslag(data: unknown): Uppslag {
  const d = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const rader = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : []);
  const sOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);
  return {
    samtal: rader(d.samtal).map((r) => ({
      vem: sOrNull(r.vem),
      nar: sOrNull(r.nar),
      sek: typeof r.sek === "number" ? r.sek : null,
      riktning: sOrNull(r.riktning),
    })),
    bokat: rader(d.bokat)
      .filter((r) => typeof r.mote_tid === "string")
      .map((r) => ({ namn: sOrNull(r.namn) ?? "Bolaget", mote_tid: r.mote_tid as string, halls_av_namn: sOrNull(r.halls_av_namn) })),
    kund: d.kund === true,
  };
}

/** Varningen i svaret på `boka`: ett annat bokat möte eller en kund. Null när det inte finns något att varna för. Spärrar ingenting. */
export function uppslagsVarning(u: Uppslag, narText: (iso: string) => string): string | null {
  const delar: string[] = [];
  for (const b of u.bokat) delar.push(`${b.namn} har redan ett bokat möte ${narText(b.mote_tid)}${b.halls_av_namn ? ` hos ${b.halls_av_namn}` : ""}.`);
  if (u.kund) delar.push("Bolaget är redan kund.");
  return delar.length ? delar.join(" ") : null;
}

export type PaminnVarden = { namn: string; telefon: string; dag: string; start: string };

/** Det `paminn` tar emot. Namnet högst 150 och telefonen högst 40 tecken, så att rubriken "Ring <namn> <telefon>" aldrig passerar kalenderns 200. Telefonnumret behålls som det skrevs (det hamnar i kalenderns rubrik), men måste gå att tolka. */
export function paminnIndata(body: unknown): Resultat<PaminnVarden> {
  if (!body || typeof body !== "object") return nej("Ogiltig begäran.");
  const b = body as Record<string, unknown>;
  const namn = text(b.namn);
  if (!namn) return nej("Skriv bolagets namn.");
  if (namn.length > 150) return nej("Namnet är för långt.");
  const telefon = text(b.telefon);
  if (!telefon || !telefonE164(telefon) || telefon.length > 40) return nej("Telefonnumret går inte att tolka.");
  const tidpunkt = dagOchStart(b.dag, b.start);
  if (!tidpunkt.ok) return tidpunkt;
  return { ok: true, varden: { namn, telefon, ...tidpunkt.varden } };
}
