/**
 * Hemvyn: måttregistret (designdokumentet 1.1).
 *
 * Alla tal som hemvyn visar, dömer eller låter AI:n läsa går genom registret.
 * Ingen annan kod räknar. Det är så "AI:n räknar aldrig själv" blir sant i
 * tekniken: ett verktyg kan bara fråga efter en nyckel som står här.
 *
 * Varje mått har en MOTVIKT, måttet som inte får bli sämre. En dom "ser bra ut"
 * kräver den, och en andel visas aldrig utan sitt antal (`bokadePerVecka`),
 * eftersom en andel annars går att förbättra genom att boka färre möten.
 *
 * ETT UNDERLAG FÖR ALLA MÖTESMÅTT. Mötessidan har två: bekräftelserna räknar
 * första möten (ny och ombokning), veckotalen bara nya. Hemvyn använder det
 * första, eftersom kedjan handlar om bekräftelse:
 *   - första möten (`skaBekraftas`): ny eller ombokning
 *   - med mötestid i perioden, i svenska dagar
 *   - med ett utfall. Ett möte utan utfall räknas inte i något mått.
 * Ett möte hör till en krets när den som bokade ELLER den som håller det ligger
 * i den (`inomKrets`), så att bokaren och hållaren ser samma möte.
 *
 * Rena funktioner, så att provet går med `node --experimental-strip-types`.
 */
import { lokalDag, motesTz, skaBekraftas } from "./motesflode.ts";
import { inomKrets, type Period, type StatMote } from "./motesstatforma.ts";

export type MattNyckel =
  | "moten.uteblivna"
  | "moten.hallna-av-alla"
  | "moten.bekraftade"
  | "order.netto"
  | "order.makulerade";

export type Matt = {
  nyckel: MattNyckel;
  /**
   * Höjs när måttets definition ändras. Skrivs i varje mätning och dom i
   * förslagsloggen, så att ett facit aldrig blandar två definitioner i det tysta.
   */
  version: number;
  /** Andel = n av ett antal. Antal = bara n. */
  sort: "andel" | "antal";
  /** Vilket håll som är bättre. */
  battre: "upp" | "ned";
  /** Måttet som inte får bli sämre. */
  motvikt: MattNyckel | null;
  /** Vad måttet räknar, för den som läser talet. */
  text: string;
  /** Vad måttet inte ser. */
  serInte: string;
  /** Frasen för att måttet blivit sämre, i domen "Bättre, men …". Utan punkt. */
  samre: string;
  /** Vad talet "n av av" räknar, efter talet i ett kort: "möten uteblev". */
  kort: string;
};

const UNDERLAG = "Räknar första möten med utfall, på mötets dag.";

export const MATT: Record<MattNyckel, Matt> = {
  "moten.uteblivna": {
    nyckel: "moten.uteblivna", version: 1, sort: "andel", battre: "ned", motvikt: "moten.hallna-av-alla",
    text: `Uteblivna möten av hållna och uteblivna. ${UNDERLAG}`,
    serInte: "Ser inte möten som saknar utfall, och inte varför kunden uteblev.",
    samre: "fler möten uteblir",
    kort: "möten uteblev",
  },
  "moten.hallna-av-alla": {
    nyckel: "moten.hallna-av-alla", version: 1, sort: "andel", battre: "upp", motvikt: "moten.uteblivna",
    text: `Hållna möten av hållna, uteblivna och avbokade. ${UNDERLAG}`,
    serInte: "Ser inte möten som saknar utfall, och inte om mötet ledde till något.",
    samre: "färre möten hålls",
    kort: "möten hölls",
  },
  "moten.bekraftade": {
    nyckel: "moten.bekraftade", version: 1, sort: "andel", battre: "upp", motvikt: "moten.hallna-av-alla",
    text: `Möten som bekräftades före mötestiden, av hållna, uteblivna och avbokade. ${UNDERLAG}`,
    serInte: "Ser inte om kunden hörde av sig på annat sätt än genom Nav.",
    samre: "färre möten bekräftas",
    kort: "möten bekräftades",
  },
  "order.netto": {
    nyckel: "order.netto", version: 1, sort: "antal", battre: "upp", motvikt: "order.makulerade",
    text: "Order som signerats i månaden minus de som makulerats i månaden. Samma tal som provisionens trappa räknar på.",
    serInte: "Ser inte order som ligger som utkast, och inte om en order makuleras senare.",
    samre: "färre order kommer in",
    kort: "order",
  },
  "order.makulerade": {
    nyckel: "order.makulerade", version: 1, sort: "antal", battre: "ned", motvikt: "order.netto",
    text: "Order som makulerats i månaden, oavsett när de signerades.",
    serInte: "Ser inte varför ordern makulerades.",
    samre: "fler order makuleras",
    kort: "order makulerades",
  },
};

