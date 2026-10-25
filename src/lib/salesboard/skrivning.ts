/**
 * Säljtavlans inställningar: det skrivrutten läser in och det sidan och rutten
 * formar ur raderna (spec §7 och §9).
 *
 * Ren logik utan Supabase och Next, så att den går att prova med node
 * (`tests/salesboard-installningar.mjs`). Rutten `/nav2/salesboard` tolkar
 * kroppen här, och Nav 2.0:s Inställningar → Säljtavlan (`src/lib/nav2/saljtavlan.ts`)
 * formar skärmarna, säljarna och tröskeln med samma funktioner som rutten svarar med.
 *
 * SERVERKOD, som `parning.ts` och `nyckel.ts`: koden från TV:n normaliseras
 * genom `normaliseraKod`, och `parning.ts` drar in `node:crypto`. Gränserna
 * klienten behöver följer med i `ND.saljtavlan`.
 *
 * ===========================================================================
 * EN SKRIVNING SOM INTE LANDAR SOM DEN SKICKADES SPARAS INTE.
 *
 * `uppdatera` hoppar med flit över en del den inte kan läsa och klipper ett tal
 * till sina gränser, så att tavlan aldrig faller på en trasig rad. För den som
 * skriver är det fel håll: "volym 150" hade sparats som 100 och "visa ordervärdet
 * ja" inte alls, och svaret hade ändå sagt ok. Därför prövas varje del här
 * först (typ, val, gräns, okända nycklar), och efter `uppdatera` jämförs varje
 * del med det som blev (`tillampa`). Det som skiljer sig ger 400 och säger vilken
 * del det gällde, och ingenting skrivs.
 * ===========================================================================
 */

import { harGodkants, raknas, type Orderstatus } from "../order.ts";
import { ROLES, ROLE_LABEL } from "../roles.ts";
import { troskelFranStatistik, type Tavlestatistik } from "./forma.ts";
import { MAL_GRANSER, normalisera, uppdatera } from "./installningar.ts";
import { normaliseraKod } from "./parning.ts";
import { AKTIVA_STATUSAR, MINSTA_UNDERLAG, SALJANDE_ROLLER, arDold } from "./regler.ts";
import { personvalen, type Lasning } from "./saknas.ts";
import type { Namnform, Ordning, TavlansInstallningar, Testtyp, Visning } from "./typer.ts";

// -----------------------------------------------------------------------------
// Gränserna och texterna
// -----------------------------------------------------------------------------

/** Ett namn på en skärm, 1–60 tecken som Postgres räknar dem (`char_length`, 0250). */
export const NAMN_MAX = 60;

/**
 * Talens gränser, samma som `normalisera` klipper till. Provet håller dem i
 * takt med `installningar.ts`: det högsta tillåtna landar, ett steg till klipps.
 * Sidan skickar dem till klienten, som inte får importera den här filen.
 */
export const GRANSER = {
  volym: { min: 0, max: 100 },
  belopp: { min: 1_000, max: 10_000_000 },
  mal: MAL_GRANSER,
  efterregistreradDagar: { min: 0, max: 30 },
} as const;

export const FEL = {
  ursprung: "Fel ursprung.",
  utloggad: "Du är utloggad. Logga in igen och försök en gång till.",
  inteAdmin: "Säljtavlan ändras av en superadmin.",
  ogiltig: "Ogiltig begäran.",
  handling: "Okänd handling.",
  inget: "Inget att spara.",
  koden: "Koden finns inte eller har gått ut.",
  kodform: "Koden är åtta tecken, A–Z och 2–9, utan I, O, 0 och 1.",
  namn: `Namnet är 1–${NAMN_MAX} tecken.`,
  namntecken: "Namnet får bara innehålla vanliga tecken.",
  id: "Okänt id.",
  arbetsdag: "Arbetsdagen måste sluta efter att den börjar.",
  laget: "Laget finns inte längre.",
  skarmen: "Skärmen finns inte eller är redan bortkopplad.",
  saljaren: "Säljaren finns inte.",
  inteInstallerad: "Säljtavlans tabeller är inte installerade än.",
  /** Det gick inte att avgöra vem som frågar, till exempel när databasen inte svarar. Aldrig 401 eller 403. */
  svararInte: "Säljtavlan svarar inte just nu. Försök igen om en stund.",
  /** Två sparningar möttes, och den här förlorade två gånger (R25). Ingenting sparades. */
  samtidigt: "Någon annan sparade samtidigt. Ladda om sidan och försök igen.",
  ovantat: "Något gick fel. Försök igen om en stund.",
} as const;

/**
 * Händelserna i händelseloggen, per handling. Modulen `salesboard` står i
 * `MODUL` (handelselogg.ts), så varje `salesboard.*` är registrerad; provet
 * håller efter det. En testhändelse ändrar ingenting och loggas inte.
 */
