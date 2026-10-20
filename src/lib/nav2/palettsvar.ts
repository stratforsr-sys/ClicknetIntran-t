import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CurrentUser } from "@/lib/auth";
import { svensktDatum } from "@/lib/klocka";
import { arStangd } from "@/lib/uppgifter";
import { STEG_ETIKETT } from "@/lib/rekrytering";
import { byggOrder } from "./order";
import { byggProvision } from "./provision";
import { byggFranvaro } from "./franvaro";
import { byggTid } from "./tid";
import { byggUppgifter } from "./uppgifter";
import { byggKalender } from "./kalender";
import { byggArenden } from "./arenden";
import { byggFel } from "./fel";
import { byggRutiner } from "./rutiner";
import { byggUtbildning } from "./utbildning";
import { byggCoachning } from "./coachning";
import { byggRekrytering } from "./rekrytering";
import { byggGolvet } from "./hem";

/**
 * Nav 2.0: palettens frågor, besvarade ur navets data utan AI.
 *
 * ===========================================================================
 * SVARET RÄKNAS NÄR FRÅGAN STÄLLS, inte ur sidans data. Sidan läser in allt
 * en gång när den laddas; en order som en kollega lade upp för en minut sedan
 * finns inte där. Här byggs bara de vyer frågan behöver, med samma funktioner
 * som vyerna (`byggOrder`, `byggFranvaro` …) och användarens egen token. Det
 * svaret visar är alltså aldrig mer än vyn visar samma person.
 *
 * Raderna märks som i utkastet: `exakt` står i navet, `utraknat` är räknat ur
 * det som står (uträkningen följer med), `uppskattning` antar något om
 * framtiden (takten). Källan är vyn raden kommer ur och öppnar den.
 *
 * Fritt skrivna frågor besvaras inte: det kräver en AI-tjänst, och
 * beställaren valde 2026-10-19 att vänta med den. Frågorna här är de som går
 * att svara på exakt.
 * ===========================================================================
 */

type Slag = "exakt" | "utraknat" | "uppskattning";
/** Märkning, text, källans etikett (eller null och uträkningen), och länken till just den här raden. */
type Rad = [Slag, string, string | null] | [Slag, string, null, string] | [Slag, string, string, undefined, string];

export type NdPalSvar = {
  lead: string;
  bound?: string;
  note?: string;
  rows: Rad[];
  acts: { l: string; open: string }[];
  follow: string[];
  /** Källans etikett → vägen i navet, för rader utan egen länk. */
  kallor: Record<string, string>;
};

const KALLOR: Record<string, string> = {
  Order: "/order",
  Provision: "/provision",
  Frånvaro: "/franvaro",
  Attest: "/franvaro/attest",
  Sjukfrånvaro: "/franvaro/sjuk",
  Tid: "/tid",
  Uppgifter: "/uppgifter",
  Kalender: "/kalender",
  Rutiner: "/rutiner",
  Utbildning: "/utbildning",
  Ärenden: "/arenden",
  Fel: "/fel",
  Coachning: "/coachning",
  Rekrytering: "/rekrytering",
  Golvet: "/",
};

const MAN = ["", "januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"];
const MK = ["", "jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
const VD = ["", "måndag", "tisdag", "onsdag", "torsdag", "fredag", "lördag", "söndag"];

const dag = (d: string) => `${+d.slice(8, 10)} ${MK[+d.slice(5, 7)]}`;
const veckodag = (d: string) => VD[new Date(`${d.slice(0, 10)}T12:00:00Z`).getUTCDay() || 7];
const manad = (m: string) => MAN[+m.slice(5, 7)];
const ndVersal = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const kr = (n: number) => `${Math.round(n).toLocaleString("sv-SE")} kr`;
const plus = (d: string, n: number) => {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
const dagarMellan = (a: string, b: string) => Math.round((Date.parse(`${b.slice(0, 10)}T12:00:00Z`) - Date.parse(`${a.slice(0, 10)}T12:00:00Z`)) / 864e5);
const hm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const timmar = (min: number) => (min % 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min / 60} h`);
const st = (antal: number, en: string, flera: string) => `${antal.toLocaleString("sv-SE")} ${antal === 1 ? en : flera}`;
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
/** Måndagen i veckan. */
const mandag = (d: string) => plus(d, 1 - (new Date(`${d}T12:00:00Z`).getUTCDay() || 7));
/** Fredagen i nästa vecka, samma dag som frågetexten i paletten räknar fram. */
const fredagNastaVecka = (idag: string) => plus(mandag(idag), 11);

/** Högst så många rader per svar; resten sägs i ingressen. */
const MAX = 6;
function kapa(rader: Rad[]): { rows: Rad[]; till: string } {
  return rader.length > MAX ? { rows: rader.slice(0, MAX), till: ` De första ${MAX} står här.` } : { rows: rader, till: "" };
}

function svar(lead: string, rows: Rad[] = [], extra: Partial<NdPalSvar> = {}): NdPalSvar {
  return { lead, rows, acts: [], follow: [], ...extra, kallor: { ...KALLOR, ...(extra.kallor ?? {}) } };
}

/** Vyernas data, byggd en gång per svar och bara när frågan behöver den. */
function laddare(supabase: SupabaseClient, user: CurrentUser) {
  const cache = new Map<string, Promise<unknown>>();
  function en<T>(k: string, f: () => Promise<T>): Promise<T> {
    if (!cache.has(k)) cache.set(k, f());
    return cache.get(k) as Promise<T>;
  }
  return {
    order: () => en("order", () => byggOrder(supabase, user)),
    provision: () => en("provision", () => byggProvision(supabase, user)),
    franvaro: () => en("franvaro", () => byggFranvaro(supabase, user)),
    tid: () => en("tid", () => byggTid(supabase, user)),
    uppgifter: () => en("uppgifter", () => byggUppgifter(supabase, user)),
    kalender: () => en("kalender", () => byggKalender(user)),
    arenden: () => en("arenden", () => byggArenden(supabase, user)),
    fel: () => en("fel", () => byggFel(supabase, user)),
    rutiner: () => en("rutiner", () => byggRutiner(supabase, user)),
    utbildning: () => en("utbildning", () => byggUtbildning(supabase, user)),
    coachning: () => en("coachning", () => byggCoachning(supabase, user)),
    rekrytering: () => en("rekrytering", () => byggRekrytering(supabase, user)),
    golvet: () => en("golvet", () => byggGolvet(user)),
  };
}
type L = ReturnType<typeof laddare>;
type Ctx = { idag: string; mig: string; namn: string; L: L };

/* ---------- Order ---------- */

async function godkann({ L, mig }: Ctx): Promise<NdPalSvar> {
  const o = await L.order();
  const v = o.order.filter((x) => x.st === "inskickad" && (o.hanterare || x.vemId === mig));
  if (!v.length) return svar(o.hanterare ? "Inga order väntar på godkännande." : "Ingen av dina order väntar på godkännande.", [], { follow: ["stoppade"] });
  const summa = v.reduce((s, x) => s + (x.varde ?? 0), 0);
  const k = kapa(
    v.map((x): Rad => [
      "exakt",
      `#${x.nr} ${x.bolag}${o.hanterare ? ` · ${x.vem}` : ""}${x.samtal ? "" : " · säljsamtal saknas"}`,
      `Order #${x.nr}`,
      undefined,
      `/order/${x.nr}`,
    ]),
  );
  return svar(`${st(v.length, "order", "order")} på totalt ${kr(summa)}.${k.till}`, k.rows, {
    note: o.hanterare ? "En order utan kopplat säljsamtal går inte att godkänna." : undefined,
    acts: [{ l: "Öppna Order", open: "/order" }],
    follow: ["stoppade"],
  });
}

