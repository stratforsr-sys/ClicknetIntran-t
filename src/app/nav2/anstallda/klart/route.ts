import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { notifiera } from "@/lib/notishandelse-server";
import { LASLAGE_TEXT, SKRIVLAGE, sammaUrsprung } from "@/lib/nav2/skrivlage";

export const dynamic = "force-dynamic";

/**
 * Nav 2.0, Anställda: Klart-knappen i mejlet.
 *
 * ===========================================================================
 * INGEN HEMLIGHET I LÄNKEN. Den som trycker måste vara inloggad i navet och
 * vara den punkten är skickad till. Länken är alltså värdelös för någon annan,
 * och ett vidarebefordrat mejl öppnar ingenting. GET visar bara frågan; det är
 * formuläret (POST, samma ursprung) som bockar av. En förhandsvisning i
 * mejlklienten kan därför aldrig trycka Klart åt någon.
 * ===========================================================================
 *
 * LÄSLÄGE: står `SKRIVLAGE.anstallda` på false sparas ingenting.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const EPOST = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

type Punkt = { id: string; employee_id: string; label: string; state: string; owner_id: string | null; ask_for: string | null; mail_subject: string | null; value: string | null; handled_at: string | null };
const PUNKT = "id, employee_id, label, state, owner_id, ask_for, mail_subject, value, handled_at";

function sida(rubrik: string, kropp: string, status = 200) {
  const html = `<!doctype html><html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(rubrik)} · Nav</title>
<style>body{font:16px/1.5 system-ui,sans-serif;margin:0;background:#f6f5f1;color:#1d1d1b}main{max-width:460px;margin:12vh auto;padding:0 16px}section{background:#fff;border-radius:14px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,.08)}h1{font-size:20px;margin:0 0 8px}p{margin:0 0 14px;color:#4a4a46}label{display:block;font-size:14px;margin:0 0 6px}input{width:100%;box-sizing:border-box;font:inherit;padding:10px 12px;border:1px solid #cfcdc6;border-radius:8px;margin:0 0 14px}button{font:inherit;background:#1f6f5c;color:#fff;border:0;border-radius:8px;padding:10px 18px;cursor:pointer}a{color:#1f6f5c}@media (prefers-color-scheme:dark){body{background:#151513;color:#ecebe6}section{background:#22221f}p{color:#b9b8b1}input{background:#151513;color:inherit;border-color:#45443f}}</style></head>
<body><main><section><h1>${esc(rubrik)}</h1>${kropp}</section></main></body></html>`;
  return new NextResponse(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store, max-age=0" } });
}

async function hamta(request: Request) {
  const user = await getCurrentUser();
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!user?.employee) return { svar: NextResponse.redirect(new URL(`/logga-in?nasta=${encodeURIComponent(`/nav2/anstallda/klart?id=${id}`)}`, request.url)) };
  if (!UUID.test(id)) return { svar: sida("Länken stämmer inte", "<p>Punkten finns inte.</p>", 404) };
  const db = supabaseAdmin();
  const { data: on } = await db.from("onboarding_task").select(PUNKT).eq("id", id).maybeSingle();
  const { data: off } = on ? { data: null } : await db.from("offboarding_task").select(PUNKT).eq("id", id).maybeSingle();
  const x = ((on ?? off) as unknown as Punkt | null) ?? null;
  if (!x || x.owner_id !== user.employee.id) return { svar: sida("Inte din punkt", "<p>Den här punkten är skickad till någon annan, eller finns inte längre.</p>", 404) };
  const { data: p } = await db.from("employee").select("first_name, last_name, manager_id").eq("id", x.employee_id).maybeSingle();
  const person = p as { first_name: string; last_name: string; manager_id: string | null } | null;
  return { user, db, x, tabell: on ? "onboarding_task" : "offboarding_task", namn: person ? `${person.first_name} ${person.last_name}`.trim() : "", chef: person?.manager_id ?? null };
}

export async function GET(request: Request) {
  const h = await hamta(request);
  if ("svar" in h) return h.svar;
  const { x, namn } = h;
  if (x.state !== "open") return sida("Redan klart", `<p>${esc(x.label)} för ${esc(namn)} är redan bockat${x.value ? `: ${esc(x.value)}` : ""}. Tack!</p>`);
  const falt = x.ask_for ? `<label for="v">${esc(x.ask_for)}</label><input id="v" name="varde" required maxlength="200" autocomplete="off">` : "";
  return sida(x.mail_subject ?? x.label, `<p>${esc(x.label)} för ${esc(namn)}.</p><form method="post">${falt}<button type="submit">Klart</button></form>`);
}

export async function POST(request: Request) {
  const h = await hamta(request);
  if ("svar" in h) return h.svar;
  if (!sammaUrsprung(request)) return sida("Fel ursprung", "<p>Tryck Klart på sidan i navet.</p>", 403);
  const { user, db, x, tabell, namn, chef } = h;
  if (x.state !== "open") return sida("Redan klart", `<p>${esc(x.label)} för ${esc(namn)} är redan bockat. Tack!</p>`);
  if (!SKRIVLAGE.anstallda) return sida("Läsläge", `<p>${esc(LASLAGE_TEXT)}</p>`, 423);
  const varde = String((await request.formData()).get("varde") ?? "").trim().slice(0, 200);
  if (x.ask_for && !varde) return sida("Saknas", `<p>Skriv ${esc(x.ask_for.toLowerCase())}. <a href="">Tillbaka</a></p>`, 400);
  if (x.ask_for === "E-postadress" && !EPOST.test(varde)) return sida("Saknas", `<p>Skriv en hel adress, till exempel namn@clicknet.se. <a href="">Tillbaka</a></p>`, 400);
  const mig = user.employee!.id;
  if (x.ask_for === "Lynes-användare") {
    const { data: upptagen } = await db.from("phone_identity").select("employee_id").eq("kind", "lynes_user").eq("value", varde).maybeSingle();
    if (upptagen && (upptagen as { employee_id: string }).employee_id !== x.employee_id) return sida("Upptagen", "<p>Lynes-användaren hör redan till någon annan i navet.</p>", 400);
    await db.from("phone_identity").delete().eq("employee_id", x.employee_id).eq("kind", "lynes_user");
    await db.from("phone_identity").insert({ employee_id: x.employee_id, kind: "lynes_user", value: varde, created_by: mig });
  }
  await db.from(tabell).update({ state: "done", handled_by: mig, handled_at: new Date().toISOString(), value: varde || null }).eq("id", x.id).eq("state", "open");
  await db.from("audit_log").insert({
    actor_id: mig, action: tabell === "onboarding_task" ? "onboarding.done" : "offboarding.done", object_type: tabell, object_id: x.id,
    meta: { employeeId: x.employee_id, varde: varde || undefined },
  });
  // Den som lade upp eller avslutade personen ser det i Nav. Närmaste chef får notisen.
  if (chef)
    await notifiera({
      till: chef, av: mig, kalla: "personal-klart", typ: "uppgift", rubrik: `${x.label} klart för ${namn}`,
      detalj: varde ? `${x.ask_for}: ${varde}` : tabell === "onboarding_task" ? "Onboarding" : "Avslut", href: "/nav2", objekt: { typ: "employee", id: x.employee_id },
    });
  return sida("Tack!", `<p>${esc(x.label)} för ${esc(namn)} är bockat${varde ? `: ${esc(varde)}` : ""}. ${chef ? "Närmaste chef ser det i Nav." : ""}</p>`);
}
