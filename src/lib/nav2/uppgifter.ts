import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { SKRIVLAGE } from "./skrivlage";
import { fullName, type CurrentUser } from "@/lib/auth";
import { svensktDatum } from "@/lib/klocka";
import { arStangd, farBjudaIn, farLamna, farPassa, farStyra, mittAttGora, type Krets, type Lage } from "@/lib/uppgifter";
import {
  KOPPLING_ETIKETT,
  attGranska,
  delatMedMig,
  hamtaUppgiftsbild,
  inkorgen,
  minaOppna,
  stilla,
  vantarPaAndra,
} from "@/lib/uppgifter-server";
import { serietext, type Serieregel } from "@/lib/upprepning";
import { momentTillText, type Mallmoment } from "@/lib/mallar";
import { genomgangslage, senasttext, type Genomgangslage } from "@/lib/genomgang";
import { senasteGenomgang, senasteKvitton } from "@/lib/genomgang-server";

/**
 * Nav 2.0: Uppgifter, med samma funktioner som /uppgifter: hamtaUppgiftsbild
 * (RLS, läget ur händelserna, kopplingarna, deluppgifterna, projekten) och
 * sidans egna urval — minaOppna, vantarPaAndra, attGranska, inkorgen och
 * delatMedMig. En rad hamnar i exakt en lista, i den ordningen.
 *
 * Händelserna (historik och chatt) läses en gång till med samma token:
 * uppgiftsbilden räknar läget ur dem men lämnar inte ut dem.
 */

export type NdUppgift = {
  id: string;
  t: string;
  /** egen, vantar, granska, inkorg eller delat — sidans flikar. */
  vy: "egen" | "vantar" | "granska" | "inkorg" | "delat";
  due: string | null;
  tid: string | null;
  est: number | null;
  prio: number;
  lage: Lage;
  /** När den senast blev klar, om den är det. */
  klarAt: string | null;
  links: [string, string, string | null][];
  proj: string | null;
  /** Rubrik, bockad, id och (0298) förnamnet på den som bockade, om någon. */
  delar: [string, boolean, string, string | null][];
  granskare: string | null;
  ansvarig: string | null;
  serie: string | null;
  /** Gamla Nav D: serien och om den inloggade äger den (assignee eller skapare, som avslutaSerie kräver). */
  serieId: string | null;
  serieAgare: boolean;
  /** Gamla Nav D: kopplingarnas id (i samma ordning som links) och om den inloggade får redigera (farRedigera). */
  linkIds: string[];
  farRed: boolean;
  /** Om den inloggade får stryka (farBjudaIn): den som la upp uppgiften eller har den. Uppgifter ändras direkt bara då. */
  farStryk: boolean;
  besk: string;
  skapadAv: string;
  skapadAt: string;
  stilla: number;
  minRoll: string | null;
  handelser: { typ: string; av: string; avId: string; note: string | null; at: string }[];
  /**
   * 0298, kollegan i uppgiften. `med` är alla tillagda med sin roll, `bollenId`
   * den som har bollen (`assignee_id`), `delad` om fler än en arbetar i den.
   * `kan` är regeltabellen i src/lib/uppgifter.ts uträknad för den inloggade:
   * klienten ritar knapparna efter den och räknar ingenting själv.
   */
  med: { id: string; namn: string; roll: string }[];
  bollenId: string | null;
  skapareId: string;
  delad: boolean;
  kan: { laggaTill: boolean; styra: boolean; lamna: boolean; passa: boolean };
  /** Förnamnet på den som bockade av uppgiften, när det var någon annan än den inloggade. */
  klarAv: string | null;
};

export type NdUppgifter = {
  uppgifter: NdUppgift[];
  projekt: {
    id: string; namn: string; farg: string; klara: number; antal: number; due: string | null; forsenade: number; skapad: string | null;
    /** Gamla Nav D: beskrivningen, ägaren, den inloggades roll, deltagarna och chatten (RLS: projekt_synligt). */
    besk: string; agareId: string; agare: string; min: "agare" | "redigerare" | "visare" | null;
    medlemmar: { id: string; namn: string; roll: string }[];
    chatt: { av: string; text: string; at: string }[];
    olasta: number;
  }[];
  /** Gamla Nav D: arkiverade projekt som den inloggade äger, för Plocka fram. */
  arkiverade: { id: string; namn: string }[];
  /** Det den inloggade bockat av de senaste 14 dagarna. */
  klara: { at: string; t: string }[];
  kollegor: string[];
  /** Mallarna (delade och egna). `text` är momenten i mallarnas radformat, för att ändra en egen. */
  mallar: { id: string; namn: string; moment: string[]; egen: boolean; delad: boolean; besk: string; text: string }[];
  /** Gamla Nav D: egna arkiverade mallar, för Plocka fram. */
  mallarArkiv: { id: string; namn: string }[];
  /** Veckogenomgången som på /uppgifter/genomgang: läget, raden "Senast gjord" och kvittona. */
  genomgang: { lage: Genomgangslage; senast: string; kvitton: { week_start: string; completed_at: string; remaining: number }[] };
  /** 0092: dagens tre, i ordning (uppgifternas id). */
  fokus: string[];
  /** 0092: dagens början och slut, och hur många vardagar i rad dagen planerats. */
  dag: { planerad: string | null; avslutad: string | null; iRad: number };
  /** 0092: första steget per uppgift. */
  forstaSteg: Record<string, string>;
  /** Kollegorna med id, för att lämna över och bjuda in. */
  personer: { id: string; namn: string }[];
  /** Sparar vyn (SKRIVLAGE.uppgifter)? Annars svarar /nav2/uppgifter med läsläge. */
  skriv: boolean;
};