async function stoppade({ L, mig }: Ctx): Promise<NdPalSvar> {
  const o = await L.order();
  const synlig = o.order.filter((x) => (o.hanterare || x.vemId === mig) && x.st !== "makulerad");
  const stopp = synlig.filter((x) => x.st === "inskickad" && !x.samtal);
  const ovriga = synlig.filter((x) => !stopp.includes(x) && x.samtalSkal);
  const v = [...stopp, ...ovriga];
  if (!v.length) return svar("Ingen order är stoppad, och alla har sitt säljsamtal.", [], { follow: ["godkann"] });
  const k = kapa(v.map((x): Rad => ["exakt", `#${x.nr} ${x.bolag}${stopp.includes(x) ? " (stoppad)" : ` (${x.st === "utkast" ? "utkast" : "godkänd"})`}: ${x.samtalSkal ?? "inget säljsamtal kopplat."}`, `Order #${x.nr}`, undefined, `/order/${x.nr}`]));
  const lead = `${stopp.length ? `${st(stopp.length, "order är stoppad", "order är stoppade")}.` : "Ingen order är stoppad."}${ovriga.length ? ` ${st(ovriga.length, stopp.length ? "order till saknar" : "order saknar", stopp.length ? "order till saknar" : "order saknar")} säljsamtal.` : ""}`;
  return svar(`${lead}${k.till}`, k.rows, {
    bound: "En order går inte att godkänna utan ett kopplat säljsamtal.",
    acts: [{ l: "Öppna Order", open: "/order" }],
  });
}

async function minaorder({ L, mig, idag }: Ctx): Promise<NdPalSvar> {
  const o = await L.order();
  const m = idag.slice(0, 7);
  const mina = o.order.filter((x) => x.vemId === mig);
  const klara = mina.filter((x) => x.period === m && (x.st === "signerad" || x.st === "betald"));
  const vantar = mina.filter((x) => x.st === "inskickad");
  const rows: Rad[] = [
    ["exakt", `${st(klara.length, "godkänd order", "godkända order")} i ${manad(m)}, ordervärde ${kr(klara.reduce((s, x) => s + (x.varde ?? 0), 0))}.`, "Order"],
  ];
  if (vantar.length) rows.push(["exakt", `${st(vantar.length, "order väntar", "order väntar")} på godkännande.`, "Order"]);
  return svar(klara.length ? `${st(klara.length, "order", "order")} godkända i ${manad(m)}.` : `Inga godkända order i ${manad(m)} än.`, rows, {
    follow: ["malet", "godkann"],
  });
}

async function loperut({ L, mig, idag }: Ctx): Promise<NdPalSvar> {
  const o = await L.order();
  const v = o.order
    .flatMap((x) => (x.slut && (o.hanterare || x.vemId === mig) && (x.st === "signerad" || x.st === "betald") ? [{ ...x, slut: x.slut }] : []))
    .filter((x) => dagarMellan(idag, x.slut) >= 0 && dagarMellan(idag, x.slut) <= 90)
    .sort((a, b) => a.slut.localeCompare(b.slut));
  if (!v.length) return svar("Inget avtal löper ut inom 90 dagar.");
  const k = kapa(v.map((x): Rad => ["exakt", `#${x.nr} ${x.bolag}${o.hanterare ? ` (${x.vem})` : ""}: slutar ${dag(x.slut)}.`, `Order #${x.nr}`, undefined, `/order/${x.nr}`]));
  return svar(`${st(v.length, "avtal löper", "avtal löper")} ut inom 90 dagar.${k.till}`, k.rows, {
  });
}

/* ---------- Provision ---------- */

async function malet({ L, idag }: Ctx): Promise<NdPalSvar> {
  const p = await L.provision();
  const m = p.manad;
  const u = p.underlag[m]?.[p.jagId];
  const mal = p.mal[m]?.[p.jagId];
  const t = p.takt[p.jagId];
  if (!u) return svar(`Nav har inget provisionsunderlag för dig i ${manad(m)}.`, [], { follow: ["minaorder"] });
  const rows: Rad[] = [["exakt", `${kr(u.summa)} i provision på ${st(u.antal.netto, "order", "order")} netto i ${manad(m)}.`, "Provision"]];
  if (!mal || (mal.k === null && mal.o === null)) {
    return svar(`${kr(u.summa)} hittills. Du har inget mål för ${manad(m)}.`, rows, {
      bound: "Målen sätts av säljchef eller VD i Provision.",
      follow: ["prognos", "forra"],
    });
  }
  let lead = "";
  if (mal.k !== null) {
    rows.push(["utraknat", `${Math.round((u.summa / mal.k) * 100)} % av målet ${kr(mal.k)}.`, null, `${kr(u.summa)} ÷ ${kr(mal.k)}.`]);
    lead = `${kr(u.summa)} av ${kr(mal.k)}.`;
  }
  if (mal.o !== null) {
    rows.push(["exakt", `${u.antal.netto} av ${st(mal.o, "order", "order")} i målet.`, "Provision"]);
    if (!lead) lead = `${u.antal.netto} av ${st(mal.o, "order", "order")}.`;
  }
  if (t && t.totalt > 0) {
    const andel = t.gangna / t.totalt;
    const fore = mal.k !== null ? u.summa >= mal.k * andel : u.antal.netto >= (mal.o ?? 0) * andel;
    lead += fore ? " Du ligger före takten." : " Takten räcker inte riktigt.";
    rows.push(["utraknat", `${t.gangna} av ${t.totalt} arbetsdagar har gått.`, null, `Arbetsdagarna i ${manad(m)} utan helger och röda dagar, till och med i dag (${dag(idag)}).`]);
  }
  return svar(lead, rows, { follow: ["prognos", "perdag"] });
}

async function prognos({ L }: Ctx): Promise<NdPalSvar> {
  const p = await L.provision();
  const t = p.takt[p.jagId];
  const m = p.manad;
  if (!t?.prognos) return svar(`Nav kan inte räkna en prognos för dig i ${manad(m)}.`, [], { bound: "Prognosen kräver godkända order i månaden att räkna takten på.", follow: ["malet"] });
  const g = t.prognos;
  const rows: Rad[] = [
    ["uppskattning", `${st(g.antal, "order", "order")} i ${manad(m)} om takten håller.`, null, `Dina order hittills ÷ ${t.gangna} arbetsdagar × ${t.totalt} arbetsdagar.`],
    ["uppskattning", `Grundprovision ${kr(g.grund)}${g.bonus ? ` och volymbonus ${kr(g.bonus)}` : ""}.`, null, "Samma provisionsmotor som Provision, på den framskrivna volymen."],
  ];
  if (g.nasta) rows.push(["exakt", `Nästa nivå i trappan: ${st(g.nasta.t, "order", "order")}, ${g.nasta.kvar} kvar.`, "Provision"]);
  return svar(`I samma takt landar ${manad(m)} på ${kr(g.totalt)}.`, rows, {
    note: "K&V-bonusen skrivs inte fram: den beror på bedömningar som inte är gjorda.",
    follow: ["perdag", "malet"],
  });
}

async function perdag({ L }: Ctx): Promise<NdPalSvar> {
  const p = await L.provision();
  const m = p.manad;
  const u = p.underlag[m]?.[p.jagId];
  const mal = p.mal[m]?.[p.jagId];
  const t = p.takt[p.jagId];
  if (!mal || (mal.k === null && mal.o === null)) return svar(`Du har inget mål för ${manad(m)}.`, [], { bound: "Målen sätts av säljchef eller VD i Provision.", follow: ["malet"] });
  const kvar = t?.kvar ?? 0;
  const summa = u?.summa ?? 0;
  const netto = u?.antal.netto ?? 0;
  if (kvar <= 0) return svar(`Inga arbetsdagar kvar i ${manad(m)}.`, [], { follow: ["malet"] });
  const rows: Rad[] = [["exakt", `${st(kvar, "arbetsdag", "arbetsdagar")} kvar i ${manad(m)}.`, "Provision"]];
  let lead = "";
  if (mal.k !== null) {
    const rest = Math.max(0, mal.k - summa);
    rows.push(["utraknat", `${kr(rest)} kvar till målet.`, null, `${kr(mal.k)} − ${kr(summa)}.`]);
    rows.push(["utraknat", `${kr(rest / kvar)} i provision per arbetsdag.`, null, `${kr(rest)} ÷ ${kvar} arbetsdagar.`]);
    lead = rest ? `Cirka ${kr(rest / kvar)} i provision per arbetsdag.` : "Du har redan nått målet i kronor.";
  }
  if (mal.o !== null) {
    const rest = Math.max(0, mal.o - netto);
    rows.push(["utraknat", `${st(rest, "order", "order")} kvar till ordermålet, ${(rest / kvar).toLocaleString("sv-SE", { maximumFractionDigits: 1 })} per arbetsdag.`, null, `(${mal.o} − ${netto}) ÷ ${kvar} arbetsdagar.`]);
    if (!lead) lead = rest ? `${(rest / kvar).toLocaleString("sv-SE", { maximumFractionDigits: 1 })} order per arbetsdag.` : "Du har redan nått ordermålet.";
  }
  return svar(lead, rows, { follow: ["malet", "prognos"] });
}

