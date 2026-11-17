/**
 * Chatten: verktygen (designdokumentet 2026-11-15, Steg 3, och PRD:n 2026-11-16, fas 1).
 *
 * Claude räknar aldrig själv. Den frågar efter ett färdigt mått, och svaret bär
 * antal, "data per", vad måttet inte ser och om underlaget räcker.
 *
 * BEHÖRIGHETEN SITTER HÄR, inte i systemtexten. Varje verktyg går med den
 * inloggades krets (`mote_statkrets()`), så Claude kan aldrig få se mer än
 * personen själv får se i Nav. Verktygslistan är densamma för alla roller, så
 * att alla delar samma cache.
 *
 * Verktygen som börjar med `forbered_` läser inte, och de ändrar ingenting: de
 * bygger ett kort (`Handlingskort`) som säger exakt vad som ska göras. Trycker
 * personen på Godkänn skickar webbläsaren kortets steg till Navs vanliga
 * rutter, som den inloggade. Då gäller samma behörighet, samma logg och samma
 * regler som när personen gör det för hand.
 *
 * ETT NYTT VERKTYG läggs till här och bara här: en rad i `VERKTYG`, en gren i
 * `korVerktyg`, och en källa i `Kallor` om det läser något nytt.
 *
 * Källorna (`Kallor`) skickas in, så att filen är ren och provet går med
 * `node --experimental-strip-types`. De riktiga står i `kallor.ts`.
 */
import { MATT, bokadePerVecka, mattMoten, type MattNyckel, type MotesMatt } from "../matt.ts";
import { teamTal, type TeamOrder } from "../hemforma.ts";
import type { StatMote } from "../motesstatforma.ts";

export type Kallor = {
  /** null = alla, en lista = de personen får se, undefined = gick inte att läsa. */
  krets(): Promise<string[] | null | undefined>;
  /** Alla som arbetar här, med namn. Namnen syns redan i Nav; talen gör det inte. */
  personer(): Promise<{ id: string; namn: string }[]>;
  moten(franDag: string): Promise<StatMote[]>;
  order(krets: readonly string[] | null, franManad: string): Promise<TeamOrder[]>;
  forslag(): Promise<{ pa: boolean; oppna: { rubrik: string; rader: string[] }[]; andrat: { text: string; dom: string | null; tal: string | null }[]; trendrad: string | null }>;
  vantar(): Promise<{ sammanfattning: string; rader: string[] }>;
  dag(dag: string): Promise<{ poster: { rubrik: string; tid: string | null }[]; uppgifter: { titel: string; klar: boolean }[] }>;
  provision(manad: string): Promise<{ summa: number; bokfort: number; signerade: number; makulerade: number; netto: number; rader: { text: string; belopp: number }[] } | null>;
  /** De öppna affärerna personen får se i Möten. Kretsen prövas av verktyget, som för talen. */
  affarer(): Promise<Affar[]>;
  /** Det i kunskapsbasen och i de publicerade rutinerna som personen får läsa och som matchar sökorden. Kunskapsbasen först. `allaOrden`: träffarna har alla sökorden, inte bara något av dem. */
  kunskap(sokord: string): Promise<{ dokument: Dokument[]; allaOrden: boolean }>;
  /** En sökning utan träff, till listan över det kunskapsbasen saknar. Utan person. */
  kunskapMiss(sokord: string): Promise<void>;
};

/** En öppen affär: ett bolag på väg mot en order. Ett kort på tavlan i Möten. */
export type Affar = {
  kedja: string;
  bolag: string;
  deltagare: string[];
  /** Den som håller mötet, eller höll det senaste. Null när ingen har hållit ett. */
  ansvarig: string | null;
  /** Stegets namn (kolumnens namn ur företagets inställning) och hur nära avslut det är: högre är närmare. */
  steg: string;
  rang: number;
  belopp: number | null;
  /** Det öppna mötet, svensk lokal tid "ÅÅÅÅ-MM-DD HH:MM". */
  mote: { tid: string; flyttningar: number } | null;
  uppfoljning: { datum: string; text: string | null; ingetSvar: number; andrad: string | null } | null;
};
/** `kalla`: var texten ligger. Kunskapsbasen sköts i Inställningar, rutinerna i Rutiner. */
export type Dokument = { rubrik: string; omrade: string; text: string; andrad: string; kalla: "kunskapsbasen" | "rutiner" };

export type Ctx = { mig: string; idag: string; kallor: Kallor };
/** Ett steg är ett anrop till en av Navs vanliga rutter. `angra` tar tillbaka det; "$fält" byts mot fältet i ruttens svar. */
export type Steg = { vag: string; body: Record<string, unknown>; angra: Record<string, unknown> | null };
/** Kortet personen godkänner: vad som ska göras, rad för rad, och stegen som gör det. `varning` står före Godkänn, `klart` är kvittot efteråt. */
export type Handlingskort = { rubrik: string; rader: { text: string; dag: string | null; not: string }[]; steg: Steg[]; varning: string | null; klart: string };
export type Verktygssvar = { svar: Record<string, unknown>; kort?: Handlingskort };

const PERIODER = ["denna-vecka", "forra-veckan", "denna-manad", "forra-manaden"] as const;
type PeriodNyckel = (typeof PERIODER)[number];
const MATTNYCKLAR = Object.keys(MATT) as MattNyckel[];
const DATUM = /^\d{4}-\d{2}-\d{2}$/;
/** En hel månad som period (B3): "ÅÅÅÅ-MM". */
const HEL_MANAD = /^(\d{4})-(0[1-9]|1[0-2])$/;
/**
 * Så många månader bakåt går en hel månad att läsa, den pågående oräknad (B3). Mätt 2026-11-17 mot provdatabasen
 * (nav-prov): mötena tolv månader bakåt var 16 rader på en sida och tog 88–92 ms, lika lång tid som en månad bakåt
 * (93–99 ms); databasen har 16 möten. Det säger inget om produktionen. Läsningen går från månadens första dag fram
 * till i dag (`kallor.moten`), så den äldsta månaden är den dyraste: taket är det planens text säger.
 */
export const MANADER_BAKAT = 12;
const MANADNAMN = ["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"];
/** Under så här många rader säger verktyget att underlaget är för litet för en jämförelse. */
export const JAMFOR_MINST = 10;
export const UTKAST_MAX = 5;
/** Så många affärer räknas upp i ett svar. Summorna gäller alla. */
export const AFFARER_MAX = 10;
/** Så många dokument, och så många tecken ur vart och ett, går till Claude. */
export const DOKUMENT_MAX = 3;
export const DOKUMENT_TECKEN = 3000;

const obj = (properties: Record<string, unknown>) => ({ type: "object" as const, properties, required: Object.keys(properties), additionalProperties: false as const });

