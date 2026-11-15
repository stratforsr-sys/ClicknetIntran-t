import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { skrivFel } from "@/lib/fel-server";
import { nettoAntal, type Order } from "@/lib/order";
import { arArbetsdag, veckodag } from "@/lib/saljtakt";
import { LAGE_KOL, REGEL_OBEKRAFTAT, facitRader, lasInst, motesInfo, somForslagMote, type LageRad } from "./forslag";
import {
  domAndring, facitDags, facitPerVal, facitVid, forFaAttSaga, kollpunkt, obekraftadeAttForesla, oppetLage, trendLaget, utfallFor,
  type AndringDom, type Beslut, type ForslagInst, type MotesUtfall, type Trend,
} from "./forslagforma";
import { textAndel } from "./hemtext";
import { MATT, bokadePerVecka, mattMoten, type MattNyckel, type MotesMatt } from "./matt";
import { INST_FORVAL, INST_NYCKLAR, lokalDag, plusDagar, skaBekraftas, type MotenInst } from "./motesflode";
import { inomKrets, type StatMote } from "./motesstatforma";
import type { NAv } from "./statistik";
import { taktLage } from "./takt";

/**
 * Hemvyns jobb (designdokumentet 1.8).
 *
 * DAGJOBBET (`skapaObekraftade`, ett steg i mötesjobbet var kvart): ett första
 * möte som står obekräftat på sin sista bekräftelsedag blir ett förslag till den
 * som håller mötet. Ett öppet förslag vars möte har flyttats, bekräftats eller
 * bytt hållare stängs som inaktuellt.
 *
 * NATTJOBBET (`korForslagNatt`, ett steg i nattjobbet):
 *   1. Obesvarade förslag stängs: "ingen valde" när mötet börjat, annars inaktuellt.
 *   2. Rader vars domsdag har kommit döms. Saknas utfallet säger Nav det och
 *      väntar; efter fem arbetsdagar stängs raden som okänd.
 *   3. En dom vars utfall har rättats i efterhand får en ny dom. Den gamla står
 *      kvar i loggen.
 *   4. En följd inställning som ändrats blir en ändring i loggen.
 *   5. Ändringarna stäms av vid 20 och 40 möten, och får sitt slut.
 *   6. Navs facit sparas vid vart tionde avgjort möte.
 *   7. Natten mot måndag räknas trendregeln. Den skriver bara i kvittot.
 *   8. Takten sparas varje arbetsmorgon, för hela företaget och för varje lag.
 *   9. Rader äldre än 24 månader avidentifieras.
 *
 * SÅ LÄNGE `forslag.pa` ÄR AV SKRIVER JOBBEN INGENTING. De räknar, och kvittot
 * säger vad som skulle ha hänt. Brytaren slås på av en människa.
 *
 * Jobben räknar inget själva: måtten kommer ur registret (`matt.ts`), reglerna
 * ur `forslagforma.ts`. Allt går att köra om utan dubbletter: raderna är unika
 * på regel och nyckel, ett förslag får ett beslut, och en mätning skrivs bara
 * när läget har ändrats. Nav kontaktar aldrig en kund och gör inget på egen hand
 * utöver att skriva i sin egen logg.
 */

type Db = SupabaseClient;

const DYGN = 24 * 3600 * 1000;
const FRAMAT = 30 * DYGN;
const VANTA_ARBETSDAGAR = 5;
const OMDOM_BAKAT = 60 * DYGN;
const INSTALLNING_BAKAT = 30 * DYGN;
const VAL_SOM_LAGGS_FRAM = ["ringer-sjalv", "flytta", "lat-sta"] as const;
const MATT_OBEKRAFTAT: MotesMatt = "moten.hallna-av-alla";
const MATT_INSTALLNING: MotesMatt = "moten.uteblivna";

const fel = async (digest: string, e: unknown): Promise<string> => {
  const text = e instanceof Error ? e.message : String(e);
  await skrivFel({ kind: "automatic", path: "/api/jobb/forslag", digest, message: `Hemvyns jobb: ${digest} föll: ${text}`, blocking: false });
  return `${digest}: ${text}`;
};

/* ------------------------------------------------------------------------ */
/* Mötena                                                                    */
/* ------------------------------------------------------------------------ */