async function forra({ L }: Ctx): Promise<NdPalSvar> {
  const p = await L.provision();
  const m = p.manader[1];
  if (!m) return svar("Nav har ingen tidigare månad att visa.");
  const u = p.underlag[m]?.[p.jagId];
  const per = p.perioder[m];
  const hist = p.historik?.[m]?.[p.jagId];
  if (!u && hist === undefined) return svar(`Nav har inget provisionsunderlag för dig i ${manad(m)}.`);
  const belopp = u ? u.summa : Number(hist);
  const rows: Rad[] = [["exakt", `${kr(belopp)} i ${manad(m)}${u ? ` på ${st(u.antal.netto, "order", "order")} netto` : " enligt lönesystemet"}.`, "Provision"]];
  rows.push(["exakt", per?.status === "faststalld" ? `Månaden är fastställd${per.stangd ? ` (${dag(per.stangd)})` : ""}.` : "Månaden är inte fastställd än, så beloppet kan ändras.", "Provision"]);
  return svar(`${kr(belopp)} i ${manad(m)}.`, rows, { follow: ["malet", "perioder"] });
}

async function perioder({ L, idag }: Ctx): Promise<NdPalSvar> {
  const p = await L.provision();
  if (!p.chefsvy) return svar("Det kan jag inte se.", [], { bound: "Perioderna fastställs av säljchef, VD och ekonomi." });
  const passerade = p.manader.filter((m) => m < idag.slice(0, 7)).slice(0, 6);
  const ej = passerade.filter((m) => p.perioder[m]?.status !== "faststalld");
  if (!ej.length) return svar("Alla månader de senaste sex är fastställda.");
  return svar(`${st(ej.length, "månad", "månader")} av de senaste sex är inte fastställda.`, ej.map((m): Rad => ["exakt", `${manad(m)} ${m.slice(0, 4)}: inte fastställd.`, "Provision"]), {
    acts: [{ l: "Öppna Provision", open: "/provision" }],
  });
}

/* ---------- Golvet ---------- */

async function teamet({ L, idag }: Ctx): Promise<NdPalSvar> {
  const [g, p] = await Promise.all([L.golvet(), L.provision()]);
  if (!g) return svar("Nav har inget lag att räkna på för dig.");
  const vem = g.lag ?? "Bolaget";
  const rows: Rad[] = [
    ["exakt", `${st(g.antal, "order", "order")} netto och ${kr(g.netto)} i ordervärde i ${manad(g.manad)}.`, "Golvet"],
  ];
  if (g.idagAntal) rows.push(["exakt", `${st(g.idagAntal, "order godkänd", "order godkända")} i dag, ${kr(g.idagSumma)}.`, "Golvet"]);
  const dagar = p.arbetsdagar[g.manad] ?? [];
  const gangna = dagar.filter((d) => d <= idag).length;
  let lead = `${vem}: ${kr(g.netto)} i ordervärde i ${manad(g.manad)}.`;
  if (g.mal.order !== null && dagar.length) {
    const vantat = (g.mal.order * gangna) / dagar.length;
    rows.push(["utraknat", `${Math.round(vantat * 10) / 10} order var väntat efter ${gangna} av ${dagar.length} arbetsdagar, mot målet ${g.mal.order}.`, null, `${g.mal.order} × ${gangna} ÷ ${dagar.length} arbetsdagar.`]);
    lead += g.antal >= vantat ? " Före takten." : " Efter takten.";
  } else if (g.mal.order === null) {
    rows.push(["exakt", "Laget har inget ordermål i månaden.", "Provision"]);
  }
  if (g.mal.utan) rows.push(["exakt", `${st(g.mal.utan, "person i laget saknar", "personer i laget saknar")} mål.`, "Provision"]);
  return svar(lead, rows, { follow: ["godkann"] });
}

/* ---------- Frånvaro ---------- */

const FRST: Record<string, string> = { pending: "väntar på beslut", approved: "beviljad", rejected: "avslagen", withdrawn: "återtagen", sick: "sjuk" };

async function semester({ L }: Ctx): Promise<NdPalSvar> {
  const f = await L.franvaro();
  const v = f.saldo.vacation;
  const s = f.saldo.saved;
  if (!v && !s) return svar("Nav har inget semestersaldo för dig.", [], { bound: "Saldot läggs in i Nav av den som sköter lönen.", follow: ["ansokt", "fredag"] });
  const rows: Rad[] = [];
  if (v) rows.push(["exakt", `${v.d} semesterdagar kvar (per ${dag(v.asof)}).`, "Frånvaro"]);
  if (s) rows.push(["exakt", `${s.d} sparade dagar (per ${dag(s.asof)}).`, "Frånvaro"]);
  return svar(v ? `${v.d} semesterdagar kvar.` : `${s!.d} sparade dagar.`, rows, { follow: ["fredag", "ansokt"] });
}

async function ansokt({ L, idag }: Ctx): Promise<NdPalSvar> {
  const f = await L.franvaro();
  const v = f.poster.filter((p) => p.egen && p.typ !== "sick" && ((p.till ?? p.fran) >= idag || (p.st === "rejected" && dagarMellan(p.fran, idag) <= 30)));
  if (!v.length) return svar("Du har ingen kommande ledighet i Nav.", [], { acts: [{ l: "Ansök om ledighet", open: "/franvaro/ny" }], follow: ["fredag"] });
  const typ = new Map(f.typer.map((t): [string, string] => [t.id, t.label]));
  const k = kapa(v.map((p): Rad => ["exakt", `${typ.get(p.typ) ?? p.typ} ${dag(p.fran)}${p.till && p.till !== p.fran ? `–${dag(p.till)}` : ""}: ${FRST[p.st] ?? p.st}.`, "Frånvaro"]));
  const vantar = v.filter((p) => p.st === "pending").length;
  return svar(`${st(v.length, "ledighet", "ledigheter")}${vantar ? `, ${vantar} väntar på beslut` : ""}.${k.till}`, k.rows, { follow: ["semester"] });
}

async function fredag({ L, idag }: Ctx): Promise<NdPalSvar> {
  const f = await L.franvaro();
  const fr = fredagNastaVecka(idag);
  const typ = f.typer.find((t) => t.id === "vacation");
  const dagar = dagarMellan(idag, fr);
  const rows: Rad[] = [];
  const hinder: string[] = [];
  if (typ) {
    const ok = dagar >= typ.notice_days;
    rows.push(["exakt", `Du ansöker ${dagar} dagar före. Semester kräver ${typ.notice_days}.`, "Frånvaro"]);
    if (!ok) hinder.push("framförhållningen");
  }
  const sparr = f.sparrar.find((s) => s.fran <= fr && fr <= s.till && (!s.typer.length || s.typer.includes("vacation")));
  if (sparr) {
    rows.push(["exakt", `Spärr: ${sparr.l} (${dag(sparr.fran)}–${dag(sparr.till)}).`, "Frånvaro"]);
    hinder.push("spärren");
  }
  const egen = f.poster.find((p) => p.egen && p.st !== "rejected" && p.st !== "withdrawn" && p.fran <= fr && fr <= (p.till ?? p.fran));
  if (egen) {
    rows.push(["exakt", `Du har redan frånvaro den dagen (${FRST[egen.st] ?? egen.st}).`, "Frånvaro"]);
    hinder.push("din egen frånvaro");
  }
  const borta = f.bemanning[fr] ?? 0;
  rows.push(["exakt", borta ? `${st(borta, "kollega är", "kollegor är")} borta den dagen.` : "Ingen kollega är borta den dagen.", "Frånvaro"]);
  if (f.saldo.vacation) rows.push(["exakt", `${f.saldo.vacation.d} semesterdagar kvar.`, "Frånvaro"]);
  const lead = hinder.length ? `Det krockar med ${hinder.join(" och ")}.` : "Inget i reglerna stoppar det.";
  return svar(lead, rows, {
    bound: f.saldo.vacation ? undefined : "Nav har inget semestersaldo för dig, så saldot är inte prövat.",
    acts: [{ l: "Ansök om ledighet", open: "/franvaro/ny" }],
    follow: ["semester", "ansokt"],
  });
}