/** Verktygslistan. Fast ordning och fasta texter: den cachas, och provets avtryck räknas på den. */
export const VERKTYG = [
  {
    name: "las_matt",
    description:
      "Läser ett färdigt mått ur Navs måttregister för en person eller ett lag och en period. Svaret bär antal, av (nämnaren, för andelar), procent, motvikten, data per, vad måttet inte ser och om underlaget räcker för en jämförelse. Order räknas bara per månad.",
    strict: true,
    input_schema: obj({
      matt: { type: "string", enum: MATTNYCKLAR, description: "Måttets nyckel i registret." },
      vem: { type: "string", description: "\"jag\" för personen som frågar, \"laget\" för alla vars tal personen får se (för den som ser alla är det hela företaget), eller en kollegas namn." },
      period: { type: "string", description: "denna-vecka, forra-veckan, denna-manad, forra-manaden, eller en hel månad som ÅÅÅÅ-MM upp till ett år bakåt." },
    }),
  },
  {
    name: "las_forslag",
    description: "Läser Navs öppna förslag till personen, det som ändrats med sina domar, och hur långt trendregeln har kvar.",
    strict: true,
    input_schema: obj({}),
  },
  {
    name: "las_vantar",
    description: "Läser listan Väntar på dig: det som personen behöver göra eller besluta nu.",
    strict: true,
    input_schema: obj({}),
  },
  {
    name: "las_dag",
    description: "Läser personens kalender och uppgifter för en dag.",
    strict: true,
    input_schema: obj({ dag: { type: "string", description: "Dagen som ÅÅÅÅ-MM-DD." } }),
  },
  {
    name: "las_vecka",
    description: "Läser personens kalender och uppgifter för en hel vecka, måndag till söndag, dag för dag och med summorna för veckan. Samma slags fält per dag som las_dag.",
    strict: true,
    input_schema: obj({ dag: { type: "string", description: "En dag i veckan som ÅÅÅÅ-MM-DD." } }),
  },
  {
    name: "las_provision",
    description: "Läser personens eget provisionsunderlag för en månad, som provisionsmotorn räknat det. Aldrig någon annans.",
    strict: true,
    input_schema: obj({ manad: { type: "string", enum: ["denna-manad", "forra-manaden"] } }),
  },
  {
    name: "las_affarer",
    description:
      "Läser de öppna affärerna för en person eller ett lag: bolag på väg mot en order, med steg, belopp när det finns, nästa steg med dag och vad som står still. Närmast avslut står först. Svaret bär summan av beloppen med antalet affärer och hur många som har ett belopp, vad som har nästa steg senast söndag, och hur långt det räcker mot ett belopp personen nämner.",
    strict: true,
    input_schema: obj({
      vem: { type: "string", description: "\"jag\" för personen som frågar, \"laget\" för alla vars affärer personen får se, eller en kollegas namn." },
      mal_kr: { type: "integer", description: "Beloppet i kronor som personen vill nå, som ett heltal. Noll om frågan inte nämner ett belopp." },
    }),
  },
  {
    name: "sok_kunskap",
    description:
      "Söker i företagets kunskapsbas: hur företaget arbetar, vad det säljer, branscher, begrepp, rutiner och hur Nav fungerar. Svaret bär de dokument som matchar, med text och dagen de ändrades. En sökning utan träff sparas i listan över det kunskapsbasen saknar.",
    strict: true,
    input_schema: obj({ sokord: { type: "string", description: "Ett till fyra ord som beskriver det som söks, till exempel ämnet och branschen." } }),
  },
  {
    name: "forbered_uppgifter",
    description: "Förbereder en eller flera uppgifter, åt personen själv eller åt någon i personens lag. Ingenting skapas: personen ser ett kort med exakt vad som läggs upp och trycker själv på Godkänn.",
    strict: true,
    input_schema: obj({
      uppgifter: {
        type: "array",
        items: obj({
          titel: { type: "string", description: "Vad som ska göras, kort." },
          dag: { type: "string", description: "Dagen som ÅÅÅÅ-MM-DD, eller en tom sträng för ingen dag." },
          till: { type: "string", description: "\"jag\" för personen som frågar, eller namnet på kollegan som ska göra uppgiften." },
        }),
      },
    }),
  },
  {
    name: "forbered_uppfoljning",
    description: "Förbereder en ny dag för när kunden i en öppen affär ska kontaktas igen. Ingenting ändras: personen ser ett kort med bolaget och dagen och trycker själv på Godkänn. Gäller affärer utan bokat möte.",
    strict: true,
    input_schema: obj({
      bolag: { type: "string", description: "Bolagets namn, som det står i affären." },
      dag: { type: "string", description: "Den nya dagen som ÅÅÅÅ-MM-DD." },
    }),
  },
  {
    name: "fraga_tillbaka",
    description: "Ställer en fråga tillbaka när frågan kan betyda flera saker som ger olika svar: vilken kollega, vilket bolag, vilken period. Personen ser frågan med alternativen som knappar och väljer ett. Använd det bara när ett verktygssvar eller frågan visar flera möjliga svar, aldrig för att bekräfta något som redan är tydligt.",
    strict: true,
    input_schema: obj({
      fraga: { type: "string", description: "Frågan, som en kort mening utan tal." },
      alternativ: { type: "array", items: { type: "string" }, description: "Två till fyra alternativ, ordagrant ur verktygssvarets kandidater eller ur frågan." },
    }),
  },
] as const;

/** B2: verktyget som avslutar frågan med ett val i stället för ett svar. Slingan kör det aldrig som en läsning (samtal.ts). */
export const FRAGA_TILLBAKA = "fraga_tillbaka";
/** Högst så många `kandidater` i ett svar som säger att flera matchar. fraga_tillbaka visar två till fyra av dem. */
export const KANDIDATER_MAX = 10;

const utc = (dag: string) => new Date(`${dag}T12:00:00Z`);
const plus = (dag: string, n: number) => new Date(utc(dag).getTime() + n * 86_400_000).toISOString().slice(0, 10);
const PERIODTEXT: Record<PeriodNyckel, string> = { "denna-vecka": "den här veckan", "forra-veckan": "förra veckan", "denna-manad": "den här månaden", "forra-manaden": "förra månaden" };

/** En hel månad ("2026-10") som den läses: "oktober 2026". Undefined för allt annat. */
const manadText = (period: string): string | undefined => {
  const m = HEL_MANAD.exec(period);
  return m ? `${MANADNAMN[Number(m[2]) - 1]} ${m[1]}` : undefined;
};

/**
 * Perioden i svenska dagar. En pågående period slutar i dag. `manad` är satt för månadsperioderna. En hel månad
 * ("ÅÅÅÅ-MM", B3) går högst MANADER_BAKAT månader bakåt och aldrig framåt; den pågående månaden slutar i dag.
 */
