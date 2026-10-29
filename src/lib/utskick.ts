import { HANDELSEKALLOR, NOTIS_KALLOR } from "./notiser.ts";

/**
 * UTSKICKEN — vem som får vad, i vilken kanal (0255).
 *
 * ===========================================================================
 * EN INSTÄLLNING FÖR ALLT SOM GÅR UT TILL EN ANSTÄLLD
 *
 * Beställaren 2026-10-29: "en allomfattande inställning" för vilka som får mejl,
 * på vad, och för notiserna — i båda naven. Fyra kanaler:
 *
 *   klocka  raderna i klockan (båda naven läser `hamtaNotiser`)
 *   mejl    händelsemejlen (`mejlaHandelse`)
 *   push    telefonen (`pushaHandelse`, kvällsnotisen, utbildningens påminnelse)
 *   morgon  morgonbrevet, avsnitt för avsnitt (`korMorgonjobbet`)
 *
 * Varje kanal har EN utgång i koden, och spärren sitter där — inte hos de
 * hundratals anropare som skapar händelserna. Därför gäller den lika i gamla
 * Nav och i Nav 2.0: båda skriver genom samma `notifiera()`.
 *
 * Inloggningskoderna går INTE härigenom och kan inte stängas av. De skickas av
 * Supabase Auth eller `kodmejl-server.ts`, och en avstängd kod är en utelåst
 * person. Detsamma gäller brev till folk utanför bolaget (kalenderns gäster,
 * kandidater, välkomstbrevet till en privat adress): de är inga notiser.
 *
 * ===========================================================================
 * FYRA LAGER, OCH BARA ETT AV DEM ÄR PERSONENS EGET
 *
 *   alla    superadmin, för hela bolaget
 *   niva    superadmin, för en nivå (säljare, admin, superadmin)
 *   person  superadmin, för en enskild person
 *   egen    personen själv
 *
 * Superadmins tre lager läses från det smalaste: står personen nämnd gäller
 * det, annars nivån, annars bolaget. Inom ett lager vinner den mest precisa
 * nyckeln — sorten före området före hela kanalen.
 *
 * DET EGNA LAGRET KAN BARA STÄNGA, ALDRIG ÖPPNA det superadmin stängt. Har
 * superadmin inte sagt något får personen däremot slå på en sort som är av som
 * standard (ett mejl om en godkänd order, till exempel). Beställarens svar
 * 2026-10-29: "Superadmin + var och en".
 * ===========================================================================
 */

export const KANALER = ["klocka", "mejl", "push", "morgon"] as const;
export type Kanal = (typeof KANALER)[number];

export const KANAL_NAMN: Record<Kanal, string> = {
  klocka: "Klockan",
  mejl: "Mejl",
  push: "Telefonen",
  morgon: "Morgonbrevet",
};

/** kanal → nyckel → på/av. Bara det som avviker sparas. */
export type Regler = Partial<Record<Kanal, Record<string, boolean>>>;

export const LAGER = ["alla", "niva", "person", "egen"] as const;
export type Lager = (typeof LAGER)[number];

/** Nav 2.0:s tre nivåer (`nivaFor` i nav2/forma.ts). */
export const NIVAER = ["salesperson", "admin", "superadmin"] as const;
export type Niva = (typeof NIVAER)[number];
export const NIVA_NAMN: Record<Niva, string> = {
  salesperson: "Säljare",
  admin: "Admin",
  superadmin: "Superadmin",
};

/** En persons fyra lager, hämtade ur `notification_rule`. */
export type Personlager = { alla?: Regler; niva?: Regler; person?: Regler; egen?: Regler };

/* ------------------------------------------------------------------------- */
/* Katalogen: områden och sorter                                             */
/* ------------------------------------------------------------------------- */

/**
 * Pushens egna sorter, som inte är rader i klockan. Kvällsnotisen till
 * ledarna (`hem-kvall.ts`) är bara en push.
 */
