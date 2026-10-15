import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { gallande, lageNu, type Handelse } from "@/lib/tid";
import { gallandeSchema } from "@/lib/raster";
import { stampelfriaAnstallda } from "@/lib/stampelfri-server";
import { medRoll, notifiera, notifieraFlera } from "@/lib/notishandelse-server";
import { svensktDatum, svenskaMinuter, svenskVeckodag, svenskDygnsstart, svenskDygnsslut, dagarBakat } from "@/lib/klocka";
import { CHEF_KVAR_KL, PAMINN_STANDARD, VECKOKOLL_KL, type Paminn } from "@/lib/nav2/tidregler";

/**
 * Nav 2.0 (0094): påminnelserna i Tid som repot inte har.
 *
 *   - "Om jag fortfarande är instämplad" N minuter efter schemats slut
 *     (`tid-paminnelse-ut`), för den som slagit på det under Påminn mig.
 *   - Fredagens veckokoll 16:30 (`tid-veckokoll`) till den som stämplar och
 *     inte kollat veckan.
 *   - Chefens morgonnotis på vald tid (`tid-chef-morgon`) och samlingen 16:00
 *     av det som ligger kvar (`tid-chef-kvar`).
 *
 * Instämplingens påminnelse är repots (`korDagtidsjobbet`), som får var och
 * ens val via `egnaPaminnelser`. Varje notis går en gång per dag: spärren är
 * `notification_event`, som i repots jobb.
 *
 * Körs av dagtidsjobbet var kvart, och bara när `SKRIVLAGE.tid` är på.
 */

const BORTRE = 180;
const min = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
};

export async function egnaPaminnelser(db: SupabaseClient): Promise<Map<string, Paminn>> {
  const { data } = await db.from("nav_preference").select("employee_id, value").eq("key", "tid.paminn");
  const ut = new Map<string, Paminn>();
  for (const r of data ?? []) {
    const v = (r.value ?? {}) as Partial<Paminn>;
    ut.set(r.employee_id as string, { in: { ...PAMINN_STANDARD.in, ...(v.in ?? {}) }, ut: { ...PAMINN_STANDARD.ut, ...(v.ut ?? {}) } });
  }
  return ut;
}

async function redan(db: SupabaseClient, kalla: string, nu: Date): Promise<Set<string>> {
  const { data } = await db.from("notification_event").select("employee_id").eq("kalla", kalla).gte("created_at", svenskDygnsstart(nu));
  return new Set((data ?? []).map((r) => r.employee_id as string));
}