/** Vardagar i rad med en planerad dag, räknat bakåt från i dag (eller i går om i dag inte planerats än). */
export function vardagarIRad(planerade: Set<string>, idag: string): number {
  const dag = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
  const vardag = (d: string) => { const w = new Date(`${d}T12:00:00Z`).getUTCDay(); return w >= 1 && w <= 5; };
  let d = planerade.has(idag) ? idag : dag(idag, -1);
  let n = 0;
  for (let i = 0; i < 400; i++) {
    if (vardag(d)) {
      if (!planerade.has(d)) break;
      n++;
    }
    d = dag(d, -1);
  }
  return n;
}

export async function byggUppgifter(supabase: SupabaseClient, user: CurrentUser): Promise<NdUppgifter> {
  const mig = user.employee!.id;
  const idag = svensktDatum();
  const [bild, senaste, kvitton] = await Promise.all([hamtaUppgiftsbild(user), senasteGenomgang(user), senasteKvitton(user, 4)]);
  const lage = genomgangslage(idag, senaste);
  const namn = (id: string | null) => (id ? bild.namn.get(id) ?? "Okänd" : null);

  const [{ data: handelser }, { data: serier }, { data: personer }, { data: mallar }, { data: moment }, { data: projRader }, { data: medRader }, { data: medd }, { data: last }] = await Promise.all([
    supabase.from("task_event").select("task_id, type, by_employee_id, note, at").order("at"),
    supabase.from("task_series").select("id, monster, veckodagar, starts_on, ends_on, assignee_id, created_by, ended_at"),
    supabase.from("employee").select("id, first_name, last_name, status").neq("status", "offboarded"),
    supabase.from("task_template").select("id, name, created_by, shared, description_md, archived_at").order("name"),
    supabase.from("task_template_item").select("template_id, sort, title, offset_days, due_time, estimate_minutes, priority").order("sort"),
    // Projektets start, för hur stor del av tiden till deadline som gått. Bilden läser den inte.
    supabase.from("project").select("id, name, description_md, owner_id, created_by, archived_at, created_at"),
    // Gamla Nav D: deltagarna, chatten och vad den inloggade läst (RLS: projekt_synligt och den egna raden).
    supabase.from("project_member").select("project_id, employee_id, role"),
    supabase.from("project_message").select("project_id, author_id, body, created_at").order("created_at").limit(2000),
    supabase.from("project_message_read").select("project_id, seen_at").eq("employee_id", mig),
  ]);
  const namnFor = new Map((personer ?? []).map((p) => [p.id, fullName(p)]));
  const vem = (id: string) => bild.namn.get(id) ?? namnFor.get(id) ?? "Okänd";

  const perUppgift = new Map<string, NdUppgift["handelser"]>();
  for (const h of handelser ?? []) {
    const rad = { typ: h.type as string, av: vem(h.by_employee_id), avId: h.by_employee_id as string, note: h.note ?? null, at: h.at as string };
    perUppgift.set(h.task_id, [...(perUppgift.get(h.task_id) ?? []), rad]);
  }
  const serieRad = new Map((serier ?? []).map((s) => [s.id as string, s as { assignee_id: string | null; created_by: string | null; ended_at: string | null }]));
  // En avslutad serie upprepas inte längre: förekomsten som står kvar säger det, och Avsluta serien visas inte
  // (provet i produktionen 2026-11-14: rutan sa "Varje måndag och torsdag" efter att serien avslutats).
  const serie = new Map((serier ?? []).map((s) => {
    const text = serietext({ monster: s.monster, veckodagar: s.veckodagar ?? [], starts_on: s.starts_on, ends_on: s.ends_on } as Serieregel);
    return [s.id, s.ended_at ? `Avslutad, var ${text.charAt(0).toLowerCase()}${text.slice(1)}` : text];
  }));
  const projektNamn = new Map(bild.projekt.map((p) => [p.id, p.name]));

  // En rad, en lista: samma urval som sidan, i sidans ordning.
  const vy = new Map<string, NdUppgift["vy"]>();
  const satt = (lista: { id: string }[], v: NdUppgift["vy"]) => lista.forEach((u) => { if (!vy.has(u.id)) vy.set(u.id, v); });
  satt(minaOppna(bild, mig), "egen");
  satt(attGranska(bild, mig), "granska");
  satt(vantarPaAndra(bild, mig), "vantar");
  satt(inkorgen(bild, mig), "inkorg");
  satt(delatMedMig(bild, mig), "delat");
  // Det egna som blivit klart de senaste 14 dagarna, för "Klart i dag" och veckan.
  const grans = new Date(Date.now() - 14 * 864e5).toISOString();
  for (const u of bild.uppgifter) {
    // 0298 (H10): `mittAttGora` och inte `assignee_id`. Det kollegan bockade i en
    // uppgift vi hade ihop är klart för mig också, och ska stå bland mina klara.
    if (vy.has(u.id) || !mittAttGora(u, mig) || !arStangd(u.lage)) continue;
    const h = perUppgift.get(u.id) ?? [];
    const sista = [...h].reverse().find((x) => x.typ === "klar" || x.typ === "avbruten");
    if (sista && sista.at >= grans) vy.set(u.id, "egen");
  }

  const uppgifter: NdUppgift[] = bild.uppgifter
    .filter((u) => vy.has(u.id))
    .map((u) => {
      const h = perUppgift.get(u.id) ?? [];
      const klar = [...h].reverse().find((x) => x.typ === "klar");
      const granskare = u.medlemmar.filter((m) => m.role === "granskare").map((m) => m.namn);
      return {
        id: u.id,
        t: u.title,
        vy: vy.get(u.id)!,
        due: u.due_date,
        tid: u.due_time,
        est: u.estimate_minutes,
        prio: u.priority,
        lage: u.lage,
        klarAt: u.lage === "klar" && klar ? klar.at : null,
        links: u.kopplingar.map((k): [string, string, string | null] => [KOPPLING_ETIKETT[k.slag], k.etikett, k.href]),
        proj: u.project_id ? projektNamn.get(u.project_id) ?? null : null,
        delar: u.delar.map((d): [string, boolean, string, string | null] => {
          const bock = d.lage === "klar" ? [...(perUppgift.get(d.id) ?? [])].reverse().find((x) => x.typ === "klar" || x.typ === "godkand") : undefined;
          return [d.title, d.lage === "klar", d.id, bock ? bock.av.split(" ")[0] : null];
        }),
        granskare: granskare.length ? granskare.join(", ") : null,
        ansvarig: namn(u.assignee_id),
        serie: u.series_id ? serie.get(u.series_id) ?? null : null,
        serieId: u.series_id ?? null,
        serieAgare: (() => { const s = u.series_id ? serieRad.get(u.series_id) : undefined; return !!s && !s.ended_at && (s.assignee_id === mig || s.created_by === mig); })(),
        linkIds: u.kopplingar.map((k) => k.id),
        farRed: u.created_by === mig || u.assignee_id === mig || u.minRoll === "redigerare",
        farStryk: u.created_by === mig || u.assignee_id === mig,
        besk: u.description_md ?? "",
        skapadAv: vem(u.created_by),
        skapadAt: u.created_at,
        stilla: stilla(u, idag),
        minRoll: u.minRoll,
        handelser: h,
        med: u.medlemmar.map((m) => ({ id: m.employee_id, namn: m.namn, roll: m.role })),
        bollenId: u.assignee_id,
        skapareId: u.created_by,
        delad: new Set([u.created_by, u.assignee_id, ...u.medlemmar.filter((m) => m.role === "redigerare").map((m) => m.employee_id)].filter(Boolean)).size > 1,
        kan: (() => {
          const k: Krets = { mig, assignee_id: u.assignee_id, created_by: u.created_by, minRoll: u.minRoll };
          return { laggaTill: farBjudaIn(k), styra: farStyra(k), lamna: farLamna(k), passa: farPassa(k) };
        })(),
        klarAv: u.lage === "klar" && klar && klar.avId !== mig ? klar.av.split(" ")[0] : null,
      };
    });

  const klara = uppgifter
    // 0298: på id och inte på namn. Två kollegor med samma namn hade fått varandras klara.
    .flatMap((u) => (perUppgift.get(u.id) ?? []).filter((x) => x.typ === "klar" && x.avId === mig && x.at >= grans).map((x) => ({ at: x.at, t: u.t })))
    .sort((a, b) => b.at.localeCompare(a.at));

  // Mallarna den inloggade får använda: delade och egna, som /uppgifter/mallar.
  const synliga = (mallar ?? []).filter((m) => !m.archived_at && (m.shared || m.created_by === mig));
  const momentFor = (id: string) => ((moment ?? []) as unknown as (Mallmoment & { template_id: string })[]).filter((x) => x.template_id === id);
  // Gamla Nav D: projektens egenskaper, deltagare och chatt.
  const projRad = new Map(((projRader ?? []) as { id: string; name: string; description_md: string | null; owner_id: string; created_by: string; archived_at: string | null; created_at: string }[]).map((p) => [p.id, p]));
  const medPer = new Map<string, { id: string; namn: string; roll: string }[]>();
  for (const m of (medRader ?? []) as { project_id: string; employee_id: string; role: string }[]) medPer.set(m.project_id, [...(medPer.get(m.project_id) ?? []), { id: m.employee_id, namn: vem(m.employee_id), roll: m.role }]);
  const chattPer = new Map<string, { av: string; text: string; at: string }[]>();
  for (const m of (medd ?? []) as { project_id: string; author_id: string; body: string; created_at: string }[]) chattPer.set(m.project_id, [...(chattPer.get(m.project_id) ?? []), { av: vem(m.author_id), text: m.body, at: m.created_at }]);
  const lastPer = new Map(((last ?? []) as { project_id: string; seen_at: string }[]).map((l) => [l.project_id, l.seen_at]));


  // 0092: dagens tre, dagarna och första steget.
  const ids = uppgifter.map((u) => u.id);
  const [{ data: fokusRader }, { data: dagRader }, { data: stegRader }] = await Promise.all([
    supabase.from("task_focus").select("task_id, position").eq("employee_id", mig).eq("dag", idag).order("position"),
    supabase.from("task_day").select("dag, planned_at, closed_at").eq("employee_id", mig).gte("dag", new Date(Date.now() - 400 * 864e5).toISOString().slice(0, 10)),
    ids.length ? supabase.from("task").select("id, next_step").in("id", ids).not("next_step", "is", null) : Promise.resolve({ data: [] as { id: string; next_step: string }[] }),
  ]);
  const dagar = (dagRader ?? []) as { dag: string; planned_at: string | null; closed_at: string | null }[];
  const iDag = dagar.find((d) => d.dag === idag);

  return {
    fokus: ((fokusRader ?? []) as { task_id: string }[]).map((f) => f.task_id).filter((id) => ids.includes(id)),
    dag: { planerad: iDag?.planned_at ?? null, avslutad: iDag?.closed_at ?? null, iRad: vardagarIRad(new Set(dagar.filter((d) => d.planned_at).map((d) => d.dag)), idag) },
    forstaSteg: Object.fromEntries(((stegRader ?? []) as { id: string; next_step: string }[]).map((r) => [r.id, r.next_step])),
    personer: (personer ?? []).filter((p) => p.id !== mig).map((p) => ({ id: p.id as string, namn: fullName(p) })).sort((a, b) => a.namn.localeCompare(b.namn, "sv")),
    skriv: SKRIVLAGE.uppgifter,
    uppgifter,
    projekt: bild.projekt
      .filter((p) => !p.archived_at)
      .map((p) => { const r = projRad.get(p.id), med = medPer.get(p.id) ?? [], ch = chattPer.get(p.id) ?? [], sett = lastPer.get(p.id) ?? "";
        const agare = r?.owner_id === mig || r?.created_by === mig;
        const roll = med.find((m) => m.id === mig)?.roll;
        return { id: p.id, namn: p.name, farg: p.color, klara: p.klara, antal: p.antal, due: p.due_date, forsenade: p.forsenade, skapad: r?.created_at ?? null,
          besk: r?.description_md ?? "", agareId: r?.owner_id ?? "", agare: r ? vem(r.owner_id) : "", min: agare ? ("agare" as const) : roll === "redigerare" ? ("redigerare" as const) : roll === "visare" ? ("visare" as const) : null,
          medlemmar: med, chatt: ch.slice(-200), olasta: ch.filter((m) => m.at > sett && m.av !== vem(mig)).length }; }),
    arkiverade: [...projRad.values()].filter((p) => p.archived_at && (p.owner_id === mig || p.created_by === mig)).map((p) => ({ id: p.id, namn: p.name })),
    klara,
    kollegor: (personer ?? []).filter((p) => p.id !== mig).map((p) => fullName(p)).sort((a, b) => a.localeCompare(b, "sv")),
    mallar: synliga.map((m) => ({ id: m.id as string, namn: m.name, moment: momentFor(m.id).map((x) => x.title), egen: m.created_by === mig, delad: !!m.shared, besk: (m.description_md as string | null) ?? "", text: momentTillText(momentFor(m.id)) })),
    mallarArkiv: (mallar ?? []).filter((m) => m.archived_at && m.created_by === mig).map((m) => ({ id: m.id as string, namn: m.name as string })),
    genomgang: { lage, senast: senasttext(lage), kvitton },
  };
}