export const BARA_PUSH = ["kvallsnotis"] as const;

export type Omrade = { id: string; namn: string };

/** Ordningen är den som visas. */
export const OMRADEN: readonly Omrade[] = [
  { id: "order", namn: "Order" },
  { id: "provision", namn: "Provision" },
  { id: "lead", namn: "Leads" },
  { id: "kalender", namn: "Kalender och leveranser" },
  { id: "uppgift", namn: "Uppgifter och projekt" },
  { id: "tid", namn: "Tid" },
  { id: "lon", namn: "Lön" },
  { id: "franvaro", namn: "Frånvaro och sjukdom" },
  { id: "coachning", namn: "Coachning" },
  { id: "kurs", namn: "Utbildning" },
  { id: "rutin", namn: "Rutiner" },
  { id: "nyhet", namn: "Nyheter" },
  { id: "arende", namn: "Ärenden" },
  { id: "avtal", namn: "Avtal" },
  { id: "rekrytering", namn: "Rekrytering" },
  { id: "personal", namn: "Personal" },
  { id: "konto", namn: "Konto" },
  { id: "fel", namn: "Fel och driftlarm" },
  { id: "guide", namn: "Guider" },
  { id: "hem", namn: "Startsidan" },
];

const OMRADE_IDN = new Set(OMRADEN.map((o) => o.id));

/** Sorter vars område inte följer av prefixet. */
const OMRADE_UNDANTAG: Record<string, string> = {
  "order-avtalsslut": "avtal",
  "tjanst-avtalsslut": "avtal",
  "sjuk-frist": "franvaro",
  "certifikat-gar-ut": "kurs",
  "prov-ratta": "kurs",
  "prov-retur": "kurs",
  "prov-rattat": "kurs",
  "utbildning-fraga": "kurs",
  "utbildning-paminn": "kurs",
  "utbildning-repetition": "kurs",
  "utbildning-certifikat": "kurs",
  rollspel: "coachning",
  "rollspel-bedomt": "coachning",
  "kv-bedomning": "coachning",
  navnyhet: "nyhet",
  veckogenomgang: "uppgift",
  projektchatt: "uppgift",
  "utkorg-fel": "kalender",
  "kampanjsida-nere": "fel",
  "kampanjsida-uppe": "fel",
  kvallsnotis: "hem",
};

const PREFIX: [string, string][] = [
  ["sjuk", "franvaro"],
  ["leverans", "kalender"],
];

/** Området en sort hör till. Okända sorter hamnar i "Startsidan" hellre än att försvinna. */
export function omradeFor(kalla: string): string {
  if (OMRADE_UNDANTAG[kalla]) return OMRADE_UNDANTAG[kalla];
  const forsta = kalla.split("-")[0];
  for (const [p, o] of PREFIX) if (forsta === p) return o;
  return OMRADE_IDN.has(forsta) ? forsta : "hem";
}

/**
 * Sorternas namn, som de visas i inställningen. En sort utan namn här visas med
 * sitt id — provet `tests/utskick.mjs` faller då, så listan hålls hel.
 */