async function sjukring({ L }: Ctx): Promise<NdPalSvar> {
  const f = await L.franvaro();
  if (!f.ring.length) return svar("Nav har ingen ringordning för dig.", [], { acts: [{ l: "Sjukanmäl dig", open: "/franvaro/sjuk" }] });
  return svar(
    `Ring ${f.ring[0].vem} först.`,
    f.ring.map((r): Rad => ["exakt", `${r.roll}: ${r.vem}${r.tel ? ` · ${r.tel}` : ""}.`, "Sjukfrånvaro"]),
    { note: "Sjukanmäl dig också i Nav, så startar fristerna rätt.", acts: [{ l: "Sjukanmäl dig", open: "/franvaro/sjuk" }] },
  );
}

async function ledig({ L, idag }: Ctx): Promise<NdPalSvar> {
  const f = await L.franvaro();
  const mon = plus(mandag(idag), 7);
  const rader: Rad[] = [];
  for (let i = 0; i < 5; i++) {
    const d = plus(mon, i);
    const n = f.bemanning[d] ?? 0;
    if (n) rader.push(["exakt", `${veckodag(d)} ${dag(d)}: ${st(n, "kollega", "kollegor")} borta.`, "Frånvaro"]);
  }
  return svar(rader.length ? `Nästa vecka är kollegor borta ${st(rader.length, "dag", "dagar")}.` : "Ingen kollega har beviljad ledighet nästa vecka.", rader, {
    bound: "Du ser hur många som är borta, inte vilka. Namnen ser din chef.",
    follow: ["fredag"],
  });
}

async function ledigt({ L, idag }: Ctx): Promise<NdPalSvar> {
  const f = await L.franvaro();
  if (!f.chef) return svar("Det kan jag inte se.", [], { bound: "Vem som är ledig ser den som ansvarar för personalen." });
  const till = plus(idag, 14);
  const borta: Rad[] = f.chef.kommande.filter((b) => b.fran <= till).map((b): Rad => ["exakt", `${b.namn}: ${b.etikett}, ${b.detalj}.`, "Frånvaro"]);
  const ko: Rad[] = f.chef.ko.filter((a) => a.starts_on <= till && a.ends_on >= idag).map((a): Rad => ["exakt", `${a.namn}: ${a.typ} ${dag(a.starts_on)}${a.ends_on !== a.starts_on ? `–${dag(a.ends_on)}` : ""}, väntar på ditt beslut.`, "Attest"]);
  const alla = [...ko, ...borta];
  if (!alla.length) return svar("Ingen är ledig de kommande två veckorna.");
  const k = kapa(alla);
  return svar(`${st(alla.length, "ledighet", "ledigheter")} de kommande två veckorna${ko.length ? `, ${ko.length} väntar på ditt beslut` : ""}.${k.till}`, k.rows, {
    acts: ko.length ? [{ l: "Öppna attesten", open: "/franvaro/attest" }] : [{ l: "Öppna Frånvaro", open: "/franvaro" }],
    follow: ["besluta"],
  });
}

async function borta({ L, idag }: Ctx): Promise<NdPalSvar> {
  const [t, f] = await Promise.all([L.tid(), L.franvaro()]);
  if (!t.chef && !f.chef) return svar("Det kan jag inte se.", [], { bound: "Dagsläget för teamet ser den som ansvarar för personalen." });
  const rader: Rad[] = (t.chef?.dagsbild ?? []).filter((r) => r.lage === "sjuk" || r.lage === "ledig").map((r): Rad => ["exakt", `${r.namn}: ${r.etikett.toLowerCase()}${r.detalj ? `, ${r.detalj}` : ""}.`, r.lage === "sjuk" ? "Sjukfrånvaro" : "Frånvaro"]);
  if (!rader.length && f.chef) {
    f.chef.sjuka.filter((s) => s.forstaDag <= idag && (!s.sistaDag || s.sistaDag >= idag)).forEach((s) => rader.push(["exakt", `${s.namn}: sjuk sedan ${dag(s.forstaDag)}.`, "Sjukfrånvaro"]));
    f.chef.kommande.filter((b) => b.fran <= idag).forEach((b) => rader.push(["exakt", `${b.namn}: ${b.etikett}, ${b.detalj}.`, "Frånvaro"]));
  }
  if (!rader.length) return svar("Ingen är borta i dag.", [], { follow: ["ejinne"] });
  const k = kapa(rader);
  return svar(`${st(rader.length, "person är", "personer är")} borta i dag.${k.till}`, k.rows, { follow: ["ejinne", "ledigt"] });
}

const FRIST: Record<string, string> = { certificate: "läkarintyg", fk_notice: "anmälan till Försäkringskassan", return_plan: "plan för återgång" };

async function frister({ L, idag }: Ctx): Promise<NdPalSvar> {
  const f = await L.franvaro();
  if (!f.chef) return svar("Det kan jag inte se.", [], { bound: "Sjukfristerna ser den som ansvarar för personalen." });
  const till = plus(idag, 14);
  const v = f.chef.sjuka
    .flatMap((s) => s.frister.map((x) => ({ namn: s.namn, kind: x.kind, due: x.due_on })))
    .filter((x) => x.due <= till)
    .sort((a, b) => a.due.localeCompare(b.due));
  if (!v.length) return svar("Inga sjukfrister de kommande två veckorna.");
  const k = kapa(v.map((x): Rad => ["exakt", `${x.namn}: ${FRIST[x.kind] ?? x.kind} senast ${dag(x.due)}${x.due < idag ? " (passerad)" : ""}.`, "Sjukfrånvaro"]));
  return svar(`${st(v.length, "frist", "frister")} de kommande två veckorna.${k.till}`, k.rows, { acts: [{ l: "Öppna sjukfrånvaron", open: "/franvaro/sjuk" }] });
}

async function rehab({ L }: Ctx): Promise<NdPalSvar> {
  const f = await L.franvaro();
  if (!f.chef) return svar("Det kan jag inte se.", [], { bound: "Rehabsignalen ser den som ansvarar för personalen." });
  const r = f.regler;
  const v = f.chef.rehab;
  if (!v.length) return svar("Ingen har upprepad korttidsfrånvaro.", [], { bound: r ? `Signalen tänds vid ${r.repeat_sick_count} sjukperioder på ${r.repeat_sick_months} månader.` : undefined });
  return svar(
    `${st(v.length, "person har", "personer har")} upprepad korttidsfrånvaro.`,
    v.map((x): Rad => ["exakt", `${x.namn}: ${x.antal} sjukperioder sedan ${dag(x.sedan)}${x.kvitterad ? ", kvitterad" : ""}.`, "Sjukfrånvaro"]),
    { bound: r ? `Signalen tänds vid ${r.repeat_sick_count} sjukperioder på ${r.repeat_sick_months} månader.` : undefined, acts: [{ l: "Öppna sjukfrånvaron", open: "/franvaro/sjuk" }] },
  );
}

/* ---------- Tid ---------- */

/** Minuter mellan in och ut per dag. Ersatta stämplingar räknas inte; en öppen dag räknas till nu. */
function arbetat(egna: { id: string; kind: string; at: string; dag: string; ersatter: string | null }[], fran: string, till: string, nu: number): Map<string, number> {
  const ersatta = new Set(egna.map((s) => s.ersatter).filter(Boolean));
  const per = new Map<string, number>();
  const s = egna.filter((x) => !ersatta.has(x.id) && x.dag >= fran && x.dag <= till).sort((a, b) => a.at.localeCompare(b.at));
  let inne: { dag: string; t: number } | null = null;
  for (const x of s) {
    if (x.kind === "in") inne = { dag: x.dag, t: Date.parse(x.at) };
    else if (x.kind === "out" && inne) {
      per.set(inne.dag, (per.get(inne.dag) ?? 0) + Math.round((Date.parse(x.at) - inne.t) / 6e4));
      inne = null;
    }
  }
  if (inne) per.set(inne.dag, (per.get(inne.dag) ?? 0) + Math.max(0, Math.round((nu - inne.t) / 6e4)));
  return per;
}