export function periodFor(period: string, idag: string): { fran: string; till: string; manad: string | null; text: string } | null {
  if (!DATUM.test(idag)) return null;
  const hel = HEL_MANAD.exec(period);
  if (hel) {
    const ar = Number(hel[1]), man = Number(hel[2]);
    const bakat = (Number(idag.slice(0, 4)) - ar) * 12 + (Number(idag.slice(5, 7)) - man);
    if (bakat < 0 || bakat > MANADER_BAKAT) return null;
    const sista = new Date(Date.UTC(ar, man, 0, 12)).toISOString().slice(0, 10);
    return { fran: `${period}-01`, till: bakat === 0 ? idag : sista, manad: period, text: manadText(period)! };
  }
  if (!(PERIODER as readonly string[]).includes(period)) return null;
  const p = period as PeriodNyckel;
  const text = PERIODTEXT[p];
  const mandag = plus(idag, -((utc(idag).getUTCDay() + 6) % 7));
  if (p === "denna-vecka") return { fran: mandag, till: idag, manad: null, text };
  if (p === "forra-veckan") return { fran: plus(mandag, -7), till: plus(mandag, -1), manad: null, text };
  if (p === "denna-manad") return { fran: `${idag.slice(0, 7)}-01`, till: idag, manad: idag.slice(0, 7), text };
  const sista = plus(`${idag.slice(0, 7)}-01`, -1);
  return { fran: `${sista.slice(0, 7)}-01`, till: sista, manad: sista.slice(0, 7), text };
}

export const MATTNAMN: Record<MattNyckel, string> = {
  "moten.uteblivna": "uteblivna möten",
  "moten.hallna-av-alla": "hållna möten",
  "moten.bekraftade": "bekräftade möten",
  "order.netto": "order",
  "order.makulerade": "makulerade order",
};
const kort = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const arJag = (v: string) => ["jag", "mig", "mina", "min"].includes(v);
const arLaget = (v: string) => ["laget", "teamet", "alla"].includes(v);

/** Raden som visas medan verktyget kör. Inget döljer väntetiden. */
export function hamtarText(namn: string, input: Record<string, unknown>): string {
  switch (namn) {
    case "las_matt": {
      const vem = kort(input.vem, 40).toLowerCase();
      const for_ = arJag(vem) ? "dig" : arLaget(vem) ? "laget" : kort(input.vem, 40) || "dig";
      // Perioden är en fri text sedan B3: bara de kända nycklarna och en hel månad blir ord.
      const p = typeof input.period === "string" && Object.hasOwn(PERIODTEXT, input.period) ? PERIODTEXT[input.period as PeriodNyckel] : manadText(String(input.period ?? ""));
      return `Hämtar ${MATTNAMN[input.matt as MattNyckel] ?? "ett mått"} för ${for_}${p ? `, ${p}` : ""}.`;
    }
    case "las_forslag": return "Hämtar Navs förslag och det som ändrats.";
    case "las_vantar": return "Hämtar det som väntar på dig.";
    case "las_dag": return `Hämtar kalendern och uppgifterna för ${DATUM.test(String(input.dag)) ? String(input.dag) : "dagen"}.`;
    case "las_vecka": return `Hämtar kalendern och uppgifterna för veckan med ${DATUM.test(String(input.dag)) ? String(input.dag) : "dagen"}.`;
    case "las_provision": return "Hämtar din provision.";
    case "las_affarer": {
      const vem = kort(input.vem, 40).toLowerCase();
      return `Hämtar de öppna affärerna för ${arJag(vem) || !vem ? "dig" : arLaget(vem) ? "laget" : kort(input.vem, 40)}.`;
    }
    case "sok_kunskap": return "Söker i kunskapsbasen.";
    case "forbered_uppgifter": return "Förbereder uppgifter att godkänna.";
    case "forbered_uppfoljning": return "Förbereder en ny dag för uppföljningen.";
    default: return "Hämtar.";
  }
}

const NEJ = "Det får du inte se.";
/** Kretsen gick inte att läsa: en källa som föll, inte en regel som sa nej. */
export const KRETSFEL = "Det gick inte att läsa vilka du får se.";

/** Ett fel från `vemKrets` som verktygets svar, med kandidaterna när flera heter så (B2). */
const vemFel = (v: { fel: string; kandidater?: string[] }): { fel: string; kandidater?: string[] } => (v.kandidater ? { fel: v.fel, kandidater: v.kandidater } : { fel: v.fel });

/**
 * Vems tal frågan gäller, och om den som frågar får se dem. Heter flera så får svaret `kandidater` (B2), bara de
 * personen får se: ett namn utanför kretsen når aldrig Claude. Ser personen ingen av dem är svaret detsamma som för en
 * enda person utanför kretsen.
 */
async function vemKrets(vem: unknown, c: Ctx): Promise<{ krets: readonly string[] | null; namn: string } | { fel: string; kandidater?: string[] }> {
  const k = await c.kallor.krets();
  if (k === undefined) return { fel: KRETSFEL };
  const v = kort(vem, 80).toLowerCase();
  if (!v || arJag(v)) return { krets: [c.mig], namn: "Du" };
  if (arLaget(v)) {
    if (k !== null && !k.some((id) => id !== c.mig)) return { fel: NEJ };
    return { krets: k, namn: k === null ? "Hela företaget" : "Ditt lag" };
  }
  const folk = await c.kallor.personer();
  const hela = folk.filter((p) => p.namn.toLowerCase() === v);
  const traffar = hela.length ? hela : folk.filter((p) => p.namn.toLowerCase().split(" ")[0] === v);
  if (!traffar.length) return { fel: "Jag hittar ingen med det namnet." };
  if (traffar.length > 1) {
    const synliga = traffar.filter((p) => p.id === c.mig || k === null || k.includes(p.id));
    if (!synliga.length) return { fel: NEJ };
    // Felet säger bara att flera heter så, inte hur Claude ska fråga: det säger systemtexten (fraga_tillbaka med kandidaterna).
    return { fel: "Flera heter så.", kandidater: [...new Set(synliga.map((p) => kort(p.namn, 80)))].slice(0, KANDIDATER_MAX) };
  }
  const p = traffar[0];
  if (p.id !== c.mig && k !== null && !k.includes(p.id)) return { fel: NEJ };
  return { krets: [p.id], namn: p.id === c.mig ? "Du" : p.namn };
}

/** Felet för en period som inte finns räknar upp de som finns (B3), med månaderna i ord så att de inte läses som tal. */
function perioderFel(idag: string): string {
  const aldsta = new Date(Date.UTC(Number(idag.slice(0, 4)), Number(idag.slice(5, 7)) - 1 - MANADER_BAKAT, 1, 12)).toISOString().slice(0, 7);
  return `Den perioden kan jag inte läsa. Perioderna som finns är denna-vecka, forra-veckan, denna-manad, forra-manaden och en hel månad från ${manadText(aldsta)} till ${manadText(idag.slice(0, 7))}.`;
}