export const SORT_NAMN: Record<string, string> = {
  nyhet: "Ny nyhet att läsa",
  "nyhet-paminn": "Påminnelse om en oläst nyhet",
  navnyhet: "Nytt i navet",
  rutin: "Rutin att läsa och kvittera",
  "rutin-granskning": "Rutin att granska",
  "rutin-arkiverad": "Rutin arkiverad",
  "rutin-aterkoppling": "Återkoppling på en rutin",
  "rutin-svar": "Svar på en fråga om en rutin",
  "rutin-delad": "Rutin delad med dig",
  "rutin-kvittera": "Påminnelse att kvittera en rutin",
  "rutin-bevakning": "Bevakad rutin ändrad",
  kurs: "Kurs att gå",
  "prov-ratta": "Prov att rätta",
  "prov-retur": "Prov tillbaka för omtag",
  "prov-rattat": "Ditt prov är rättat",
  "certifikat-gar-ut": "Certifikat som går ut",
  "utbildning-fraga": "Fråga i en kurs",
  "utbildning-paminn": "Påminnelse om en kurs",
  "utbildning-repetition": "Dagens repetition",
  "utbildning-certifikat": "Certifikat att förnya",
  arende: "Nytt svar i ett ärende",
  "arende-tilldelad": "Ärende tilldelat dig",
  "arende-status": "Ärendets status ändrad",
  franvaro: "Frånvaro att besluta om",
  "franvaro-beslut": "Beslut om din frånvaro",
  "franvaro-lucka": "Lucka i bemanningen",
  "franvaro-forslag": "Förslag på frånvaro",
  "franvaro-konsekvens": "Konsekvens av frånvaro",
  "franvaro-tillbakadragen": "Frånvaro tillbakadragen",
  "franvaro-installd": "Frånvaro inställd",
  "franvaro-saldo": "Semestersaldot ändrat",
  "franvaro-havd": "Frånvaro hävd",
  "franvaro-registrerad": "Frånvaro registrerad åt dig",
  "franvaro-annan-period": "Frånvaro flyttad till annan period",
  sjuk: "Sjukanmälan att bekräfta",
  "sjuk-frist": "Frist för läkarintyg eller anmälan",
  "sjuk-bekraftad": "Sjukanmälan bekräftad",
  "sjuk-avslutad": "Sjukperiod avslutad",
  "sjuk-installd": "Sjukanmälan inställd",
  "sjuk-anteckning": "Anteckning på en sjukanmälan",
  rollspel: "Rollspel att göra",
  "rollspel-bedomt": "Rollspel bedömt",
  fel: "Felrapport",
  "fel-svar": "Svar på din felrapport",
  "fel-meddelande": "Meddelande om ett fel",
  "fel-lagad": "Fel lagat",
  "kampanjsida-nere": "Kampanjsida nere",
  "kampanjsida-uppe": "Kampanjsida uppe igen",
  guide: "Guide att gå igenom",
  "guide-knuff": "Påminnelse om en guide",
  "guide-team": "Teamets guider",
  "coachning-ny": "Ny coachning",
  coachning: "Coachning att följa upp",
  "coachning-kvittering": "Coachning att kvittera",
  "coachning-team": "Teamets coachning",
  "coachning-godkand": "Coachning godkänd",
  "coachning-avbruten": "Coachning avbruten",
  "coachning-samtal": "Coachningssamtal",
  "coachning-ovning": "Övning i coachningen",
  "coachning-rad": "Ny rad i coachningen",
  "coachning-forfragan": "Förfrågan om coachning",
  "coachning-datum": "Datum för coachning",
  "kv-bedomning": "K&V-bedömning",
  avtal: "Avtal att skriva under",
  "avtal-tillbakadraget": "Avtal tillbakadraget",
  "avtal-paminnelse": "Påminnelse om ett avtal",
  "order-avtalsslut": "Kundavtal som löper ut",
  "tjanst-avtalsslut": "Tjänsteavtal som löper ut",
  "provision-bokford": "Provision bokförd",
  "provision-mal": "Mål i provisionen",
  "provision-bonus": "Bonus uppnådd",
  "order-inskickad": "Order inskickad",
  "order-godkand": "Order godkänd",
  "order-returnerad": "Order returnerad",
  "order-makulerad": "Order makulerad",
  "order-betald": "Order betald",
  "order-overtack": "Order övertagen",
  "order-rattad": "Order rättad",
  "order-grattis": "Grattis till en order",
  "tid-rattelse": "Rättelse av tid att besluta",
  "tid-rattelse-beslut": "Beslut om din tidsrättelse",
  "tid-ostamplad": "Ostämplat skift",
  "tid-schema": "Schemat ändrat",
  "tid-avvikelse": "Avvikelse i tiden",
  "tid-avvikelse-avslutad": "Avvikelse avslutad",
  "tid-fraga": "Fråga om din tid",
  "tid-be-ratta": "Ombedd att rätta tid",
  "tid-paminnelse-ut": "Påminnelse att stämpla ut",
  "tid-veckokoll": "Veckans tidskoll",
  "tid-chef-morgon": "Morgonläget för chefen",
  "tid-chef-kvar": "Kvar att se över",
  "tid-schema-sett": "Schemat har setts",
  "tid-sen-forklaring": "Förklaring till sen stämpling",
  "lon-attesterad": "Lön attesterad",
  "lon-justering": "Justering av lön",
  "konto-roll": "Din roll ändrad",
  "konto-behorighet": "Din behörighet ändrad",
  "konto-losenord": "Ditt lösenord ändrat",
  "konto-aktiverad": "Ditt konto aktiverat",
  "konto-organisation": "Organisationen ändrad",
  "rekrytering-ny": "Ny kandidat",
  "rekrytering-steg": "Kandidat i nytt steg",
  "rekrytering-noshow": "Kandidat kom inte",
  "rekrytering-anstalld": "Kandidat anställd",
  "rekrytering-tips": "Tips om en kandidat",
  "rekrytering-tips-be": "Ombedd att tipsa",
  "personal-ny": "Ny i personalen",
  "personal-uppdrag": "Uppdrag i en anställning",
  "personal-paminn": "Påminnelse i en anställning",
  "personal-klart": "Anställningen klar",
  "personal-anstallning": "Någon anställd eller avslutad",
  uppgift: "Uppgift att göra",
  "uppgift-idag": "Uppgift i dag",
  "uppgift-ny": "Ny uppgift",
  "uppgift-returnerad": "Uppgift tillbaka",
  "uppgift-granska": "Uppgift att granska",
  "uppgift-vantar": "Uppgift som väntar",
  "uppgift-tilldelad": "Uppgift tilldelad dig",
  "uppgift-godkand": "Uppgift godkänd",
  "uppgift-kommentar": "Kommentar på en uppgift",
  "uppgift-avbruten": "Uppgift avbruten",
  "uppgift-paminnelse": "Påminnelse om en uppgift",
  veckogenomgang: "Veckogenomgången",
  projektchatt: "Projektchatten",
  "kalender-delad": "Kalender delad med dig",
  "kalender-aterkallad": "Delning återkallad",
  "kalender-inbjudan": "Inbjudan till ett möte",
  "kalender-flyttad": "Möte flyttat",
  "kalender-flyttad-tyst": "Möte ändrat i detaljer",
  "kalender-installd": "Möte inställt",
  "kalender-svar": "Svar på din inbjudan",
  "kalender-forslag": "Förslag på ny tid",
  "kalender-forslag-beslut": "Beslut om föreslagen tid",
  "kalender-paminnelse": "Påminnelse om ett möte",
  "kalender-punkt": "Punkt till ett 1:1",
  "kalender-forberedelse": "Förberedelse inför ett möte",
  "utkorg-fel": "Utskick som inte gick fram",
  "leverans-ny": "Ny leverans",
  "leverans-bokad": "Leverans bokad",
  "leverans-makulerad": "Leverans makulerad",
  "leverans-komplettera": "Leverans att komplettera",
  "leverans-frist": "Frist för en leverans",
  "leverans-studs": "Leveransens mejl studsade",
  "lead-ny": "Nytt lead",
  "lead-tilldelad": "Lead tilldelat dig",
  "lead-paminn": "Påminnelse om ett lead",
  kvallsnotis: "Kvällsnotisen om morgondagen",
};

