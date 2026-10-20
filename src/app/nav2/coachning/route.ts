import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { fullName, getCurrentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { svensktDatum } from "@/lib/klocka";
import { notifiera } from "@/lib/notishandelse-server";
import { forberedUppladdning, registreraFil } from "@/lib/filer-server";
import { arChefFor, farCoacha } from "@/lib/coachning-server";
import {
  avbrytUppgift,
  kvittera,
  lamnaIn,
  skapaSamtal,
  skapaUppgift as skapaCoachuppgift,
} from "@/app/(app)/coachning/actions";
import { avbryt as avbrytEgen, skapaUppgift } from "@/app/(app)/uppgifter/actions";
import { skapaSerie } from "@/app/(app)/kalender/moten/actions";
import { lk } from "@/lib/leveranskalender-server";
import { LASLAGE_TEXT, SKRIVLAGE, sammaUrsprung } from "@/lib/nav2/skrivlage";

export const dynamic = "force-dynamic";

/**
 * Nav 2.0: allt som ändrar Coachning, i en rutt.
 *
 * ===========================================================================
 * REPOTS ACTIONS där de finns: en ny överenskommelse (`skapaUppgift` i
 * coachningen), lämna in (`lamnaIn`), kvittera och gör om (`kvittera`),
 * avbryt (`avbrytUppgift`) och 1:1:et (`skapaSamtal`, med åtagandena som
 * uppgifter). "Gå förbi i dag" och chefens egna steg blir uppgifter i
 * Uppgifter (`skapaUppgift` där). Ett 1:1 bokas som kalenderns 1:1, en gång
 * (`skapaSerie` med `upprepa: "aldrig"`).
 *
 * DET NYA (0100): övningen med svar, avgörandet (vana, fem dagar till, byt),
 * vanornas kontroller, punkterna till 1:1 (Tids tabell, 0094), "Be om en
 * 1:1", chefens rader, flyttat datum, filen som bevis (repots uppladdning,
 * ändamålet `coaching`, som repot inte hade någon inlämning för) och 1:1:ets
 * utkast (`nav_preference`).
 *
 * Ångra (beställaren 2026-10-19: "Ångra överallt"): allt går att ångra i tio
 * minuter. Det rutten själv skriver tas bort. Det repots actions skrev tas
 * tillbaka här: kvittering, gör om, inlämning och klar (händelseraden),
 * avbrott (raden öppnas igen), flyttat datum, bokade 1:1 (kalenderns
 * `lk_angra`) och ett sparat 1:1 (samtalet, åtagandena, övningen, fokus,
 * punkterna och nästa bokning). En notis som redan gått ut står kvar.
 *
 * Rollspel live (beställaren 2026-10-19: "lossa kravet"): 0101 låter
 * `rollspel_live` sakna rollspelsmodul. Repots `skapaUppgift` kräver fortfarande
 * en modul för den typen, så överenskommelsen skapas som `uppgift` och får sedan
 * sitt slag. Utan 0101 avvisar databasen bytet, och då märks den med
 * `nav2_kind` som förut.
 * ===========================================================================
 *
 * LÄSLÄGE: står `SKRIVLAGE.coachning` på false svarar rutten 423 innan något skrivs.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DATUM = /^\d{4}-\d{2}-\d{2}$/;
const SVAR = ["ja", "delvis", "inget", "nej"];
const SKAL = ["Glömde bort det", "Kunden la på innan", "Visste inte vad jag skulle säga", "Passade inte i samtalet"];
const OMR: Record<string, string> = {
  intro: "Intro",
  behov: "Behovsanalys",
  roi: "ROI",
  avslut: "Avslut",
  kvalitet: "Kvalitet på samtalet",
  avtal: "Korrekt avtalshantering",
};
const MAX_OVNINGAR = 2;
// Hur länge Ångra gäller för det som går genom repots actions.
const ANGRA_MIN = 10;

type Svar = { ok?: string; fel?: string; [k: string]: unknown };
const svar = (data: Svar, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store, max-age=0" } });

function form(falt: Record<string, unknown>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(falt)) if (v !== undefined && v !== null) f.set(k, String(v));
  return f;
}
const fran = (s: { fel?: string; ok?: string } | undefined, ok: string, extra: Record<string, unknown> = {}) =>
  s?.fel ? svar({ fel: s.fel }, 400) : svar({ ok, ...extra });
const str = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
const dagarMellan = (a: string, b: string) => Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 864e5);
const vardag = (dag: string) => [1, 2, 3, 4, 5].includes(new Date(dag + "T12:00:00Z").getUTCDay());

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user?.employee) return svar({ fel: "Du måste vara inloggad." }, 401);
  if (!sammaUrsprung(request)) return svar({ fel: "Fel ursprung." }, 403);
  const mig = user.employee.id;
  const jagNamn = fullName(user.employee);

  let b: Record<string, unknown>;
  try {
    b = (await request.json()) as Record<string, unknown>;
  } catch {
    return svar({ fel: "Ogiltig begäran." }, 400);
  }
  const handling = String(b.handling ?? "");

  if (!SKRIVLAGE.coachning) return svar({ fel: LASLAGE_TEXT, laslage: true }, 423);
  const db = supabaseAdmin();
  const idag = svensktDatum();
  const coach = farCoacha(user);
  const nyss = new Date(Date.now() - ANGRA_MIN * 60e3).toISOString();
  const forSent = () => svar({ fel: `Det går bara att ångra de första ${ANGRA_MIN} minuterna.` }, 400);

  // Den det gäller, eller dennes chef (repots arChefFor, samma krets som RLS).
  const farRora = async (vem: string) => UUID.test(vem) && (vem === mig || (await arChefFor(user, vem)));
  const chefFor = async (vem: string) => UUID.test(vem) && vem !== mig && (await arChefFor(user, vem));
  const namnPa = async (id: string) => {
    const { data } = await db.from("employee").select("first_name, last_name").eq("id", id).maybeSingle();
    return data ? fullName(data as { first_name: string; last_name: string }) : "";
  };
  // Säljarens besked går till närmaste chef.
  const narmasteChef = async (vem: string) => {
    const { data } = await db.from("employee").select("manager_id").eq("id", vem).maybeSingle();
    return (data?.manager_id as string | null) ?? null;
  };
  const fokusId = async (omr: string) => {
    if (!OMR[omr]) return null;
    const { data } = await db.from("coaching_focus").select("id").eq("label", OMR[omr]).maybeSingle();
    return (data?.id as string | undefined) ?? null;
  };
  const omrAv = async (focusId: string | null) => {
    if (!focusId) return "";
    const { data } = await db.from("coaching_focus").select("label").eq("id", focusId).maybeSingle();
    return Object.keys(OMR).find((k) => OMR[k] === data?.label) ?? "";
  };
  const ovning = async (id: string) => {
    if (!UUID.test(id)) return null;
    const { data } = await db.from("coaching_drill").select("id, employee_id, focus_id, when_text, then_text, days, starts_on, status, habit_since").eq("id", id).maybeSingle();
    return data as { id: string; employee_id: string; focus_id: string | null; when_text: string; then_text: string; days: number; starts_on: string; status: string; habit_since: string | null } | null;
  };
  const aktiva = async (vem: string) => {
    const { count } = await db.from("coaching_drill").select("id", { count: "exact", head: true }).eq("employee_id", vem).eq("status", "aktiv");
    return count ?? 0;
  };
  const uppgift = async (id: string) => {
    if (!UUID.test(id)) return null;
    const { data } = await db.from("coaching_task").select("id, title, kind, assignee_id, partner_id, created_by, verify_by, evidence, due_date, cancelled_at").eq("id", id).maybeSingle();
    return data as { id: string; title: string; kind: string; assignee_id: string; partner_id: string | null; created_by: string; verify_by: string; evidence: string; due_date: string | null; cancelled_at: string | null } | null;
  };
  // En ny övning: kontrollerna som utkastet gör, och samma regel för alla vägar in.
  const nyOvning = async (vem: string, f: { omr: string; nar: string; da: string; n: number; start: string; r?: string | null; session?: string | null }, ersatter?: string | null) => {
    const nar = f.nar.replace(/[.\s]+$/, ""), da = f.da.replace(/[.\s]+$/, "");
    if (!nar) return { fel: "Skriv situationen, till exempel vad kunden säger." };
    if (!da) return { fel: "Skriv vad du gör då." };
    if (![5, 10].includes(f.n)) return { fel: "Välj fem eller tio arbetsdagar." };
    if (!DATUM.test(f.start) || f.start <= idag || dagarMellan(idag, f.start) > 21 || !vardag(f.start)) return { fel: "Övningen börjar en kommande arbetsdag." };
    if (!ersatter && (await aktiva(vem)) >= MAX_OVNINGAR) return { fel: `Det finns redan ${MAX_OVNINGAR} övningar. Gör en till vana eller byt ut en först.` };
    if (ersatter) await db.from("coaching_drill").update({ status: "avslutad", ended_at: new Date().toISOString() }).eq("id", ersatter).eq("employee_id", vem).eq("status", "aktiv");
    const { data, error } = await db
      .from("coaching_drill")
      .insert({ employee_id: vem, focus_id: await fokusId(f.omr), when_text: nar.slice(0, 120), then_text: da.slice(0, 160), routine_slug: f.r ? String(f.r).slice(0, 120) : null, days: f.n, starts_on: f.start, created_by: mig, session_id: f.session ?? null })
      .select("id")
      .single();
    if (error || !data) return { fel: `Övningen sparades inte: ${error?.message ?? "okänt fel"}` };
    return { id: data.id as string, nar, da };
  };

  try {
    switch (handling) {
      // ---------------------------------------------------------------- Svaren
      case "svar": {
        const o = await ovning(str(b.ov, 40));
        if (!o || o.employee_id !== mig) return svar({ fel: "Övningen finns inte." }, 404);
        const dag = str(b.dag, 10), v = str(b.v, 10);
        if (!DATUM.test(dag) || dag > idag || dag < o.starts_on) return svar({ fel: "Den dagen går inte att svara på." }, 400);
        if (!SVAR.includes(v)) return svar({ fel: "Välj ett svar." }, 400);
        const { data: fore } = await db.from("coaching_drill_answer").select("answer, note, reason, call_label").eq("drill_id", o.id).eq("day", dag).maybeSingle();
        const rad: Record<string, unknown> = { drill_id: o.id, day: dag, answer: v, answered_at: new Date().toISOString() };
        if (b.txt !== undefined) rad.note = str(b.txt, 200) || null;
        if (b.sam !== undefined) rad.call_label = str(b.sam, 200) || null;
        if (b.skal !== undefined) rad.reason = SKAL.includes(String(b.skal)) ? String(b.skal) : null;
        if (v !== "delvis" && v !== "nej") rad.reason = null;
        const { error } = await db.from("coaching_drill_answer").upsert(rad, { onConflict: "drill_id,day" });
        if (error) return svar({ fel: error.message }, 400);
        return svar({ ok: "", fore: fore ?? null });
      }
      case "svar-falt": {
        const o = await ovning(str(b.ov, 40));
        if (!o || o.employee_id !== mig) return svar({ fel: "Övningen finns inte." }, 404);
        const dag = str(b.dag, 10), rad: Record<string, unknown> = {};
        if (b.txt !== undefined) rad.note = str(b.txt, 200) || null;
        if (b.sam !== undefined) rad.call_label = str(b.sam, 200) || null;
        if (b.skal !== undefined) rad.reason = SKAL.includes(String(b.skal)) ? String(b.skal) : null;
        await db.from("coaching_drill_answer").update(rad).eq("drill_id", o.id).eq("day", dag);
        return svar({ ok: "" });
      }
      case "svar-ater": {
        // Ångra: svaret som fanns före, eller inget.
        const o = await ovning(str(b.ov, 40));
        if (!o || o.employee_id !== mig) return svar({ fel: "Övningen finns inte." }, 404);
        const dag = str(b.dag, 10), f = b.fore as { answer?: string; note?: string | null; reason?: string | null; call_label?: string | null } | null;
        if (f && f.answer && SVAR.includes(f.answer))
          await db.from("coaching_drill_answer").upsert({ drill_id: o.id, day: dag, answer: f.answer, note: f.note ?? null, reason: f.reason && SKAL.includes(f.reason) ? f.reason : null, call_label: f.call_label ?? null }, { onConflict: "drill_id,day" });
        else await db.from("coaching_drill_answer").delete().eq("drill_id", o.id).eq("day", dag);
        return svar({ ok: "Ångrat." });
      }

      // ------------------------------------------------------------- Övningen
      case "ovning-ny": {
        const vem = str(b.vem, 40);
        if (!(await farRora(vem))) return svar({ fel: "Du kan bara lägga övningar åt dig själv eller ditt lag." }, 403);
        const ersatter = b.ersatter ? str(b.ersatter, 40) : null;
        if (ersatter) {
          const gammal = await ovning(ersatter);
          if (!gammal || gammal.employee_id !== vem) return svar({ fel: "Övningen som skulle bytas finns inte." }, 404);
        }
        const r = await nyOvning(vem, { omr: str(b.omr, 20), nar: str(b.nar, 120), da: str(b.da, 160), n: Number(b.n) || 5, start: str(b.start, 10), r: b.r ? str(b.r, 120) : null }, ersatter);
        if ("fel" in r) return svar({ fel: r.fel }, 400);
        if (vem !== mig)
          await notifiera({ till: vem, av: mig, kalla: "coachning-ovning", typ: "coachning", rubrik: `Ny övning från ${jagNamn}`, detalj: `När ${r.nar} → ${r.da}`, href: "/coachning" });
        else {
          const c = await narmasteChef(vem);
          if (c) await notifiera({ till: c, av: mig, kalla: "coachning-ovning", typ: "coachning", rubrik: `${jagNamn} valde en ny övning`, detalj: `När ${r.nar} → ${r.da}`, href: `/coachning/${vem}` });
        }
        return svar({ ok: vem === mig ? "Övningen är vald. Din chef ser den." : "Övningen är lagd. Den kommer vid instämplingen.", id: r.id });
      }
      case "ovning-bort": {
        // Ångra en ny övning: den tas bort om ingen svarat på den, och den den ersatte öppnas igen.
        const o = await ovning(str(b.ov, 40));
        if (!o || !(await farRora(o.employee_id))) return svar({ fel: "Övningen finns inte." }, 404);
        const { count } = await db.from("coaching_drill_answer").select("day", { count: "exact", head: true }).eq("drill_id", o.id);
        if (count) return svar({ fel: "Övningen har redan svar och tas inte bort." }, 400);
        await db.from("coaching_drill").delete().eq("id", o.id);
        if (b.ater && UUID.test(String(b.ater))) await db.from("coaching_drill").update({ status: "aktiv", ended_at: null }).eq("id", String(b.ater)).eq("employee_id", o.employee_id);
        return svar({ ok: "Ångrat." });
      }
      case "ovning-avgor": {
        const o = await ovning(str(b.ov, 40));
        if (!o || !(await farRora(o.employee_id)) || o.status !== "aktiv") return svar({ fel: "Övningen finns inte." }, 404);
        if (b.val === "vana") {
          await db.from("coaching_drill").update({ status: "vana", habit_since: idag, ended_at: new Date().toISOString() }).eq("id", o.id);
          if (o.employee_id === mig) {
            const c = await narmasteChef(mig);
            if (c) await notifiera({ till: c, av: mig, kalla: "coachning-ovning", typ: "coachning", rubrik: `${jagNamn} gjorde övningen till en vana`, detalj: `När ${o.when_text}`, href: `/coachning/${mig}` });
          }
          return svar({ ok: "Det är en vana nu. Nav frågar om en vecka om den fortfarande sitter.", fore: { status: "aktiv", days: o.days } });
        }
        if (b.val === "forlang") {
          if (o.days + 5 > 60) return svar({ fel: "Övningen kan inte bli längre." }, 400);
          await db.from("coaching_drill").update({ days: o.days + 5 }).eq("id", o.id);
          return svar({ ok: "Fem dagar till. Samma fråga vid utstämplingen.", fore: { status: "aktiv", days: o.days } });
        }
        return svar({ fel: "Välj hur det ska fortsätta." }, 400);
      }
      case "ovning-ater": {
        const o = await ovning(str(b.ov, 40));
        if (!o || !(await farRora(o.employee_id))) return svar({ fel: "Övningen finns inte." }, 404);
        const days = Number(b.days);
        await db.from("coaching_drill").update({ status: "aktiv", habit_since: null, ended_at: null, days: days >= 1 && days <= 60 ? days : o.days }).eq("id", o.id);
        return svar({ ok: "Ångrat." });
      }
      case "koll": {
        const o = await ovning(str(b.ov, 40));
        if (!o || o.employee_id !== mig || o.status !== "vana") return svar({ fel: "Vanan finns inte." }, 404);
        const due = str(b.due, 10), v = str(b.v, 10);
        if (!DATUM.test(due) || due > idag || !["ja", "ibland", "nej"].includes(v)) return svar({ fel: "Svaret stämmer inte." }, 400);
        await db.from("coaching_habit_check").upsert({ drill_id: o.id, due_on: due, answer: v }, { onConflict: "drill_id,due_on" });
        if (v === "nej") {
          if ((await aktiva(mig)) >= MAX_OVNINGAR) return svar({ ok: `Svaret är sparat. Du har redan ${MAX_OVNINGAR} övningar, så ta upp den här på 1:1:et.` });
          const r = await nyOvning(mig, { omr: await omrAv(o.focus_id), nar: o.when_text, da: o.then_text, n: 5, start: str(b.start, 10) });
          if ("fel" in r) return svar({ fel: r.fel }, 400);
          return svar({ ok: "Den blir en övning igen, i fem dagar.", id: r.id });
        }
        return svar({ ok: v === "ja" ? "Bra. Nästa fråga kommer om två veckor." : "Tack. Din chef ser svaret, och ni kan ta upp den på 1:1:et." });
      }
      case "ova-igen": {
        const o = await ovning(str(b.ov, 40));
        if (!o || o.employee_id !== mig || o.status !== "vana") return svar({ fel: "Vanan finns inte." }, 404);
        const r = await nyOvning(mig, { omr: await omrAv(o.focus_id), nar: o.when_text, da: o.then_text, n: 5, start: str(b.start, 10) });
        if ("fel" in r) return svar({ fel: r.fel }, 400);
        return svar({ ok: "Den övas igen i fem dagar.", id: r.id });
      }

      // ------------------------------------------------------- Punkterna, 1:1
      case "punkt": {
        const text = str(b.text, 500);
        if (!text) return svar({ fel: "Skriv punkten först." }, 400);
        const kalla = b.kalla === "coachning" ? "coachning" : "egen";
        const { data: finns } = await db.from("one_on_one_point").select("id").eq("employee_id", mig).eq("text", text).is("handled_at", null).is("removed_at", null).maybeSingle();
        if (finns) return svar({ fel: "Den raden finns redan bland punkterna." }, 400);
        const { data, error } = await db.from("one_on_one_point").insert({ employee_id: mig, text, source: kalla, added_by: mig }).select("id").single();
        if (error || !data) return svar({ fel: error?.message ?? "Punkten sparades inte." }, 400);
        return svar({ ok: kalla === "coachning" ? "Raden ligger bland punkterna till nästa 1:1." : "Punkten är tillagd. Din chef ser den.", id: data.id });
      }
      case "punkt-bort":
      case "punkt-ater": {
        const id = str(b.id, 40);
        if (!UUID.test(id)) return svar({ fel: "Punkten finns inte." }, 404);
        const { data: p } = await db.from("one_on_one_point").select("employee_id, added_by").eq("id", id).maybeSingle();
        if (!p || (p.employee_id !== mig && p.added_by !== mig)) return svar({ fel: "Punkten finns inte." }, 404);
        await db.from("one_on_one_point").update({ removed_at: handling === "punkt-bort" ? new Date().toISOString() : null }).eq("id", id);
        return svar({ ok: handling === "punkt-bort" ? "Punkten är borttagen." : "Ångrat." });
      }
      case "be-om": {
        const { data: finns } = await db.from("coaching_meeting_request").select("id").eq("employee_id", mig).is("handled_at", null).maybeSingle();
        if (finns) return svar({ ok: "Du har redan bett om en tid." });
        const { data } = await db.from("coaching_meeting_request").insert({ employee_id: mig }).select("id").single();
        const c = await narmasteChef(mig);
        if (c) await notifiera({ till: c, av: mig, kalla: "coachning-forfragan", typ: "coachning", rubrik: `${jagNamn} ber om en 1:1`, detalj: "Boka en tid i Coachning", href: `/coachning/${mig}` });
        return svar({ ok: c ? "Din chef har fått en notis och bokar en tid." : "Förfrågan är sparad, men du har ingen chef i Nav som får den.", id: data?.id });
      }
      case "be-om-ater": {
        await db.from("coaching_meeting_request").delete().eq("employee_id", mig).is("handled_at", null);
        return svar({ ok: "Ångrat." });
      }
      case "utkast": {
        const vem = str(b.vem, 40);
        if (!(await chefFor(vem))) return svar({ fel: "Bara chefen håller 1:1:et." }, 403);
        const key = `coachning.utkast.${vem}`;
        if (b.m && typeof b.m === "object") await db.from("nav_preference").upsert({ employee_id: mig, key, value: b.m, updated_at: new Date().toISOString() }, { onConflict: "employee_id,key" });
        else await db.from("nav_preference").delete().eq("employee_id", mig).eq("key", key);
        return svar({ ok: "" });
      }

      // ------------------------------------------------------- Chefens rader
      case "rad": {
        const lista = (Array.isArray(b.vem) ? b.vem : [b.vem]).map((x) => str(x, 40));
        const text = str(b.text, 500);
        if (!text) return svar({ fel: "Skriv raden först." }, 400);
        const ids: string[] = [];
        for (const vem of lista) {
          if (!(await chefFor(vem))) return svar({ fel: "Du kan bara skriva till personer i ditt lag." }, 403);
          const { data } = await db.from("coaching_message").insert({ employee_id: vem, from_id: mig, text }).select("id").single();
          if (data) ids.push(data.id as string);
          await notifiera({ till: vem, av: mig, kalla: "coachning-rad", typ: "coachning", rubrik: `${jagNamn}: ${text}`, detalj: "Coachning", href: "/coachning" });
        }
        return svar({ ok: lista.length > 1 ? "Skickat. Var och en får sin egen fråga." : "Skickat. Raden syns i Coachning och som en notis.", ids });
      }
      case "rad-bort": {
        const ids = (Array.isArray(b.ids) ? b.ids : []).map((x) => str(x, 40)).filter((x) => UUID.test(x));
        const tio = new Date(Date.now() - 10 * 60e3).toISOString();
        await db.from("coaching_message").delete().in("id", ids).eq("from_id", mig).gte("created_at", tio);
        return svar({ ok: "Ångrat. Notisen hann gå ut." });
      }
      case "forbi": {
        const vem = str(b.vem, 40);
        if (!(await chefFor(vem))) return svar({ fel: "Du kan bara gå förbi någon i ditt lag." }, 403);
        const s = await skapaUppgift({}, form({ title: str(b.text, 180) || `Gå förbi ${(await namnPa(vem)).split(" ")[0]}`, due_date: idag, priority: 2, description_md: "Ur Coachning: övningen har inte fått svar på två dagar." }));
        return fran(s, "Lagt i dina uppgifter för i dag.");
      }

      // ------------------------------------------------ Överenskommelserna
      case "ny": {
        const vem = str(b.vem, 40), typ = str(b.typ, 30);
        if (!coach || !(await chefFor(vem))) return svar({ fel: "Du kan bara lägga upp överenskommelser för personer du är chef för." }, 403);
        const live = typ === "rollspel_live";
        let course_id: string | null = null, module_id: string | null = null, document_id: string | null = null;
        const ref = str(b.ref, 120);
        if (typ === "kurs") course_id = ((await db.from("course").select("id").eq("slug", ref).maybeSingle()).data?.id as string | undefined) ?? null;
        if (typ === "rollspel_inspelat") module_id = UUID.test(ref) ? ref : null;
        if (typ === "lasning") document_id = ((await db.from("document").select("id").eq("slug", ref).maybeSingle()).data?.id as string | undefined) ?? null;
        const mot = str(b.mot, 40);
        const titel = str(b.t, 140);
        const s = await skapaCoachuppgift(
          {},
          form({ assignee_id: vem, title: titel, description_md: str(b.besk, 400), kind: live ? "uppgift" : typ, verify_by: str(b.ver, 10) || "sjalv", evidence: str(b.bevis, 10) || "ingen", partner_id: UUID.test(mot) ? mot : null, due_date: str(b.due, 10), course_id, module_id, document_id }),
        );
        if (s.fel) return svar({ fel: s.fel }, 400);
        if (live) {
          // Repots skapaUppgift kräver en modul för rollspel_live; utkastet väljer ingen. 0101 lossar
          // databasens krav, så slaget sätts efteråt. Utan 0101 märks den som förut (0100).
          const { data: ny } = await db.from("coaching_task").select("id").eq("assignee_id", vem).eq("created_by", mig).eq("title", titel).order("created_at", { ascending: false }).limit(1).maybeSingle();
          if (ny) {
            const { error: slag } = await db.from("coaching_task").update({ kind: "rollspel_live" }).eq("id", ny.id);
            if (slag) await db.from("coaching_task").update({ nav2_kind: "rollspel_live" }).eq("id", ny.id);
          }
        }
        return svar({ ok: "Överenskommelsen är lagd. Personen ser den i Coachning." });
      }
      case "lamna-in": {
        const u = await uppgift(str(b.id, 40));
        if (!u || u.assignee_id !== mig) return svar({ fel: "Överenskommelsen finns inte." }, 404);
        const note = str(b.text, 2000);
        if (u.verify_by === "sjalv") return fran(await kvittera({}, form({ task_id: u.id, utfall: "kvitterad", note })), "Klar. Din chef ser det.");
        return fran(await lamnaIn({}, form({ task_id: u.id, note })), "Inlämnad. Den som kvitterar får se den.");
      }
      case "klar": {
        const u = await uppgift(str(b.id, 40));
        if (!u || u.assignee_id !== mig) return svar({ fel: "Överenskommelsen finns inte." }, 404);
        return fran(await kvittera({}, form({ task_id: u.id, utfall: "kvitterad" })), "Klar. Din chef ser det.");
      }
      case "be-motpart": {
        const u = await uppgift(str(b.id, 40));
        if (!u || u.assignee_id !== mig || u.verify_by !== "motpart") return svar({ fel: "Överenskommelsen finns inte." }, 404);
        const s = await lamnaIn({}, form({ task_id: u.id }));
        return fran(s, `${(await namnPa(u.partner_id ?? "")).split(" ")[0] || "Motparten"} får en fråga om att bekräfta.`);
      }
      case "fil-forbered": {
        const u = await uppgift(str(b.id, 40));
        if (!u || u.assignee_id !== mig || u.evidence !== "fil" || u.cancelled_at) return svar({ fel: "Överenskommelsen tar ingen fil." }, 400);
        const p = await forberedUppladdning({ andamal: "coaching", filnamn: str(b.filnamn, 200) || "fil", mimetyp: str(b.mime, 100), storlek: Number(b.storlek) || 0 });
        if ("fel" in p) return svar({ fel: p.fel }, 400);
        return svar({ ok: "", ...p, supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "" });
      }
      case "fil-registrera": {
        const u = await uppgift(str(b.id, 40));
        if (!u || u.assignee_id !== mig || u.evidence !== "fil" || u.cancelled_at) return svar({ fel: "Överenskommelsen tar ingen fil." }, 400);
        const filnamn = str(b.filnamn, 200) || "fil";
        const r = await registreraFil({ fileId: str(b.fil, 40), andamal: "coaching", filnamn, store: str(b.store, 20), uploadedBy: mig, subjectEmployeeId: mig });
        if ("fel" in r) return svar({ fel: r.fel }, 400);
        // Repots lämna in tar ingen fil, så händelsen skrivs här, med samma regler (0043).
        const typ = u.verify_by === "sjalv" ? "kvitterad" : "inlamnad";
        const { error } = await db.from("coaching_task_event").insert({ task_id: u.id, type: typ, by_employee_id: mig, note: `Bifogade ${filnamn}.`, file_id: str(b.fil, 40) });
        if (error) return svar({ fel: error.message }, 400);
        revalidatePath("/coachning");
        return svar({ ok: typ === "kvitterad" ? `${filnamn} är bifogad, och överenskommelsen är klar.` : `${filnamn} är inlämnad. Den som kvitterar får se den.` });
      }
      case "kvittera":
      case "gor-om": {
        const u = await uppgift(str(b.id, 40));
        if (!u) return svar({ fel: "Överenskommelsen finns inte." }, 404);
        const note = str(b.text, 2000);
        const s = await kvittera({}, form({ task_id: u.id, utfall: handling === "kvittera" ? "kvitterad" : "underkand", note }));
        return fran(s, handling === "kvittera" ? "Kvitterad. Personen ser det, och det räknas som coachning i dag." : "Skickad tillbaka med din kommentar.");
      }
      case "flytta": {
        const u = await uppgift(str(b.id, 40));
        if (!u || u.cancelled_at) return svar({ fel: "Överenskommelsen finns inte." }, 404);
        if (u.created_by !== mig && !(await chefFor(u.assignee_id))) return svar({ fel: "Du får inte flytta den här överenskommelsen." }, 403);
        const ny = str(b.due, 10);
        if (!DATUM.test(ny) || ny < idag) return svar({ fel: "Välj i dag eller ett senare datum." }, 400);
        if (ny === u.due_date) return svar({ ok: "" });
        const kort = (d: string | null) => (d ? `${+d.slice(8, 10)}/${+d.slice(5, 7)}` : "inget datum");
        await db.from("coaching_task").update({ due_date: ny }).eq("id", u.id);
        const { data: not } = await db.from("coaching_task_note").insert({ task_id: u.id, by_employee_id: mig, text: `Flyttade datumet från ${kort(u.due_date)} till ${kort(ny)}.` }).select("id").maybeSingle();
        await notifiera({ till: u.assignee_id, av: mig, kalla: "coachning-datum", typ: "coachning", rubrik: "Nytt datum", detalj: `${u.title}: klar senast ${kort(ny)}`, href: `/coachning/uppgift/${u.id}` });
        revalidatePath("/coachning");
        return svar({ ok: "Nytt datum. Personen får en notis, och påminnelserna räknas från det.", fore: u.due_date, not: (not?.id as string | undefined) ?? null, due: ny });
      }
      case "flytta-ater": {
        const u = await uppgift(str(b.id, 40));
        if (!u || u.cancelled_at) return svar({ fel: "Överenskommelsen finns inte." }, 404);
        if (u.created_by !== mig && !(await chefFor(u.assignee_id))) return svar({ fel: "Du får inte flytta den här överenskommelsen." }, 403);
        const fore = str(b.fore, 10), not = str(b.not, 40);
        if (u.due_date !== str(b.due, 10)) return svar({ fel: "Datumet har ändrats igen sedan dess." }, 409);
        if (UUID.test(not)) {
          const { data: n } = await db.from("coaching_task_note").select("created_at").eq("id", not).eq("task_id", u.id).eq("by_employee_id", mig).maybeSingle();
          if (!n || String(n.created_at) < nyss) return forSent();
          await db.from("coaching_task_note").delete().eq("id", not);
        }
        await db.from("coaching_task").update({ due_date: DATUM.test(fore) ? fore : null }).eq("id", u.id);
        revalidatePath("/coachning");
        return svar({ ok: "Ångrat. Datumet är som förut; notisen hann gå ut." });
      }
      case "avbryt": {
        const u = await uppgift(str(b.id, 40));
        if (!u) return svar({ fel: "Överenskommelsen finns inte." }, 404);
        // Skälet skrivs i raden under knappen (beställaren 2026-10-19), och repot kräver det.
        const skal = str(b.skal, 500);
        if (!skal) return svar({ fel: "Skriv varför överenskommelsen avbryts." }, 400);
        return fran(await avbrytUppgift({}, form({ task_id: u.id, reason: skal })), "Överenskommelsen är avbruten. Personen får en notis med skälet.");
      }
      case "avbryt-ater": {
        const id = str(b.id, 40);
        if (!UUID.test(id)) return svar({ fel: "Överenskommelsen finns inte." }, 404);
        const { data: t } = await db.from("coaching_task").select("cancelled_at, cancelled_by").eq("id", id).maybeSingle();
        if (!t || !t.cancelled_at || t.cancelled_by !== mig) return svar({ fel: "Överenskommelsen är inte avbruten av dig." }, 404);
        if (String(t.cancelled_at) < nyss) return forSent();
        await db.from("coaching_task").update({ cancelled_at: null, cancelled_by: null, cancel_reason: null }).eq("id", id);
        await db.from("coaching_task_event").delete().eq("task_id", id).eq("type", "avbruten").eq("by_employee_id", mig).gte("at", nyss);
        revalidatePath("/coachning");
        return svar({ ok: "Ångrat. Överenskommelsen gäller igen; notisen hann gå ut." });
      }
      case "handelse-ater": {
        // Kvittera, gör om, lämna in, klar och be motparten: repots actions skriver en händelserad.
        const u = await uppgift(str(b.id, 40));
        if (!u) return svar({ fel: "Överenskommelsen finns inte." }, 404);
        const { data: h } = await db
          .from("coaching_task_event")
          .select("id, at")
          .eq("task_id", u.id)
          .eq("by_employee_id", mig)
          .in("type", ["kvitterad", "underkand", "inlamnad"])
          .order("at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!h) return svar({ fel: "Det finns inget att ångra." }, 404);
        if (String(h.at) < nyss) return forSent();
        await db.from("coaching_task_event").delete().eq("id", h.id);
        revalidatePath("/coachning");
        return svar({ ok: "Ångrat. Notisen hann gå ut." });
      }

      // ---------------------------------------------------------------- 1:1
      case "boka": {
        const lista = (Array.isArray(b.lista) ? b.lista : [b]) as { vem?: unknown; dag?: unknown; start?: unknown }[];
        const bokade: string[] = [], angra: string[] = [], req: string[] = [];
        for (const x of lista) {
          const vem = str(x.vem, 40), dag = str(x.dag, 10), start = Number(x.start);
          if (!(await chefFor(vem))) return svar({ fel: "Du kan bara boka 1:1 med personer i ditt lag." }, 403);
          if (!DATUM.test(dag) || dag <= idag) return svar({ fel: "Välj en dag efter i dag." }, 400);
          const r = await skapaSerie({ typ: "enskilt", rubrik: "1:1", med: [vem], dag, start, minuter: 30, upprepa: "aldrig", agenda: "Börja med veckans övning och det säljaren vill ta upp." });
          if (r.fel) return svar({ fel: r.fel, angra, req }, 400);
          if (r.angra) angra.push(r.angra);
          const { data: fr } = await db.from("coaching_meeting_request").update({ handled_at: new Date().toISOString(), handled_by: mig }).eq("employee_id", vem).is("handled_at", null).select("id");
          for (const f of (fr ?? []) as { id: string }[]) req.push(f.id);
          bokade.push(vem);
        }
        return svar({ ok: bokade.length > 1 ? `Bokat ${bokade.length} 1:1. Var och en får en inbjudan.` : "1:1:et är bokat, och inbjudan ligger i kalendern.", angra, req });
      }
      case "boka-ater": {
        const angra = (Array.isArray(b.angra) ? b.angra : []).map((x) => str(x, 40)).filter((x) => UUID.test(x));
        const req = (Array.isArray(b.req) ? b.req : []).map((x) => str(x, 40)).filter((x) => UUID.test(x));
        for (const u of angra) {
          const r = await lk<{ event_id: string | null }>("lk_angra", { p_aktor: mig, p_undo: u });
          if (!r.ok) return svar({ fel: r.fel }, 400);
        }
        if (req.length) await db.from("coaching_meeting_request").update({ handled_at: null, handled_by: null }).in("id", req).eq("handled_by", mig).gte("handled_at", nyss);
        return svar({ ok: angra.length > 1 ? "Ångrat. Mötena är borttagna, och de inbjudna får veta det." : "Ångrat. 1:1:et är borttaget, och den inbjudna får veta det." });
      }
      case "spara-1-1": {
        const vem = str(b.vem, 40);
        if (!coach || !(await chefFor(vem))) return svar({ fel: "Du kan bara hålla 1:1 med personer du är chef för." }, 403);
        const dag = str(b.d, 10);
        if (!DATUM.test(dag) || dag > idag) return svar({ fel: "Ett 1:1 sparas när det har hållits." }, 400);
        const steg = (Array.isArray(b.steg) ? b.steg : []) as { t?: unknown; vem?: unknown; d?: unknown }[];
        const rena = steg.map((x) => ({ t: str(x.t, 180), chef: x.vem === "chef", d: str(x.d, 10) })).filter((x) => x.t);
        for (const x of rena) if (!DATUM.test(x.d) || x.d < idag) return svar({ fel: "Varje steg behöver ett datum från i dag." }, 400);
        const vagText: Record<string, string> = { fortsatt: "Övningen fortsätter.", vana: "Övningen blir en vana.", forlang: "Fem dagar till.", ny: "En ny övning.", ingen: "Ingen övning nu." };
        const vag = str(b.vag, 10);
        const atagande = rena.filter((x) => !x.chef).map((x) => `${x.t.replace(/\|/g, "/")} | ${Math.max(0, dagarMellan(dag, x.d))}`).join("\n");
        const tagna = (Array.isArray(b.tagit) ? b.tagit : []).map((x) => str(x, 500)).filter(Boolean);
        const s = await skapaSamtal(
          {},
          form({
            employee_id: vem,
            held_on: dag,
            goal_md: str(b.mal, 160),
            reality_md: [str(b.lage, 2000), tagna.length ? `Tog upp: ${tagna.join("; ")}` : ""].filter(Boolean).join("\n"),
            options_md: vagText[vag] ?? "",
            will_md: rena.map((x) => `${x.t} (${x.chef ? "chefen" : "säljaren"}, ${x.d})`).join("\n"),
            atagande,
          }),
        );
        if (s.fel) return svar({ fel: s.fel }, 400);
        const { data: sess } = await db.from("coaching_session").select("id").eq("employee_id", vem).eq("coach_id", mig).eq("held_on", dag).order("created_at", { ascending: false }).limit(1).maybeSingle();
        const sessId = (sess?.id as string | undefined) ?? null;
        const omr = str(b.omr, 20), fid = await fokusId(omr);
        // Det som behövs för att ta tillbaka 1:1:et (Ångra).
        const { data: fokusFore } = await db.from("coaching_person_focus").select("focus_id, set_by, set_at").eq("employee_id", vem).maybeSingle();
        if (sessId) await db.from("coaching_session").update({ previous_goal_met: ["ja", "delvis", "nej"].includes(String(b.forra)) ? String(b.forra) : null, focus_id: fid }).eq("id", sessId);
        if (fid) await db.from("coaching_person_focus").upsert({ employee_id: vem, focus_id: fid, set_by: mig, set_at: new Date().toISOString() }, { onConflict: "employee_id" });
        // Nästa övning.
        const { data: akt } = await db.from("coaching_drill").select("id, days").eq("employee_id", vem).eq("status", "aktiv").order("starts_on").limit(1).maybeSingle();
        let nyOv: string | null = null;
        if (akt && vag === "vana") await db.from("coaching_drill").update({ status: "vana", habit_since: idag, ended_at: new Date().toISOString() }).eq("id", akt.id);
        if (akt && vag === "forlang") await db.from("coaching_drill").update({ days: Math.min(60, (akt.days as number) + 5) }).eq("id", akt.id);
        if (vag === "ny") {
          const r = await nyOvning(vem, { omr, nar: str(b.nar, 120), da: str(b.da, 160), n: Number(b.n) || 5, start: str(b.start, 10), session: sessId }, (akt?.id as string | undefined) ?? null);
          if ("fel" in r) return svar({ fel: `1:1:et är sparat, men övningen inte: ${r.fel}` }, 400);
          nyOv = r.id;
        }
        // Chefens egna steg blir uppgifter i Uppgifter.
        const egna: string[] = [];
        for (const x of rena.filter((y) => y.chef)) {
          const u = await skapaUppgift({}, form({ title: x.t, due_date: x.d, priority: 3, description_md: "Ur 1:1:et i Coachning." }));
          if (u.id) egna.push(u.id);
        }
        // Punkterna som togs upp, och förfrågan om en tid.
        const pids = (Array.isArray(b.punkter) ? b.punkter : []).map((x) => str(x, 40)).filter((x) => UUID.test(x));
        if (pids.length) await db.from("one_on_one_point").update({ handled_at: new Date().toISOString(), session_id: sessId }).in("id", pids).eq("employee_id", vem);
        const { data: fr } = await db.from("coaching_meeting_request").update({ handled_at: new Date().toISOString(), handled_by: mig }).eq("employee_id", vem).is("handled_at", null).select("id");
        // Det bokade 1:1:et i kalendern får sitt samtal.
        const ev = str(b.eventId, 40);
        if (sessId && UUID.test(ev)) await db.rpc("lk_koppla_samtal", { p_aktor: mig, p_event: ev, p_session: sessId });
        // Nästa 1:1.
        let bokat = "", bokatAngra: string | null = null;
        const nb = b.boka as { dag?: unknown; start?: unknown } | null;
        if (nb && nb.dag) {
          const r = await skapaSerie({ typ: "enskilt", rubrik: "1:1", med: [vem], dag: str(nb.dag, 10), start: Number(nb.start), minuter: 30, upprepa: "aldrig", agenda: "Börja med veckans övning och det säljaren vill ta upp." });
          bokat = r.fel ? ` Nästa 1:1 bokades inte: ${r.fel}` : " Nästa 1:1 är bokat.";
          bokatAngra = r.angra ?? null;
        }
        await db.from("nav_preference").delete().eq("employee_id", mig).eq("key", `coachning.utkast.${vem}`);
        const angra = sessId
          ? {
              sess: sessId,
              akt: akt && (vag === "vana" || vag === "forlang" || vag === "ny") ? { id: akt.id as string, days: akt.days as number } : null,
              nyOv,
              fokus: fokusFore ?? null,
              egna,
              pids,
              req: ((fr ?? []) as { id: string }[]).map((x) => x.id),
              bokat: bokatAngra,
            }
          : null;
        return svar({ ok: `1:1:et är sparat, och personen ser sammanfattningen.${bokat}`, angra });
      }
      case "spara-1-1-ater": {
        // Tar tillbaka ett sparat 1:1 i omvänd ordning. Notiserna som gick ut står kvar.
        const vem = str(b.vem, 40);
        if (!coach || !(await chefFor(vem))) return svar({ fel: "Du kan bara ta tillbaka dina egna 1:1." }, 403);
        const a = (b.a ?? {}) as { sess?: unknown; akt?: { id?: unknown; days?: unknown } | null; nyOv?: unknown; fokus?: { focus_id?: unknown; set_by?: unknown; set_at?: unknown } | null; egna?: unknown; pids?: unknown; req?: unknown; bokat?: unknown };
        const sess = str(a.sess, 40);
        if (!UUID.test(sess)) return svar({ fel: "1:1:et finns inte." }, 404);
        const { data: sa } = await db.from("coaching_session").select("coach_id, employee_id, created_at").eq("id", sess).maybeSingle();
        if (!sa || sa.coach_id !== mig || sa.employee_id !== vem) return svar({ fel: "1:1:et finns inte." }, 404);
        if (String(sa.created_at) < nyss) return forSent();
        const idLista = (v: unknown) => (Array.isArray(v) ? v : []).map((x) => str(x, 40)).filter((x) => UUID.test(x));
        // Nästa 1:1 i kalendern, och kopplingen till det hållna.
        const bokatId = str(a.bokat, 40);
        if (UUID.test(bokatId)) await lk<{ event_id: string | null }>("lk_angra", { p_aktor: mig, p_undo: bokatId });
        await db.from("calendar_event").update({ coaching_session_id: null }).eq("coaching_session_id", sess);
        // Övningen: den nya bort (om ingen svarat), den förra som den var.
        const nyOv = str(a.nyOv, 40);
        if (UUID.test(nyOv)) {
          const { count } = await db.from("coaching_drill_answer").select("day", { count: "exact", head: true }).eq("drill_id", nyOv);
          if (!count) await db.from("coaching_drill").delete().eq("id", nyOv).eq("employee_id", vem);
        }
        const aktId = str(a.akt?.id, 40), aktDagar = Number(a.akt?.days);
        if (UUID.test(aktId))
          await db.from("coaching_drill").update({ status: "aktiv", habit_since: null, ended_at: null, days: aktDagar >= 1 && aktDagar <= 60 ? aktDagar : 5 }).eq("id", aktId).eq("employee_id", vem);
        // Fokusområdet som det var.
        const ff = a.fokus;
        if (ff && UUID.test(str(ff.focus_id, 40))) await db.from("coaching_person_focus").upsert({ employee_id: vem, focus_id: str(ff.focus_id, 40), set_by: UUID.test(str(ff.set_by, 40)) ? str(ff.set_by, 40) : mig, set_at: str(ff.set_at, 40) || new Date().toISOString() }, { onConflict: "employee_id" });
        else await db.from("coaching_person_focus").delete().eq("employee_id", vem).eq("set_by", mig).gte("set_at", nyss);
        // Chefens egna steg i Uppgifter avbryts (repots avbryt, som loggar varför).
        for (const id of idLista(a.egna)) await avbrytEgen({}, form({ id, note: "Ångrat: 1:1:et i Coachning togs tillbaka." }));
        // Punkterna och förfrågan står öppna igen.
        const pids = idLista(a.pids), req = idLista(a.req);
        if (pids.length) await db.from("one_on_one_point").update({ handled_at: null, session_id: null }).in("id", pids).eq("employee_id", vem);
        if (req.length) await db.from("coaching_meeting_request").update({ handled_at: null, handled_by: null }).in("id", req).eq("handled_by", mig);
        // Åtagandena (med sina händelser) och samtalet.
        await db.from("coaching_task").delete().eq("session_id", sess).eq("created_by", mig);
        const { error } = await db.from("coaching_session").delete().eq("id", sess);
        if (error) return svar({ fel: `1:1:et togs inte bort: ${error.message}` }, 400);
        // Det som skrevs står kvar som utkast.
        if (b.m && typeof b.m === "object") await db.from("nav_preference").upsert({ employee_id: mig, key: `coachning.utkast.${vem}`, value: b.m, updated_at: new Date().toISOString() }, { onConflict: "employee_id,key" });
        revalidatePath("/coachning");
        return svar({ ok: "Ångrat. 1:1:et är borttaget och ligger kvar som utkast; notisen hann gå ut." });
      }

      default:
        return svar({ fel: "Okänd handling." }, 400);
    }
  } catch (e) {
    return svar({ fel: e instanceof Error ? e.message : "Något gick fel." }, 500);
  }
}