async function lasMatt(input: Record<string, unknown>, c: Ctx): Promise<Record<string, unknown>> {
  const nyckel = String(input.matt ?? "") as MattNyckel;
  if (!MATTNYCKLAR.includes(nyckel)) return { fel: "Det måttet finns inte i registret." };
  const p = periodFor(String(input.period ?? ""), c.idag);
  if (!p) return { fel: perioderFel(c.idag) };
  const m = MATT[nyckel];
  const order = nyckel === "order.netto" || nyckel === "order.makulerade";
  if (order && !p.manad) return { fel: "Order räknas per månad. Fråga om den här månaden eller förra månaden." };
  const vem = await vemKrets(input.vem, c);
  if ("fel" in vem) return vemFel(vem);
  const gemensamt = { matt: nyckel, vad: m.text, vem: vem.namn, period: p.text, fran: p.fran, till: p.till, dataPer: c.idag, serInte: m.serInte };

  if (order) {
    const tal = teamTal(await c.kallor.order(vem.krets, p.manad!), [], vem.krets, p.manad!);
    const antal = nyckel === "order.netto" ? tal.netto : tal.makulerade;
    return {
      ...gemensamt, antal,
      motvikt: { matt: m.motvikt, antal: nyckel === "order.netto" ? tal.makulerade : tal.netto },
      vantarPaGodkannande: tal.vantar,
      rackerForJamforelse: antal >= JAMFOR_MINST,
    };
  }
  const moten = await c.kallor.moten(p.fran);
  const period = { fran: p.fran, till: p.till };
  const s = mattMoten(nyckel as MotesMatt, moten, period, vem.krets);
  const mv = m.motvikt ? mattMoten(m.motvikt as MotesMatt, moten, period, vem.krets) : null;
  return {
    ...gemensamt,
    antal: s.n, av: s.av, procent: s.av ? Math.round((s.n / s.av) * 100) : null,
    motvikt: mv ? { matt: m.motvikt, antal: mv.n, av: mv.av, procent: mv.av ? Math.round((mv.n / mv.av) * 100) : null } : null,
    bokadePerVecka: bokadePerVecka(moten, period, vem.krets),
    rackerForJamforelse: s.av >= JAMFOR_MINST,
  };
}

async function lasDag(input: Record<string, unknown>, c: Ctx): Promise<Record<string, unknown>> {
  const dag = String(input.dag ?? "");
  if (!DATUM.test(dag) || Number.isNaN(utc(dag).getTime())) return { fel: "Dagen ska skrivas som ÅÅÅÅ-MM-DD." };
  const d = await c.kallor.dag(dag);
  const kvar = d.uppgifter.filter((u) => !u.klar);
  // Navs uppgiftslista bär det som blivit klart de senaste 14 dagarna. Längre bak går antalet klara inte att säga.
  const forGammal = dag < plus(c.idag, -KLARA_DAGAR);
  return {
    dag, dataPer: c.idag,
    kalenderposter: d.poster.length, poster: d.poster.slice(0, 30).map((x) => ({ rubrik: kort(x.rubrik, 120), tid: x.tid })),
    uppgifterKvar: kvar.length, uppgifterKlara: forGammal ? null : d.uppgifter.length - kvar.length, uppgifter: kvar.slice(0, 30).map((u) => kort(u.titel, 120)),
    serInte: DAG_SER_INTE,
  };
}

/** Högst så många kalenderposter, och så många uppgifter, per dag i las_vecka. Antalen (`kalenderposter`, `uppgifterKvar`) räknar alla. */
export const VECKA_POSTER = 10;

/**
 * B5: en hel vecka, måndag till söndag, dag för dag med samma slags fält som las_dag (kalenderposter, poster, uppgifter kvar
 * och deras titlar; inte de klara), och summorna för veckan. Summorna räknas
 * här, ur samma dagar, aldrig av Claude. Dagarna läses med `kallor.dag`, som läser kalendern en gång per vecka och
 * uppgifterna en gång per fråga (N1): sju dagar är en läsning av varje.
 */
async function lasVecka(input: Record<string, unknown>, c: Ctx): Promise<Record<string, unknown>> {
  const dag = String(input.dag ?? "");
  if (!DATUM.test(dag) || Number.isNaN(utc(dag).getTime())) return { fel: "Dagen ska skrivas som ÅÅÅÅ-MM-DD." };
  const fran = plus(dag, -((utc(dag).getUTCDay() + 6) % 7));
  const dagar = await Promise.all(Array.from({ length: 7 }, (_x, n) => plus(fran, n)).map(async (d) => {
    const x = await c.kallor.dag(d);
    // Uppgifternas titlar per dag, som i las_dag: beskrivningen lovar samma slags fält, och "Vilka uppgifter har jag
    // nästa vecka?" ska inte kräva sju las_dag (granskningen). Tillägget B5:s svarsform saknade dem.
    const kvar = x.uppgifter.filter((u) => !u.klar);
    return { dag: d, kalenderposter: x.poster.length, poster: x.poster.slice(0, VECKA_POSTER).map((p) => ({ rubrik: kort(p.rubrik, 120), tid: p.tid })), uppgifterKvar: kvar.length, uppgifter: kvar.slice(0, VECKA_POSTER).map((u) => kort(u.titel, 120)) };
  }));
  return {
    fran, till: plus(fran, 6), dataPer: c.idag,
    kalenderposter: dagar.reduce((n, d) => n + d.kalenderposter, 0),
    uppgifterKvar: dagar.reduce((n, d) => n + d.uppgifterKvar, 0),
    dagar,
    serInte: DAG_SER_INTE,
  };
}

/** Så långt bak bär Navs uppgiftslista det som blivit klart (`byggUppgifter`). */
const KLARA_DAGAR = 14;
/** Vad las_dag och las_vecka inte ser. */
const DAG_SER_INTE = `Ser inte kalendrar utanför Nav, inte uppgifter utan dag och inte uppgifter som blev klara för mer än ${KLARA_DAGAR} dagar sedan. Frister, ledighet och möten du tackat nej till räknas inte som kalenderposter.`;
/** Slagen i kalendern som är en bokad tid. Frister, ledighet och uppgifter är det inte. */
const BOKADE_SLAG = ["mote", "enskilt", "leverans", "coachning"];

/**
 * Det `las_dag` läser ur kalendern och uppgiftslistan för en dag: bokade tider
 * som personen inte tackat nej till, och personens egna uppgifter med frist den
 * dagen. En avbruten uppgift är varken kvar eller klar. Ren, så att provet håller den.
 */
export function dagUr(
  poster: readonly { dag: string; slag: string; rubrik: string | null; start: number | null; svar: string | null }[],
  uppgifter: readonly { due: string | null; vy: string; t: string; lage: string }[],
  dag: string,
): { poster: { rubrik: string; tid: string | null }[]; uppgifter: { titel: string; klar: boolean }[] } {
  const klockslag = (min: number | null) => (min === null ? null : `${String(Math.floor(min / 60)).padStart(2, "0")}.${String(min % 60).padStart(2, "0")}`);
  return {
    poster: poster
      .filter((p) => p.dag === dag && BOKADE_SLAG.includes(p.slag) && p.svar !== "nej")
      .sort((a, b) => (a.start ?? -1) - (b.start ?? -1))
      .map((p) => ({ rubrik: p.rubrik ?? "Upptagen", tid: klockslag(p.start) })),
    uppgifter: uppgifter.filter((u) => u.due === dag && u.vy === "egen" && u.lage !== "avbruten").map((u) => ({ titel: u.t, klar: u.lage === "klar" })),
  };
}

