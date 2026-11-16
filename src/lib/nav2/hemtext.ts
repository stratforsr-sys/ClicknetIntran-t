/**
 * Hemvyn: texterna i korten och genomgångarna (designdokumentet, Texterna).
 *
 * Texterna skrivs av mallar, inte av AI. Samma data ger samma text, och texten
 * går att prova. Servern bygger raderna och skickar dem färdiga till
 * gränssnittet, så att det finns en enda plats där Navs röst bestäms.
 *
 * Tonen: korta meningar, antal före procent, aldrig en orsak Nav inte kan visa,
 * och "Det här ser jag inte" där det är sant. Nav säger vad den SER
 * ("Inget försök att nå kunden är noterat"), aldrig vad någon gjort eller inte
 * gjort.
 */
import { lokalDag, lokalKlockan, plusDagar } from "./motesflode.ts";
import type { AndringDom, Facit, MotesUtfall, Val } from "./forslagforma.ts";
import type { NAv } from "./statistik.ts";
import type { TaktTraff } from "./takt.ts";

/** Källraden under varje genomgång. Den är det som gör "jag" ärligt. */
export const KALLRAD = { regler: "Räknat av regler", ai: "Skrivet av AI ur Navs tal" } as const;

const ORD = ["noll", "en", "två", "tre", "fyra", "fem", "sex", "sju", "åtta", "nio", "tio"];
/** "en gång", "två gånger", "11 gånger". */
export function gangerText(n: number): string {
  return `${n >= 0 && n <= 10 ? ORD[n] : String(n)} ${n === 1 ? "gång" : "gånger"}`;
}
const stor = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const tal = (n: number): string => String(n).replace(".", ",");

const MANADER = ["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"];
const MAN_KORT = ["jan", "feb", "mars", "april", "maj", "juni", "juli", "aug", "sep", "okt", "nov", "dec"];
const VECKODAG = ["söndag", "måndag", "tisdag", "onsdag", "torsdag", "fredag", "lördag"];

/** "oktober" ur "2026-10". */
export function manadsnamn(manad: string): string {
  return MANADER[Number(manad.slice(5, 7)) - 1] ?? manad;
}

/** "i dag", "i morgon", "på måndag" (inom en vecka) eller "28 dec", för en kalenderdag sedd från en annan. */
export function dagText(dag: string, idag: string): string {
  if (dag === idag) return "i dag";
  if (dag === plusDagar(idag, 1)) return "i morgon";
  const d = new Date(`${dag}T12:00:00Z`);
  if (dag > idag && dag <= plusDagar(idag, 6)) return `på ${VECKODAG[d.getUTCDay()]}`;
  return `${d.getUTCDate()} ${MAN_KORT[d.getUTCMonth()]}`;
}

/** När ett möte är, sett från nu: dagen i ord och klockslaget med punkt ("09.00"). */
export function narText(moteTid: string, nu: Date, tz: string): { dag: string; kl: string } {
  return { dag: dagText(lokalDag(moteTid, tz), lokalDag(nu, tz)), kl: lokalKlockan(moteTid, tz).replace(":", ".") };
}

/* ------------------------------------------------------------------------ */
/* Första kedjan                                                             */
/* ------------------------------------------------------------------------ */

export type ObekraftatText = {
  kund: string;
  dag: string;
  kl: string;
  /** Förnamnet på den som bokade. null när hen inte längre finns. */
  bokare: string | null;
  /** Antal noterade försök att nå kunden (`mote.forsok`). */
  forsok: number;
  /** Läsaren bokade mötet själv. */
  jag: boolean;
};

/**
 * Det Nav säger när ett möte står obekräftat sista dagen. Tre rader: läget, hur
 * det brukar gå, och vad Nav inte ser. Antal, aldrig en orsak.
 */
const forsokText = (m: ObekraftatText): string =>
  m.forsok <= 0
    ? "Inget försök att nå kunden är noterat."
    : m.jag
      ? `Du har ringt ${gangerText(m.forsok)} utan svar.`
      : m.bokare
        ? `${m.bokare} har ringt ${gangerText(m.forsok)} utan svar.`
        : `Kunden har ringts ${gangerText(m.forsok)} utan svar.`;

/** Kortet Nav föreslår, för ett förslag: ett tal, vad talet räknar, en mening och förslagets egen knapp (skiss 9). */
export type KortForslag = { tal: string; vad: string; text: string; knapp: string };
export function textKortForslag(m: ObekraftatText): KortForslag {
  return { tal: "1", vad: `möte ${m.dag} är obekräftat`, text: `${m.kund} ${m.kl}. ${forsokText(m)}`, knapp: "Välj vad som händer" };
}

