/**
 * Chatten: de sex verktygen (designdokumentet, Steg 3).
 *
 * Claude räknar aldrig själv. Den frågar efter ett färdigt mått, och svaret bär
 * antal, "data per", vad måttet inte ser och om underlaget räcker.
 *
 * BEHÖRIGHETEN SITTER HÄR, inte i systemtexten. Varje verktyg går med den
 * inloggades krets (`mote_statkrets()`), så Claude kan aldrig få se mer än
 * personen själv får se i Nav. Verktygslistan är densamma för alla roller, så
 * att alla delar samma cache.
 *
 * Det enda verktyget som inte läser är `forbered_uppgifter`, och det skapar
 * ingenting: utkastet visas för personen, som trycker själv.
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
};

export type Ctx = { mig: string; idag: string; kallor: Kallor };
export type Utkast = { titel: string; dag: string | null };
export type Verktygssvar = { svar: Record<string, unknown>; utkast?: Utkast[] };

const PERIODER = ["denna-vecka", "forra-veckan", "denna-manad", "forra-manaden"] as const;
type PeriodNyckel = (typeof PERIODER)[number];
const MATTNYCKLAR = Object.keys(MATT) as MattNyckel[];
const DATUM = /^\d{4}-\d{2}-\d{2}$/;
/** Under så här många rader säger verktyget att underlaget är för litet för en jämförelse. */
export const JAMFOR_MINST = 10;
export const UTKAST_MAX = 5;

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
      vem: { type: "string", description: "\"jag\" för personen som frågar, \"laget\" för alla personen leder, eller en kollegas namn." },
      period: { type: "string", enum: [...PERIODER] },
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
    name: "las_provision",
    description: "Läser personens eget provisionsunderlag för en månad, som provisionsmotorn räknat det. Aldrig någon annans.",
    strict: true,
    input_schema: obj({ manad: { type: "string", enum: ["denna-manad", "forra-manaden"] } }),
  },
  {
    name: "forbered_uppgifter",
    description: "Förbereder ett utkast till en eller flera uppgifter. Ingenting skapas: personen ser utkastet och trycker själv på Lägg i min dag.",
    strict: true,
    input_schema: obj({
      uppgifter: {
        type: "array",
        items: obj({ titel: { type: "string", description: "Vad som ska göras, kort." }, dag: { type: "string", description: "Dagen som ÅÅÅÅ-MM-DD, eller en tom sträng för ingen dag." } }),
      },
    }),
  },
] as const;

const utc = (dag: string) => new Date(`${dag}T12:00:00Z`);
const plus = (dag: string, n: number) => new Date(utc(dag).getTime() + n * 86_400_000).toISOString().slice(0, 10);
const PERIODTEXT: Record<PeriodNyckel, string> = { "denna-vecka": "den här veckan", "forra-veckan": "förra veckan", "denna-manad": "den här månaden", "forra-manaden": "förra månaden" };

/** Perioden i svenska dagar. En pågående period slutar i dag. `manad` är satt för månadsperioderna. */
export function periodFor(period: string, idag: string): { fran: string; till: string; manad: string | null; text: string } | null {
  if (!(PERIODER as readonly string[]).includes(period) || !DATUM.test(idag)) return null;
  const p = period as PeriodNyckel;
  const text = PERIODTEXT[p];
  const mandag = plus(idag, -((utc(idag).getUTCDay() + 6) % 7));
  if (p === "denna-vecka") return { fran: mandag, till: idag, manad: null, text };
  if (p === "forra-veckan") return { fran: plus(mandag, -7), till: plus(mandag, -1), manad: null, text };
  if (p === "denna-manad") return { fran: `${idag.slice(0, 7)}-01`, till: idag, manad: idag.slice(0, 7), text };
  const sista = plus(`${idag.slice(0, 7)}-01`, -1);
  return { fran: `${sista.slice(0, 7)}-01`, till: sista, manad: sista.slice(0, 7), text };
}

const MATTNAMN: Record<MattNyckel, string> = {
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
      const p = PERIODTEXT[input.period as PeriodNyckel];
      return `Hämtar ${MATTNAMN[input.matt as MattNyckel] ?? "ett mått"} för ${for_}${p ? `, ${p}` : ""}.`;
    }
    case "las_forslag": return "Hämtar Navs förslag och det som ändrats.";
    case "las_vantar": return "Hämtar det som väntar på dig.";
    case "las_dag": return `Hämtar kalendern och uppgifterna för ${DATUM.test(String(input.dag)) ? String(input.dag) : "dagen"}.`;
    case "las_provision": return "Hämtar din provision.";
    case "forbered_uppgifter": return "Förbereder ett utkast till uppgifter.";
    default: return "Hämtar.";
  }
}

