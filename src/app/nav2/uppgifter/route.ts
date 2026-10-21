import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { fullName, getCurrentUser } from "@/lib/auth";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { svensktDatum } from "@/lib/klocka";
import { notifiera } from "@/lib/notishandelse-server";
import {
  andraProjekt,
  andraUppgift,
  arkiveraProjekt,
  ateroppna,
  avbryt,
  avslutaSerie,
  bjudIn,
  bjudInProjekt,
  koppla,
  markeraProjektchattLast,
  skapaProjekt,
  skrivProjektmeddelande,
  taBortKoppling,
  taBortProjektmedlem,
  bocka,
  godkann,
  kommentera,
  paborja,
  planera,
  returnera,
  skapaUppgift,
  taBortMedlem,
  tilldela,
  type UppgiftState,
} from "@/app/(app)/uppgifter/actions";
import { andraUppgiftsmall, anvandUppgiftsmall, arkiveraUppgiftsmall, skapaUppgiftsmall } from "@/app/(app)/uppgifter/mallar/actions";
import { slutforGenomgang } from "@/app/(app)/uppgifter/genomgang/actions";
import { LASLAGE_TEXT, SKRIVLAGE, sammaUrsprung } from "@/lib/nav2/skrivlage";

export const dynamic = "force-dynamic";

/**
 * Nav 2.0: allt som ändrar en uppgift, i en rutt.
 *
 * ===========================================================================
 * REPOTS ACTIONS. Lägga upp (också snabbraden och deluppgifter), bocka av,
 * öppna igen, godkänna, returnera, lämna över, stryka, planera, ändra,
 * kommentera, påbörja, bjuda in, ta bort ur kretsen, använda en mall och
 * slutföra veckogenomgången går genom app/(app)/uppgifter — samma krets,
 * samma historik och samma notiser. Planera och ändra skriver alla sina fält,
 * så rutten fyller i de nuvarande värdena för det som inte ändras.
 *
 * Det nya (0092): dagens tre (`task_focus`), dagens början och slut
 * (`task_day`), första steget (`task.next_step`) och påminn (en händelse
 * `paminnelse` och en notis till den som har uppgiften). "Dela upp med Nav"
 * lägger deluppgifter med `skapaUppgift`.
 * ===========================================================================
 *
 * LÄSLÄGE: står `SKRIVLAGE.uppgifter` på false svarar rutten 423 innan något
 * skrivs.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DATUM = /^\d{4}-\d{2}-\d{2}$/;
/** Projektens färger, som repots NyttProjekt. */
const FARGER = ["brand", "info", "accent", "ok", "warn", "danger"];

type Svar = { ok?: string; fel?: string; [k: string]: unknown };
const svar = (data: Svar, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store, max-age=0" } });
const fran = (s: UppgiftState, okText: string) => (s.fel ? svar({ fel: s.fel }, 400) : svar({ ok: s.ok ?? okText, id: s.id ?? null }));

function form(falt: Record<string, unknown>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(falt)) if (v !== undefined && v !== null) f.set(k, String(v));
  return f;
}

/** Uppgiften som den inloggade ser den (RLS), med de fält ändringarna behöver. */
async function uppgiften(id: string) {
  if (!UUID.test(id)) return null;
  const { data } = await (await supabaseServer())
    .from("task")
    .select("id, title, priority, description_md, due_date, due_time, starts_on, estimate_minutes, project_id, assignee_id, created_by")
    .eq("id", id)
    .maybeSingle();
  return data;
}