const ORD_EN = ["inga", "en", "två", "tre", "fyra", "fem", "sex", "sju", "åtta", "nio", "tio"];
const ordStor = (n: number) => { const o = ORD_EN[n] ?? String(n); return o[0].toUpperCase() + o.slice(1); };
/** Inledningen till genomgången Det som ändrats (skiss 9). `fet` står i fetstil mellan `fore` och `efter`. */
export function textAndratInledning(t: { foljs: number; bra: number; samre: number; tidiga: number }): { fore: string; fet: string; efter: string } {
  if (!t.foljs) return { fore: "Jag följer inga ändringar än.", fet: "", efter: " Berätta om en ändring, så följer jag måttet och säger hur det gick." };
  const fore = `Jag följer ${t.foljs === 1 ? "en ändring" : `${ORD_EN[t.foljs] ?? t.foljs} ändringar`}.`;
  const ensam = t.foljs === 1;
  const fet = t.bra ? (ensam ? "Den ser bra ut" : `${ordStor(t.bra)} ser bra ut`) : "";
  const delar = [
    t.bra ? " och går att ta vidare." : "",
    t.samre ? (ensam ? " Den ser sämre ut." : ` ${ordStor(t.samre)} ser sämre ut.`) : "",
    t.tidiga ? (ensam ? " Den är för tidig att döma." : ` ${ordStor(t.tidiga)} ${t.tidiga === 1 ? "är för tidig" : "är för tidiga"} att döma.`) : "",
    " Ingen ändring får ”ser bra ut” om något annat blev sämre på köpet.",
  ];
  return { fore, fet, efter: delar.join("") };
}

export function textObekraftat(m: ObekraftatText, trodde: NAv | null, forFa: boolean, bekraftade?: NAv | null): string[] {
  const forsok = forsokText(m);
  let hittills: string;
  if (!trodde || trodde.av === 0) hittills = "Jag har inga tidigare obekräftade möten att jämföra med.";
  else {
    hittills = `Hittills har ${trodde.n} av ${trodde.av} obekräftade möten hållits.`;
    if (forFa) hittills += " Det är för få för att säga något.";
    else if (bekraftade && bekraftade.av > 0) hittills += ` Av de bekräftade hölls ${bekraftade.n} av ${bekraftade.av}.`;
  }
  return [
    `Mötet med ${m.kund} ${m.dag} ${m.kl} är inte bekräftat. ${forsok}`,
    hittills,
    "Det här ser jag inte: om kunden har hört av sig på annat sätt.",
  ];
}

/** Kortets rad: "1 möte i morgon är obekräftat". `dag` null när mötena ligger på olika dagar. */
export function textKortObekraftade(antal: number, dag: string | null): string {
  const nar = dag ? ` ${dag}` : "";
  return antal === 1 ? `1 möte${nar} är obekräftat` : `${antal} möten${nar} är obekräftade`;
}

/**
 * Lagets öppna rader, hos den som leder laget: hur många möten som står
 * obekräftade och hur många av dem som saknar ett val. `dag` null när mötena
 * ligger på olika dagar.
 */
export function textLagetsOppna(antal: number, utanVal: number, dag: string | null): string {
  const start = `Obekräftade möten${dag ? ` ${dag}` : ""}: ${antal}`;
  if (utanVal === 0) return `${start}. ${antal === 1 ? "Valet är gjort." : "Alla har fått ett val."}`;
  if (antal === 1) return `${start}, utan val.`;
  return utanVal === antal ? `${start}, alla utan val.` : `${start}, varav ${utanVal} utan val.`;
}

/** Kvittot efter ett val. `dom` är när domen kommer, i ord ("på onsdag"). */
export function textKvitto(val: Val, dom: string): string {
  switch (val) {
    case "ringer-sjalv": return `Klart. Bekräftelsen ligger i din lista i dag. ${stor(dom)} säger jag hur det gick.`;
    case "lat-sta": return `Klart. Mötet står kvar som det är. ${stor(dom)} säger jag hur det gick.`;
    case "flytta": return "Klart. Mötet är flyttat. Står den nya tiden också obekräftad sista dagen frågar jag igen.";
  }
}

const VALDE: Record<Val | "ingen", string> = {
  "ringer-sjalv": "valde att ringa själv",
  "lat-sta": "valde att låta mötet stå",
  flytta: "valde att flytta mötet",
  ingen: "",
};

/**
 * Domen dagen efter mötet, för ett möte. Den säger vad som valdes, vad som hände
 * och om mötet blev bekräftat. Aldrig att valet orsakade utfallet, och aldrig
 * "jag hade rätt": ett enda möte går inte att gissa utan att nästan alltid få rätt.
 */