async function jobbat({ L, idag }: Ctx): Promise<NdPalSvar> {
  const t = await L.tid();
  if (!t.stamplar) return svar("Du stämplar inte i Nav.", [], { bound: "Tiden registreras bara för de roller som stämplar." });
  const mon = mandag(idag);
  const per = arbetat(t.egna, mon, idag, Date.now());
  const summa = [...per.values()].reduce((s, x) => s + x, 0);
  const rows: Rad[] = [...per.entries()].sort().map(([d, min]): Rad => ["exakt", `${veckodag(d)} ${dag(d)}: ${timmar(min)}.`, "Tid"]);
  rows.push(["utraknat", `${timmar(summa)} sedan måndag.`, null, "Tiden mellan in- och utstämpling, dag för dag. En rättad stämpling räknas i stället för den den ersätter; en dag du är instämplad räknas till nu."]);
  return svar(`${timmar(summa)} den här veckan.`, rows, { follow: ["instamplad", "sena"] });
}

async function instamplad({ L, idag }: Ctx): Promise<NdPalSvar> {
  const t = await L.tid();
  if (!t.stamplar) return svar("Du stämplar inte i Nav.");
  const ersatta = new Set(t.egna.map((s) => s.ersatter).filter(Boolean));
  const idagS = t.egna.filter((s) => s.dag === idag && !ersatta.has(s.id)).sort((a, b) => a.at.localeCompare(b.at));
  const forsta = idagS.find((s) => s.kind === "in");
  if (!forsta) return svar("Du har inte stämplat in i dag.", [], { acts: [{ l: "Öppna Tid", open: "/tid" }] });
  const rows: Rad[] = idagS.map((s): Rad => ["exakt", `${s.kind === "in" ? "In" : "Ut"} ${s.kl}${s.korr ? " (rättad)" : ""}.`, "Tid"]);
  const lage = t.lage === "inne" ? "Du är instämplad nu." : t.lage === "rast" ? "Du har rast nu." : "Du är utstämplad nu.";
  return svar(`Klockan ${forsta.kl}. ${lage}`, rows, { follow: ["jobbat"] });
}

async function sena({ L, idag }: Ctx): Promise<NdPalSvar> {
  const t = await L.tid();
  if (!t.stamplar) return svar("Du stämplar inte i Nav.");
  const fran = plus(idag, -30);
  const v = t.sena.filter((s) => s.dag >= fran).sort((a, b) => b.dag.localeCompare(a.dag));
  if (!v.length) return svar("Inga sena ankomster de senaste 30 dagarna.");
  const k = kapa(v.map((s): Rad => ["exakt", `${veckodag(s.dag)} ${dag(s.dag)}: ${s.min} min (kom ${s.ankom}, schemat ${s.schemalagd}).`, "Tid"]));
  return svar(`${st(v.length, "sen ankomst", "sena ankomster")} de senaste 30 dagarna.${k.till}`, k.rows, {
    note: "En sen ankomst gallras ur Nav efter en tid; dagarna kvar står i Tid.",
    follow: ["jobbat"],
  });
}

async function ejinne({ L }: Ctx): Promise<NdPalSvar> {
  const t = await L.tid();
  if (!t.chef) return svar("Det kan jag inte se.", [], { bound: "Dagsläget för teamet ser den som ansvarar för personalen." });
  const v = t.chef.dagsbild.filter((r) => r.lage === "ej_instamplad");
  if (!v.length) return svar("Alla som skulle börjat har stämplat in.", [], { follow: ["borta"] });
  const k = kapa(v.map((r): Rad => ["exakt", `${r.namn}: ${r.detalj}.`, "Tid"]));
  return svar(`${st(v.length, "person har", "personer har")} inte stämplat in.${k.till}`, k.rows, {
    note: "Inte instämplad är ingen anklagelse. Personen kan vara på ett kundbesök eller ha glömt.",
    follow: ["borta"],
  });
}

async function rattelser({ L }: Ctx): Promise<NdPalSvar> {
  const t = await L.tid();
  if (!t.chef) return svar("Det kan jag inte se.", [], { bound: "Rättelser beslutas av den som ansvarar för personalen." });
  const r = t.chef.rattelser;
  const ogiltig = t.chef.ogiltig.filter((o) => o.status === "foreslagen");
  if (!r.length && !ogiltig.length) return svar("Inga rättelser eller förslag väntar på dig.");
  const rows: Rad[] = r.map((x): Rad => ["exakt", `${x.namn}: ${x.kind === "in" ? "instämpling" : x.kind === "out" ? "utstämpling" : x.kind} ${dag(x.dag)}, ${x.fran ?? "saknas"} → ${x.till}.`, "Tid"]);
  if (ogiltig.length) rows.push(["exakt", `${st(ogiltig.length, "förslag", "förslag")} om ogiltig frånvaro väntar på beslut.`, "Tid"]);
  const k = kapa(rows);
  const delar = [r.length ? st(r.length, "rättelse", "rättelser") : "", ogiltig.length ? `${st(ogiltig.length, "förslag", "förslag")} om ogiltig frånvaro` : ""].filter(Boolean);
  return svar(`${ndVersal(delar.join(" och "))} väntar på dig.${k.till}`, k.rows, {
    acts: [{ l: "Öppna Tid", open: "/tid" }],
  });
}

/* ---------- Uppgifter och kalendern ---------- */

async function forsenat({ L, idag }: Ctx): Promise<NdPalSvar> {
  const u = await L.uppgifter();
  const v = u.uppgifter.filter((x) => x.vy === "egen" && !arStangd(x.lage) && x.due && x.due < idag).sort((a, b) => (a.due ?? "").localeCompare(b.due ?? ""));
  if (!v.length) return svar("Ingen av dina uppgifter är försenad.", [], { follow: ["idag"] });
  const k = kapa(v.map((x): Rad => ["exakt", `${x.t}: frist ${dag(x.due!)}, ${st(dagarMellan(x.due!, idag), "dag", "dagar")} sedan.`, "Uppgifter", undefined, `/uppgifter/${x.id}`]));
  return svar(`${st(v.length, "uppgift är", "uppgifter är")} försenade.${k.till}`, k.rows, {
    acts: [{ l: "Öppna Uppgifter", open: "/uppgifter" }],
    follow: ["vantar"],
  });
}

async function vantar({ L }: Ctx): Promise<NdPalSvar> {
  const u = await L.uppgifter();
  const v = u.uppgifter.filter((x) => x.vy === "vantar" && !arStangd(x.lage));
  if (!v.length) return svar("Du väntar inte på någon.");
  const k = kapa(v.map((x): Rad => ["exakt", `${x.t}: ${x.ansvarig ?? "ingen ansvarig"}${x.due ? `, frist ${dag(x.due)}` : ""}.`, "Uppgifter", undefined, `/uppgifter/${x.id}`]));
  return svar(`Du väntar på ${st(v.length, "uppgift", "uppgifter")} från andra.${k.till}`, k.rows);
}

const SLAG: Record<string, string> = { mote: "Möte", enskilt: "1:1", coachning: "Coachning", leverans: "Leverans", uppgift: "Uppgift", ledig: "Ledig", order: "Frist", frist: "Frist" };

type Kal = NonNullable<Awaited<ReturnType<typeof byggKalender>>>;
type Post = Kal["poster"][number];
/** De andra i ett möte, med namn, utan den som frågar och utan dubbletter. */
function andra(k: Kal, p: Post): string[] {
  const namn = new Map(k.personer.map((x): [string, string] => [x.id, x.namn]));
  const ids = [...new Set([p.organisator, p.agare, ...p.deltagare].filter((id): id is string => Boolean(id) && id !== k.mig))];
  return ids.map((id) => namn.get(id)).filter((n): n is string => Boolean(n));
}
/** Postens rubrik som i Kalendern: "1:1 med Elin" i stället för "1:1", "Upptagen" när nivån döljer den. */
function rubrik(k: Kal, p: Post): string {
  if (p.rubrik === null) return "Upptagen";
  if (p.slag === "enskilt") {
    const a = andra(k, p);
    return a.length ? `1:1 med ${a.join(" och ")}` : p.rubrik;
  }
  return p.slag === "mote" || p.slag === "uppgift" ? p.rubrik : `${p.rubrik} (${SLAG[p.slag] ?? p.slag})`;
}

