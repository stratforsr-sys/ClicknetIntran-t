import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CurrentUser } from "@/lib/auth";
import { svensktDatum } from "@/lib/klocka";
import { rodaDagar } from "@/lib/saljtakt";
import { hamtaKalposter, type NdPost } from "./kalender";
import { byggFranvaro, type NdFranvaroPost } from "./franvaro";
import { byggUppgifter, type NdUppgift } from "./uppgifter";
import { byggArenden, type NdArende } from "./arenden";
import { pushaTill } from "./push";
import { vilkaFar } from "@/lib/utskick-server";
import { SKRIVLAGE } from "./skrivlage";

/**
 * Nav 2.0: kvällsnotisen och söndagsnotisen (E5.8, 0121).
 *
 * Kvällen före en arbetsdag: kalendern (möten, 1:1, leveranser), teamets
 * frånvaro den dagen (aldrig någon diagnos), beslut med frist (ledighet som
 * börjar, ärenden som passerar svarstiden, aldrig ärendets rubrik) och
 * uppgifter med dagens datum. Söndagen: samma sak för måndag till fredag.
 *
 * Texten räknas med personens EGEN inloggning, med samma byggfunktioner som
 * sidan (Kalendern, Frånvaro, Uppgifter, Ärenden). Notisen ser därför aldrig
 * mer än personen ser i navet.
 *
 * Utskicket (`skickaKvallsnotiser`) körs av dagtidsjobbet: vardagar från 17:00
 * och söndagar från 18:00, svensk tid, en gång per person och dag (`push_sent`),
 * till ledarrollerna (säljchef, VD, teamledare) som slagit på notisen på en enhet.
 * Beställaren 2026-10-18: tiderna står, och INGEN NOTIS TILL DEN SOM ÄR LEDIG
 * DAGEN EFTER (på söndagen: måndagen). Ledig = godkänd frånvaro hela dagen eller
 * en sjukanmälan som pågår. Borta del av dagen räknas inte som ledig.
 */

export type NdKvall = { slag: "kvall" | "sondag"; dagar: string[]; titel: string; text: string };

const LEDARE = ["sales_manager", "ceo", "team_lead"];
const DAGNAMN = ["", "Måndag", "Tisdag", "Onsdag", "Torsdag", "Fredag", "Lördag", "Söndag"];
const MOTEN = new Set(["mote", "enskilt", "leverans", "coachning"]);
const TYP: Record<string, string> = { sick: "sjuk", vab: "VAB", vacation: "semester", saved_vacation: "semester" };