export function textDom(i: { kund: string; val: Val | "ingen"; utfall: MotesUtfall | null; bekraftat: boolean; vem?: string }): string {
  const vem = i.val === "ingen" ? "ingen valde" : `${i.vem ?? "du"} ${VALDE[i.val]}`;
  const start = `${i.kund}: ${vem}.`;
  const bekr = i.bekraftat ? "Det blev bekräftat före mötet." : "Mötet blev aldrig bekräftat.";
  switch (i.utfall) {
    case null: return `${start} Utfallet är inte satt. Jag dömer när det är det.`;
    case "okant": return `${start} Utfallet blev aldrig satt, så jag kan inte säga hur det gick.`;
    case "flyttat": return `${start} Mötet flyttades till en ny tid.`;
    case "hallet": return `${start} Mötet hölls. ${bekr}`;
    case "uteblev": return `${start} Kunden uteblev. ${bekr}`;
    case "avbokat": return `${start} Mötet avbokades. ${bekr}`;
  }
}

/* ------------------------------------------------------------------------ */
/* Navs facit                                                                */
/* ------------------------------------------------------------------------ */

/**
 * Navs facit per val, för hela laget. Antalen visas alltid. Domen säger aldrig
 * att valet orsakade utfallet: den som håller mötet väljer själv vilka möten hen
 * ringer om, och det står i samma mening som utslaget.
 */
export function textFacit(f: Facit): string {
  const r = f.per["ringer-sjalv"], l = f.per["lat-sta"], i = f.per.ingen;
  if (r.av === 0 && l.av === 0 && i.av === 0 && f.flyttade === 0) return "Inget facit än. Det kommer när de första mötena har fått ett utfall.";
  const delar: string[] = [];
  if (r.av > 0) delar.push(`När någon har ringt själv har ${r.n} av ${r.av} möten hållits.`);
  if (l.av > 0) delar.push(`Låt stå: ${l.n} av ${l.av}.`);
  if (i.av > 0) delar.push(`Ingen valde: ${i.n} av ${i.av}.`);
  if (f.flyttade > 0) delar.push(`Flyttade: ${f.flyttade}.`);
  switch (f.dom.sort) {
    case "tomt": delar.push("Det finns inget att jämföra med än."); break;
    case "for-fa":
      delar.push("För få för att skilja från slump.");
      if (f.dom.tidigast !== null) delar.push(`Tidigast vid runt ${f.dom.tidigast} möten, om skillnaden håller.`);
      break;
    case "utslag":
      delar.push(`Vid ${f.dom.vid} möten var skillnaden för stor för att vara slump. Den som håller mötet väljer vilka möten hen ringer om, så den visar inte att samtalet gjorde den.`);
      break;
    case "en-person":
      delar.push("En person står för mer än hälften av mötena i ett val. Då vore det här ett facit om den personen, så jag dömer inte.");
      break;
  }
  return delar.join(" ");
}

/** Samma facit på en rad, i förslaget hos den som ska välja. */
export function textFacitKort(f: Facit): string {
  const r = f.per["ringer-sjalv"], l = f.per["lat-sta"];
  if (r.av === 0 && l.av === 0) return "Inget facit i laget än.";
  const delar: string[] = [];
  if (r.av > 0) delar.push(`ringt själv ${r.n} av ${r.av} hölls`);
  if (l.av > 0) delar.push(`låt stå ${l.n} av ${l.av}`);
  const tal = `I laget hittills: ${delar.join(", ")}.`;
  if (f.dom.sort === "utslag") return `${tal} Skillnaden är för stor för att vara slump, men den visar inte att samtalet gjorde den.`;
  if (f.dom.sort === "for-fa" && f.dom.tidigast !== null) return `${tal} För få för att säga något, tidigast vid runt ${f.dom.tidigast} möten.`;
  return `${tal} För få för att säga något.`;
}

export function textTrodde(t: { raknade: number; av: number; blev: number }): string {
  return `Jag räknade med att ${t.raknade} av ${t.av} skulle hållas. Det blev ${t.blev}.`;
}

/* ------------------------------------------------------------------------ */
/* Teamet i månaden                                                          */
/* ------------------------------------------------------------------------ */

/**
 * Kortets tal och rader. Det stora talet är det säkra: order hittills, mot målet
 * när det finns. Prognosen säger själv att den är en uträkning på takten.
 */
export function textTakt(t: { netto: number; mal: number | null; prognos: number | null; utanMal: number; manad: string }): { stort: string; rad: string; malrad: string | null } {
  const stort = t.mal !== null ? `${t.netto} av ${t.mal} order` : `${t.netto} order`;
  const rad =
    t.prognos === null
      ? "För tidigt för en takt. Den kommer när månadens första arbetsdag har gått."
      : `I samma takt blir det ungefär ${t.prognos}. Det är en uträkning på takten, inget löfte.`;
  const malrad =
    t.mal === null
      ? `Inget mål satt för ${manadsnamn(t.manad)}.`
      : t.utanMal > 0
        ? `Mål saknas för ${t.utanMal} ${t.utanMal === 1 ? "person" : "personer"}.`
        : null;
  return { stort, rad, malrad };
}