type StatRad = {
  id: string; kedja_id: string; bokat_av: string; halls_av: string; bokat_nar: string; mote_tid: string; art: StatMote["art"];
  utfall: StatMote["utfall"]; resultat: string | null; kalla: string; bekraftat_nar: string | null;
};
const STAT_KOL = "id, kedja_id, bokat_av, halls_av, bokat_nar, mote_tid, art, utfall, resultat, kalla, bekraftat_nar";
const SIDA = 1000;

/** Alla möten sedan Möten började gälla, också de utan utfall (de behövs för bokade per vecka). */
async function lasMoten(db: Db, gallerFran: string): Promise<StatMote[]> {
  const ut: StatMote[] = [];
  for (let sida = 0; sida < 10; sida++) {
    const { data, error } = await db.from("mote").select(STAT_KOL).gte("mote_tid", gallerFran).order("mote_tid", { ascending: true }).order("id", { ascending: true }).range(sida * SIDA, sida * SIDA + SIDA - 1);
    if (error) throw new Error(`möten: ${error.message}`);
    const rader = (data ?? []) as unknown as StatRad[];
    for (const r of rader) {
      ut.push({ id: r.id, kedja: r.kedja_id, bokatAv: r.bokat_av, hallsAv: r.halls_av, bokatNar: r.bokat_nar, moteTid: r.mote_tid, art: r.art, utfall: r.utfall, resultat: r.resultat, kalla: r.kalla, bekraftatNar: r.bekraftat_nar });
    }
    if (rader.length < SIDA) break;
  }
  return ut;
}

const bekraftatFore = (m: { bekraftatNar?: string | null; moteTid: string }): boolean => !!m.bekraftatNar && Date.parse(m.bekraftatNar) < Date.parse(m.moteTid);

/**
 * Det Nav tror när ett förslag skapas: hur det har gått för tidigare möten som
 * stod obekräftade när de började. Talen kommer ur måttregistret.
 */
function troddeUr(moten: StatMote[], grans: number): { trodde: NAv | null; bekraftade: NAv; forFa: boolean; rader: string[] } {
  const o = mattMoten(MATT_OBEKRAFTAT, moten.filter((m) => !bekraftatFore(m)), null, null);
  const b = mattMoten(MATT_OBEKRAFTAT, moten.filter(bekraftatFore), null, null);
  const obekraftade = { n: o.n, av: o.av }, bekraftade = { n: b.n, av: b.av };
  return { trodde: o.av > 0 ? obekraftade : null, bekraftade, forFa: forFaAttSaga(obekraftade, bekraftade, grans), rader: o.bakom };
}

/* ------------------------------------------------------------------------ */
/* Dagjobbet                                                                 */
/* ------------------------------------------------------------------------ */

export type ObekraftadeKvitto = { skulle: number; skapade: number; inaktuella: number; torr: boolean };

type OppetMote = {
  id: string; kedja_id: string; bokat_av: string; halls_av: string; bokat_nar: string; flyttad_nar: string | null; mote_tid: string;
  art: string; bekraftat_nar: string | null; utfall: string | null; utfall_nar: string | null; forsok: number | null;
};
const OPPET_KOL = "id, kedja_id, bokat_av, halls_av, bokat_nar, flyttad_nar, mote_tid, art, bekraftat_nar, utfall, utfall_nar, forsok";