const HANDELSER = new Set<string>(HANDELSEKALLOR);

/** Kanalerna en sort alls kan gå i. Mejl och push finns bara för det som HÄNDER. */
export function kanalerFor(kalla: string): Kanal[] {
  if ((BARA_PUSH as readonly string[]).includes(kalla)) return ["push"];
  return HANDELSER.has(kalla) ? ["klocka", "mejl", "push"] : ["klocka"];
}

/** Alla sorter, i katalogens ordning. */
export const SORTER: readonly string[] = [...NOTIS_KALLOR, ...BARA_PUSH];

/* ------------------------------------------------------------------------- */
/* Morgonbrevets avsnitt                                                     */
/* ------------------------------------------------------------------------- */

/** Rubrikerna är morgonbrevets egna (`AVSNITT` i jobb/morgon.ts). */
export const MORGON_AVSNITT = [
  { id: "forsenat", rubrik: "FÖRSENAT", namn: "Försenat" },
  { id: "idag", rubrik: "IDAG", namn: "I dag" },
  { id: "godkannande", rubrik: "VÄNTAR PÅ DITT GODKÄNNANDE", namn: "Väntar på ditt godkännande" },
  { id: "franvaro", rubrik: "FRÅNVARO ATT BESLUTA OM", namn: "Frånvaro att besluta om" },
  { id: "coachning", rubrik: "COACHNING", namn: "Coachning" },
  { id: "utbildning", rubrik: "UTBILDNING", namn: "Utbildning" },
  { id: "rutiner", rubrik: "RUTINER ATT GRANSKA", namn: "Rutiner att granska" },
  { id: "avtal", rubrik: "AVTAL SOM LÖPER UT", namn: "Avtal som löper ut" },
] as const;