export const HANDELSER = {
  spara: "salesboard.settings_changed",
  para: "salesboard.screen_created",
  byt_namn: "salesboard.screen_renamed",
  ljud_skarm: "salesboard.screen_sound_changed",
  koppla_bort: "salesboard.screen_revoked",
  person: "salesboard.person_changed",
} as const;

// -----------------------------------------------------------------------------
// Skrivningarna
// -----------------------------------------------------------------------------

/** En del av inställningarna, som `uppdatera` tar den: det som inte nämns står kvar. */
export type Delar = {
  lag?: string | null;
  namn?: Namnform;
  ordning?: Ordning;
  /** Månad → mål i kronor. Null tar bort månadens eget mål, så att det ärvs från månaden före. */
  mal?: Record<string, number | null>;
  arbetsdag?: Partial<TavlansInstallningar["arbetsdag"]>;
  rorelse?: TavlansInstallningar["rorelse"];
  firande?: Partial<Omit<TavlansInstallningar["firande"], "storAffar">> & {
    storAffar?: Partial<TavlansInstallningar["firande"]["storAffar"]>;
  };
  ljud?: Partial<TavlansInstallningar["ljud"]>;
};

export type Skrivning =
  | { handling: "spara"; delar: Delar }
  | { handling: "para"; kod: string; namn: string }
  | { handling: "byt_namn"; id: string; namn: string }
  | { handling: "ljud_skarm"; id: string; ljud: boolean }
  | { handling: "koppla_bort"; id: string }
  | { handling: "person"; id: string; display: Visning }
  | { handling: "testa"; typ: Testtyp };