async function lasProvision(input: Record<string, unknown>, c: Ctx): Promise<Record<string, unknown>> {
  // Bara de två månaderna i verktygets schema: hela månader bakåt (B3) gäller las_matt.
  const manad = String(input.manad ?? "");
  const p = manad === "denna-manad" || manad === "forra-manaden" ? periodFor(manad, c.idag) : null;
  if (!p?.manad) return { fel: "Provisionen läses per månad: den här eller förra." };
  const u = await c.kallor.provision(p.manad);
  if (!u) return { fel: "Provisionsunderlaget saknas eller går inte att läsa för den månaden." };
  return {
    manad: p.manad, period: p.text, dataPer: c.idag,
    summa: u.summa, bokfort: u.bokfort, signerade: u.signerade, makulerade: u.makulerade, netto: u.netto,
    antalRader: u.rader.length, rader: u.rader.slice(0, 40).map((r) => ({ text: kort(r.text, 120), belopp: r.belopp })),
    serInte: "Ser inte order som inte är godkända än, och en pågående månad kan ändras tills den stängs.",
  };
}

/** Kolumnerna på tavlan i Möten, efter hur nära avslut de är. En affär utan öppet möte är i uppföljning eller har en offert. */
const RANG: Record<string, number> = { bokat: 1, att_bekrafta: 1, bekraftat: 2, hos_saljaren: 3 };
export const STEG_UPPFOLJNING = "Uppföljning";
export const STEG_OFFERT = "Offert skickad";

/**
 * En affär ur ett kort på tavlan i Möten. Ren, så att provet håller den. Stegets namn är kolumnens namn ur
 * företagets inställning. En skickad offert är närmast avslut, också när ett nytt möte är bokat.
 */
export function affarUr(
  k: {
    kedja: string; namn: string; fas: string; deltagare: readonly string[];
    mote: { tid: string; flyttningar: number; hallsAv: string } | null;
    uppfoljning: { datum: string; text: string | null; offert: boolean; offertBelopp: number | null; ingetSvar: number; andrad: string | null } | null;
    senast: { hallsAv: string } | null;
  },
  kolumnnamn: Readonly<Record<string, string>>,
): Affar {
  const offert = k.uppfoljning?.offert === true;
  return {
    kedja: k.kedja, bolag: k.namn, deltagare: [...k.deltagare],
    ansvarig: k.mote?.hallsAv || k.senast?.hallsAv || null,
    steg: offert ? STEG_OFFERT : k.mote ? kolumnnamn[k.fas] ?? k.fas : STEG_UPPFOLJNING,
    rang: offert ? 4 : k.mote ? RANG[k.fas] ?? 1 : 3,
    belopp: offert ? k.uppfoljning?.offertBelopp ?? null : null,
    mote: k.mote ? { tid: k.mote.tid, flyttningar: k.mote.flyttningar } : null,
    uppfoljning: k.uppfoljning ? { datum: k.uppfoljning.datum, text: k.uppfoljning.text, ingetSvar: k.uppfoljning.ingetSvar, andrad: k.uppfoljning.andrad } : null,
  };
}

const dagarMellan = (fran: string, till: string) => Math.round((utc(till).getTime() - utc(fran).getTime()) / 86_400_000);

async function lasAffarer(input: Record<string, unknown>, c: Ctx): Promise<Record<string, unknown>> {
  if (!DATUM.test(c.idag)) return { fel: "Dagen gick inte att läsa." };
  const vem = await vemKrets(input.vem, c);
  if ("fel" in vem) return vemFel(vem);
  const mal = Number.isInteger(input.mal_kr) && (input.mal_kr as number) > 0 && (input.mal_kr as number) <= 1_000_000_000 ? (input.mal_kr as number) : 0;
  const sondag = plus(c.idag, 6 - ((utc(c.idag).getUTCDay() + 6) % 7));
  const flera = vem.krets === null || vem.krets.length > 1;
  const namn = flera ? new Map((await c.kallor.personer()).map((p) => [p.id, p.namn])) : null;
  const rader = (await c.kallor.affarer())
    .filter((a) => vem.krets === null || a.deltagare.some((id) => vem.krets!.includes(id)) || (a.ansvarig !== null && vem.krets.includes(a.ansvarig)))
    .map((a) => {
      const dag = a.mote ? a.mote.tid.slice(0, 10) : a.uppfoljning?.datum ?? null;
      return {
        rang: a.rang,
        rad: {
          bolag: kort(a.bolag, 120),
          ...(namn ? { ansvarig: (a.ansvarig && namn.get(a.ansvarig)) || null } : {}),
          steg: kort(a.steg, 40),
          belopp: a.belopp,
          nastaSteg: a.mote ? "Möte" : dag ? "Kontakta kunden" : null,
          nastaDag: dag,
          nastaTid: a.mote ? a.mote.tid.slice(11, 16).replace(":", ".") || null : null,
          iVeckan: dag !== null && dag <= sondag,
          // Dagen kunden skulle ha kontaktats har passerat. Ett möte som väntar på utfall räknas inte hit.
          forsenadDagar: !a.mote && dag !== null && dag < c.idag ? dagarMellan(dag, c.idag) : null,
          motetFlyttat: a.mote?.flyttningar || null,
          ingetSvarIRad: (!a.mote && a.uppfoljning?.ingetSvar) || null,
          anteckning: !a.mote && a.uppfoljning?.text ? kort(a.uppfoljning.text, 160) : null,
        },
      };
    })
    .sort((x, y) => y.rang - x.rang || (x.rad.nastaDag ?? "9999").localeCompare(y.rad.nastaDag ?? "9999") || (y.rad.belopp ?? -1) - (x.rad.belopp ?? -1) || x.rad.bolag.localeCompare(y.rad.bolag, "sv"))
    .map((x) => x.rad);
  const sum = (r: typeof rader) => ({ antal: r.length, medBelopp: r.filter((x) => x.belopp !== null).length, summa: r.reduce((s, x) => s + (x.belopp ?? 0), 0) });
  const alla = sum(rader), vecka = sum(rader.filter((x) => x.iVeckan));
  return {
    vad: "Öppna affärer", vem: vem.namn, dataPer: c.idag,
    oppna: alla.antal, medBelopp: alla.medBelopp, summa: alla.summa,
    iVeckan: { ...vecka, senast: sondag },
    utanNastaSteg: rader.filter((x) => x.nastaDag === null).length,
    forsenade: rader.filter((x) => x.forsenadDagar !== null).length,
    mal: mal ? { belopp: mal, saknas: Math.max(0, mal - alla.summa), saknasIVeckan: Math.max(0, mal - vecka.summa) } : null,
    visar: Math.min(rader.length, AFFARER_MAX), affarer: rader.slice(0, AFFARER_MAX),
    chans: "För tidigt att säga. Hur ofta ett steg leder till order går inte att räkna förrän företaget har fler avslutade affärer.",
    serInte: "Ser bara affärer som finns i Möten: ett bolag med bokat möte, uppföljning eller skickad offert. Ser inte återkomster och samtal som ligger i andra system än Nav, och inte order som redan är signerade. Ett belopp finns bara på en offert där någon skrev in det. Summan är det som står på offerterna, inte vad som kommer in.",
  };
}