export type MotesMatt = Exclude<MattNyckel, "order.netto" | "order.makulerade">;
export type MattSvar = { n: number; av: number; bakom: string[] };

const iPerioden = (ts: string, p: Period | null): boolean => {
  if (p === null) return true;
  const d = lokalDag(ts, motesTz());
  return d >= p.fran && d <= p.till;
};

/** Underlaget: första möten med utfall, i perioden och i kretsen, i mötestidsordning. */
function underlag(moten: StatMote[], p: Period | null, krets: readonly string[] | null): StatMote[] {
  const egna = inomKrets(moten, [], krets).moten;
  return egna
    .filter((m) => skaBekraftas(m.art) && m.utfall !== null && iPerioden(m.moteTid, p))
    .sort((a, b) => Date.parse(a.moteTid) - Date.parse(b.moteTid) || (a.id < b.id ? -1 : 1));
}

const bekraftatFore = (m: StatMote): boolean => !!m.bekraftatNar && Date.parse(m.bekraftatNar) < Date.parse(m.moteTid);

/**
 * Ett mötesmått för en krets och en period. `p` null = ingen period (anroparen
 * har redan valt mötena, till exempel de 40 senaste före en ändring).
 * `bakom` är nämnarens rader, också de som inte räknades som n, så att den som
 * klickar på talet ser vilka som föll bort.
 */
export function mattMoten(nyckel: MotesMatt, moten: StatMote[], p: Period | null, krets: readonly string[] | null): MattSvar {
  const rader = underlag(moten, p, krets);
  const avgjorda = rader.filter((m) => m.utfall === "hallet" || m.utfall === "uteblev");
  const svar = (n: StatMote[], av: StatMote[]): MattSvar => ({ n: n.length, av: av.length, bakom: av.map((m) => m.id) });
  switch (nyckel) {
    case "moten.uteblivna": return svar(avgjorda.filter((m) => m.utfall === "uteblev"), avgjorda);
    case "moten.hallna-av-alla": return svar(rader.filter((m) => m.utfall === "hallet"), rader);
    case "moten.bekraftade": return svar(rader.filter(bekraftatFore), rader);
  }
}

const MS_PER_DAG = 86_400_000;

/**
 * Första möten som bokades i perioden, per vecka (en decimal). Står bredvid
 * varje andel, före och efter, så att en bättre andel aldrig döljer att färre
 * möten bokas.
 */
export function bokadePerVecka(moten: StatMote[], p: Period, krets: readonly string[] | null): number {
  const antal = inomKrets(moten, [], krets).moten.filter((m) => skaBekraftas(m.art) && iPerioden(m.bokatNar, p)).length;
  const dagar = Math.round((Date.parse(`${p.till}T00:00:00Z`) - Date.parse(`${p.fran}T00:00:00Z`)) / MS_PER_DAG) + 1;
  if (dagar <= 0) return 0;
  return Math.round((antal / (dagar / 7)) * 10) / 10;
}