const och = (l: string[]): string => (l.length <= 1 ? l.join("") : `${l.slice(0, -1).join(", ")} och ${l[l.length - 1]}`);

/**
 * Taktens facit, bredvid prognosen: vad takten sa vid samma antal gångna
 * arbetsdagar varje avslutad månad, och vad det blev. Också månaderna där den
 * missade. Kortet visar den senaste månaden, så att det ryms; genomgången
 * visar alla.
 */
export function textTaktFacit(traffar: readonly TaktTraff[], max = 1): string {
  const med = traffar.filter((t) => t.sa !== null).slice(0, max);
  if (!med.length) return "Takten har inget facit än. Det kommer när en månad är avslutad.";
  const g = med[0].gatt;
  const rad = `Efter ${g} ${g === 1 ? "dag" : "dagar"} sa takten ${och(med.map((t) => `${t.sa} i ${manadsnamn(t.manad)} (det blev ${t.blev})`))}.`;
  return med.some((t) => t.efterhand) ? `${rad} Räknat i efterhand ur orderna.` : rad;
}

/**
 * Kortets rad (skiss 9): takten och förra månadens facit i en mening.
 * En månad räknad i efterhand sägs som det var: takten "hade sagt" det.
 * Uträkningen och alla månader står i genomgången.
 */
export function textTaktKort(prognos: number | null, traffar: readonly TaktTraff[]): string {
  if (prognos === null) return "För tidigt för en takt. Den kommer när månadens första arbetsdag har gått.";
  const f = traffar.find((t) => t.sa !== null);
  const facit = f ? ` I ${manadsnamn(f.manad)} ${f.efterhand ? "hade takten sagt" : "sa takten"} ${f.sa}, det blev ${f.blev}.` : "";
  return `I samma takt blir det ungefär ${prognos}.${facit}`;
}

/* ------------------------------------------------------------------------ */
/* Det som ändrats                                                           */
/* ------------------------------------------------------------------------ */

/**
 * Domen över en ändring. "Ser bra ut", aldrig "fungerar". `motviktSamre` är
 * motviktens egen fras för att den blivit sämre ("färre möten hålls").
 */
export function textAndringDom(d: AndringDom, motviktSamre: string): string {
  const laget = (ord: string) =>
    d.helaLaget ? " Hela laget ändrade sig samtidigt, så jag har inget att jämföra med." : d.restenOcksa ? ` Resten av laget blev också ${ord}.` : "";
  switch (d.sort) {
    case "inget-fore": return "Inget före att jämföra med.";
    case "for-tidigt": return "För tidigt att säga.";
    case "ser-bra-ut": return `Ser bra ut.${laget("bättre")}`;
    case "battre-men": return `Bättre, men ${motviktSamre}.${laget("bättre")}`;
    case "ser-samre-ut": return `Ser sämre ut.${laget("sämre")}`;
    case "ingen-skillnad": return "Ingen skillnad som går att se.";
    case "for-fa": return "För få möten för att säga något.";
  }
}

/** En andel står aldrig utan sitt antal: bokade möten per vecka, före och efter. */
export function textAndel(k: NAv, bokade: { fore: number; efter: number }, verb = "uteblev"): string {
  return `${k.n} av ${k.av} ${verb}. Bokade per vecka: ${tal(bokade.fore)} före, ${tal(bokade.efter)} efter.`;
}

export function textTrendSaknas(har: number, behover: number): string {
  return `För att jämföra laget med sig självt behöver jag ${behover} avgjorda möten. Jag har ${har}.`;
}

/**
 * Felet till den som läser: kort svenska och en kod att slå upp i loggen. Själva felet (databasens eller
 * tjänstens text) skrivs bara i loggen, aldrig till klienten. `kod` är fem tecken, 0–9 och a–f.
 */
export function textFel(sort: "lasa" | "spara", kod: string): string {
  return `${sort === "lasa" ? "Det gick inte att läsa just nu." : "Det gick inte att spara just nu."} Försök igen. Felkod ${kod}.`;
}

/** En felkod på fem tecken ur en slumpad uuid. */
export const felkod = (): string => globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 5);

/** "Norr", "Norr och Syd", "Norr, Syd och Väst". Null när listan är tom. */
export function textLagnamn(namn: readonly string[]): string | null {
  if (!namn.length) return null;
  return namn.length === 1 ? namn[0] : `${namn.slice(0, -1).join(", ")} och ${namn[namn.length - 1]}`;
}