const plus = (d: string, n: number) => {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
const veckodag = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay() || 7;
const arbetsdag = (d: string) => veckodag(d) < 6 && !rodaDagar(+d.slice(0, 4)).has(d);
const kort = (d: string) => `${DAGNAMN[veckodag(d)].slice(0, 3).toLowerCase()} ${+d.slice(8)}/${+d.slice(5, 7)}`;
const fornamn = (n: string) => n.split(" ")[0];

/** Dagarna notisen gäller: nästa arbetsdag, eller på helgen veckan som kommer. */
export function kvallsdagar(idag: string): { slag: "kvall" | "sondag"; dagar: string[] } {
  if (veckodag(idag) >= 6) {
    let m = plus(idag, 1);
    while (veckodag(m) !== 1) m = plus(m, 1);
    return { slag: "sondag", dagar: [0, 1, 2, 3, 4].map((i) => plus(m, i)).filter(arbetsdag) };
  }
  let d = plus(idag, 1);
  for (let i = 0; i < 10 && !arbetsdag(d); i++) d = plus(d, 1);
  return { slag: "kvall", dagar: [d] };
}

/** Texten, ren så att den går att prova utan databas. */
export function formaKvall(x: {
  slag: "kvall" | "sondag";
  dagar: string[];
  mig: string;
  poster: NdPost[];
  franvaro: NdFranvaroPost[];
  ko: { employeeId: string; namn: string; typ: string; starts_on: string }[];
  arenden: NdArende[] | null;
  uppgifter: NdUppgift[];
}): NdKvall {
  const { slag, dagar, mig } = x;
  const forsta = dagar[0], sista = dagar[dagar.length - 1];
  const kal = x.poster.filter((p) => p.agare === mig && dagar.includes(p.dag) && MOTEN.has(p.slag) && p.svar !== "nej").sort((a, b) => a.dag.localeCompare(b.dag) || (a.start ?? 0) - (b.start ?? 0));
  const borta = new Map<string, string>();
  for (const p of x.franvaro) {
    if (p.pid === mig || p.st === "rejected" || p.st === "cancelled") continue;
    const tackar = dagar.some((d) => p.fran <= d && (p.till === null ? p.typ === "sick" : p.till >= d));
    if (tackar && !borta.has(p.vem)) borta.set(p.vem, TYP[p.typ] ?? "ledig");
  }
  const beslut = x.ko.filter((a) => a.employeeId !== mig && a.starts_on <= sista);
  const slut = Date.parse(`${sista}T23:59:59+01:00`);
  const arenden = (x.arenden ?? []).filter((a) => ["new", "in_progress"].includes(a.status) && !a.lost && Date.parse(a.due) <= slut).length;
  const uppg = x.uppgifter.filter((u) => u.vy === "egen" && u.due && u.due >= forsta && u.due <= sista && !["klar", "avbruten"].includes(u.lage));
  const fristAntal = beslut.length + arenden;

  const delar: string[] = [];
  beslut.slice(0, 2).forEach((a) => delar.push(`${fornamn(a.namn)}s ${a.typ.toLowerCase()} ska beslutas${a.starts_on < forsta ? ', den har börjat' : ''}.`));
  if (arenden) delar.push(`${arenden} ${arenden === 1 ? "ärende passerar" : "ärenden passerar"} svarstiden.`);
  const bortaL = [...borta].slice(0, 3).map(([n, t]) => `${fornamn(n)} ${t}`);
  if (bortaL.length) delar.push(`Borta: ${bortaL.join(", ")}${borta.size > 3 ? ` och ${borta.size - 3} till` : ""}.`);
  if (kal.length) delar.push(`Först: ${kal[0].rubrik ?? "Upptagen"}${kal[0].start !== null ? ` ${String(Math.floor(kal[0].start / 60)).padStart(2, "0")}:${String(kal[0].start % 60).padStart(2, "0")}` : ""}${slag === "sondag" ? ` (${kort(kal[0].dag)})` : ""}.`);
  if (uppg.length) delar.push(`${uppg.length} ${uppg.length === 1 ? "uppgift" : "uppgifter"} med frist.`);

  const titel = slag === "sondag"
    ? `Veckan som kommer: ${kal.length} i kalendern, ${borta.size} borta, ${fristAntal + uppg.length} ${fristAntal + uppg.length === 1 ? "sak" : "saker"} att få klart`
    : `${DAGNAMN[veckodag(forsta)]}: ${kal.length} i kalendern, ${borta.size} borta, ${fristAntal} ${fristAntal === 1 ? "beslut" : "beslut"} med frist`;
  return { slag, dagar, titel, text: delar.join(" ").slice(0, 240) || "Inget som väntar på dig." };
}

/** Notisen för den inloggade, med hens egen behörighet. */
export async function byggKvall(supabase: SupabaseClient, user: CurrentUser, nu: Date = new Date()): Promise<NdKvall | null> {
  if (!user.employee) return null;
  const { slag, dagar } = kvallsdagar(svensktDatum(nu));
  const [kal, fr, up, ar] = await Promise.all([
    hamtaKalposter(user, "vecka", dagar[0], []),
    byggFranvaro(supabase, user),
    byggUppgifter(supabase, user),
    byggArenden(supabase, user),
  ]);
  return formaKvall({
    slag,
    dagar,
    mig: user.employee.id,
    poster: kal?.poster ?? [],
    franvaro: fr.chef ? fr.chef.poster : [],
    ko: fr.chef ? fr.chef.ko.map((a) => ({ employeeId: a.employeeId, namn: a.namn, typ: a.typ, starts_on: a.starts_on })) : [],
    arenden: ar.hanterare ? ar.arenden : null,
    uppgifter: up.uppgifter,
  });
}

/** Klockan i Stockholm: veckodag 1–7 och minuter sedan midnatt. */
function klockan(nu: Date): { dag: string; vd: number; min: number } {
  const p = Object.fromEntries(new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(nu).map((x) => [x.type, x.value]));
  const dag = svensktDatum(nu);
  return { dag, vd: veckodag(dag), min: +p.hour * 60 + +p.minute };
}

/** Dagtidsjobbets steg. Bakom `SKRIVLAGE.hem`. */
export async function skickaKvallsnotiser(db: SupabaseClient, nu: Date = new Date()): Promise<{ slag: string | null; mottagare: number; lediga: number; skickade: number; fel: string[] }> {
  if (!SKRIVLAGE.hem) return { slag: null, mottagare: 0, lediga: 0, skickade: 0, fel: [] };
  const k = klockan(nu);
  const slag = k.vd <= 5 && k.min >= 17 * 60 && k.min < 21 * 60 ? "kvall" : k.vd === 7 && k.min >= 18 * 60 && k.min < 21 * 60 ? "sondag" : null;
  if (!slag) return { slag: null, mottagare: 0, lediga: 0, skickade: 0, fel: [] };

  const [{ data: roller }, { data: enheter }, { data: skickat }] = await Promise.all([
    db.from("employee_role").select("employee_id, role").in("role", LEDARE),
    db.from("push_subscription").select("employee_id"),
    db.from("push_sent").select("employee_id").eq("kind", slag).eq("day", k.dag),
  ]);
  const harEnhet = new Set(((enheter ?? []) as { employee_id: string }[]).map((x) => x.employee_id));
  const klara = new Set(((skickat ?? []) as { employee_id: string }[]).map((x) => x.employee_id));
  const kandidater = [...new Set(((roller ?? []) as { employee_id: string }[]).map((x) => x.employee_id))].filter((id) => harEnhet.has(id) && !klara.has(id));
  const dagen = kvallsdagar(k.dag).dagar[0];
  const lediga = await ledigaDen(db, kandidater, dagen);
  // Utskicken (0255): kvällsnotisen kan stängas av superadmin eller av ledaren själv.
  const mottagare = await vilkaFar(kandidater.filter((id) => !lediga.has(id)), "push", "kvallsnotis", true, db);

  let skickade = 0;
  const fel: string[] = [];
  for (const id of mottagare) {
    // Raden först: hellre en missad notis än två samma kväll om jobbet körs två gånger samtidigt.
    const { error } = await db.from("push_sent").insert({ employee_id: id, kind: slag, day: k.dag });
    if (error) continue;
    const u = await pushaTill(db, id);
    await db.from("push_sent").update({ devices: u.ok }).eq("employee_id", id).eq("kind", slag).eq("day", k.dag);
    if (u.ok) skickade++;
    fel.push(...u.fel);
  }
  return { slag, mottagare: mottagare.length, lediga: lediga.size, skickade, fel };
}

/** Vilka av personerna som är lediga en dag: godkänd frånvaro hela dagen, eller sjukanmälda. */
export async function ledigaDen(db: SupabaseClient, ids: string[], dag: string): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const [{ data: fr }, { data: sjuk }] = await Promise.all([
    db.from("absence_request").select("employee_id").in("employee_id", ids).eq("status", "approved").is("part_day_minutes", null).lte("starts_on", dag).gte("ends_on", dag),
    db.from("sick_report").select("employee_id, last_sick_day").in("employee_id", ids).is("cancelled_at", null).lte("first_sick_day", dag),
  ]);
  const ut = new Set(((fr ?? []) as { employee_id: string }[]).map((x) => x.employee_id));
  for (const s of (sjuk ?? []) as { employee_id: string; last_sick_day: string | null }[]) if (s.last_sick_day === null || s.last_sick_day >= dag) ut.add(s.employee_id);
  return ut;
}