async function moten({ L, idag }: Ctx): Promise<NdPalSvar> {
  const k = await L.kalender();
  if (!k) return svar("Du har ingen kalender i Nav.");
  const sondag = plus(mandag(idag), 6);
  const v = k.poster
    .filter((p) => p.agare === k.mig && p.dag >= idag && p.dag <= sondag && ["mote", "enskilt", "coachning", "leverans"].includes(p.slag))
    .sort((a, b) => a.dag.localeCompare(b.dag) || (a.start ?? 0) - (b.start ?? 0));
  if (!v.length) return svar("Inga möten resten av veckan.", [], { follow: ["nasta11"] });
  const r = kapa(v.map((p): Rad => ["exakt", `${veckodag(p.dag)} ${dag(p.dag)}${p.start !== null ? ` ${hm(p.start)}` : ""}: ${rubrik(k, p)}.`, "Kalender"]));
  return svar(`${st(v.length, "möte", "möten")} resten av veckan.${r.till}`, r.rows, { follow: ["nasta11", "idag"] });
}

async function nasta11({ L, idag }: Ctx): Promise<NdPalSvar> {
  const k = await L.kalender();
  if (!k) return svar("Du har ingen kalender i Nav.");
  const nu = new Date().toLocaleTimeString("sv-SE", { timeZone: "Europe/Stockholm", hour: "2-digit", minute: "2-digit" });
  const nuMin = +nu.slice(0, 2) * 60 + +nu.slice(3, 5);
  const p = k.poster
    .filter((x) => x.agare === k.mig && x.slag === "enskilt" && (x.dag > idag || (x.dag === idag && (x.start ?? 0) >= nuMin)))
    .sort((a, b) => a.dag.localeCompare(b.dag) || (a.start ?? 0) - (b.start ?? 0))[0];
  if (!p) return svar("Ingen 1:1 inbokad den här månaden eller nästa.", [], { acts: [{ l: "Öppna Kalender", open: "/kalender" }] });
  const med = andra(k, p);
  return svar(`${ndVersal(veckodag(p.dag))} ${dag(p.dag)}${p.start !== null ? ` klockan ${hm(p.start)}` : ""}${med.length ? ` med ${med.join(" och ")}` : ""}.`, [["exakt", `${rubrik(k, p)}${p.minuter ? `, ${p.minuter} min` : ""}.`, "Kalender"]], {
    acts: [{ l: "Öppna i kalendern", open: `/kalender?dag=${p.dag}${p.ref ? `&handelse=${p.ref}` : ""}` }],
    follow: ["coach"],
  });
}

async function idagFraga({ L, idag, mig }: Ctx): Promise<NdPalSvar> {
  const [u, k, o] = await Promise.all([L.uppgifter(), L.kalender(), L.order()]);
  const rows: Rad[] = [];
  const kal = (k?.poster ?? []).filter((p) => p.agare === k?.mig && p.dag === idag && p.slag !== "ledig").sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
  if (k) kal.forEach((p) => rows.push(["exakt", `${p.start !== null ? `${hm(p.start)} ` : ""}${rubrik(k, p)}.`, "Kalender"]));
  const upg = u.uppgifter.filter((x) => x.vy === "egen" && !arStangd(x.lage) && x.due && x.due <= idag);
  const sena = upg.filter((x) => x.due! < idag).length;
  if (upg.length) rows.push(["exakt", `${st(upg.length, "uppgift", "uppgifter")} med frist i dag eller tidigare${sena ? `, ${sena} försenade` : ""}.`, "Uppgifter"]);
  const stopp = o.order.filter((x) => x.vemId === mig && x.st === "inskickad" && !x.samtal);
  stopp.forEach((x) => rows.push(["exakt", `Order #${x.nr} ${x.bolag} är stoppad tills säljsamtalet kopplas.`, `Order #${x.nr}`, undefined, `/order/${x.nr}`]));
  const delar = [kal.length ? st(kal.length, "post i kalendern", "poster i kalendern") : "", upg.length ? st(upg.length, "uppgift", "uppgifter") : "", stopp.length ? st(stopp.length, "stoppad order", "stoppade order") : ""].filter(Boolean);
  const r = kapa(rows);
  return svar(delar.length ? `${delar.join(", ")}.${r.till}` : "Inget i kalendern, inga uppgifter med frist och inga stoppade order i dag.", r.rows, {
    follow: ["forsenat", "moten"],
  });
}

/* ---------- Rutiner ---------- */

async function kvittera({ L }: Ctx): Promise<NdPalSvar> {
  const r = await L.rutiner();
  const v = r.rutiner.filter((x) => x.kvitt && !x.acked && x.status === "published");
  if (!v.length) return svar("Du har kvitterat alla rutiner som kräver det.");
  return svar(`${st(v.length, "rutin väntar", "rutiner väntar")} på din kvittens.`, v.map((x): Rad => ["exakt", `${x.t}, version ${x.v}.`, "Rutiner", undefined, `/rutiner/${x.id}`]), {
    acts: [{ l: `Öppna ${v[0].t}`, open: `/rutiner/${v[0].id}` }],
  });
}

/** En fråga om en sak som en rutin borde svara på. Svaret är rutinen, eller att den saknas. */
function rutinFraga(ord: string[], amne: string) {
  return async ({ L }: Ctx): Promise<NdPalSvar> => {
    const r = await L.rutiner();
    const har = (s: string) => ord.some((o) => norm(s).includes(o));
    const publ = r.rutiner.filter((x) => x.status === "published");
    const v = [...publ.filter((x) => har(x.t) || x.syn.some(har)), ...publ.filter((x) => !(har(x.t) || x.syn.some(har)) && har(x.tldr ?? ""))];
    if (!v.length)
      return svar(`Det finns ingen rutin om ${amne} i Nav.`, [], {
        bound: "Skriv ett ärende, så kan den som förvaltar rutinerna skriva en.",
        acts: [{ l: "Skapa ett ärende", open: "/arenden/nytt" }],
      });
    const x = v[0];
    const rows: Rad[] = [];
    if (x.tldr) rows.push(["exakt", x.tldr, "Rutiner", undefined, `/rutiner/${x.id}`]);
    (x.steg ?? []).slice(0, 4).forEach((s, i) => rows.push(["exakt", `Steg ${i + 1}: ${s[0]}${s[1] ? ` – ${s[1]}` : ""}`, "Rutiner", undefined, `/rutiner/${x.id}`]));
    return svar(`Rutinen ${x.t} svarar på det.`, rows, { acts: [{ l: "Öppna rutinen", open: `/rutiner/${x.id}` }] });
  };
}

async function kvittenser({ L }: Ctx): Promise<NdPalSvar> {
  const r = await L.rutiner();
  if (!r.redaktor) return svar("Det kan jag inte se.", [], { bound: "Kvittenserna ser den som förvaltar rutinerna." });
  const v = r.rutiner.filter((x) => x.kvitt && x.saknar.length);
  if (!v.length) return svar("Alla har kvitterat rutinerna som kräver det.");
  return svar(
    `${st(v.length, "rutin saknar", "rutiner saknar")} kvittenser.`,
    v.map((x): Rad => ["exakt", `${x.t}: ${st(x.saknar.length, "person", "personer")} (${x.saknar.slice(0, 3).join(", ")}${x.saknar.length > 3 ? " …" : ""}).`, "Rutiner", undefined, `/rutiner/${x.id}`]),
    {},
  );
}

async function granska({ L, idag }: Ctx): Promise<NdPalSvar> {
  const r = await L.rutiner();
  const till = plus(idag, 30);
  const v = r.rutiner.filter((x) => x.status === "published" && x.nasta && x.nasta <= till).sort((a, b) => a.nasta.localeCompare(b.nasta));
  if (!v.length) return svar("Ingen rutin ska granskas de kommande 30 dagarna.");
  return svar(
    `${st(v.length, "rutin", "rutiner")} ska granskas inom 30 dagar.`,
    v.map((x): Rad => ["exakt", `${x.t}: senast ${dag(x.nasta)}${x.nasta < idag ? " (passerad)" : ""}, ägare ${x.agare}.`, "Rutiner", undefined, `/rutiner/${x.id}`]),
    {},
  );
}