export async function skapaObekraftade(db: Db, inst: MotenInst, finst: ForslagInst, nu: Date): Promise<ObekraftadeKvitto> {
  const kvitto: ObekraftadeKvitto = { skulle: 0, skapade: 0, inaktuella: 0, torr: !finst.pa };
  const tz = inst.tidszon;

  // 1. Öppna förslag vars läge har ändrats: mötet är flyttat, bekräftat, har bytt hållare eller finns inte längre.
  const { data: or } = await db.from("nav_forslag_lage").select(LAGE_KOL).eq("regel", REGEL_OBEKRAFTAT).eq("sort", "forslag").is("beslut_id", null).is("dom", null).limit(500);
  const oppna = (or ?? []) as unknown as LageRad[];
  if (oppna.length) {
    const info = await motesInfo(db, oppna.map((r) => r.nyckel.split("@")[0]));
    for (const r of oppna) {
      const m = info.get(r.nyckel.split("@")[0])?.m ?? null;
      if (oppetLage(r.nyckel, r.utgar ?? "", m, nu, tz) !== "inaktuellt") continue;
      kvitto.inaktuella++;
      if (finst.pa) await db.rpc("nav_forslag_valj", { p_forslag: r.id, p_av: null, p_data: { val: "inaktuellt" } });
    }
  }

  // 2. Möten som har nått sin sista bekräftelsedag obekräftade.
  const { data: mr, error } = await db
    .from("mote")
    .select(OPPET_KOL)
    .is("utfall", null)
    .is("bekraftat_nar", null)
    .gt("mote_tid", nu.toISOString())
    .lte("mote_tid", new Date(nu.getTime() + FRAMAT).toISOString())
    .limit(1000);
  if (error) throw new Error(`obekräftade möten: ${error.message}`);
  const rader = ((mr ?? []) as unknown as OppetMote[]).filter((r) => skaBekraftas(r.art));
  if (!rader.length) return kvitto;
  const hallare = [...new Set(rader.map((r) => r.halls_av))];
  const { data: er, error: efel } = await db.from("employee").select("id").in("id", hallare).neq("status", "offboarded").limit(hallare.length);
  if (efel) throw new Error(`anställda: ${efel.message}`);
  const aktiva = new Set(((er ?? []) as unknown as { id: string }[]).map((e) => e.id));

  const att = obekraftadeAttForesla(rader.map(somForslagMote), aktiva, nu, { tid: finst.obekraftatTid, bekraftaDagar: inst.bekraftaDagar, tz, gallerFran: inst.gallerFran });
  if (!att.length) return kvitto;
  const { data: fr, error: ffel } = await db.from("nav_forslag").select("nyckel").eq("regel", REGEL_OBEKRAFTAT).in("nyckel", att.map((a) => a.nyckel)).limit(att.length);
  if (ffel) throw new Error(`förslagen: ${ffel.message}`);
  const finns = new Set(((fr ?? []) as unknown as { nyckel: string }[]).map((f) => f.nyckel));
  const nya = att.filter((a) => !finns.has(a.nyckel));
  kvitto.skulle = nya.length;
  if (!finst.pa || !nya.length) return kvitto;

  // 3. Det Nav tror skrivs på raden FÖRE valet, och ändras aldrig i efterhand.
  const t = troddeUr(await lasMoten(db, inst.gallerFran ?? "1970-01-01T00:00:00Z"), finst.gransFacit);
  const m = MATT[MATT_OBEKRAFTAT];
  const forsok = new Map(rader.map((r) => [r.id, r.forsok ?? 0]));
  const { data: ny, error: nfel } = await db
    .from("nav_forslag")
    .upsert(
      nya.map((a) => ({
        sort: "forslag",
        regel: REGEL_OBEKRAFTAT,
        nyckel: a.nyckel,
        kalla: "regel",
        om: a.om,
        lag: null,
        belagg: { mote: a.moteId, forsok: forsok.get(a.moteId) ?? 0, obekraftade: t.trodde, bekraftade: t.bekraftade, forFa: t.forFa, rader: t.rader, matt: m.nyckel, version: m.version },
        trodde: t.trodde,
        val: [...VAL_SOM_LAGGS_FRAM],
        foljer: { matt: m.nyckel, motvikt: m.motvikt, version: m.version, moten: [a.moteId] },
        doms_dag: a.domsDag,
        utgar: a.utgar,
        prov: false,
      })),
      { onConflict: "regel,nyckel", ignoreDuplicates: true },
    )
    .select("id");
  if (nfel) throw new Error(`nya förslag: ${nfel.message}`);
  kvitto.skapade = ((ny ?? []) as unknown[]).length;
  return kvitto;
}

/* ------------------------------------------------------------------------ */
/* Domen över en ändring: talen                                              */
/* ------------------------------------------------------------------------ */

const VERB: Record<MotesMatt, string> = { "moten.uteblivna": "uteblev", "moten.hallna-av-alla": "hölls", "moten.bekraftade": "bekräftades" };

export type Avstamning = {
  dom: AndringDom;
  /** Kontrollpunkten domen räknades vid: 0 (ingen än), 20 eller 40 möten efter ändringen. */
  vid: 0 | 20 | 40;
  fore: NAv; efter: NAv; motFore: NAv; motEfter: NAv;
  bokade: { fore: number; efter: number };
  /** Talen i klartext. En andel står aldrig utan sitt antal. */
  tal: string;
  veckor: number;
  matt: MotesMatt;
  version: number;
  /** Läget i kort form: en ny mätning skrivs bara när det här har ändrats. */
  sig: string;
};