async function sokKunskap(input: Record<string, unknown>, c: Ctx): Promise<Record<string, unknown>> {
  const sokord = kort(input.sokord, 120);
  if (sokord.length < 2) return { fel: "Skriv vad som ska sökas." };
  const serInte = "Söker bara i företagets kunskapsbas och i de publicerade rutiner som personen får läsa. Texten är skriven av företaget och kan vara gammal: dagen den ändrades står på varje dokument.";
  const { dokument: d, allaOrden } = await c.kallor.kunskap(sokord);
  // Listan över det som saknas är till för den som sköter kunskapsbasen. Dit går också en sökning där inget dokument
  // hade alla orden: hellre en rad för mycket än en lucka ingen ser. Går listan inte att skriva ska svaret komma ändå.
  if (!d.length || !allaOrden) await c.kallor.kunskapMiss(sokord).catch(() => undefined);
  if (!d.length) return { sokord, traffar: 0, besked: "Kunskapsbasen har inget om det här. Sökningen är sparad i listan över det som saknas, så att den som sköter kunskapsbasen ser den.", serInte };
  return {
    sokord, traffar: Math.min(d.length, DOKUMENT_MAX), dataPer: c.idag,
    ...(allaOrden ? {} : { obs: "Inget dokument har alla sökorden. De här har något av dem och kan handla om något annat. Använd dem bara om de svarar på frågan. Sökningen är sparad i listan över det som saknas." }),
    dokument: d.slice(0, DOKUMENT_MAX).map((x) => ({ rubrik: kort(x.rubrik, 160), omrade: kort(x.omrade, 80), kalla: x.kalla === "rutiner" ? "Rutiner" : "Kunskapsbasen", andrad: x.andrad.slice(0, 10), text: x.text.slice(0, DOKUMENT_TECKEN), avkortad: x.text.length > DOKUMENT_TECKEN })),
    serInte,
  };
}

const giltigDag = (dag: string) => DATUM.test(dag) && !Number.isNaN(utc(dag).getTime());
/** Skälet som står på en uppgift som ströks med Ångra. Rutten kräver ett skäl, och de som hade uppgiften ser det. */
const ANGRAD = "Ångrad direkt efter att den lades upp i chatten.";
const BESKED_KORT = "Kortet visas för personen med knapparna Godkänn och Avbryt. Ingenting är gjort förrän personen trycker på Godkänn.";

async function forberedUppgifter(input: Record<string, unknown>, c: Ctx): Promise<Verktygssvar> {
  const lista = Array.isArray(input.uppgifter) ? (input.uppgifter as Record<string, unknown>[]) : [];
  if (!lista.length || lista.length > UTKAST_MAX) return { svar: { fel: `Ett kort har mellan en och ${UTKAST_MAX} uppgifter.` } };
  const utkast: { titel: string; dag: string | null; till: string | null }[] = [];
  const steg: Steg[] = [];
  for (const u of lista) {
    const titel = kort(u?.titel, 120);
    const dag = String(u?.dag ?? "").trim();
    const till = kort(u?.till, 80);
    if (!titel) return { svar: { fel: "Varje uppgift behöver en titel." } };
    if (dag && !giltigDag(dag)) return { svar: { fel: "Dagen ska skrivas som ÅÅÅÅ-MM-DD, eller lämnas tom." } };
    // Åt någon annan: bara den vars tal personen får se, alltså det egna laget. Snävare än Nav, som låter alla ge alla en uppgift.
    let person: { id: string; namn: string } | null = null;
    if (till && !arJag(till.toLowerCase())) {
      if (arLaget(till.toLowerCase())) return { svar: { fel: "En uppgift läggs åt en person i taget. Fråga vem som ska göra den." } };
      const v = await vemKrets(till, c);
      if ("fel" in v) return { svar: v.fel === NEJ ? { fel: "Här går det bara att lägga uppgifter åt sig själv och åt sitt eget lag." } : vemFel(v) };
      if (v.krets?.length === 1 && v.krets[0] !== c.mig) person = { id: v.krets[0], namn: v.namn };
    }
    utkast.push({ titel, dag: dag || null, till: person?.namn ?? null });
    steg.push({ vag: "/nav2/uppgifter", body: { handling: "skapa", titel, dag: dag || null, ...(person ? { till: person.id } : {}) }, angra: { handling: "avbryt", id: "$id", note: ANGRAD } });
  }
  return {
    svar: { _egnaOrd: true, _belagda: ["uppgifter"], utkast, uppgifter: utkast.length, besked: BESKED_KORT },
    kort: {
      rubrik: utkast.length === 1 ? "Lägg upp en uppgift" : `Lägg upp ${utkast.length} uppgifter`,
      rader: utkast.map((u) => ({ text: u.titel, dag: u.dag, not: [u.dag ? "" : "utan dag", u.till ? `åt ${u.till}` : ""].filter(Boolean).join(" · ") })),
      steg, varning: null, klart: utkast.length === 1 ? "Uppgiften är upplagd." : "Uppgifterna är upplagda.",
    },
  };
}

async function forberedUppfoljning(input: Record<string, unknown>, c: Ctx): Promise<Verktygssvar> {
  const dag = String(input.dag ?? "").trim();
  if (!giltigDag(dag)) return { svar: { fel: "Dagen ska skrivas som ÅÅÅÅ-MM-DD." } };
  if (dag < c.idag) return { svar: { fel: "Välj i dag eller en senare dag." } };
  const sok = kort(input.bolag, 120).toLowerCase();
  if (!sok) return { svar: { fel: "Fråga vilket bolag det gäller." } };
  // Bara affärer personen själv ser i Möten. Rutten prövar sedan om personen får ändra just den.
  const alla = await c.kallor.affarer();
  const hela = alla.filter((a) => a.bolag.toLowerCase() === sok);
  const traffar = hela.length ? hela : alla.filter((a) => a.bolag.toLowerCase().includes(sok));
  if (!traffar.length) return { svar: { fel: "Jag hittar ingen öppen affär med det bolaget." } };
  // B2: kandidaterna är affärer personen redan ser i Möten (källan läser bara dem). Felet säger inte hur Claude ska fråga.
  if (traffar.length > 1) return { svar: { fel: "Flera öppna affärer matchar namnet.", kandidater: [...new Set(traffar.map((a) => kort(a.bolag, 120)))].slice(0, KANDIDATER_MAX) } };
  const a = traffar[0];
  if (a.mote) return { svar: { fel: "Affären har ett bokat möte. Dagen ändras genom att flytta mötet i Möten." } };
  const fore = a.uppfoljning?.datum ?? null;
  if (fore === dag) return { svar: { fel: "Uppföljningen står redan på den dagen." } };
  // Den förra dagen går bara att sätta tillbaka om den inte har passerat: Möten tar inte emot en dag bakåt i tiden.
  const garAngra = fore !== null && fore >= c.idag;
  const body = { handling: "uppfoljning_andra", kedja: a.kedja, fore: a.uppfoljning?.andrad ?? null, datum: dag, text: a.uppfoljning?.text ?? null };
  return {
    svar: { _egnaOrd: true, bolag: kort(a.bolag, 120), dag, forraDagen: fore, besked: BESKED_KORT },
    kort: {
      rubrik: "Ändra dagen för uppföljningen",
      rader: [{ text: kort(a.bolag, 120), dag, not: fore ? `förut ${fore}` : "ingen dag förut" }],
      steg: [{ vag: "/nav2/moten", body, angra: garAngra ? { ...body, fore: "$uppfoljning_andrad", datum: fore } : null }],
      varning: garAngra ? null : "Går inte att ångra här efteråt: den förra dagen har passerat eller saknas. Dagen går att ändra igen i Möten.",
      klart: "Uppföljningen är ändrad.",
    },
  };
}