/* ---------- Utbildning ---------- */

async function kurser({ L }: Ctx): Promise<NdPalSvar> {
  const u = await L.utbildning();
  const v = u.kurser.filter((k) => k.klara < k.moduler.length).sort((a, b) => Number(b.obl) - Number(a.obl));
  if (!v.length) return svar("Du har gjort klart alla kurser du har.", [], { follow: ["repetition"] });
  return svar(
    `${st(v.length, "kurs", "kurser")} kvar${v.some((k) => k.obl) ? `, varav ${st(v.filter((k) => k.obl).length, "obligatorisk", "obligatoriska")}` : ""}.`,
    v.map((k): Rad => ["exakt", `${k.t}: ${k.klara} av ${k.moduler.length} moduler${k.obl ? ", obligatorisk" : ""}${k.frist ? `, frist ${dag(k.frist)}` : ""}.`, "Utbildning"]),
    { acts: [{ l: "Öppna Utbildning", open: "/utbildning" }], follow: ["repetition"] },
  );
}

async function repetition({ L }: Ctx): Promise<NdPalSvar> {
  const u = await L.utbildning();
  const n = u.forfallna.length;
  const rows: Rad[] = [["exakt", `${st(u.streak, "dag", "dagar")} i rad${u.bast ? `, bästa ${u.bast}` : ""}.`, "Utbildning"]];
  if (!u.repetition.length) return svar("Du har ingen repetition än.", [], { bound: "Repetitionen byggs av frågorna i prov du klarat.", follow: ["kurser"] });
  return svar(n ? `${st(n, "fråga väntar", "frågor väntar")} i repetitionen.` : "Inga frågor att repetera i dag.", rows, {
    acts: [{ l: "Öppna Utbildning", open: "/utbildning" }],
    follow: ["kurser"],
  });
}

async function kurserteam({ L }: Ctx): Promise<NdPalSvar> {
  const u = await L.utbildning();
  if (!u.team) return svar("Det kan jag inte se.", [], { bound: "Teamets kurser ser den som leder ett team." });
  const rader: Rad[] = [];
  for (const k of u.team.obligatoriska)
    for (const p of u.team.personer) {
      const x = p.kurser[k.id];
      if (x && x[0] < x[1]) rader.push(["exakt", `${p.namn}: ${x[0]} av ${x[1]} i ${k.t}.`, "Utbildning"]);
    }
  if (!rader.length) return svar(u.team.obligatoriska.length ? "Alla har gjort de obligatoriska kurserna." : "Inga kurser är obligatoriska.");
  const r = kapa(rader);
  return svar(`${st(rader.length, "person har", "personer har")} obligatoriska kurser kvar.${r.till}`, r.rows, { follow: ["bedoma"] });
}

async function bedoma({ L }: Ctx): Promise<NdPalSvar> {
  const u = await L.utbildning();
  if (!u.team) return svar("Det kan jag inte se.", [], { bound: "Rollspelen bedöms av den som leder ett team." });
  const v = u.team.attBedoma;
  if (!v.length) return svar("Inga rollspel väntar på bedömning.");
  return svar(
    `${st(v.length, "rollspel väntar", "rollspel väntar")} på din bedömning.`,
    v.map((x): Rad => ["exakt", `${x.namn}: ${x.modul}, inlämnat ${dag(x.inlamnad)}.`, "Utbildning"]),
    { acts: [{ l: "Öppna Utbildning", open: "/utbildning" }] },
  );
}

/* ---------- Ärenden och fel ---------- */

const ARST: Record<string, string> = { new: "skickat, inte läst än", in_progress: "pågår", waiting: "väntar på ditt svar", resolved: "löst" };

async function arenden({ L, mig }: Ctx): Promise<NdPalSvar> {
  const a = await L.arenden();
  const v = a.arenden.filter((x) => x.vemId === mig && (x.status !== "resolved" || (x.lost && Date.now() - Date.parse(x.lost) < 30 * 864e5)));
  if (!v.length) return svar("Du har inga öppna ärenden.", [], { acts: [{ l: "Skapa ett ärende", open: "/arenden/nytt" }] });
  const svaraDu = v.filter((x) => x.status === "waiting").length;
  return svar(
    svaraDu ? `${st(svaraDu, "ärende väntar", "ärenden väntar")} på ditt svar.` : `${st(v.length, "ärende", "ärenden")}, inget väntar på dig.`,
    v.map((x): Rad => ["exakt", `${x.rubrik}: ${ARST[x.status]}.`, "Ärenden", undefined, `/arenden/${x.id}`]),
    {},
  );
}

async function arendetid({ L }: Ctx): Promise<NdPalSvar> {
  const a = await L.arenden();
  if (!a.hanterare) return svar("Det kan jag inte se.", [], { bound: "Svarstiderna ser den som handlägger ärenden." });
  const nu = Date.now();
  const kat = new Map(a.kategorier.map((k): [string, string] => [k.id, k.l]));
  const v = a.arenden.filter((x) => x.status !== "resolved" && x.status !== "waiting" && x.due && Date.parse(x.due) < nu);
  if (!v.length) return svar("Inga ärenden har passerat svarstiden.");
  return svar(
    `${st(v.length, "ärende har", "ärenden har")} passerat svarstiden.`,
    v.map((x): Rad => ["exakt", `${kat.get(x.kat) ?? "Ärende"}: ${timmar(Math.round((nu - Date.parse(x.due!)) / 6e4 / 60) * 60)} över tiden.`, "Ärenden", undefined, `/arenden/${x.id}`]),
    { note: "Rubrikerna visas inte här, som på startsidan."},
  );
}

const FELST: Record<string, string> = { new: "inte tagen än", ack: "någon arbetar med det", closed: "lagad" };

async function fel({ L, mig }: Ctx): Promise<NdPalSvar> {
  const f = await L.fel();
  const v = f.rader.filter((x) => x.vemId === mig && x.kind !== "automatic");
  if (!v.length) return svar("Du har inte rapporterat några fel.", [], { acts: [{ l: "Rapportera fel", open: "/fel/nytt" }] });
  const lagade = v.filter((x) => x.status === "closed").length;
  const r = kapa(v.map((x): Rad => ["exakt", `${x.rubrik}: ${FELST[x.status]}${x.losning ? `. ${x.losning}` : ""}.`, "Fel"]));
  return svar(`${lagade} av ${st(v.length, "rapport", "rapporter")} är lagade.${r.till}`, r.rows);
}

async function felko({ L }: Ctx): Promise<NdPalSvar> {
  const f = await L.fel();
  if (!f.hanterar) return svar("Det kan jag inte se.", [], { bound: "Felkön ser säljchef, VD och admin." });
  const v = f.rader.filter((x) => x.status !== "closed");
  if (!v.length) return svar("Felkön är tom.");
  const stopp = v.filter((x) => x.blocking).length;
  const nya = v.filter((x) => x.status === "new").length;
  const r = kapa(v.sort((a, b) => Number(b.blocking) - Number(a.blocking) || b.ant - a.ant).map((x): Rad => ["exakt", `${x.rubrik}${x.blocking ? " (stoppar arbetet)" : ""}: ${st(x.ant, "gång", "gånger")}, ${FELST[x.status]}.`, "Fel"]));
  return svar(`${st(v.length, "öppet fel", "öppna fel")}, ${nya} inte tagna${stopp ? `, ${stopp} stoppar arbetet` : ""}.${r.till}`, r.rows, { follow: ["natten"] });
}