export function avsnittId(rubrik: string): string | null {
  return MORGON_AVSNITT.find((a) => a.rubrik === rubrik)?.id ?? null;
}

/* ------------------------------------------------------------------------- */
/* Nycklarna och beslutet                                                    */
/* ------------------------------------------------------------------------- */

/** Nycklarna för en sort, från den mest precisa till hela kanalen. */
export function nycklarFor(kalla: string): string[] {
  return [`sort:${kalla}`, `omrade:${omradeFor(kalla)}`, "*"];
}

/** Nycklarna för ett avsnitt i morgonbrevet. */
export function nycklarForAvsnitt(id: string): string[] {
  return [`avsnitt:${id}`, "*"];
}

function forsta(regler: Regler | undefined, kanal: Kanal, nycklar: readonly string[]): boolean | undefined {
  const r = regler?.[kanal];
  if (!r) return undefined;
  for (const n of nycklar) if (typeof r[n] === "boolean") return r[n];
  return undefined;
}

/** Vad superadmin sagt om nycklarna för personen: person, nivå, bolaget. `undefined` = inget. */
export function superadminsVal(l: Personlager, kanal: Kanal, nycklar: readonly string[]): boolean | undefined {
  return forsta(l.person, kanal, nycklar) ?? forsta(l.niva, kanal, nycklar) ?? forsta(l.alla, kanal, nycklar);
}

/**
 * Får personen det här?
 *
 * `standard` är kanalens eget svar när ingen sagt något: klockan tar allt,
 * mejlet bara `MEJLKALLOR`, telefonen bara kalendern och de egna pushsorterna,
 * morgonbrevet alla avsnitt.
 */
export function far(l: Personlager, kanal: Kanal, nycklar: readonly string[], standard: boolean): boolean {
  const sa = superadminsVal(l, kanal, nycklar);
  if (sa === false) return false;
  const egen = forsta(l.egen, kanal, nycklar);
  if (egen !== undefined) return egen;
  return sa ?? standard;
}

/** Vad personen får göra med en nyckel: `last` när superadmin stängt den. */
export function lastAvSuperadmin(l: Personlager, kanal: Kanal, nycklar: readonly string[]): boolean {
  return superadminsVal(l, kanal, nycklar) === false;
}