const dagarMellan = (fran: string, till: string): number => Math.round((Date.parse(`${till}T12:00:00Z`) - Date.parse(`${fran}T12:00:00Z`)) / DYGN);

/**
 * En ändring stämd av mot mötena. Före är de 40 senaste mötena i måttets
 * underlag före ändringens dag. Efter är de första 20 eller 40 efter den
 * (`kollpunkt`), så att samma möten inte prövas om natt efter natt. Motvikten
 * räknas på samma tid. Resten av laget står bredvid när ändringen inte gäller
 * alla.
 */
export function stamAvAndring(i: {
  matt: MotesMatt; fran: string; krets: readonly string[] | null; moten: StatMote[]; idag: string; tz: string; grans: number; gransMotvikt: number;
}): Avstamning {
  const m = MATT[i.matt];
  const motvikt = (m.motvikt ?? i.matt) as MotesMatt;
  const dagFor = (x: StatMote) => lokalDag(x.moteTid, i.tz);
  const iTid = (l: StatMote[]) => [...l].sort((a, b) => Date.parse(a.moteTid) - Date.parse(b.moteTid) || (a.id < b.id ? -1 : 1));
  const fonster = (lista: StatMote[]) => {
    const fore = lista.filter((x) => dagFor(x) < i.fran);
    const efter = lista.filter((x) => dagFor(x) >= i.fran && dagFor(x) <= i.idag);
    // Måttets egna rader (nämnaren), i tidsordning: de 40 sista före, och efteråt fram till kontrollpunkten.
    const idFore = mattMoten(i.matt, fore, null, null).bakom.slice(-40);
    const idEfterAlla = mattMoten(i.matt, efter, null, null).bakom;
    return { fore, efter, idFore, idEfterAlla };
  };
  const tidFor = (lista: StatMote[], id: string | undefined): number | null => (id ? Date.parse(lista.find((x) => x.id === id)?.moteTid ?? "") : null);

  const egna = iTid(inomKrets(i.moten, [], i.krets).moten);
  const f = fonster(egna);
  const vid = kollpunkt(f.idEfterAlla.length);
  const idEfter = vid === 0 ? f.idEfterAlla : f.idEfterAlla.slice(0, vid);
  const start = tidFor(egna, f.idFore[0]);
  const slut = tidFor(egna, idEfter[idEfter.length - 1]);
  const foreTid = f.fore.filter((x) => start !== null && Date.parse(x.moteTid) >= start);
  const efterTid = f.efter.filter((x) => slut !== null && Date.parse(x.moteTid) <= slut);
  const somNAv = (s: { n: number; av: number }): NAv => ({ n: s.n, av: s.av });
  const fore = somNAv(mattMoten(i.matt, foreTid, null, null));
  const efter = somNAv(mattMoten(i.matt, efterTid, null, null));
  const motFore = somNAv(mattMoten(motvikt, foreTid, null, null));
  const motEfter = somNAv(mattMoten(motvikt, efterTid, null, null));

  let resten: { fore: NAv; efter: NAv } | null = null;
  if (i.krets !== null) {
    const i_krets = new Set(i.krets);
    const andra = iTid(i.moten.filter((x) => !i_krets.has(x.bokatAv) && !i_krets.has(x.hallsAv)));
    const r = fonster(andra);
    const rStart = tidFor(andra, r.idFore[0]);
    resten = {
      fore: somNAv(mattMoten(i.matt, r.fore.filter((x) => rStart !== null && Date.parse(x.moteTid) >= rStart), null, null)),
      efter: somNAv(mattMoten(i.matt, r.efter.filter((x) => slut === null || Date.parse(x.moteTid) <= slut), null, null)),
    };
  }

  const veckor = Math.max(0, Math.floor(dagarMellan(i.fran, i.idag) / 7));
  const dom = domAndring({ fore, efter, motFore, motEfter, resten, veckor, battre: m.battre, motBattre: MATT[motvikt].battre, grans: i.grans, gransMotvikt: i.gransMotvikt });
  const bokade = {
    fore: bokadePerVecka(i.moten, { fran: plusDagar(i.fran, -28), till: plusDagar(i.fran, -1) }, i.krets),
    efter: i.idag >= i.fran ? bokadePerVecka(i.moten, { fran: i.fran, till: i.idag }, i.krets) : 0,
  };
  return {
    dom, vid, fore, efter, motFore, motEfter, bokade, veckor, matt: i.matt, version: m.version,
    tal: textAndel(efter, bokade, VERB[i.matt]),
    sig: [dom.sort, vid, fore.n, fore.av, efter.n, efter.av, dom.restenOcksa ? 1 : 0].join(":"),
  };
}