/** Beskedet Claude får när ett verktyg inte gick att läsa, eller inte svarade i tid. */
export const VERKTYGSFEL = "Det gick inte att läsa just nu.";

/**
 * Kör ett verktyg. `anrop` är verktygsanropets nummer i frågan (från ett), det
 * som hänvisningen `{{t:<anrop>.<fält>}}` pekar på. Ett fel blir ett svar med
 * `fel` och inga tal, aldrig ett kast: Claude ska kunna säga vad som saknas.
 */
export async function korVerktyg(namn: string, input: unknown, c: Ctx, anrop: number): Promise<Verktygssvar> {
  const i = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  const marke = { _verktyg: namn, _anrop: anrop };
  try {
    switch (namn) {
      case "las_matt": return { svar: { ...marke, ...(await lasMatt(i, c)) } };
      case "las_forslag": {
        const f = await c.kallor.forslag();
        return { svar: { ...marke, dataPer: c.idag, forslagenArPa: f.pa, oppna: f.oppna.length, forslag: f.oppna.map((o) => ({ rubrik: kort(o.rubrik, 160), rader: o.rader.map((r) => kort(r, 240)) })), andrat: f.andrat.map((a) => ({ text: kort(a.text, 240), dom: a.dom, tal: a.tal })), trendregeln: f.trendrad, serInte: "Ser bara förslag som en regel har skapat, och av det som ändrats bara de tre senaste. Jag kan inte skapa förslag själv." } };
      }
      case "las_vantar": {
        const v = await c.kallor.vantar();
        // Inget antal: listan visar de första raderna av varje sort, och ett radantal vore ett fel tal.
        return { svar: { ...marke, dataPer: c.idag, sammanfattning: kort(v.sammanfattning, 300), rader: v.rader.slice(0, 30).map((r) => kort(r, 200)), serInte: "Visar de första raderna av varje sort, inte alla. Raderna räknas inte: ett antal finns bara i sammanfattningens text, och skrivs då som ett ordagrant citat av den." } };
      }
      case "las_dag": return { svar: { ...marke, ...(await lasDag(i, c)) } };
      case "las_vecka": return { svar: { ...marke, ...(await lasVecka(i, c)) } };
      case "las_provision": return { svar: { ...marke, ...(await lasProvision(i, c)) } };
      case "las_affarer": return { svar: { ...marke, ...(await lasAffarer(i, c)) } };
      case "sok_kunskap": return { svar: { ...marke, ...(await sokKunskap(i, c)) } };
      case "forbered_uppgifter":
      case "forbered_uppfoljning": {
        const f = await (namn === "forbered_uppgifter" ? forberedUppgifter(i, c) : forberedUppfoljning(i, c));
        return { svar: { ...marke, ...f.svar }, kort: f.kort };
      }
      // B2: läser ingenting. Slingan avslutar frågan med valet och skickar inget svar tillbaka till Claude; det här är
      // bara anropets plats i listan, så att numren stämmer. Det bär Claudes egna ord och är ingen källa.
      case FRAGA_TILLBAKA: return { svar: { ...marke, _egnaOrd: true } };
      default: return { svar: { ...marke, fel: "Okänt verktyg." } };
    }
  } catch (e) {
    // Claude får samma raka besked som förut. Felet självt hamnar i serverns logg, så att någon kan se vad som föll.
    console.error(`chatt: verktyget ${namn} föll: ${e instanceof Error ? e.message : String(e)}`);
    return { svar: { ...marke, fel: VERKTYGSFEL } };
  }
}

/** Vad ett fält är, för källraden: talet ska säga vilket fält det kommer ur, inte bara vilket verktyg. */
const FALTNAMN: Record<string, string> = {
  "las_dag.kalenderposter": "Kalenderposter",
  "las_dag.uppgifterKvar": "Uppgifter kvar",
  "las_dag.uppgifterKlara": "Klara uppgifter",
  "las_vecka.kalenderposter": "Kalenderposter i veckan",
  "las_vecka.uppgifterKvar": "Uppgifter kvar i veckan",
  "las_vecka.dagar.kalenderposter": "Kalenderposter en dag",
  "las_vecka.dagar.uppgifterKvar": "Uppgifter kvar en dag",
  "las_provision.summa": "Provision, summa",
  "las_provision.bokfort": "Provision, bokförd",
  "las_provision.signerade": "Signerade order",
  "las_provision.makulerade": "Makulerade order",
  "las_provision.netto": "Order netto",
  "las_provision.antalRader": "Rader i underlaget",
  "las_provision.rader.belopp": "Belopp på en rad i underlaget",
  "las_forslag.oppna": "Öppna förslag",
  "forbered_uppgifter.uppgifter": "Uppgifter på kortet",
  "las_affarer.oppna": "Öppna affärer",
  "las_affarer.medBelopp": "Öppna affärer med belopp",
  "las_affarer.summa": "Summan av beloppen på de öppna affärerna",
  "las_affarer.iVeckan.antal": "Öppna affärer med nästa steg senast söndag",
  "las_affarer.iVeckan.medBelopp": "Affärer med nästa steg senast söndag och med belopp",
  "las_affarer.iVeckan.summa": "Summan av beloppen på affärer med nästa steg senast söndag",
  "las_affarer.utanNastaSteg": "Öppna affärer utan nästa steg",
  "las_affarer.forsenade": "Affärer där dagen för uppföljning har passerat",
  "las_affarer.mal.belopp": "Beloppet frågan gällde",
  "las_affarer.mal.saknas": "Kvar till beloppet om alla öppna affärer med belopp blir order",
  "las_affarer.mal.saknasIVeckan": "Kvar till beloppet om affärerna med nästa steg senast söndag blir order",
  "las_affarer.visar": "Affärer som räknas upp",
  "las_affarer.affarer.belopp": "Offertens belopp",
  "las_affarer.affarer.forsenadDagar": "Dagar sedan kunden skulle ha kontaktats",
  "las_affarer.affarer.motetFlyttat": "Gånger mötet har flyttats",
  "las_affarer.affarer.ingetSvarIRad": "Försök i rad utan svar",
  "sok_kunskap.traffar": "Dokument i kunskapsbasen som matchade",
};