export async function korTidpaminnelser(db: SupabaseClient, val: Map<string, Paminn>, nu = new Date()) {
  const utfall = { ut: 0, veckokoll: 0, morgon: 0, kvar: 0 };
  const idag = svensktDatum(nu);
  const veckodag = svenskVeckodag(nu);
  if (veckodag >= 6) return utfall;
  const nuMin = svenskaMinuter(nu);

  const [{ data: personal }, { data: scheman }, { data: stamplar }, stampelfria] = await Promise.all([
    db.from("employee").select("id, team_id, status").neq("status", "offboarded"),
    db.from("work_schedule").select("id, scope, employee_id, team_id, weekday, start_time, end_time, valid_from").eq("weekday", veckodag),
    db.from("time_event").select("id, employee_id, kind, occurred_at, source, supersedes_id, correction_state").gte("occurred_at", svenskDygnsstart(nu)).lte("occurred_at", svenskDygnsslut(idag)),
    stampelfriaAnstallda(db),
  ]);
  const perPerson = new Map<string, Handelse[]>();
  for (const h of (stamplar ?? []) as unknown as (Handelse & { employee_id: string })[]) perPerson.set(h.employee_id, [...(perPerson.get(h.employee_id) ?? []), h]);
  const pers = ((personal ?? []) as { id: string; team_id: string | null }[]).filter((p) => !stampelfria.has(p.id));

  // Fortfarande instämplad efter schemats slut.
  const sagtUt = await redan(db, "tid-paminnelse-ut", nu);
  for (const p of pers) {
    const v = val.get(p.id);
    if (!v?.ut.pa || sagtUt.has(p.id)) continue;
    const s = gallandeSchema(scheman ?? [], p.id, p.team_id, idag)[0];
    if (!s) continue;
    const slut = min(String(s.end_time));
    const gatt = nuMin - slut;
    if (gatt < v.ut.min || gatt > BORTRE) continue;
    if (lageNu(perPerson.get(p.id) ?? []) === "ute") continue;
    if (await notifiera({ till: p.id, av: null, kalla: "tid-paminnelse-ut", typ: "tid", rubrik: "Du är fortfarande instämplad", detalj: `Schemat slutade ${String(s.end_time).slice(0, 5)}.`, href: "/tid" })) utfall.ut++;
  }

  // Fredag: stämmer veckan?
  if (veckodag === 5 && nuMin >= min(VECKOKOLL_KL)) {
    const mandag = dagarBakat(idag, 4);
    const [{ data: kollade }, sagt] = await Promise.all([db.from("time_week_check").select("employee_id").eq("week_start", mandag), redan(db, "tid-veckokoll", nu)]);
    const klara = new Set((kollade ?? []).map((k) => k.employee_id as string));
    for (const p of pers) {
      if (klara.has(p.id) || sagt.has(p.id)) continue;
      if (!gallandeSchema(scheman ?? [], p.id, p.team_id, idag).length) continue;
      if (await notifiera({ till: p.id, av: null, kalla: "tid-veckokoll", typ: "tid", rubrik: "Stämmer veckan?", detalj: "Trettio sekunder: tryck på en dag för att se raderna.", href: "/tid" })) utfall.veckokoll++;
    }
  }

  // Chefen: morgonnotisen på vald tid, och det som ligger kvar 16:00.
  const chefer = await medRoll("sales_manager", "admin");
  if (!chefer.length) return utfall;
  const [{ count: rattelser }, { count: forslag }] = await Promise.all([
    db.from("time_event").select("id", { count: "exact", head: true }).eq("correction_state", "pending"),
    db.from("attendance_incident").select("id", { count: "exact", head: true }).eq("status", "foreslagen"),
  ]);
  const ejInne = pers.filter((p) => {
    const s = gallandeSchema(scheman ?? [], p.id, p.team_id, idag)[0];
    return s && nuMin > min(String(s.start_time)) + 15 && gallande(perPerson.get(p.id) ?? []).length === 0;
  }).length;
  const delar = [
    rattelser ? `${rattelser} ${rattelser === 1 ? "rättelse väntar" : "rättelser väntar"}` : "",
    forslag ? `${forslag} förslag på ogiltig frånvaro` : "",
  ].filter(Boolean);

  const { data: morgonval } = await db.from("nav_preference").select("employee_id, value").eq("key", "tid.morgonnotis").in("employee_id", chefer);
  const morgonKl = new Map((morgonval ?? []).map((r) => [r.employee_id as string, String(r.value)]));
  const sagtMorgon = await redan(db, "tid-chef-morgon", nu);
  const morgonDelar = [...delar, ejInne ? `${ejInne} har inte stämplat in` : ""].filter(Boolean);
  for (const c of chefer) {
    if (sagtMorgon.has(c) || !morgonDelar.length) continue;
    const kl = morgonKl.get(c) ?? "08:15";
    if (nuMin < min(kl) || nuMin > min(kl) + 120) continue;
    if (await notifiera({ till: c, av: null, kalla: "tid-chef-morgon", typ: "tid", rubrik: "Tid i dag: två minuter", detalj: morgonDelar.join(", "), href: "/tid" })) utfall.morgon++;
  }

  if (delar.length && nuMin >= min(CHEF_KVAR_KL) && nuMin <= min(CHEF_KVAR_KL) + 120) {
    const sagtKvar = await redan(db, "tid-chef-kvar", nu);
    utfall.kvar = await notifieraFlera(chefer.filter((c) => !sagtKvar.has(c)), { av: null, kalla: "tid-chef-kvar", typ: "tid", rubrik: "Det här ligger kvar i Tid", detalj: delar.join(", "), href: "/tid" });
  }
  return utfall;
}