/* ------------------------------------------------------------------------ */
/* En ändrad inställning i klartext                                          */
/* ------------------------------------------------------------------------ */

const forvalFor = (nyckel: string): unknown => {
  const falt = (Object.keys(INST_NYCKLAR) as (keyof MotenInst)[]).find((f) => INST_NYCKLAR[f] === nyckel);
  return falt ? INST_FORVAL[falt] : null;
};
const lika = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const dagOrd = (n: unknown): string => `${n} ${n === 1 ? "arbetsdag" : "arbetsdagar"}`;

/** Vad som ändrades, för de inställningar Nav känner. Andra får en allmän rad med gammalt och nytt värde. */
export function textInstallning(nyckel: string, fore: unknown, efter: unknown): string {
  switch (nyckel) {
    case INST_NYCKLAR.bekraftaDagar: return `Bekräftelsen öppnar ${dagOrd(efter)} före mötet i stället för ${fore}.`;
    case INST_NYCKLAR.bekraftaTid: return `Bekräftelsen läggs upp kl. ${String(efter).replace(":", ".")} i stället för ${String(fore).replace(":", ".")}.`;
    case INST_NYCKLAR.bekraftaPaminn: return efter === true ? "Nav lägger upp bekräftelsen som uppgift och notis igen." : "Nav lägger inte längre upp bekräftelsen som uppgift och notis.";
    default: return `Inställningen ${nyckel} ändrades från ${JSON.stringify(fore)} till ${JSON.stringify(efter)}.`;
  }
}

/* ------------------------------------------------------------------------ */
/* Nattjobbet                                                                */
/* ------------------------------------------------------------------------ */

export type NattKvitto = {
  ingenValde: number; inaktuella: number; domda: number; utanUtfall: number; omdomda: number;
  installningar: number; andringar: number; facit: number; trend: Trend | null; takt: number; avidentifierade: number;
  torr: boolean; fel?: string[]; hoppade_over?: string;
};

/** Arbetsdagar efter `fran` till och med `till`. */
const arbetsdagarSedan = (fran: string, till: string): number => {
  let n = 0;
  for (let d = plusDagar(fran, 1); d <= till && n < 400; d = plusDagar(d, 1)) if (arArbetsdag(d)) n++;
  return n;
};

const arUtfall = (x: unknown): x is MotesUtfall => x === "hallet" || x === "uteblev" || x === "avbokat" || x === "flyttat" || x === "okant";

