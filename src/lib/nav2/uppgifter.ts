import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { SKRIVLAGE } from "./skrivlage";
import { fullName, type CurrentUser } from "@/lib/auth";
import { svensktDatum } from "@/lib/klocka";
import { arStangd, type Lage } from "@/lib/uppgifter";
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
  delar: [string, boolean, string][];
  granskare: string | null;
  ansvarig: string | null;
  serie: string | null;
  besk: string;
  skapadAv: string;
  skapadAt: string;
  stilla: number;
  minRoll: string | null;
  handelser: { typ: string; av: string; note: string | null; at: string }[];
};

export type NdUppgifter = {
  uppgifter: NdUppgift[];
  projekt: { id: string; namn: string; farg: string; klara: number; antal: number; due: string | null; forsenade: number; skapad: string | null }[];
  /** Det den inloggade bockat av de senaste 14 dagarna. */
  klara: { at: string; t: string }[];
  kollegor: string[];
  mallar: { namn: string; moment: string[] }[];
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

  const [{ data: handelser }, { data: serier }, { data: personer }, { data: mallar }, { data: moment }, { data: projektdag }] = await Promise.all([
    supabase.from("task_event").select("task_id, type, by_employee_id, note, at").order("at"),
    supabase.from("task_series").select("id, monster, veckodagar, starts_on, ends_on"),
    supabase.from("employee").select("id, first_name, last_name, status").neq("status", "offboarded"),
    supabase.from("task_template").select("id, name, created_by, shared").is("archived_at", null).order("name"),
    supabase.from("task_template_item").select("template_id, sort, title").order("sort"),
    // Projektets start, för hur stor del av tiden till deadline som gått. Bilden läser den inte.
    supabase.from("project").select("id, created_at"),
  ]);
  const namnFor = new Map((personer ?? []).map((p) => [p.id, fullName(p)]));
  const vem = (id: string) => bild.namn.get(id) ?? namnFor.get(id) ?? "Okänd";

  const perUppgift = new Map<string, NdUppgift["handelser"]>();
  for (const h of handelser ?? []) {
    const rad = { typ: h.type as string, av: vem(h.by_employee_id), note: h.note ?? null, at: h.at as string };
    perUppgift.set(h.task_id, [...(perUppgift.get(h.task_id) ?? []), rad]);
  }
  const serie = new Map((serier ?? []).map((s) => [s.id, serietext({ monster: s.monster, veckodagar: s.veckodagar ?? [], starts_on: s.starts_on, ends_on: s.ends_on } as Serieregel)]));
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
    if (vy.has(u.id) || u.assignee_id !== mig || !arStangd(u.lage)) continue;
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
        delar: u.delar.map((d): [string, boolean, string] => [d.title, d.lage === "klar", d.id]),
        granskare: granskare.length ? granskare.join(", ") : null,
        ansvarig: namn(u.assignee_id),
        serie: u.series_id ? serie.get(u.series_id) ?? null : null,
        besk: u.description_md ?? "",
        skapadAv: vem(u.created_by),
        skapadAt: u.created_at,
        stilla: stilla(u, idag),
        minRoll: u.minRoll,
        handelser: h,
      };
    });

  const klara = uppgifter
    .flatMap((u) => (perUppgift.get(u.id) ?? []).filter((x) => x.typ === "klar" && x.av === vem(mig) && x.at >= grans).map((x) => ({ at: x.at, t: u.t })))
    .sort((a, b) => b.at.localeCompare(a.at));

  // Mallarna den inloggade får använda: delade och egna, som /uppgifter/mallar.
  const synliga = (mallar ?? []).filter((m) => m.shared || m.created_by === mig);

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
      .map((p) => ({ id: p.id, namn: p.name, farg: p.color, klara: p.klara, antal: p.antal, due: p.due_date, forsenade: p.forsenade, skapad: (projektdag ?? []).find((x) => x.id === p.id)?.created_at ?? null })),
    klara,
    kollegor: (personer ?? []).filter((p) => p.id !== mig).map((p) => fullName(p)).sort((a, b) => a.localeCompare(b, "sv")),
    mallar: synliga.map((m) => ({ namn: m.name, moment: (moment ?? []).filter((x) => x.template_id === m.id).map((x) => x.title) })),
    genomgang: { lage, senast: senasttext(lage), kvitton },
  };
}