/* ------------------------------------------------------------------------- */
/* Det som kommer från webbläsaren                                           */
/* ------------------------------------------------------------------------- */

const SORT_IDN = new Set(SORTER);
const AVSNITT_IDN = new Set<string>(MORGON_AVSNITT.map((a) => a.id));

/** Är nyckeln en som går att spara i kanalen? */
export function arNyckel(kanal: Kanal, nyckel: string): boolean {
  if (nyckel === "*") return true;
  if (kanal === "morgon") return nyckel.startsWith("avsnitt:") && AVSNITT_IDN.has(nyckel.slice(8));
  if (nyckel.startsWith("omrade:")) return OMRADE_IDN.has(nyckel.slice(7));
  if (nyckel.startsWith("sort:")) {
    const s = nyckel.slice(5);
    return SORT_IDN.has(s) && kanalerFor(s).includes(kanal);
  }
  return false;
}

export function arKanal(v: unknown): v is Kanal {
  return typeof v === "string" && (KANALER as readonly string[]).includes(v);
}

/**
 * En ändring: sätt nyckeln till på, av, eller ärv (`null`).
 * Returnerar nya regler, eller `null` om ändringen inte är giltig.
 */
export function andra(regler: Regler, kanal: unknown, nyckel: unknown, varde: unknown): Regler | null {
  if (!arKanal(kanal) || typeof nyckel !== "string" || !arNyckel(kanal, nyckel)) return null;
  if (varde !== true && varde !== false && varde !== null) return null;
  const ut: Regler = { ...regler, [kanal]: { ...(regler[kanal] ?? {}) } };
  if (varde === null) delete ut[kanal]![nyckel];
  else ut[kanal]![nyckel] = varde;
  if (Object.keys(ut[kanal]!).length === 0) delete ut[kanal];
  return ut;
}

/**
 * Samma som `andra`, men en bred nyckel tar med sig de smalare under sig: att
 * stänga hela mejlet suddar personens egna undantag i mejlet, att stänga ett
 * område suddar sorterna i det. Används för det EGNA lagret, där "Av" på hela
 * kanalen ska betyda av — inte "av utom det jag en gång slog på".
 * Superadmins lager behåller sina undantag; där visas de rad för rad.
 */
export function andraMedUnder(regler: Regler, kanal: unknown, nyckel: unknown, varde: unknown): Regler | null {
  const ut = andra(regler, kanal, nyckel, varde);
  if (!ut || varde === null || !arKanal(kanal)) return ut;
  const rad = ut[kanal];
  if (!rad) return ut;
  for (const n of Object.keys(rad)) {
    if (n === nyckel) continue;
    const under =
      nyckel === "*" ||
      (typeof nyckel === "string" && nyckel.startsWith("omrade:") && n.startsWith("sort:") && `omrade:${omradeFor(n.slice(5))}` === nyckel);
    if (under) delete rad[n];
  }
  return ut;
}

/** Läser en jsonb-kolumn ur databasen och släpper bara igenom giltiga nycklar. */
export function rensa(varde: unknown): Regler {
  const ut: Regler = {};
  if (!varde || typeof varde !== "object" || Array.isArray(varde)) return ut;
  for (const [k, r] of Object.entries(varde as Record<string, unknown>)) {
    if (!arKanal(k) || !r || typeof r !== "object" || Array.isArray(r)) continue;
    const rad: Record<string, boolean> = {};
    for (const [n, v] of Object.entries(r as Record<string, unknown>)) {
      if (typeof v === "boolean" && arNyckel(k, n)) rad[n] = v;
    }
    if (Object.keys(rad).length) ut[k] = rad;
  }
  return ut;
}

/** Antalet avstängda nycklar i ett lager, för en rad i listan över personer. */
export function antalAv(regler: Regler | undefined): number {
  let n = 0;
  for (const k of KANALER) for (const v of Object.values(regler?.[k] ?? {})) if (v === false) n++;
  return n;
}