/** Ett nej. `del` är fältet eller delen det gällde, så att klienten kan visa felet där. */
export type Avslag = { fel: string; del?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KLOCKSLAG = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Styrtecken, osynliga tecken och riktningsväxlingar. Ett namn står på TV:n och
 * i listan, och ett tecken som vänder texten eller inte syns hör inte hemma där.
 */
const KONSTIGA = /[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/;

/** Fälten handlingarna tar, utöver `handling`. Ett fält till är ett fel, inte något som tappas. */
const FALT: Record<Skrivning["handling"], readonly string[]> = {
  spara: ["delar"],
  para: ["kod", "namn"],
  byt_namn: ["id", "namn"],
  ljud_skarm: ["id", "ljud"],
  koppla_bort: ["id"],
  person: ["id", "display"],
  testa: ["typ"],
};

/**
 * Uppslag med `Record` över unionen, så att typkontrollen säger till när en
 * visning eller testtyp läggs till i `typer.ts` utan att läggas till här.
 */
const VISNINGAR: Record<Visning, true> = { namn: true, initialer: true, dold: true };
const TESTTYPER: Record<Testtyp, true> = { order: true, stor: true, forsta: true, serie: true, malet: true };

type Objekt = Record<string, unknown>;

/** Ett vanligt objekt: inte null och inte en lista. */
const arObjekt = (x: unknown): x is Objekt => typeof x === "object" && x !== null && !Array.isArray(x);

/** Bara egna nycklar. `"constructor"` och `"__proto__"` finns inte i en uppslagstabell. */
const finns = (tabell: object, nyckel: unknown): boolean => typeof nyckel === "string" && Object.hasOwn(tabell, nyckel);

/** Ett id: ett uuid, i små bokstäver. */
const idUr = (x: unknown): string | null => (typeof x === "string" && UUID.test(x) ? x.toLowerCase() : null);

/**
 * Ett namn på en skärm: sammansatt (NFC), blanksteg ihopslagna och trimmat, och
 * 1–60 tecken räknade som Postgres räknar dem (ett tecken utanför BMP är ett,
 * inte två). Ett styrtecken eller en riktningsväxling ger ett eget fel.
 */
function namnUr(x: unknown): string | Avslag {
  if (typeof x !== "string") return { fel: FEL.namn, del: "namn" };
  const namn = x.normalize("NFC").replace(/\s+/g, " ").trim();
  if (KONSTIGA.test(namn)) return { fel: FEL.namntecken, del: "namn" };
  const langd = [...namn].length;
  return langd >= 1 && langd <= NAMN_MAX ? namn : { fel: FEL.namn, del: "namn" };
}

// --- Delarna i `spara` --------------------------------------------------------

type Regel =
  | { typ: "brytare"; etikett: string }
  | { typ: "val"; etikett: string; alt: readonly string[] }
  | { typ: "heltal"; etikett: string; min: number; max: number; enhet: string }
  | { typ: "klockslag"; etikett: string }
  | { typ: "lag"; etikett: string }
  | { typ: "mal"; etikett: string }
  | { typ: "grupp"; etikett: string; falt: Record<string, Regel> };

/** En månad bland målen, "2026-10". */
const MALMANAD = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Målet för en månad: ett heltal i kronor inom gränserna. */
const malRegel = (manad: string): Regel => ({ typ: "heltal", etikett: `Målet för ${manad}`, ...MAL_GRANSER, enhet: " kr" });

const brytare = (etikett: string): Regel => ({ typ: "brytare", etikett });
const val = (etikett: string, alt: readonly string[]): Regel => ({ typ: "val", etikett, alt });
const klockslag = (etikett: string): Regel => ({ typ: "klockslag", etikett });
const heltal = (etikett: string, g: { min: number; max: number }, enhet = ""): Regel => ({ typ: "heltal", etikett, ...g, enhet });
const grupp = (etikett: string, falt: Record<string, Regel>): Regel => ({ typ: "grupp", etikett, falt });

/**
 * Inställningarnas form, fält för fält, med ett namn att säga i ett fel. Samma
 * fält som `tolka` i installningar.ts läser, och inga andra: `version` skrivs
 * aldrig utifrån.
 */
const FORMEN: Record<string, Regel> = {
  lag: { typ: "lag", etikett: "Laget" },
  namn: val("Namnformen", ["fornamn", "fornamn_e", "hela"] satisfies Namnform[]),
  ordning: val("Ordningen", ["varde", "antal"] satisfies Ordning[]),
  mal: { typ: "mal", etikett: "Målen" },
  arbetsdag: grupp("Arbetsdagen", { fran: klockslag("Arbetsdagens början"), till: klockslag("Arbetsdagens slut") }),
  rorelse: val("Rörelsen", ["full", "lugn"] satisfies TavlansInstallningar["rorelse"][]),
  firande: grupp("Firandet", {
    storAffar: grupp("Stor affär", {
      lage: val("Läget för stor affär", ["auto", "belopp"] satisfies TavlansInstallningar["firande"]["storAffar"]["lage"][]),
      belopp: heltal("Beloppet för stor affär", GRANSER.belopp, " kr"),
    }),
    forstaOrdern: brytare("Första ordern"),
    dagensForsta: brytare("Dagens första"),
    personbasta: brytare("Personbästa"),
    dagsrekord: brytare("Dagsrekord"),
    halvvags: brytare("Halvvägs"),
    maletNatt: brytare("Målet nått"),
    efterregistreradDagar: heltal("Efterregistrerad", GRANSER.efterregistreradDagar, " dagar"),
  }),
  ljud: grupp("Ljudet", {
    pa: brytare("Ljud på"),
    volym: heltal("Volymen", GRANSER.volym),
    fran: klockslag("Ljudtidens början"),
    till: klockslag("Ljudtidens slut"),
    helgTyst: brytare("Tyst på helger"),
  }),
};

const tal = (n: number) => new Intl.NumberFormat("sv-SE").format(n);

/**
 * Prövar ett värde mot sin regel. Ger värdet (en ny kopia för en grupp, bara med
 * kända fält) eller ett nej som pekar ut delen.
 */
function prova(regel: Regel, x: unknown, del: string): { varde: unknown } | Avslag {
  const nej = (krav: string): Avslag => ({ fel: `${regel.etikett} ska vara ${krav}.`, del });
  switch (regel.typ) {
    case "brytare":
      return typeof x === "boolean" ? { varde: x } : nej("på eller av");
    case "val":
      return typeof x === "string" && regel.alt.includes(x) ? { varde: x } : nej(`ett av ${regel.alt.join(", ")}`);
    case "heltal":
      return Number.isInteger(x) && (x as number) >= regel.min && (x as number) <= regel.max
        ? { varde: x }
        : nej(`ett heltal från ${tal(regel.min)} till ${tal(regel.max)}${regel.enhet}`);
    case "klockslag":
      return typeof x === "string" && KLOCKSLAG.test(x) ? { varde: x } : nej("ett klockslag som 08:00");
    case "lag": {
      if (x === null) return { varde: null };
      const id = idUr(x);
      return id ? { varde: id } : nej("ett lag eller alla");
    }
    case "mal": {
      if (!arObjekt(x) || Object.keys(x).length === 0) return nej("en eller flera månader med ett mål");
      const ut: Objekt = {};
      for (const [manad, varde] of Object.entries(x)) {
        const vag = `${del}.${manad}`;
        if (!MALMANAD.test(manad)) return { fel: `Okänd månad: ${manad}.`, del: vag };
        if (varde === null) {
          ut[manad] = null;
          continue;
        }
        const r = prova(malRegel(manad), varde, vag);
        if ("fel" in r) return r;
        ut[manad] = r.varde;
      }
      return { varde: ut };
    }
    case "grupp":
      return provaGrupp(regel.falt, x, del, regel.etikett);
  }
}

/** En grupp av fält. `del` är gruppens väg, och tom för inställningarna själva. */
function provaGrupp(falt: Record<string, Regel>, x: unknown, del: string, etikett: string): { varde: Objekt } | Avslag {
  if (!arObjekt(x)) return del ? { fel: `${etikett} ska vara en grupp av fält.`, del } : { fel: "Delarna ska vara ett objekt.", del: "delar" };
  const nycklar = Object.keys(x);
  if (nycklar.length === 0) return del ? { fel: `Inget att spara i ${del}.`, del } : { fel: FEL.inget };
  const ut: Objekt = {};
  for (const nyckel of nycklar) {
    const vag = del ? `${del}.${nyckel}` : nyckel;
    if (!finns(falt, nyckel)) return { fel: `Okänd del: ${vag}.`, del: vag };
    const r = prova(falt[nyckel], x[nyckel], vag);
    if ("fel" in r) return r;
    ut[nyckel] = r.varde;
  }
  return { varde: ut };
}

/**
 * Tolkar kroppen i en skrivning. Ger skrivningen, rensad och normaliserad, eller
 * ett nej med vad som var fel. Ingenting okänt följer med och ingenting tappas
 * tyst: ett okänt fält är ett nej.
 *
 * - `spara`: varje del prövas mot inställningarnas form. Tal utanför sina
 *   gränser ger nej i stället för att klippas. Arbetsdagens par prövas i
 *   `tillampa`, mot det som gäller nu.
 * - `para`: koden går genom `normaliseraKod` (med eller utan streck, små eller
 *   stora bokstäver) och blir åtta versaler utan streck, den form den hashas i.
 * - `person`: bara visningen (R33). Motiven finns inte längre (R38).
 */
export function tolkaSkrivning(kropp: unknown): Skrivning | Avslag {
  if (!arObjekt(kropp)) return { fel: FEL.ogiltig };
  const handling = kropp.handling;
  if (!finns(FALT, handling)) return { fel: FEL.handling };
  const h = handling as Skrivning["handling"];

  for (const nyckel of Object.keys(kropp)) {
    if (nyckel !== "handling" && !FALT[h].includes(nyckel)) return { fel: `Okänt fält: ${nyckel}.`, del: nyckel };
  }

  const id = () => idUr(kropp.id);
  switch (h) {
    case "spara": {
      const d = provaGrupp(FORMEN, kropp.delar, "", "Delarna");
      return "fel" in d ? d : { handling: h, delar: d.varde as Delar };
    }
    case "para": {
      const kod = normaliseraKod(kropp.kod as string);
      if (!kod) return { fel: FEL.kodform, del: "kod" };
      const namn = namnUr(kropp.namn);
      return typeof namn === "string" ? { handling: h, kod, namn } : namn;
    }
    case "byt_namn": {
      const i = id();
      if (!i) return { fel: FEL.id, del: "id" };
      const namn = namnUr(kropp.namn);
      return typeof namn === "string" ? { handling: h, id: i, namn } : namn;
    }
    case "ljud_skarm": {
      const i = id();
      if (!i) return { fel: FEL.id, del: "id" };
      return typeof kropp.ljud === "boolean" ? { handling: h, id: i, ljud: kropp.ljud } : { fel: "Ljudet ska vara på eller av.", del: "ljud" };
    }
    case "koppla_bort": {
      const i = id();
      return i ? { handling: h, id: i } : { fel: FEL.id, del: "id" };
    }
    case "person": {
      const i = id();
      if (!i) return { fel: FEL.id, del: "id" };
      if (!finns(VISNINGAR, kropp.display)) return { fel: "Visningen ska vara namn, initialer eller dold.", del: "display" };
      return { handling: h, id: i, display: kropp.display as Visning };
    }
    case "testa":
      return finns(TESTTYPER, kropp.typ) ? { handling: h, typ: kropp.typ as Testtyp } : { fel: "Testet finns inte.", del: "typ" };
  }
}

// --- Efter `uppdatera` --------------------------------------------------------

/** Regeln för en väg som "ljud.volym", eller undefined för en del som inte finns. */
function regelFor(vag: string): Regel | undefined {
  let falt: Record<string, Regel> = FORMEN;
  let regel: Regel | undefined;
  for (const bit of vag.split(".")) {
    if (regel?.typ === "mal") return MALMANAD.test(bit) ? malRegel(bit) : undefined;
    if (!finns(falt, bit)) return undefined;
    regel = falt[bit];
    falt = regel.typ === "grupp" ? regel.falt : {};
  }
  return regel;
}

/** Varje löv i `delar` som en väg och ett värde: `["ljud.volym", 30]`. */
function lov(delar: unknown, fore = ""): [string, unknown][] {
  if (!arObjekt(delar)) return [[fore, delar]];
  return Object.keys(delar).flatMap((nyckel) => lov(delar[nyckel], fore ? `${fore}.${nyckel}` : nyckel));
}

function vardeVid(objekt: unknown, vag: string): unknown {
  let x = objekt;
  for (const bit of vag.split(".")) x = arObjekt(x) && Object.hasOwn(x, bit) ? x[bit] : undefined;
  return x;
}

/**
 * Lägger `delar` ovanpå det som gäller nu (`uppdatera`) och kontrollerar att
 * varje del landade som den skickades. Ger hela inställningarna, eller ett nej
 * med den första delen som inte landade, och då sparas ingenting.
 *
 * Arbetsdagen är ett par som ska sluta efter att det börjar, prövat mot det som
 * gäller nu: `{till: "07:00"}` mot början 08:00 ger nej. Ljudtiden får gå över
 * midnatt. Delarna har normalt redan prövats i `tolkaSkrivning`; här fångas också
 * det som inte har det, och varje skillnad mellan rutten och installningar.ts.
 */
export function tillampa(nu: TavlansInstallningar, delar: Delar): { installningar: TavlansInstallningar } | Avslag {
  if (!arObjekt(delar)) return { fel: "Delarna ska vara ett objekt.", del: "delar" };
  const ny = uppdatera(nu, delar);
  for (const [vag, varde] of lov(delar)) {
    if (Object.is(vardeVid(ny, vag), varde)) continue;
    // Ett borttaget mål landar som ett mål som inte finns: månaden ärver det före.
    if (varde === null && vag.startsWith("mal.") && vardeVid(ny, vag) === undefined) continue;
    const regel = regelFor(vag);
    if (!regel) return { fel: `Okänd del: ${vag}.`, del: vag };
    // Ett värde som inte klarar sin regel säger regelns krav. Ett som klarar den
    // men ändå inte landade är arbetsdagens par, eller en gräns som glidit isär
    // från installningar.ts.
    const provat = prova(regel, varde, vag);
    if ("fel" in provat) return provat;
    if (vag.startsWith("arbetsdag.")) return { fel: FEL.arbetsdag, del: "arbetsdag" };
    return { fel: `${regel.etikett} gick inte att spara som ${JSON.stringify(varde)}.`, del: vag };
  }
  return { installningar: ny };
}

/** Inställningarnas rad i `nav_setting`, som den lästes, eller null när den inte finns än. */
export type Installningsrad = { value: unknown; updated_at: string } | null;

/** Så många gånger en sparning läser, lägger ihop och skriver innan den ger upp (R25). */
export const SPARFORSOK = 2;

/**
 * Det en sparning ska skriva: inställningarna med delarna ovanpå det som stod i
 * raden, och villkoret för skrivningen (R25, jämför och byt).
 *
 * `villkor` är radens `updated_at` som den lästes. Uppdateringen gäller bara om
 * raden fortfarande har den tiden, så att en annan sparning som hann emellan
 * inte skrivs över utan att synas. Null när raden inte finns: då en ny rad, och
 * en annan som hann före ger en krock på nyckeln.
 */
export function planeraSparning(rad: Installningsrad, delar: Delar): { installningar: TavlansInstallningar; villkor: string | null } | Avslag {
  const r = tillampa(normalisera(rad?.value), delar);
  return "fel" in r ? r : { installningar: r.installningar, villkor: rad ? rad.updated_at : null };
}

/**
 * Stämpeln en sparning skriver: nu, men alltid minst en millisekund efter den som
 * lästes (`villkor`). Då ändrar varje skrivning villkoret, också när två instanser
 * har klockor som går olika, och en sparning som läst samma rad som en annan kan
 * aldrig landa efter den (R25, den uppskjutna CAS-anmärkningen).
 */
export function nastaStampel(villkor: string | null, nu: string): string {
  const fore = villkor === null ? Number.NaN : Date.parse(villkor);
  const t = Date.parse(nu);
  return Number.isFinite(fore) && !(t > fore) ? new Date(fore + 1).toISOString() : nu;
}

/**
 * Efter ett försök: klart när skrivningen landade, annars en gång till (läs om,
 * lägg ihop, skriv), och efter `SPARFORSOK` försök en krock (409, `FEL.samtidigt`).
 */
export function efterForsok(forsok: number, landade: boolean): "klar" | "igen" | "krock" {
  if (landade) return "klar";
  return forsok < SPARFORSOK ? "igen" : "krock";
}

// -----------------------------------------------------------------------------
// Skärmarna
// -----------------------------------------------------------------------------

/** Kolumnerna listan läser ur `salesboard_screen`, och inga andra: ingen hash, ingen adress. */
export const SKARMKOLUMNER = "id, name, sound, created_at, claimed_at, last_seen_at, user_agent";

export type RaSkarm = {
  id: string;
  name: string;
  sound: boolean;
  created_at: string;
  claimed_at: string | null;
  last_seen_at: string | null;
  user_agent: string | null;
};

/** En skärm i inställningarnas lista. */
export type Skarm = {
  id: string;
  namn: string;
  ljud: boolean;
  /** När skärmen skapades (koden skrevs in), ISO. */
  skapad: string;
  /** När TV:n löste in koden, ISO. Null tills den gjort det. */
  parad: string | null;
  /** När TV:n senast hämtade tavlan, ISO. Skrivs högst en gång i minuten. */
  sedd: string | null;
  /** "Chrome 130 · Linux ARM", eller null. */
  webblasare: string | null;
  /** TV:ns egen webbläsare, där ljudet ofta är spärrat. */
  tv: boolean;
};

/** En tid som ISO med Z och millisekunder, som Safari läser. Det som inte går att läsa blir null. */
function isoUr(tid: string | null): string | null {
  const ms = tid ? Date.parse(tid) : Number.NaN;
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

const TV = /SMART-TV|SmartTV|Tizen|Web0S|webOS|NetCast|HbbTV|BRAVIA|Android TV|GoogleTV|\bAFT[A-Z]|CrKey|Roku|VIDAA/i;

/**
 * Webbläsaren i klartext ur user-agent: "Chrome 130 · Linux ARM", "Samsung-TV".
 * `tv` säger att det är TV:ns egen webbläsare, där ljudet ofta inte släpps fram
 * (spec §7: "Undvik TV:ns egen webbläsare om det ska låta").
 */
export function webblasarnamn(ua: string | null): { namn: string | null; tv: boolean } {
  if (!ua) return { namn: null, tv: false };
  const version = (monster: RegExp, namn: string) => {
    const m = monster.exec(ua);
    return m ? `${namn} ${m[1]}` : null;
  };
  const motor =
    version(/\bEdg(?:e|A|iOS)?\/(\d+)/, "Edge") ??
    version(/\bOPR\/(\d+)/, "Opera") ??
    version(/\bSamsungBrowser\/(\d+)/, "Samsung Internet") ??
    version(/\bFirefox\/(\d+)/, "Firefox") ??
    version(/\bChromium\/(\d+)/, "Chromium") ??
    version(/\bChrome\/(\d+)/, "Chrome") ??
    (/\bSafari\//.test(ua) ? version(/\bVersion\/(\d+)/, "Safari") : null);
  const plattform = /Tizen/i.test(ua)
    ? "Samsung-TV"
    : /Web0S|webOS|NetCast/i.test(ua)
      ? "LG-TV"
      : /CrKey/.test(ua)
        ? "Chromecast"
        : /Android TV|GoogleTV|\bAFT[A-Z]/.test(ua)
          ? "Android-TV"
          : /\bCrOS\b/.test(ua)
            ? "ChromeOS"
            : /Android/.test(ua)
              ? "Android"
              : /iPhone|iPad|iPod/.test(ua)
                ? "iOS"
                : /Macintosh|Mac OS X/.test(ua)
                  ? "macOS"
                  : /Windows/.test(ua)
                    ? "Windows"
                    : /Linux/.test(ua)
                      ? /aarch64|armv\d|\barm/i.test(ua)
                        ? "Linux ARM"
                        : "Linux"
                      : null;
  const delar = [motor, plattform].filter((d): d is string => d !== null);
  return { namn: delar.length ? delar.join(" · ") : "Okänd webbläsare", tv: TV.test(ua) };
}

/** Skärmarna för listan, på namn i svensk ordning (å, ä, ö efter z). Fält för fält, inget mer. */
export function formaSkarmar(rader: readonly RaSkarm[]): Skarm[] {
  return rader
    .map((r): Skarm => {
      const w = webblasarnamn(r.user_agent);
      return {
        id: r.id,
        namn: r.name,
        ljud: r.sound === true,
        skapad: isoUr(r.created_at) ?? r.created_at,
        parad: isoUr(r.claimed_at),
        sedd: isoUr(r.last_seen_at),
        webblasare: w.namn,
        tv: w.tv,
      };
    })
    .sort((a, b) => a.namn.localeCompare(b.namn, "sv") || a.skapad.localeCompare(b.skapad));
}

// -----------------------------------------------------------------------------
// Säljarna
// -----------------------------------------------------------------------------

/** Statusarna som räknas som aktiva: aktiv eller på väg in. Samma som `AKTIVA` i atkomstregler.ts. */
export { AKTIVA_STATUSAR };

/**
 * Kolumnerna ur `employee`, med rollerna inbäddade. Nyckeln är namngiven med
 * flit: `employee_role` pekar två gånger på `employee` (se `auth.ts`).
 */
export const ANSTALLDKOLUMNER = "id, first_name, last_name, team_id, status, employee_role!employee_role_employee_id_fkey(role)";

export type RaAnstalld = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  team_id: string | null;
  status: string;
  employee_role: { role: string }[] | null;
};

/** Säljarens val i `salesboard_person` (0250), läst som okänt: raden kan vara vad som helst. */
export type RaPersonval = { employee_id: string; display: unknown };

/** En säljare i inställningarnas kort. */
export type Saljare = {
  id: string;
  fornamn: string;
  efternamn: string;
  /** Lagets id, eller null. */
  lag: string | null;
  visning: Visning;
  /**
   * Varför personen står i listan, när det inte är för att hen är säljare:
   * "Slutat", eller rollen för den som säljer utan att vara säljare ("Säljchef",
   * "VD"). Null för en aktiv säljare.
   */
  varfor: string | null;
};

/** Kolumnerna ur `sales_order` som avgör vem tavlan kan visa, och inga andra. */
export const SALJORDERKOLUMNER = "salesperson_id, status, period_month, approved_at, cancel_period_month";

export type RaSaljorder = {
  salesperson_id: string;
  status: string;
  /** Signeringsmånaden, "2026-10-01". */
  period_month: string | null;
  approved_at: string | null;
  cancel_period_month: string | null;
};

/**
 * Visningen ur raden, med tavlans regel (`arDold`): bara exakt "namn" och
 * "initialer" visar något, och allt annat är dolt, så att kortet aldrig säger
 * "namn" om en säljare som tavlan döljer.
 */
const visningUr = (x: unknown): Visning => (arDold(x) ? "dold" : (x as Visning));

/**
 * Vilka säljare tavlan kan visa ur orderna, med `formaOgonblick`s två källor
 * (forma.ts): orderlistan, alltså godkända order (signerad eller betald) som
 * godkändes från `senasteFran`, och månadens bidrag, alltså order som godkänts
 * någon gång, signerats i månaden och inte makulerats i den. Bara order med ett
 * godkännande som går att läsa räknas, som där.
 *
 * Laget väljs av den som anropar: orderna ska redan vara lagets.
 */
export function tavlansPersoner(order: readonly RaSaljorder[], fonster: { manad: string; senasteFran: string }): Set<string> {
  const fran = Date.parse(fonster.senasteFran);
  const ut = new Set<string>();
  for (const o of order) {
    const godkand = o.approved_at ? Date.parse(o.approved_at) : Number.NaN;
    if (!Number.isFinite(godkand)) continue;
    const status = o.status as Orderstatus;
    const iListan = raknas(status) && godkand >= fran;
    const bidrag =
      harGodkants(status) && o.period_month === fonster.manad && !(status === "makulerad" && o.cancel_period_month === fonster.manad);
    if (iListan || bidrag) ut.add(o.salesperson_id);
  }
  return ut;
}

/** Den som säljer utan att vara säljare: den första rollen i navets ordning (`ROLES`). */
function rollFor(roller: readonly string[]): string {
  const roll = ROLES.find((r) => roller.includes(r));
  return roll ? ROLE_LABEL[roll] : "Utan roll";
}

/**
 * Alla som tavlan kan visa i laget (R28), med sina val, i svensk ordning på
 * förnamn och efternamn:
 *
 * - de aktiva vars roll kan sälja (`SALJANDE_ROLLER`: säljare, säljchef och VD,
 *   aktiv eller på väg in, R30), också de som inte sålt något än, så att "Dold"
 *   kan väljas innan första ordern firas med namn;
 * - alla som står i lagets order på tavlan (`tavlansPersoner`): chefen eller VD:n
 *   som säljer själv (472468e), och den som sålt och sedan slutat.
 *
 * Laget är `team_id` nu, som på tavlan. Null är alla lag. Den som saknar rad har
 * inte valt något och visas med namn, som på tavlan.
 */
export function formaSaljare(
  anstallda: readonly RaAnstalld[],
  val: readonly RaPersonval[],
  lag: string | null,
  order: readonly RaSaljorder[],
  fonster: { manad: string; senasteFran: string },
): Saljare[] {
  const valFor = new Map(val.map((v) => [v.employee_id, v]));
  const aktiva = new Set<string>(AKTIVA_STATUSAR);
  const laget = anstallda.filter((a) => lag === null || a.team_id === lag);
  const lagIds = new Set(laget.map((a) => a.id));
  const syns = tavlansPersoner(
    order.filter((o) => lagIds.has(o.salesperson_id)),
    fonster,
  );

  return laget
    .flatMap((a): Saljare[] => {
      const roller = (a.employee_role ?? []).map((r) => r.role);
      const aktiv = aktiva.has(a.status);
      const saljare = aktiv && roller.some((r) => SALJANDE_ROLLER.has(r));
      if (!saljare && !syns.has(a.id)) return [];
      const v = valFor.get(a.id);
      return [
        {
          id: a.id,
          fornamn: (a.first_name ?? "").trim(),
          efternamn: (a.last_name ?? "").trim(),
          lag: a.team_id,
          visning: v ? visningUr(v.display) : "namn",
          varfor: !aktiv ? "Slutat" : roller.includes("salesperson") ? null : rollFor(roller),
        },
      ];
    })
    .sort((a, b) => a.fornamn.localeCompare(b.fornamn, "sv") || a.efternamn.localeCompare(b.efternamn, "sv") || (a.id < b.id ? -1 : 1));
}

// -----------------------------------------------------------------------------
// Tröskeln för stor affär
// -----------------------------------------------------------------------------

/**
 * Tröskeln i läget "auto", som tavlan räknar den just nu. `percentil` säger om
 * den är topp 10 % (underlaget räcker) eller reserven, och `underlag` hur många
 * order de senaste 90 dagarna den räknades på.
 */
export type Troskel = { auto: number; percentil: boolean; underlag: number };

/**
 * Tröskeln ur statistiken (`salesboard_statistik`), med tavlans egen regel
 * (`troskelFranStatistik`). Utan statistik, innan 0250 körts, är det tavlans
 * tröskel utan statistik.
 *
 * `percentil` är samma villkor som regeln själv: en p90 räknad på minst
 * `MINSTA_UNDERLAG` order. En percentil som råkar vara lika stor som reserven är
 * fortfarande reserven när underlaget är för litet.
 */
export function troskelNu(statistik: Tavlestatistik | null): Troskel {
  const p90 = statistik?.p90 ?? null;
  const underlag = statistik?.antal90 ?? 0;
  return {
    auto: troskelFranStatistik(p90, underlag, { lage: "auto", belopp: GRANSER.belopp.min }),
    percentil: p90 !== null && underlag >= MINSTA_UNDERLAG,
    underlag,
  };
}

// -----------------------------------------------------------------------------
// Besluten i rutten och på sidan. Anropen gör de själva; här står vad svaren betyder.
// -----------------------------------------------------------------------------

/**
 * Vad `tavlansAdmin` gav: en admin, ett säkert nej (med eller utan session),
 * eller inget säkert svar alls, när den kastade.
 */
export type Atkomstlage = { typ: "admin"; id: string } | { typ: "nej"; session: boolean } | { typ: "oklart" };

/**
 * Rutternas nej. Bara ett säkert svar blir 401 eller 403. Det som inte går att
 * veta (databasen svarar inte) blir 503, så att en admin aldrig får höra att hen
 * inte är admin för att databasen hade en dålig minut. Null för en admin.
 */
export function atkomstsvar(a: Atkomstlage): { status: 401 | 403 | 503; fel: string } | null {
  if (a.typ === "admin") return null;
  if (a.typ === "oklart") return { status: 503, fel: FEL.svararInte };
  return a.session ? { status: 403, fel: FEL.inteAdmin } : { status: 401, fel: FEL.utloggad };
}

/**
 * Vem som får ändra tavlan: bara superadmin (beställaren 2026-10-25), alltså VD
 * och administratör. Säljchef och teamledare är admin och får nej, som säljaren.
 * `niva` är `nivaFor(roller)` i `src/lib/nav2/forma.ts`.
 */
export function farAndraTavlan(niva: string): boolean {
  return niva === "superadmin";
}

/**
 * Parningens inlösen, efter den villkorade uppdateringen. Allt utom "klar" tar
 * bort den nya skärmen igen: "ingen-kod" svarar 404 (`FEL.koden`), "fel" svarar
 * med felet.
 */
export function parningsutfall(losfel: unknown, losta: number): "klar" | "ingen-kod" | "fel" {
  if (losfel) return "fel";
  return losta > 0 ? "klar" : "ingen-kod";
}

/**
 * Är 0250 körd, sett från sidan? Skärmarna och säljarnas val kommer med samma
 * migration, och statistiken med den.
 *
 * - "ej": allt saknas, och korten för skärmar, säljare och test säger det lugnt.
 * - "installerad": skärmarna och valen svarar. Statistiken får saknas: tavlan
 *   går då på reserven, och tröskeln bredvid valet säger samma sak.
 * - "fel": ett riktigt fel, eller något saknas fast något annat ur 0250 svarar
 *   (`personvalen`). Ett "saknas" där gäller inte: att tro att ingen valt att
 *   vara dold hade visat dolda säljare med namn.
 */
export function installationslage(skarm: Lasning, val: Lasning, statistik: Lasning): "installerad" | "ej" | "fel" {
  if (skarm === "fel") return "fel";
  const valet = personvalen(val, [skarm, statistik]);
  if (valet === "fel") return "fel";
  if ((skarm === "saknas") !== (valet === "inga")) return "fel";
  return valet === "rader" ? "installerad" : "ej";
}

/**
 * Säljarna i kortet ur läsningarna. De anställda och orderna finns alltid, så
 * ett "saknas" där är ett fel. Valen följer `personvalen`: "inga-val" före
 * 0250, och ett fel när de saknas fast `ovriga` (det andra ur 0250 som lästes)
 * svarar. Vid "fel" visas ingen lista alls, aldrig en där en dold säljare står
 * med namn.
 */
export function saljarutfall(las: { anstallda: Lasning; order: Lasning; val: Lasning; ovriga: readonly Lasning[] }): "rader" | "inga-val" | "fel" {
  if (las.anstallda !== "svar" || las.order !== "svar") return "fel";
  const valet = personvalen(las.val, las.ovriga);
  return valet === "rader" ? "rader" : valet === "inga" ? "inga-val" : "fel";
}