/**
 * Raden under svaret som säger var det kommer ifrån: Navs tal, företagets kunskapsbas eller ingetdera.
 * Ur verktygssvaren, aldrig ur Claudes text. Ett verktyg som svarade med fel, och ett kort Claude själv
 * har förberett, är ingen källa.
 */
export function kallaFor(svar: readonly Record<string, unknown>[]): string {
  const last = svar.filter((s) => s && typeof s.fel !== "string" && s._egnaOrd !== true);
  const dok = last.filter((s) => s._verktyg === "sok_kunskap").flatMap((s) => (Array.isArray(s.dokument) ? (s.dokument as { rubrik?: unknown; kalla?: unknown }[]) : []));
  const namn = (rutin: boolean) => [...new Set(dok.filter((d) => (d?.kalla === "Rutiner") === rutin).map((d) => kort(d?.rubrik, 60)).filter(Boolean))].slice(0, DOKUMENT_MAX).join(", ");
  const kb = namn(false), ru = namn(true);
  const delar = [last.some((s) => s._verktyg !== "sok_kunskap") ? "Navs tal" : "", kb ? `företagets kunskapsbas (${kb})` : "", ru ? `företagets rutiner (${ru})` : ""].filter(Boolean);
  return delar.length ? `Skrivet av AI ur ${delar.length > 2 ? `${delar.slice(0, -1).join(", ")} och ${delar[delar.length - 1]}` : delar.join(" och ")}` : "Skrivet av AI, inte ur Navs tal eller kunskapsbasen";
}

/**
 * Raden som visas när någon klickar på ett tal: vad det är, vem det gäller, perioden och "data per". Ur
 * verktygssvaret, aldrig ur Claudes text. `falt` är fältet talet hämtades ur: motviktens tal ska bära
 * motviktens förklaring, inte huvudmåttets.
 */
export function kallrad(svar: Record<string, unknown> | undefined, falt = ""): string {
  if (!svar) return "";
  const s = (k: string) => (typeof svar[k] === "string" && svar[k] ? String(svar[k]) : "");
  const motvikt = (svar.motvikt as { matt?: unknown } | null | undefined)?.matt;
  const egen =
    svar._verktyg !== "las_matt" ? ""
    : falt.startsWith("motvikt.") && typeof motvikt === "string" && Object.hasOwn(MATT, motvikt) ? MATT[motvikt as MattNyckel].text
    : falt === "bokadePerVecka" ? "Första möten som bokades i perioden, per vecka"
    : falt === "vantarPaGodkannande" ? "Order som väntar på godkännande"
    : "";
  const faltnamn = FALTNAMN[`${String(svar._verktyg ?? "")}.${falt.replace(/\.\d+\./g, ".")}`] ?? "";
  // las_vecka (B5) har ingen period i ord: veckan är fran till till, och ett tal ur en dag (`dagar.2.…`) gäller den dagen.
  const iVeckan = /^dagar\.(\d+)\./.exec(falt);
  const enDag = iVeckan && Array.isArray(svar.dagar) ? (svar.dagar[Number(iVeckan[1])] as { dag?: unknown } | undefined)?.dag : undefined;
  const period = s("period") ? (s("fran") && s("till") ? `${s("period")} (${s("fran")} till ${s("till")})` : s("period")) : typeof enDag === "string" && enDag ? enDag : s("fran") && s("till") ? `${s("fran")} till ${s("till")}` : s("dag");
  const vad = egen || faltnamn || s("vad") || ({ las_forslag: "Navs förslag", las_vantar: "Väntar på dig", las_dag: "Kalender och uppgifter", las_vecka: "Kalender och uppgifter", las_provision: "Din provision", sok_kunskap: "Företagets kunskapsbas", forbered_uppgifter: "Uppgifter att godkänna", forbered_uppfoljning: "Uppföljning att godkänna" } as Record<string, string>)[s("_verktyg")] || "";
  return [vad, s("vem"), period, s("dataPer") ? `data per ${s("dataPer")}` : ""].filter(Boolean).join(" · ");
}

/**
 * Det som står under källraden när någon klickar på ett tal (funktion 3, Motvikten vid talet): motvikten, vad verktyget
 * inte ser och om underlaget är för litet för en jämförelse. Allt är verktygets egna fält, inget räknas här. Det går
 * bara till webbläsaren, med talet: Claude får verktygssvaret som förut, och texten bär det aldrig.
 *
 *   ser       verktygets `serInte`, en hel mening. För motviktens eget tal: motviktens (ur registret), som i `kallrad`.
 *   motvikt   bara för måttets egna tal i las_matt (`antal`, `av`, `procent`): motviktens namn, antal och, för ett
 *             mötesmått, nämnaren (`av`, aldrig en procent). Klickar man på motviktens tal (`motvikt.*`) står
 *             huvudmåttet här i stället. Null för alla andra tal.
 *   forFa     verktygets eget `rackerForJamforelse === false`, för måttets egna tal (`antal`, `av`, `procent`): domen
 *             gäller huvudmåttets underlag. Falskt för motviktens tal och för alla andra.
 *
 * Ett svar som är ett fel, eller saknas, ger nullor och falskt.
 */
export type KallaTillagg = { ser: string | null; motvikt: { text: string; antal: number; av: number | null } | null; forFa: boolean };

export function kallaTillagg(svar: Record<string, unknown> | undefined, falt = ""): KallaTillagg {
  if (!svar || typeof svar !== "object" || typeof svar.fel === "string") return { ser: null, motvikt: null, forFa: false };
  const ser = typeof svar.serInte === "string" && svar.serInte ? svar.serInte : null;
  if (svar._verktyg !== "las_matt") return { ser, motvikt: null, forFa: false };
  const tal = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const iRegistret = (k: unknown): k is MattNyckel => typeof k === "string" && Object.hasOwn(MATT, k);
  const mv = (svar.motvikt ?? {}) as { matt?: unknown; antal?: unknown; av?: unknown };
  const huvud = svar.matt;
  const mot = mv.matt;
  const forFa = svar.rackerForJamforelse === false;
  if (falt.startsWith("motvikt.")) {
    const antal = tal(svar.antal);
    // `rackerForJamforelse` är verktygets dom om huvudmåttets underlag. Om motviktens tal har verktyget ingen dom.
    return {
      ser: iRegistret(mot) ? MATT[mot].serInte : ser,
      motvikt: iRegistret(huvud) && antal !== null ? { text: MATTNAMN[huvud], antal, av: tal(svar.av) } : null,
      forFa: false,
    };
  }
  if (!["antal", "av", "procent"].includes(falt)) return { ser, motvikt: null, forFa: false };
  const antal = tal(mv.antal);
  return { ser, motvikt: iRegistret(mot) && antal !== null ? { text: MATTNAMN[mot], antal, av: tal(mv.av) } : null, forFa };
}