/**
 * Gamla Nav D: väljarna för en koppling, som /uppgifter/[id] läser dem: med den inloggades token (RLS). Läsning, svarar
 * också i läsläge. Ordrarna, ärendena och coachningsuppgifterna är de 50 senaste; `sok` (beställaren 2026-10-21, "det som
 * är bäst") söker bland alla av en sort (`slag`), också de äldre. Personerna och kurserna kommer alla och filtreras i klienten.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user?.employee) return svar({ fel: "Du måste vara inloggad." }, 401);
  const url = new URL(request.url);
  if (url.searchParams.get("kopplingsval") !== "1") return svar({ fel: "Okänd fråga." }, 400);
  const supabase = await supabaseServer();
  // PostgREST-filtrets egna tecken tas bort, så att sökordet inte kan bli ett filter.
  const sok = (url.searchParams.get("sok") ?? "").replace(/[%_,()*\\:."]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  const slag = url.searchParams.get("slag") ?? "";
  const m = `%${sok}%`;
  const orderQ = () => supabase.from("sales_order").select("id, company_name, signed_on").order("created_at", { ascending: false }).limit(50);
  const arendeQ = () => supabase.from("hr_case").select("id, subject").order("created_at", { ascending: false }).limit(50);
  const coachQ = () => supabase.from("coaching_task").select("id, title, assignee_id").is("cancelled_at", null).order("created_at", { ascending: false }).limit(50);
  const { data: personer } = await supabase.from("employee").select("id, first_name, last_name").neq("status", "offboarded").order("first_name");
  const namn = new Map(((personer ?? []) as { id: string; first_name: string; last_name: string }[]).map((p) => [p.id, fullName(p)]));
  // Samma kund kan ha flera order, och samma coachningsuppgift ges till flera: dagen och personen skiljer dem åt.
  const somOrder = (r: unknown[] | null) => ((r ?? []) as { id: string; company_name: string; signed_on: string | null }[]).map((o) => ({ id: o.id, namn: o.signed_on ? `${o.company_name} · ${o.signed_on}` : o.company_name }));
  const somArende = (r: unknown[] | null) => ((r ?? []) as { id: string; subject: string }[]).map((a) => ({ id: a.id, namn: a.subject }));
  const somCoach = (r: unknown[] | null) => ((r ?? []) as { id: string; title: string; assignee_id: string | null }[]).map((c) => ({ id: c.id, namn: c.assignee_id && namn.get(c.assignee_id) ? `${c.title} · ${namn.get(c.assignee_id)}` : c.title }));
  if (sok.length >= 2 && (slag === "order" || slag === "arende" || slag === "coachning")) {
    if (slag === "order") return svar({ ok: "", slag, val: somOrder((await orderQ().or(`company_name.ilike.${m},org_number.ilike.${m},contact_name.ilike.${m}`)).data) });
    if (slag === "arende") return svar({ ok: "", slag, val: somArende((await arendeQ().ilike("subject", m)).data) });
    return svar({ ok: "", slag, val: somCoach((await coachQ().ilike("title", m)).data) });
  }
  const [{ data: order }, { data: arenden }, { data: kurser }, { data: coachning }] = await Promise.all([
    orderQ(),
    arendeQ(),
    supabase.from("course").select("id, title").eq("status", "published").order("title"),
    coachQ(),
  ]);
  return svar({
    ok: "",
    val: {
      order: somOrder(order),
      person: [...namn].map(([id, n]) => ({ id, namn: n })),
      arende: somArende(arenden),
      kurs: (kurser ?? []).map((k) => ({ id: k.id as string, namn: k.title as string })),
      coachning: somCoach(coachning),
    },
  });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user?.employee) return svar({ fel: "Du måste vara inloggad." }, 401);
  if (!sammaUrsprung(request)) return svar({ fel: "Fel ursprung." }, 403);
  const mig = user.employee.id;

  let b: Record<string, unknown>;
  try {
    b = (await request.json()) as Record<string, unknown>;
  } catch {
    return svar({ fel: "Ogiltig begäran." }, 400);
  }
  const handling = String(b.handling ?? "");
  const id = String(b.id ?? "");

  if (!SKRIVLAGE.uppgifter) return svar({ fel: LASLAGE_TEXT, laslage: true }, 423);
  const db = supabaseAdmin();
  const idag = svensktDatum();

  try {
    switch (handling) {
      case "skapa":
        // Snabbraden tolkas av repots tolkaSnabbrad; en deluppgift har parent_id.
        return fran(
          await skapaUppgift({}, form(b.rad ? { rad: b.rad } : { title: b.titel, parent_id: b.foralder ?? null, priority: b.prio ?? 3, due_date: b.dag ?? null })),
          "Uppgiften är upplagd.",
        );
      case "dela-upp": {
        const steg = Array.isArray(b.steg) ? (b.steg as string[]).map((s) => String(s).trim()).filter(Boolean).slice(0, 10) : [];
        if (!steg.length) return svar({ fel: "Inga steg att lägga till." }, 400);
        for (const titel of steg) {
          const s = await skapaUppgift({}, form({ title: titel, parent_id: id }));
          if (s.fel) return svar({ fel: s.fel }, 400);
        }
        return svar({ ok: `Uppgiften är uppdelad i ${steg.length} steg. Ändra fritt.` });
      }
      case "bocka":
        return fran(await bocka({}, form({ id })), "Klar.");
      case "ateroppna":
        return fran(await ateroppna({}, form({ id })), "Öppnad igen.");
      case "godkann":
        return fran(await godkann({}, form({ id })), "Godkänd.");
      case "returnera":
        return fran(await returnera({}, form({ id, note: b.note ?? "" })), "Returnerad.");
      case "tilldela":
        return fran(await tilldela({}, form({ id, assignee_id: b.till ?? "" })), "Uppgiften är överlämnad.");
      case "avbryt":
        return fran(await avbryt({}, form({ id, note: b.note ?? "" })), "Struken.");
      case "paborja":
        return fran(await paborja({}, form({ id })), "Påbörjad.");
      case "kommentera":
        return fran(await kommentera({}, form({ id, note: b.note ?? "" })), "Kommentaren är skickad.");
      case "bjudin":
        return fran(await bjudIn({}, form({ id, employee_id: b.person ?? "", role: b.roll ?? "visare" })), "Inbjuden.");
      case "lamna":
        return fran(await taBortMedlem({}, form({ id, employee_id: b.person ?? mig })), "Du följer inte uppgiften längre.");
      case "planera": {
        const u = await uppgiften(id);
        if (!u) return svar({ fel: "Uppgiften finns inte." }, 404);
        const dag = b.dag === undefined ? u.due_date : b.dag === null ? null : String(b.dag);
        if (dag !== null && !DATUM.test(dag)) return svar({ fel: "Okänt datum." }, 400);
        const tid = b.tid === undefined ? u.due_time : b.tid === null ? null : String(b.tid);
        const est = b.est === undefined ? u.estimate_minutes : b.est === null ? null : Number(b.est);
        return fran(await planera({}, form({ id, due_date: dag ?? "", due_time: tid ?? "", estimate_minutes: est ?? "" })), dag ? "Planerad." : "Datumet togs bort.");
      }
      case "andra": {
        const u = await uppgiften(id);
        if (!u) return svar({ fel: "Uppgiften finns inte." }, 404);
        const f = (b.falt ?? {}) as Record<string, unknown>;
        const v = (k: string, nu: unknown) => (k in f ? f[k] : nu);
        return fran(
          await andraUppgift(
            {},
            form({
              id,
              title: v("title", u.title),
              priority: v("priority", u.priority),
              description_md: v("description_md", u.description_md ?? ""),
              due_date: v("due_date", u.due_date) ?? "",
              due_time: v("due_time", u.due_time) ?? "",
              starts_on: u.starts_on ?? "",
              estimate_minutes: v("estimate_minutes", u.estimate_minutes) ?? "",
              project_id: v("project_id", u.project_id) ?? "",
              serie_omfattning: f.serie === true ? "serie" : "",
            }),
          ),
          "Sparat.",
        );
      }
      /* ---------------- Gamla Nav D: projekten, mallarna, serien och kopplingarna (repots actions) ---------------- */
      case "projekt-ny":
        return fran(await skapaProjekt({}, form({ name: String(b.namn ?? "").trim().slice(0, 120), color: FARGER.includes(String(b.farg)) ? b.farg : "brand", due_date: DATUM.test(String(b.due ?? "")) ? b.due : "", description_md: String(b.besk ?? "").slice(0, 4000) })), "Projektet finns.");
      case "projekt-andra":
        return fran(await andraProjekt({}, form({ id, name: String(b.namn ?? "").trim().slice(0, 120), color: FARGER.includes(String(b.farg)) ? b.farg : "brand", due_date: DATUM.test(String(b.due ?? "")) ? b.due : "", description_md: String(b.besk ?? "").slice(0, 4000), owner_id: UUID.test(String(b.agare ?? "")) ? b.agare : "" })), "Sparat.");
      case "projekt-arkivera":
        return fran(await arkiveraProjekt({}, form({ id, aterstall: b.aterstall === true ? "ja" : "" })), b.aterstall === true ? "Framplockat." : "Arkiverat.");
      case "projekt-bjud":
        return fran(await bjudInProjekt({}, form({ id, employee_id: b.vem ?? "", role: b.roll === "visare" ? "visare" : "redigerare" })), "Inbjuden.");
      case "projekt-bort":
        return fran(await taBortProjektmedlem({}, form({ id, employee_id: b.vem ?? "" })), "Borttagen.");
      case "projekt-skriv":
        return fran(await skrivProjektmeddelande({}, form({ id, body: String(b.text ?? "") })), "Skickat.");
      case "projekt-last":
        await markeraProjektchattLast(id);
        return svar({ ok: "" });
      case "mall-ny":
        return fran(await skapaUppgiftsmall({}, form({ name: b.namn ?? "", moment: b.moment ?? "", description_md: b.besk ?? "", shared: b.delad === true ? "on" : null })), "Mallen är sparad.");
      case "mall-andra":
        return fran(await andraUppgiftsmall({}, form({ template_id: b.mall ?? "", name: b.namn ?? "", moment: b.moment ?? "", description_md: b.besk ?? "", shared: b.delad === true ? "on" : null })), "Mallen är uppdaterad.");
      case "mall-arkivera":
        return fran(await arkiveraUppgiftsmall({}, form({ template_id: b.mall ?? "" })), "Klart.");
      case "serie-avsluta":
        return fran(await avslutaSerie({}, form({ id })), "Rutinen är avslutad.");
      case "koppla":
        return fran(await koppla({}, form({ id, slag: b.slag ?? "", mal: b.mal ?? "", visible_to_subject: b.synlig === true ? "ja" : "" })), "Kopplad.");
      case "koppla-bort":
        return fran(await taBortKoppling({}, form({ id, link_id: b.lank ?? "" })), "Borttagen.");
      case "mall":
        return fran(await anvandUppgiftsmall({}, form({ template_id: b.mall ?? "", start_date: b.dag ?? idag })), "Mallen är lagd som uppgifter.");
      case "genomgang": {
        const s = await slutforGenomgang({}, new FormData());
        return s.fel ? svar({ fel: s.fel }, 400) : svar({ ok: "Veckogenomgången är gjord." });
      }

      case "fokus": {
        // Dagens tre: högst tre, i ordning. Bara uppgifter den inloggade ser.
        const ids = Array.isArray(b.ids) ? [...new Set((b.ids as string[]).filter((x) => UUID.test(String(x))))].slice(0, 3) : [];
        if (ids.length) {
          const { data: synliga } = await (await supabaseServer()).from("task").select("id").in("id", ids);
          if ((synliga ?? []).length !== ids.length) return svar({ fel: "En av uppgifterna finns inte." }, 404);
        }
        await db.from("task_focus").delete().eq("employee_id", mig).eq("dag", idag);
        if (ids.length) await db.from("task_focus").insert(ids.map((t, i) => ({ employee_id: mig, dag: idag, position: i + 1, task_id: t })));
        return svar({ ok: ids.length ? "Dagens tre är sparade." : "Dagens tre är tömda." });
      }
      case "dag": {
        const vad = String(b.vad ?? "");
        if (vad !== "planera" && vad !== "avsluta" && vad !== "oppna") return svar({ fel: "Okänd handling." }, 400);
        const nu = new Date().toISOString();
        if (vad === "oppna") {
          await db.from("task_day").update({ closed_at: null }).eq("employee_id", mig).eq("dag", idag).not("planned_at", "is", null);
          return svar({ ok: "Dagen är öppen igen." });
        }
        const { data: finns } = await db.from("task_day").select("dag").eq("employee_id", mig).eq("dag", idag).maybeSingle();
        if (finns) await db.from("task_day").update(vad === "planera" ? { planned_at: nu } : { closed_at: nu }).eq("employee_id", mig).eq("dag", idag);
        else await db.from("task_day").insert({ employee_id: mig, dag: idag, ...(vad === "planera" ? { planned_at: nu } : { closed_at: nu }) });
        return svar({ ok: vad === "planera" ? "Dagen är planerad." : "Dagen är avslutad. Ha en bra kväll." });
      }
      case "forsta-steg": {
        const u = await uppgiften(id);
        if (!u) return svar({ fel: "Uppgiften finns inte." }, 404);
        if (u.assignee_id !== mig && u.created_by !== mig) return svar({ fel: "Bara den som har uppgiften skriver första steget." }, 403);
        const text = String(b.text ?? "").trim().slice(0, 200);
        await db.from("task").update({ next_step: text || null, updated_at: new Date().toISOString() }).eq("id", id);
        return svar({ ok: text ? "Första steget är sparat." : "Första steget är borttaget." });
      }
      case "paminn": {
        const ids = Array.isArray(b.ids) ? (b.ids as string[]) : [id];
        let n = 0;
        for (const tid of ids.slice(0, 50)) {
          const u = await uppgiften(String(tid));
          if (!u || !u.assignee_id || u.assignee_id === mig) continue;
          await db.from("task_event").insert({ task_id: u.id, type: "paminnelse", by_employee_id: mig, note: null });
          await notifiera({
            till: u.assignee_id,
            av: mig,
            kalla: "uppgift-paminnelse",
            typ: "uppgift",
            rubrik: `${fullName(user.employee)} påminner om ”${String(u.title).slice(0, 80)}”`,
            detalj: u.due_date ? `ska vara klar ${u.due_date}` : "",
            href: `/uppgifter/${u.id}`,
            objekt: { typ: "task", id: u.id },
          });
          n++;
        }
        revalidatePath("/uppgifter");
        return n ? svar({ ok: n === 1 ? "Påminnelsen är skickad." : `${n} påminnelser skickade.` }) : svar({ fel: "Det finns ingen att påminna." }, 400);
      }

      default:
        return svar({ fel: "Okänd handling." }, 400);
    }
  } catch (e) {
    return svar({ fel: e instanceof Error ? e.message : "Något gick fel." }, 500);
  }
}