async function natten({ L }: Ctx): Promise<NdPalSvar> {
  const f = await L.fel();
  const d = f.drift;
  if (!d) return svar("Det kan jag inte se.", [], { bound: "Nattjobbets kvitto ser den som hanterar felkön." });
  const fel = d.steg.filter((s) => !s.ok);
  const nar = d.ts ? new Date(d.ts).toLocaleString("sv-SE", { timeZone: "Europe/Stockholm", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "vid okänd tid";
  const rows: Rad[] = (fel.length ? fel : d.steg.slice(0, 4)).map((s): Rad => ["exakt", `${s.l}: ${s.text}`, "Fel"]);
  return svar(d.lage === "ok" && !fel.length ? `Ja. Nattjobbet gick ${nar}, alla steg klara.` : `Nej. ${st(fel.length, "steg", "steg")} gick fel i natt (${nar}).`, rows, { follow: ["felko"] });
}

/* ---------- Coachning och rekrytering ---------- */

const CNST: Record<string, string> = { ej_paborjad: "inte påbörjad", paborjad: "påbörjad", inlamnad: "inlämnad", klar: "klar", avbruten: "struken" };

async function coach({ L, mig, idag }: Ctx): Promise<NdPalSvar> {
  const c = await L.coachning();
  const v = c.avtal.filter((x) => x.vem === mig && x.st !== "klar" && x.st !== "avbruten");
  if (!v.length) return svar("Du har inga öppna överenskommelser i coachningen.", [], { follow: ["nasta11"] });
  const sena = v.filter((x) => x.due && x.due < idag).length;
  return svar(
    `${st(v.length, "överenskommelse", "överenskommelser")}${sena ? `, ${sena} försenade` : ""}.`,
    v.map((x): Rad => ["exakt", `${x.t}${x.due ? `, frist ${dag(x.due)}` : ""}: ${CNST[x.st] ?? x.st}.`, "Coachning"]),
    { acts: [{ l: "Öppna Coachning", open: "/coachning" }], follow: ["nasta11"] },
  );
}

async function coachteam({ L, mig, idag }: Ctx): Promise<NdPalSvar> {
  const c = await L.coachning();
  if (!c.chef) return svar("Det kan jag inte se.", [], { bound: "Teamets överenskommelser ser den som coachar." });
  const v = c.avtal.filter((x) => x.vem !== mig && x.st !== "klar" && x.st !== "avbruten" && x.due && x.due < idag);
  const inl = c.avtal.filter((x) => x.vem !== mig && x.st === "inlamnad");
  if (!v.length && !inl.length) return svar("Inga överenskommelser är försenade, och inget väntar på dig.");
  const rows: Rad[] = [
    ...inl.map((x): Rad => ["exakt", `${c.namn[x.vem] ?? "Okänd"}: ${x.t}, inlämnad, väntar på dig.`, "Coachning"]),
    ...v.map((x): Rad => ["exakt", `${c.namn[x.vem] ?? "Okänd"}: ${x.t}, frist ${dag(x.due!)}.`, "Coachning"]),
  ];
  const r = kapa(rows);
  return svar(`${st(v.length, "försenad", "försenade")}${inl.length ? ` och ${inl.length} inlämnade att titta på` : ""}.${r.till}`, r.rows, { acts: [{ l: "Öppna Coachning", open: "/coachning" }] });
}

async function kandidater({ L }: Ctx): Promise<NdPalSvar> {
  const x = await L.rekrytering();
  if (!x.far) return svar("Det kan jag inte se.", [], { bound: "Kandidaterna ser den som rekryterar." });
  const v = x.kand.filter((k) => k.steg !== "hired" && k.steg !== "rejected").sort((a, b) => a.stegD.localeCompare(b.stegD));
  if (!v.length) return svar("Inga kandidater är i processen just nu.");
  const r = kapa(v.map((k): Rad => ["exakt", `${k.namn}: ${STEG_ETIKETT[k.steg]} sedan ${dag(k.stegD)}.`, "Rekrytering"]));
  return svar(`${st(v.length, "kandidat", "kandidater")} i processen.${r.till}`, r.rows, { acts: [{ l: "Öppna Rekrytering", open: "/rekrytering" }] });
}

/* ---------- Chefens beslut ---------- */

async function besluta({ L, idag }: Ctx): Promise<NdPalSvar> {
  const [f, o, t, a, u] = await Promise.all([L.franvaro(), L.order(), L.tid(), L.arenden(), L.utbildning()]);
  const rows: Rad[] = [];
  const acts: { l: string; open: string }[] = [];
  const sjuka = (f.chef?.sjuka ?? []).filter((s) => !s.bekraftad && (!s.sistaDag || s.sistaDag >= idag));
  sjuka.forEach((s) => rows.push(["exakt", `${s.namn}s sjukanmälan från ${dag(s.forstaDag)} är inte bekräftad.`, "Sjukfrånvaro"]));
  const ko = f.chef?.ko ?? [];
  ko.forEach((x) => rows.push(["exakt", `${x.namn}: ${x.typ} ${dag(x.starts_on)}${x.brutna.length ? `, bryter mot ${x.brutna.join(" och ").toLowerCase()}` : ""}.`, "Attest"]));
  if (sjuka.length || ko.length) acts.push({ l: "Öppna attesten", open: "/franvaro/attest" });
  const ord = o.hanterare ? o.order.filter((x) => x.st === "inskickad") : [];
  if (ord.length) {
    rows.push(["exakt", `${st(ord.length, "order väntar", "order väntar")} på godkännande.`, "Order"]);
    acts.push({ l: "Öppna Order", open: "/order" });
  }
  const ratt = t.chef?.rattelser.length ?? 0;
  const ogiltig = t.chef?.ogiltig.filter((x) => x.status === "foreslagen").length ?? 0;
  if (ratt) rows.push(["exakt", `${st(ratt, "rättelse", "rättelser")} av stämplingar.`, "Tid"]);
  if (ogiltig) rows.push(["exakt", `${st(ogiltig, "förslag", "förslag")} om ogiltig frånvaro.`, "Tid"]);
  if (ratt || ogiltig) acts.push({ l: "Öppna Tid", open: "/tid" });
  const nu = Date.now();
  const over = a.hanterare ? a.arenden.filter((x) => x.status !== "resolved" && x.status !== "waiting" && x.due && Date.parse(x.due) < nu).length : 0;
  if (over) rows.push(["exakt", `${st(over, "ärende har", "ärenden har")} passerat svarstiden.`, "Ärenden"]);
  const roll = u.team?.attBedoma.length ?? 0;
  if (roll) rows.push(["exakt", `${st(roll, "rollspel", "rollspel")} att bedöma.`, "Utbildning"]);
  const antal = sjuka.length + ko.length + (ord.length ? 1 : 0) + (ratt ? 1 : 0) + (ogiltig ? 1 : 0) + (over ? 1 : 0) + (roll ? 1 : 0);
  if (!antal) return svar("Inget väntar på ditt beslut.", [], { follow: ["ledigt", "godkann"] });
  const r = kapa(rows);
  return svar(`${st(rows.length, "sak", "saker")} väntar på dig.${r.till}`, r.rows, { acts: acts.slice(0, 3), follow: ["ledigt", "arendetid", "rattelser"] });
}

/* ---------- Registret ---------- */

const FRAGOR: Record<string, (c: Ctx) => Promise<NdPalSvar>> = {
  idag: idagFraga,
  moten,
  nasta11,
  forsenat,
  vantar,
  malet,
  prognos,
  perdag,
  forra,
  minaorder,
  godkann,
  stoppade,
  loperut,
  teamet,
  semester,
  ansokt,
  fredag,
  sjukring,
  ledig,
  jobbat,
  instamplad,
  sena,
  kvittera,
  eftersalj: rutinFraga(["eftersalj"], "eftersälj"),
  samtycke: rutinFraga(["samtycke vid inspelning", "inspelning av samtal", "samtal spelas in"], "samtycke när samtalet spelas in"),
  sjukanmalan: rutinFraga(["sjukanmal"], "sjukanmälan"),
  kurser,
  repetition,
  arenden,
  fel,
  coach,
  besluta,
  ledigt,
  borta,
  ejinne,
  frister,
  rehab,
  arendetid,
  rattelser,
  kurserteam,
  bedoma,
  kvittenser,
  granska,
  felko,
  natten,
  perioder,
  coachteam,
  kandidater,
};

export const PAL_FRAGOR = Object.keys(FRAGOR);

/** Svaret på en av palettens frågor, räknat nu, med användarens behörighet. Null = okänd fråga. */
export async function svaraPaletten(supabase: SupabaseClient, user: CurrentUser, fraga: string): Promise<NdPalSvar | null> {
  const f = FRAGOR[fraga];
  if (!f || !user.employee) return null;
  return f({
    idag: svensktDatum(),
    mig: user.employee.id,
    namn: `${user.employee.first_name} ${user.employee.last_name}`.trim(),
    L: laddare(supabase, user),
  });
}
