import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { fullName, getCurrentUser } from "@/lib/auth";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { svensktDatum } from "@/lib/klocka";
import { notifiera } from "@/lib/notishandelse-server";
import {
  andraUppgift,
  ateroppna,
  avbryt,
  bjudIn,
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
import { anvandUppgiftsmall } from "@/app/(app)/uppgifter/mallar/actions";
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