export async function korForslagNatt(db: Db, nu: Date = new Date()): Promise<NattKvitto> {
  const kvitto: NattKvitto = { ingenValde: 0, inaktuella: 0, domda: 0, utanUtfall: 0, omdomda: 0, installningar: 0, andringar: 0, facit: 0, trend: null, takt: 0, avidentifierade: 0, torr: true };
  const inst = await lasInst(db);
  const gallerFran = inst.m.gallerFran;
  if (!gallerFran) return { ...kvitto, torr: !inst.f.pa, hoppade_over: "moten.galler-fran saknas" };
  const pa = inst.f.pa;
  kvitto.torr = !pa;
  const tz = inst.m.tidszon;
  const idag = lokalDag(nu, tz);
  const misstag: string[] = [];
  const steg = async (namn: string, kor: () => Promise<void>) => {
    try {
      await kor();
    } catch (e) {
      misstag.push(await fel(`forslag-natt-${namn}`, e));
    }
  };
  const handelse = async (forslag: string, sort: "matning" | "dom", data: Record<string, unknown>) => {
    const { error } = await db.from("nav_forslag_handelse").insert({ forslag, sort, data });
    if (error) throw new Error(`${sort} för ${forslag}: ${error.message}`);
  };
  let allaMoten: StatMote[] | null = null;
  const moten = async (): Promise<StatMote[]> => (allaMoten ??= await lasMoten(db, gallerFran));
  const m0 = MATT[MATT_OBEKRAFTAT];

  // 1 och 2. Stäng det som ingen valde i, och döm det vars domsdag har kommit.
  await steg("dom", async () => {
    const { data } = await db.from("nav_forslag_lage").select(LAGE_KOL).eq("regel", REGEL_OBEKRAFTAT).eq("sort", "forslag").is("dom", null).limit(2000);
    const rader = (data ?? []) as unknown as LageRad[];
    if (!rader.length) return;
    const info = await motesInfo(db, rader.map((r) => r.nyckel.split("@")[0]));
    for (const r of rader) {
      const m = info.get(r.nyckel.split("@")[0])?.m ?? null;
      let beslut: Beslut | undefined = r.beslut_id ? r.beslut?.val : undefined;
      if (!r.beslut_id) {
        const lage = oppetLage(r.nyckel, r.utgar ?? "", m, nu, tz);
        if (lage === "oppet") continue;
        if (lage === "ingen") kvitto.ingenValde++;
        else kvitto.inaktuella++;
        if (pa) await db.rpc("nav_forslag_valj", { p_forslag: r.id, p_av: null, p_data: { val: lage } });
        beslut = lage;
      }
      // Ett inaktuellt förslag döms aldrig: det fanns inget kvar att välja, och det räknas inte i facit.
      if (!beslut || beslut === "inaktuellt" || !r.doms_dag || r.doms_dag > idag) continue;
      let utfall = utfallFor(r.nyckel, m, tz);
      if (utfall === null) {
        if (arbetsdagarSedan(r.doms_dag, idag) < VANTA_ARBETSDAGAR) {
          // "Utfallet är inte satt. Jag dömer när det är det." Sägs en gång, inte varje natt.
          kvitto.utanUtfall++;
          if (pa && r.matning?.vantar !== true) await handelse(r.id, "matning", { vantar: true, utfall: null, dag: idag });
          continue;
        }
        utfall = "okant";
      }
      kvitto.domda++;
      if (pa) await handelse(r.id, "dom", { utfall, bekraftat: !!m && bekraftatFore(m), matt: m0.nyckel, version: m0.version });
    }
  });

  // 3. Utfallet har rättats efter domen: en ny dom, och den gamla står kvar i loggen.
  await steg("omdom", async () => {
    const { data } = await db
      .from("nav_forslag_lage").select(LAGE_KOL).eq("regel", REGEL_OBEKRAFTAT).eq("sort", "forslag").not("dom", "is", null)
      .gte("dom_nar", new Date(nu.getTime() - OMDOM_BAKAT).toISOString()).limit(2000);
    const rader = (data ?? []) as unknown as LageRad[];
    if (!rader.length) return;
    const info = await motesInfo(db, rader.map((r) => r.nyckel.split("@")[0]));
    for (const r of rader) {
      const m = info.get(r.nyckel.split("@")[0])?.m ?? null;
      const utfall = utfallFor(r.nyckel, m, tz);
      const gammalt = r.dom?.utfall;
      if (utfall === null || !arUtfall(gammalt)) continue;
      const bekraftat = !!m && bekraftatFore(m);
      // Ett möte som är borta ger "okänt" i dag. Det rättar inte en dom som en gång fick ett riktigt utfall.
      if (utfall === gammalt && bekraftat === (r.dom?.bekraftat === true)) continue;
      if (utfall === "okant" && gammalt !== "okant") continue;
      kvitto.omdomda++;
      if (pa) await handelse(r.id, "dom", { utfall, bekraftat, matt: m0.nyckel, version: m0.version, rattar: gammalt });
    }
  });

  // 4. En följd inställning som ändrats blir en ändring i loggen.
  await steg("installningar", async () => {
    if (!inst.f.foljda.length) return;
    const { data } = await db
      .from("audit_log").select("id, actor_id, object_id, meta, ts").eq("action", "installning").in("object_id", inst.f.foljda)
      .gte("ts", new Date(nu.getTime() - INSTALLNING_BAKAT).toISOString()).order("id", { ascending: true }).limit(500);
    type Logg = { id: number; actor_id: string | null; object_id: string; meta: { fore?: unknown; efter?: unknown } | null; ts: string };
    const andrade = ((data ?? []) as unknown as Logg[])
      .map((l) => ({ l, fore: l.meta?.fore ?? forvalFor(l.object_id), efter: l.meta?.efter ?? null }))
      // Första gången en inställning sparas står inget gammalt värde: då gällde förvalet. Samma värde är ingen ändring.
      .filter((x) => x.fore !== null && x.efter !== null && !lika(x.fore, x.efter));
    if (!andrade.length) return;
    const nycklar = andrade.map((x) => `installning:${x.l.id}`);
    const { data: fr } = await db.from("nav_forslag").select("nyckel").eq("kalla", "installning").in("nyckel", nycklar).limit(nycklar.length);
    const finns = new Set(((fr ?? []) as unknown as { nyckel: string }[]).map((f) => f.nyckel));
    const nya = andrade.filter((x) => !finns.has(`installning:${x.l.id}`));
    kvitto.installningar = nya.length;
    if (!pa || !nya.length) return;
    const m = MATT[MATT_INSTALLNING];
    const { error } = await db.from("nav_forslag").upsert(
      nya.map((x) => ({
        sort: "andring",
        regel: m.nyckel,
        nyckel: `installning:${x.l.id}`,
        kalla: "installning",
        om: null,
        lag: null,
        skapad_av: x.l.actor_id,
        text: textInstallning(x.l.object_id, x.fore, x.efter),
        foljer: { matt: m.nyckel, motvikt: m.motvikt, version: m.version, fran: lokalDag(x.l.ts, tz), installning: x.l.object_id, fore: x.fore, efter: x.efter },
        prov: false,
      })),
      { onConflict: "regel,nyckel", ignoreDuplicates: true },
    );
    if (error) throw new Error(error.message);
  });

  // 5. Ändringarna stäms av. En rad som fått sitt slut stäms inte av igen.
  await steg("andringar", async () => {
    const { data } = await db.from("nav_forslag_lage").select(LAGE_KOL).eq("sort", "andring").eq("prov", false).limit(500);
    const oppna = ((data ?? []) as unknown as LageRad[]).filter((r) => (r.dom as { dom?: AndringDom } | null)?.dom?.stangd !== true);
    if (!oppna.length) return;
    const lagIds = [...new Set(oppna.map((r) => r.lag).filter((x): x is string => !!x))];
    const { data: er } = lagIds.length ? await db.from("employee").select("id, team_id").in("team_id", lagIds).limit(2000) : { data: [] };
    const iLag = new Map<string, string[]>();
    for (const e of (er ?? []) as unknown as { id: string; team_id: string | null }[]) if (e.team_id) iLag.set(e.team_id, [...(iLag.get(e.team_id) ?? []), e.id]);
    const alla = await moten();
    for (const r of oppna) {
      const matt = MATT[(r.foljer?.matt ?? r.regel) as MattNyckel];
      const fran = typeof r.foljer?.fran === "string" ? r.foljer.fran : lokalDag(r.skapad, tz);
      // Bara mått av sorten andel går att följa i det här steget. Antal påverkas av semester och sjukdom.
      if (!matt || matt.sort !== "andel" || fran > idag) continue;
      const krets = r.om ? [r.om] : r.lag ? iLag.get(r.lag) ?? [] : null;
      const a = stamAvAndring({ matt: matt.nyckel as MotesMatt, fran, krets, moten: alla, idag, tz, grans: inst.f.gransDom, gransMotvikt: inst.f.gransMotvikt });
      const data = { dom: a.dom, vid: a.vid, fore: a.fore, efter: a.efter, motFore: a.motFore, motEfter: a.motEfter, bokade: a.bokade, tal: a.tal, veckor: a.veckor, matt: a.matt, version: a.version, sig: a.sig };
      if (a.dom.stangd) {
        kvitto.andringar++;
        if (pa) await handelse(r.id, "dom", data);
      } else if ((r.matning as { sig?: string } | null)?.sig !== a.sig) {
        kvitto.andringar++;
        if (pa) await handelse(r.id, "matning", data);
      }
    }
  });

  // 6. Navs facit, sparat vid vart tionde avgjort möte. Talen på raden är de som domen räknades på.
  await steg("facit", async () => {
    const { data } = await db.from("nav_forslag_lage").select(LAGE_KOL).eq("regel", REGEL_OBEKRAFTAT).eq("sort", "forslag").eq("prov", false).not("dom", "is", null).limit(5000);
    const rader = facitRader((data ?? []) as unknown as LageRad[]);
    const f = facitPerVal(rader, inst.f.gransFacit);
    if (f.dom.vid < 10) return;
    const { data: sr } = await db.from("nav_facit_dom").select("vid").eq("regel", REGEL_OBEKRAFTAT).eq("krets", "alla").order("vid", { ascending: false }).limit(1);
    const senast = ((sr ?? []) as unknown as { vid: number }[])[0]?.vid ?? 0;
    if (!facitDags(f.dom.vid, senast)) return;
    kvitto.facit = 1;
    if (!pa) return;
    const { hog, lag } = facitVid(rader, f.dom.vid);
    const { error } = await db.from("nav_facit_dom").upsert(
      { regel: REGEL_OBEKRAFTAT, krets: "alla", vid: f.dom.vid, hog_n: hog.n, hog_av: hog.av, lag_n: lag.n, lag_av: lag.av, sort: f.dom.sort, p: f.dom.p, tidigast: f.dom.tidigast, matt_version: m0.version },
      { onConflict: "regel,krets,vid,hog_n,hog_av,lag_n,lag_av", ignoreDuplicates: true },
    );
    if (error) throw new Error(error.message);
  });

  // 7. Trendregeln, natten mot måndag. Den skriver bara i kvittot och säger ingenting till någon.
  await steg("trend", async () => {
    if (veckodag(idag) !== 1) return;
    const avgjorda = (await moten())
      .filter((m): m is StatMote & { utfall: "hallet" | "uteblev" } => skaBekraftas(m.art) && (m.utfall === "hallet" || m.utfall === "uteblev"))
      .map((m) => ({ moteTid: m.moteTid, utfall: m.utfall }));
    kvitto.trend = trendLaget(avgjorda, inst.f.gransPerson);
  });

  // 8. Takten, varje arbetsmorgon: vad den sa, så att dess facit räknas ur det som faktiskt visades.
  await steg("takt", async () => {
    if (!pa || !arArbetsdag(idag)) return;
    const manad = `${idag.slice(0, 7)}-01`;
    const [{ data: or }, { data: er }, { data: tr }] = await Promise.all([
      db.from("sales_order").select("id, salesperson_id, status, period_month, cancel_period_month").or(`period_month.eq.${manad},cancel_period_month.eq.${manad}`).limit(5000),
      db.from("employee").select("id, team_id").limit(5000),
      db.from("team").select("id").limit(500),
    ]);
    const order = (or ?? []) as unknown as Order[];
    const lagFor = new Map(((er ?? []) as unknown as { id: string; team_id: string | null }[]).map((e) => [e.id, e.team_id]));
    const kretsar: [string, Order[]][] = [
      ["alla", order],
      ...((tr ?? []) as unknown as { id: string }[]).map((t): [string, Order[]] => [t.id, order.filter((o) => lagFor.get(o.salesperson_id) === t.id)]),
    ];
    const rader = kretsar.map(([krets, o]) => {
      const netto = nettoAntal(o, manad);
      const t = taktLage({ netto, manad: manad.slice(0, 7), idag });
      return { krets, manad, gatt: t.gatt, netto, prognos: t.prognos };
    });
    const { data: ny, error } = await db.from("nav_takt_dag").upsert(rader, { onConflict: "krets,manad,gatt", ignoreDuplicates: true }).select("krets");
    if (error) throw new Error(error.message);
    kvitto.takt = ((ny ?? []) as unknown[]).length;
  });

  // 9. Avidentifieringen: 24 månader efter domsdagen tas personen och raderna bakom bort. Talen blir kvar.
  await steg("avid", async () => {
    if (!pa) return;
    const [a, m, d] = idag.split("-").map(Number);
    const fore = new Date(Date.UTC(a - 2, m - 1, d, 12)).toISOString().slice(0, 10);
    const { data, error } = await db.rpc("nav_forslag_avidentifiera", { p_fore: fore });
    if (error) throw new Error(error.message);
    kvitto.avidentifierade = typeof data === "number" ? data : 0;
  });

  return misstag.length ? { ...kvitto, fel: misstag } : kvitto;
}
