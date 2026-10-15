import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { canManageEmployees, fullName, getCurrentUser, hasRole } from "@/lib/auth";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { dagarBakat, svensktDatum, svenskTidpunkt, svenskVeckodag } from "@/lib/klocka";
import { gallandeSchema } from "@/lib/raster";
import { hamtaLage } from "@/lib/sparrar";
import { medRoll, notifiera, notifieraFlera } from "@/lib/notishandelse-server";
import { begarRattelse, beslutaRattelse, sparaArbetsschema, stampla } from "@/app/(app)/tid/actions";
import { avvisaHandelse, godkannHandelse, havHandelse } from "@/app/(app)/tid/ogiltig-franvaro/actions";
import { attestera, generera, skapaPeriod } from "@/app/(app)/tid/lonerapport/actions";
import { MORGONNOTIS_VAL, PAMINN_MINUTER, SCHEMA_KVITTENS_FRAN } from "@/lib/nav2/tidregler";
import { LASLAGE_TEXT, SKRIVLAGE, sammaUrsprung } from "@/lib/nav2/skrivlage";

export const dynamic = "force-dynamic";

/**
 * Nav 2.0: allt som ändrar Tid, i en rutt.
 *
 * ===========================================================================
 * REPOTS ACTIONS. Stämpla (`stampla`), begära en rättelse (`begarRattelse`),
 * besluta den (`beslutaRattelse`), besluta, avfärda och häva en ogiltig
 * frånvaro (`godkannHandelse`, `avvisaHandelse`, `havHandelse`), ge någon ett
 * schema och ändra toleransen (`sparaArbetsschema`, en ny rad med nytt
 * `valid_from`; ett schema skrivs aldrig om), och lönerapportens period,
 * underlag och attest (`skapaPeriod`, `generera`, `attestera`).
 *
 * Det nya (0094): en saknad stämpling som rättelse utan en rad att ersätta,
 * stödet och avslagets skäl (`time_correction_extra`), "Okej" på ett avslag,
 * "Ja, det stämmer" på en stängd dag, "Jag har sett det" på ett nytt schema,
 * veckokollen, förklaringen till en sen dag (`late_arrival.employee_comment`,
 * som repot visar men inte låter skriva), påminnelserna, chefens frågor,
 * "Ta upp på 1:1", loggen när sena dagar öppnas, "Påminn dem", morgonnotisen,
 * senaste besöket, exportkolumnerna och "Skickad till lön".
 * ===========================================================================
 *
 * LÄSLÄGE: står `SKRIVLAGE.tid` på false svarar rutten 423 innan något skrivs.
 * GET (ett annat lönerapportsunderlag) är läsning och svarar alltid.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DATUM = /^\d{4}-\d{2}-\d{2}$/;
const KLOCKA = /^([01]\d|2[0-3]):[0-5]\d$/;

type Svar = { ok?: string; fel?: string; [k: string]: unknown };
const svar = (data: Svar, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store, max-age=0" } });
const fran = (s: { fel?: string; ok?: string }, okText: string) => (s.fel ? svar({ fel: s.fel }, 400) : svar({ ok: s.ok ?? okText }));

function form(falt: Record<string, unknown>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(falt)) {
    if (Array.isArray(v)) v.forEach((x) => f.append(k, String(x)));
    else if (v !== undefined && v !== null) f.set(k, String(v));
  }
  return f;
}

/** Repots `beslutaRattelse` kastar i stället för att svara. */
async function fangad<T>(f: () => Promise<T>): Promise<T | { fel: string }> {
  try {
    return await f();
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

export async function GET(request: Request) {
  // Ett annat lönerapportsunderlag: samma rader som /tid/lonerapport/[id], med RLS.
  const user = await getCurrentUser();
  if (!user?.employee || !hasRole(user, "sales_manager", "ceo", "finance", "admin")) return svar({ fel: "Nekad." }, 403);
  const id = new URL(request.url).searchParams.get("period") ?? "";
  if (!UUID.test(id)) return svar({ fel: "Okänd period." }, 400);
  const supabase = await supabaseServer();
  const [{ data: period }, { data: rader }, { data: just }, { data: personal }] = await Promise.all([
    supabase.from("payroll_period").select("id, period_start, period_end").eq("id", id).maybeSingle(),
    supabase.from("payroll_row").select("employee_id, worked_minutes, auto_closed_days, absence_minutes, over_minutes").eq("period_id", id),
    supabase.from("payroll_adjustment").select("employee_id, minutes").eq("period_id", id),
    supabase.from("employee").select("id, first_name, last_name, employee_number"),
  ]);
  if (!period) return svar({ fel: "Perioden finns inte." }, 404);
  const p = new Map((personal ?? []).map((x) => [x.id as string, x]));
  const j = new Map<string, number>();
  for (const x of just ?? []) j.set(x.employee_id, (j.get(x.employee_id) ?? 0) + x.minutes);
  return svar({
    underlag: {
      periodId: id,
      rader: (rader ?? [])
        .map((r) => {
          const vem = p.get(r.employee_id);
          return {
          pid: r.employee_id,
          namn: vem ? fullName(vem) : "Okänd",
          nr: String(vem?.employee_number ?? ""),
          arbetad: r.worked_minutes,
          justering: j.get(r.employee_id) ?? 0,
          stangda: r.auto_closed_days,
          utanfor: r.over_minutes ?? 0,
          franvaro: r.absence_minutes ?? {},
          };
        })
        .sort((a, b) => a.namn.localeCompare(b.namn, "sv")),
    },
  });
}

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
  const id = String(b.id ?? "");

  if (!SKRIVLAGE.tid) return svar({ fel: LASLAGE_TEXT, laslage: true }, 423);
  const db = supabaseAdmin();
  const idag = svensktDatum();
  const chef = canManageEmployees(user);
  const pref = async (key: string, value: unknown) => {
    await db.from("nav_preference").upsert({ employee_id: mig, key, value, updated_at: new Date().toISOString() }, { onConflict: "employee_id,key" });
  };
  const person = async (vem: string) => {
    if (!UUID.test(vem)) return null;
    const { data } = await db.from("employee").select("id, first_name, last_name, team_id, manager_id, status").eq("id", vem).maybeSingle();
    return data;
  };

  try {
    switch (handling) {
      /* ---------------- Den som stämplar ---------------- */
      case "stampla":
        return fran(await stampla({}, form({ typ: b.typ })), "Registrerat.");

      case "ratta": {
        // En rättelse av en befintlig rad: repots begarRattelse, och stödet om det bifogas.
        const { data: org } = await (await supabaseServer()).from("time_event").select("id, employee_id, occurred_at").eq("id", id).maybeSingle();
        if (!org || org.employee_id !== mig) return svar({ fel: "Stämplingen hittades inte." }, 404);
        const tid = String(b.tid ?? "");
        if (!KLOCKA.test(tid)) return svar({ fel: "Välj den rätta tiden." }, 400);
        const s = await begarRattelse({}, form({ ersatter: id, tid: svenskTidpunkt(svensktDatum(org.occurred_at), tid).toISOString(), motivering: String(b.skal ?? "").trim() }));
        if (s.fel) return svar({ fel: s.fel }, 400);
        const stod = String(b.stod ?? "").trim().slice(0, 300);
        if (stod) {
          const { data: ny } = await db.from("time_event").select("id").eq("supersedes_id", id).eq("correction_state", "pending").order("created_at", { ascending: false }).limit(1).maybeSingle();
          if (ny) await db.from("time_correction_extra").upsert({ time_event_id: ny.id, support: stod, updated_at: new Date().toISOString() });
        }
        return svar({ ok: s.ok ?? "Skickat till din chef." });
      }

      case "lagg": {
        // "Glömde du stämpla?": en rättelse utan en rad att ersätta. Samma väg till chefen som repots begäran.
        const sparr = await hamtaLage();
        if (!sparr.stampling) return svar({ fel: "Stämplingen är avstängd just nu." }, 400);
        const typ = String(b.typ ?? ""), dag = String(b.dag ?? idag), tid = String(b.tid ?? ""), skal = String(b.skal ?? "").trim();
        if (typ !== "in" && typ !== "out") return svar({ fel: "Välj in eller ut." }, 400);
        if (!DATUM.test(dag) || dag < dagarBakat(idag, 35) || dag > idag) return svar({ fel: "Välj en dag de senaste fem veckorna." }, 400);
        if (!KLOCKA.test(tid)) return svar({ fel: "Välj klockslaget." }, 400);
        if (!skal) return svar({ fel: "Skriv varför stämplingen saknas." }, 400);
        const nar = svenskTidpunkt(dag, tid);
        if (nar > new Date()) return svar({ fel: "Tiden ligger i framtiden." }, 400);
        const { data: rad, error } = await db
          .from("time_event")
          .insert({ employee_id: mig, kind: typ, occurred_at: nar.toISOString(), source: "correction", correction_state: "pending", requested_by: mig, note: skal.slice(0, 500) })
          .select("id")
          .single();
        if (error || !rad) return svar({ fel: "Begäran kunde inte skickas." }, 500);
        await db.from("audit_log").insert({ actor_id: mig, action: "time.correction_requested", object_type: "time_event", object_id: rad.id, meta: { saknad: true, till: nar.toISOString() } });
        await notifieraFlera(await medRoll("sales_manager", "admin"), {
          av: mig,
          kalla: "tid-rattelse",
          typ: "tid",
          rubrik: `${jagNamn} vill lägga till en stämpling`,
          detalj: `${typ === "in" ? "In" : "Ut"} ${dag} ${tid} · ${skal}`,
          href: "/tid",
          objekt: { typ: "time_event", id: rad.id },
        });
        revalidatePath("/tid", "layout");
        return svar({ ok: "Skickat till din chef. Raden läggs till som en rättelse, inget skrivs över." });
      }

      case "avslag-sett": {
        const { data: h } = await db.from("time_event").select("employee_id, correction_state").eq("id", id).maybeSingle();
        if (!h || h.employee_id !== mig || h.correction_state !== "rejected") return svar({ fel: "Avslaget finns inte." }, 404);
        await db.from("time_correction_extra").upsert({ time_event_id: id, rejection_seen_at: new Date().toISOString(), updated_at: new Date().toISOString() });
        return svar({ ok: "Okej." });
      }

      case "auto-ok": {
        const dag = String(b.dag ?? "");
        if (!DATUM.test(dag)) return svar({ fel: "Okänd dag." }, 400);
        const { data: auto } = await (await supabaseServer()).from("time_event").select("id").eq("employee_id", mig).eq("source", "system_auto_close").gte("occurred_at", svenskTidpunkt(dag, "00:00").toISOString()).lte("occurred_at", svenskTidpunkt(dagarBakat(dag, -1), "00:00").toISOString()).limit(1);
        if (!auto?.length) return svar({ fel: "Navet stängde inte den dagen." }, 400);
        await db.from("time_day_ack").upsert({ employee_id: mig, work_date: dag, kind: "auto_close_ok" });
        return svar({ ok: "Bekräftat. Tiden står kvar." });
      }

      case "schema-sett": {
        const f = String(b.fran ?? "");
        if (!DATUM.test(f)) return svar({ fel: "Okänt schema." }, 400);
        await db.from("work_schedule_seen").upsert({ employee_id: mig, valid_from: f });
        return svar({ ok: "Tack. Schemat räknas från den dag det börjar gälla." });
      }

      case "vecka": {
        const v = String(b.vecka ?? "");
        if (!DATUM.test(v) || svenskVeckodag(svenskTidpunkt(v, "12:00")) !== 1) return svar({ fel: "Okänd vecka." }, 400);
        await db.from("time_week_check").upsert({ employee_id: mig, week_start: v, ok: b.ok !== false, checked_at: new Date().toISOString() });
        return svar({ ok: b.ok === false ? "Tryck på dagen som är fel och rätta den." : "Veckan är kollad." });
      }

      case "sen-forklaring": {
        const text = String(b.text ?? "").trim().slice(0, 500);
        if (!text) return svar({ fel: "Skriv vad som hände, en mening räcker." }, 400);
        const { data: sen } = await db.from("late_arrival").select("id, employee_id, work_date").eq("id", id).maybeSingle();
        if (!sen || sen.employee_id !== mig) return svar({ fel: "Dagen finns inte." }, 404);
        await db.from("late_arrival").update({ employee_comment: text }).eq("id", id).eq("employee_id", mig);
        await db.from("audit_log").insert({ actor_id: mig, action: "late_arrival.commented", object_type: "late_arrival", object_id: id });
        const jag = await person(mig);
        const till = jag?.manager_id ? [jag.manager_id as string] : await medRoll("sales_manager");
        await notifieraFlera(till, { av: mig, kalla: "tid-sen-forklaring", typ: "tid", rubrik: `${jagNamn} förklarade en sen dag`, detalj: `${sen.work_date} · ${text}`, href: "/tid", objekt: { typ: "late_arrival", id } });
        return svar({ ok: "Förklaringen är sparad. Din chef ser den bredvid dagen." });
      }

      case "paminn": {
        const ok = (x: unknown) => {
          const v = (x ?? {}) as { pa?: unknown; min?: unknown };
          return { pa: v.pa === true, min: (PAMINN_MINUTER as readonly number[]).includes(Number(v.min)) ? Number(v.min) : 15 };
        };
        await pref("tid.paminn", { in: ok(b.in), ut: ok(b.ut) });
        return svar({ ok: "Påminnelserna är sparade." });
      }

      /* ---------------- Chefen ---------------- */
      case "besok":
        if (!chef) return svar({ ok: "" });
        await pref("tid.senast", new Date().toISOString());
        return svar({ ok: "" });

      case "beslut":
      case "beslut-stod": {
        if (!chef) return svar({ fel: "Bara chef får besluta om en rättelse." }, 403);
        const ja = handling === "beslut-stod" || b.beslut === "ja";
        const skal = String(b.skal ?? "").trim().slice(0, 500);
        if (!ja && !skal) return svar({ fel: "Skriv ett skäl. Utan skäl går avslaget inte iväg." }, 400);
        let ids = handling === "beslut-stod" ? (Array.isArray(b.ids) ? (b.ids as string[]) : []).filter((x) => UUID.test(String(x))) : [id];
        if (handling === "beslut-stod") {
          const { data: medStod } = await db.from("time_correction_extra").select("time_event_id").in("time_event_id", ids).not("support", "is", null);
          ids = (medStod ?? []).map((x) => x.time_event_id as string);
        }
        let n = 0;
        for (const r of ids.slice(0, 50)) {
          const s = (await fangad(() => beslutaRattelse(form({ rattelse_id: r, beslut: ja ? "godkann" : "avsla" })))) as { fel?: string } | undefined;
          if (s?.fel) return svar({ fel: s.fel }, 403);
          const { data: efter } = await db.from("time_event").select("correction_state, decided_by").eq("id", r).maybeSingle();
          if (efter?.decided_by !== mig) continue;
          if (!ja) await db.from("time_correction_extra").upsert({ time_event_id: r, reject_reason: skal, updated_at: new Date().toISOString() });
          n++;
        }
        if (!n) return svar({ fel: "Rättelsen är redan beslutad." }, 400);
        return svar({ ok: ja ? (n === 1 ? "Godkänd. Journalen är uppdaterad." : `${n} rättelser godkända.`) : "Avslagen. Skälet syns för personen." });
      }

      case "ogiltig": {
        const vad = String(b.b ?? "");
        const not = String(b.skal ?? "").trim();
        if (vad === "godkann") return fran(await godkannHandelse({}, form({ id, anteckning: not })), "Godkänd som ogiltig frånvaro.");
        if (vad === "avfarda") return fran(await avvisaHandelse({}, form({ id, anteckning: not || "Var på plats." })), "Avfärdad.");
        if (vad === "hav") return fran(await havHandelse({}, form({ id, skal: not || "Hävd i Nav 2.0." })), "Beslutet är hävt. Båda spåren står kvar i historiken.");
        if (vad === "fraga") {
          const { data: o } = await db.from("attendance_incident").select("employee_id, occurred_on, status").eq("id", id).maybeSingle();
          if (!o || o.status !== "foreslagen") return svar({ fel: "Förslaget finns inte." }, 404);
          if (!chef) return svar({ fel: "Bara chef får fråga." }, 403);
          await notifiera({ till: o.employee_id as string, av: mig, kalla: "tid-fraga", typ: "tid", rubrik: `${jagNamn} undrar om ${o.occurred_on}`, detalj: "Var du på plats? Svara i Ärenden eller direkt till din chef.", href: "/tid" });
          return svar({ ok: "Frågan är skickad." });
        }
        return svar({ fel: "Okänd handling." }, 400);
      }

      case "fraga": {
        if (!chef) return svar({ fel: "Bara chef får fråga." }, 403);
        const p = await person(String(b.vem ?? ""));
        if (!p) return svar({ fel: "Personen finns inte." }, 404);
        await notifiera({ till: p.id as string, av: mig, kalla: "tid-fraga", typ: "tid", rubrik: `${jagNamn} undrar: Är allt okej?`, detalj: "Hör av dig om du inte kommer i dag.", href: "/tid" });
        return svar({ ok: `Frågan är skickad till ${p.first_name}.` });
      }

      case "be-ratta": {
        if (!chef) return svar({ fel: "Bara chef får be om en rättelse." }, 403);
        const p = await person(String(b.vem ?? ""));
        const dag = String(b.dag ?? "");
        if (!p || !DATUM.test(dag)) return svar({ fel: "Personen eller dagen finns inte." }, 404);
        await notifiera({ till: p.id as string, av: mig, kalla: "tid-be-ratta", typ: "tid", rubrik: `${dag} saknar utstämpling`, detalj: `${jagNamn} ber dig lägga till när du gick. Rättelsen hamnar hos din chef.`, href: "/tid" });
        return svar({ ok: `${p.first_name} är ombedd att rätta. Rättelsen hamnar här.` });
      }

      case "ge-schema": {
        // Personen får samma schema som teamet (eller bolaget), från i dag: en ny rad, inget skrivs om.
        const p = await person(String(b.vem ?? ""));
        if (!p) return svar({ fel: "Personen finns inte." }, 404);
        const { data: alla } = await db.from("work_schedule").select("scope, employee_id, team_id, weekday, start_time, end_time, tol_late, valid_from");
        const grupper = new Map<string, { dagar: number[]; start: string; slut: string; tol: number }>();
        for (let v = 1; v <= 7; v++) {
          const s = gallandeSchema((alla ?? []).filter((x) => x.weekday === v && x.scope !== "employee"), p.id as string, (p.team_id as string | null) ?? null, idag)[0];
          if (!s) continue;
          const k = `${s.start_time}|${s.end_time}|${s.tol_late}`;
          const g = grupper.get(k) ?? { dagar: [] as number[], start: String(s.start_time).slice(0, 5), slut: String(s.end_time).slice(0, 5), tol: s.tol_late ?? 1 };
          g.dagar.push(v);
          grupper.set(k, g);
        }
        if (!grupper.size) return svar({ fel: "Teamet har inget schema att ge." }, 400);
        for (const g of grupper.values()) {
          const s = await fangad(() => sparaArbetsschema({}, form({ scope: "employee", scope_id: p.id, veckodag: g.dagar, start_time: g.start, end_time: g.slut, valid_from: idag, tol_late: g.tol })));
          if ("fel" in s && s.fel) return svar({ fel: s.fel }, 400);
        }
        return svar({ ok: `${p.first_name} har teamets schema från i dag. Den öppna dagen rättas fortfarande av ${p.first_name}.` });
      }

      case "punkt": {
        if (!chef) return svar({ fel: "Bara chef lägger punkter till en 1:1." }, 403);
        const p = await person(String(b.vem ?? ""));
        const text = String(b.text ?? "").trim().slice(0, 500);
        if (!p || !text) return svar({ fel: "Personen eller punkten saknas." }, 400);
        const { data: finns } = await db.from("one_on_one_point").select("id").eq("employee_id", p.id).eq("source", "tid-sen").is("handled_at", null).limit(1);
        if (!finns?.length) await db.from("one_on_one_point").insert({ employee_id: p.id, text, source: "tid-sen", added_by: mig });
        return svar({ ok: `${fullName(p as { first_name: string; last_name: string })} står på agendan till nästa 1:1.` });
      }

      case "sena-visad": {
        if (!chef) return svar({ fel: "Nekad." }, 403);
        const p = await person(String(b.vem ?? ""));
        if (!p) return svar({ fel: "Personen finns inte." }, 404);
        await db.from("tid_view_log").insert({ viewer_id: mig, employee_id: p.id, what: "sena" });
        return svar({ ok: "" });
      }

      case "schema-paminn": {
        if (!chef) return svar({ fel: "Nekad." }, 403);
        const f = String(b.fran ?? "");
        if (!DATUM.test(f) || f < SCHEMA_KVITTENS_FRAN) return svar({ fel: "Okänt schema." }, 400);
        const [{ data: rader }, { data: sett }, { data: pers }] = await Promise.all([
          db.from("work_schedule").select("scope, employee_id, team_id").eq("valid_from", f),
          db.from("work_schedule_seen").select("employee_id").eq("valid_from", f),
          db.from("employee").select("id, team_id").neq("status", "offboarded"),
        ]);
        const harSett = new Set((sett ?? []).map((s) => s.employee_id as string));
        const berorda = (pers ?? []).filter((p) => (rader ?? []).some((r) => r.scope === "company" || (r.scope === "team" && r.team_id === p.team_id) || (r.scope === "employee" && r.employee_id === p.id)));
        const till = berorda.filter((p) => !harSett.has(p.id as string)).map((p) => p.id as string);
        if (!till.length) return svar({ ok: "Alla har sett schemat." });
        await notifieraFlera(till, { av: mig, kalla: "tid-schema-sett", typ: "tid", rubrik: `Nytt schema från ${f}`, detalj: "Titta på det i Tid. Ingen sen ankomst bedöms mot det förrän du sett det.", href: "/tid" });
        return svar({ ok: `${till.length} ${till.length === 1 ? "person är påmind" : "personer är påminda"}.` });
      }

      case "tolerans": {
        if (!chef) return svar({ fel: "Bara säljchef och administratör får ändra scheman." }, 403);
        const tol = Number(b.tol);
        if (!Number.isInteger(tol) || tol < 1 || tol > 60) return svar({ fel: "Toleransen ska vara 1–60 minuter." }, 400);
        const { data: jag } = await db.from("employee").select("team_id").eq("id", mig).maybeSingle();
        const { data: alla } = await db.from("work_schedule").select("scope, employee_id, team_id, weekday, start_time, end_time, tol_late, valid_from");
        const team = (jag?.team_id as string | null) ?? null;
        const pa = (alla ?? []).filter((r) => (team && r.scope === "team" && r.team_id === team) || r.scope === "company");
        const scope = team && pa.some((r) => r.scope === "team") ? "team" : "company";
        const imorgon = dagarBakat(idag, -1);
        const grupper = new Map<string, { dagar: number[]; start: string; slut: string }>();
        for (let v = 1; v <= 7; v++) {
          const s = pa.filter((r) => r.scope === scope && r.weekday === v && r.valid_from <= imorgon).sort((a, c) => String(c.valid_from).localeCompare(String(a.valid_from)))[0];
          if (!s) continue;
          const k = `${s.start_time}|${s.end_time}`;
          const g = grupper.get(k) ?? { dagar: [] as number[], start: String(s.start_time).slice(0, 5), slut: String(s.end_time).slice(0, 5) };
          g.dagar.push(v);
          grupper.set(k, g);
        }
        if (!grupper.size) return svar({ fel: "Det finns inget schema att ändra." }, 400);
        for (const g of grupper.values()) {
          const s = await fangad(() => sparaArbetsschema({}, form({ scope, scope_id: scope === "team" ? team : "", veckodag: g.dagar, start_time: g.start, end_time: g.slut, valid_from: imorgon, tol_late: tol })));
          if ("fel" in s && s.fel) return svar({ fel: s.fel }, 400);
        }
        return svar({ ok: `Toleransen är ${tol} min från i morgon.` });
      }

      case "morgonnotis": {
        const t = String(b.tid ?? "");
        if (!(MORGONNOTIS_VAL as readonly string[]).includes(t)) return svar({ fel: "Välj en av tiderna." }, 400);
        await pref("tid.morgonnotis", t);
        return svar({ ok: `Morgonnotisen kommer ${t}.` });
      }

      /* ---------------- Lönerapporten ---------------- */
      case "lon-granska": {
        // Granskad = underlaget skrivet och attesterat (repots generera och attestera), när perioden är slut.
        let pid = String(b.period ?? "");
        if (!UUID.test(pid)) {
          const start = String(b.start ?? ""), slut = String(b.slut ?? "");
          if (!DATUM.test(start) || !DATUM.test(slut)) return svar({ fel: "Okänd period." }, 400);
          const { data: finns } = await db.from("payroll_period").select("id").eq("period_start", start).eq("period_end", slut).maybeSingle();
          if (finns) pid = finns.id as string;
          else {
            const s = await skapaPeriod({}, form({ period_start: start, period_end: slut }));
            if (s.fel) return svar({ fel: s.fel }, 400);
            const { data: ny } = await db.from("payroll_period").select("id").eq("period_start", start).eq("period_end", slut).maybeSingle();
            if (!ny) return svar({ fel: "Perioden kunde inte skapas." }, 500);
            pid = ny.id as string;
          }
        }
        const { data: per } = await db.from("payroll_period").select("period_end, status").eq("id", pid).maybeSingle();
        if (!per) return svar({ fel: "Perioden finns inte." }, 404);
        if (per.status === "attested") return svar({ ok: "Perioden är redan granskad och attesterad." });
        if (String(per.period_end) >= idag) return svar({ fel: "Perioden är inte slut än. Underlaget skrivs och attesteras när sista dagen är avslutad." }, 400);
        const g = await generera({}, form({ period_id: pid }));
        if (g.fel) return svar({ fel: g.fel, blockeringar: g.blockeringar ?? [] }, 400);
        return fran(await attestera({}, form({ period_id: pid })), "Underlaget är skrivet och attesterat.");
      }

      case "lon-skickad": {
        if (!hasRole(user, "sales_manager", "ceo", "finance", "admin")) return svar({ fel: "Nekad." }, 403);
        const { data: per } = await db.from("payroll_period").select("status").eq("id", String(b.period ?? "")).maybeSingle();
        if (!per) return svar({ fel: "Perioden finns inte." }, 404);
        if (per.status !== "attested") return svar({ fel: "Attestera underlaget innan det skickas till lön." }, 400);
        await db.from("payroll_period_sent").upsert({ period_id: String(b.period), sent_by: mig, sent_at: new Date().toISOString() });
        await db.from("audit_log").insert({ actor_id: mig, action: "payroll.sent", object_type: "payroll_period", object_id: String(b.period) });
        return svar({ ok: "Markerad som skickad till lön." });
      }

      case "lon-kolumn": {
        if (!hasRole(user, "sales_manager", "ceo", "finance", "admin")) return svar({ fel: "Nekad." }, 403);
        if (!UUID.test(id)) return svar({ fel: "Okänd kolumn." }, 400);
        await db.from("payroll_export_column").update({ active: b.pa === true }).eq("id", id);
        await db.from("audit_log").insert({ actor_id: mig, action: "payroll.column_changed", object_type: "payroll_export_column", object_id: id, meta: { active: b.pa === true } });
        return svar({ ok: "Kolumnerna sparas till nästa fil." });
      }

      default:
        return svar({ fel: "Okänd handling." }, 400);
    }
  } catch (e) {
    return svar({ fel: e instanceof Error ? e.message : "Något gick fel." }, 500);
  }
}