const NEJ = "Det får du inte se.";

/** Vems tal frågan gäller, och om den som frågar får se dem. */
async function vemKrets(vem: unknown, c: Ctx): Promise<{ krets: readonly string[] | null; namn: string } | { fel: string }> {
  const k = await c.kallor.krets();
  if (k === undefined) return { fel: "Det gick inte att läsa vilka du får se." };
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
  if (traffar.length > 1) return { fel: "Flera heter så. Fråga med hela namnet." };
  const p = traffar[0];
  if (p.id !== c.mig && k !== null && !k.includes(p.id)) return { fel: NEJ };
  return { krets: [p.id], namn: p.id === c.mig ? "Du" : p.namn };
}

async function lasMatt(input: Record<string, unknown>, c: Ctx): Promise<Record<string, unknown>> {
  const nyckel = String(input.matt ?? "") as MattNyckel;
  if (!MATTNYCKLAR.includes(nyckel)) return { fel: "Det måttet finns inte i registret." };
  const p = periodFor(String(input.period ?? ""), c.idag);
  if (!p) return { fel: "Den perioden kan jag inte läsa." };
  const m = MATT[nyckel];
  const order = nyckel === "order.netto" || nyckel === "order.makulerade";
  if (order && !p.manad) return { fel: "Order räknas per månad. Fråga om den här månaden eller förra månaden." };
  const vem = await vemKrets(input.vem, c);
  if ("fel" in vem) return { fel: vem.fel };
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
    serInte: `Ser inte kalendrar utanför Nav, inte uppgifter utan dag och inte uppgifter som blev klara för mer än ${KLARA_DAGAR} dagar sedan. Frister, ledighet och möten du tackat nej till räknas inte som kalenderposter.`,
  };
}

/** Så långt bak bär Navs uppgiftslista det som blivit klart (`byggUppgifter`). */
const KLARA_DAGAR = 14;
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
  const p = periodFor(String(input.manad ?? ""), c.idag);
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

function forbered(input: Record<string, unknown>): Verktygssvar {
  const lista = Array.isArray(input.uppgifter) ? (input.uppgifter as Record<string, unknown>[]) : [];
  if (!lista.length || lista.length > UTKAST_MAX) return { svar: { fel: `Ett utkast har mellan en och ${UTKAST_MAX} uppgifter.` } };
  const utkast: Utkast[] = [];
  for (const u of lista) {
    const titel = kort(u?.titel, 120);
    const dag = String(u?.dag ?? "").trim();
    if (!titel) return { svar: { fel: "Varje uppgift behöver en titel." } };
    if (dag && (!DATUM.test(dag) || Number.isNaN(utc(dag).getTime()))) return { svar: { fel: "Dagen ska skrivas som ÅÅÅÅ-MM-DD, eller lämnas tom." } };
    utkast.push({ titel, dag: dag || null });
  }
  return { svar: { _egnaOrd: true, utkast, uppgifter: utkast.length, besked: "Utkastet visas för personen. Ingenting är skapat förrän personen trycker på Lägg i min dag." }, utkast };
}

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
        return { svar: { ...marke, dataPer: c.idag, sammanfattning: kort(v.sammanfattning, 300), rader: v.rader.slice(0, 30).map((r) => kort(r, 200)), serInte: "Visar de första raderna av varje sort, inte alla. Hur många som väntar står på kortet Väntar på dig." } };
      }
      case "las_dag": return { svar: { ...marke, ...(await lasDag(i, c)) } };
      case "las_provision": return { svar: { ...marke, ...(await lasProvision(i, c)) } };
      case "forbered_uppgifter": {
        const f = forbered(i);
        return { svar: { ...marke, ...f.svar }, utkast: f.utkast };
      }
      default: return { svar: { ...marke, fel: "Okänt verktyg." } };
    }
  } catch {
    return { svar: { ...marke, fel: "Det gick inte att läsa just nu." } };
  }
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
  const period = s("period") ? (s("fran") && s("till") ? `${s("period")} (${s("fran")} till ${s("till")})` : s("period")) : s("dag");
  const vad = egen || s("vad") || ({ las_forslag: "Navs förslag", las_vantar: "Väntar på dig", las_dag: "Kalender och uppgifter", las_provision: "Din provision", forbered_uppgifter: "Utkast till uppgifter" } as Record<string, string>)[s("_verktyg")] || "";
  return [vad, s("vem"), period, s("dataPer") ? `data per ${s("dataPer")}` : ""].filter(Boolean).join(" · ");
}
