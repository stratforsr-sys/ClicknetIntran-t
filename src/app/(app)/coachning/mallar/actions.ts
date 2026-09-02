"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import {
  MALLTYP_KRAVER_SLUG,
  laggTill,
  tolkaMall,
  type Mallrad,
  type Uppgiftstyp,
} from "@/lib/coachning";
import { arChefFor, farCoacha } from "@/lib/coachning-server";

export type MallState = { fel?: string; ok?: string };

async function kravCoach() {
  const user = await getCurrentUser();
  if (!user?.employee || !farCoacha(user)) {
    throw new Error("Bara teamledare, säljchef och VD hanterar coachningsmallar.");
  }
  return user;
}

function text(form: FormData, namn: string): string {
  return String(form.get(namn) ?? "").trim();
}

/**
 * Slar upp slugarna EN gang for hela mallen.
 *
 * Slugen kontrolleras nar mallen SPARAS, inte nar den tillamps. Ett stavfel ska
 * fangas av den som skriver mallen, inte av den som ett halvar senare tillamper
 * den pa en ny anstalld och far halva rampplanen.
 */
async function slaUppKallor(rader: Mallrad[]): Promise<{ karta: Map<string, string>; fel: string | null }> {
  const db = supabaseAdmin();
  const karta = new Map<string, string>();

  const kursslugar = rader.filter((r) => r.kind === "kurs" && r.kalla_slug).map((r) => r.kalla_slug!);
  const dokslugar = rader.filter((r) => r.kind === "lasning" && r.kalla_slug).map((r) => r.kalla_slug!);

  const [{ data: kurser }, { data: dokument }] = await Promise.all([
    db.from("course").select("id, slug").in("slug", kursslugar),
    db.from("document").select("id, slug").in("slug", dokslugar),
  ]);

  for (const k of kurser ?? []) karta.set(`kurs:${k.slug}`, k.id);
  for (const d of dokument ?? []) karta.set(`lasning:${d.slug}`, d.id);

  for (const r of rader) {
    if (!MALLTYP_KRAVER_SLUG.includes(r.kind)) continue;
    if (!karta.has(`${r.kind}:${r.kalla_slug}`)) {
      return { karta, fel: `Rad ${r.sort}: hittar ingen ${r.kind === "kurs" ? "kurs" : "publicerat dokument"} med slugen "${r.kalla_slug}".` };
    }
  }

  return { karta, fel: null };
}

export async function skapaMall(_prev: MallState, form: FormData): Promise<MallState> {
  try {
    const user = await kravCoach();
    const db = supabaseAdmin();

    const namn = text(form, "name");
    if (!namn) return { fel: "Ge mallen ett namn." };

    const { rader, fel } = tolkaMall(text(form, "moment"));
    if (fel) return { fel };
    if (rader.length === 0) return { fel: "En mall behöver minst ett moment." };

    const { karta, fel: kallfel } = await slaUppKallor(rader);
    if (kallfel) return { fel: kallfel };

    // Fokusomradena slas upp pa etikett. En etikett som inte finns ar ett
    // stavfel och inte ett nytt omrade — omradena laggs upp for sig.
    const { data: fokus } = await db.from("coaching_focus").select("id, label").eq("active", true);
    const fokuskarta = new Map((fokus ?? []).map((f) => [f.label.toLowerCase(), f.id]));

    for (const r of rader) {
      for (const f of r.fokus) {
        if (!fokuskarta.has(f.toLowerCase())) {
          return { fel: `Rad ${r.sort}: "${f}" är inget fokusområde. Välj bland ${(fokus ?? []).map((x) => x.label).join(", ")}.` };
        }
      }
    }

    const { data: mall, error } = await db
      .from("coaching_template")
      .insert({
        name: namn,
        description_md: text(form, "description_md"),
        created_by: user.employee!.id,
      })
      .select("id")
      .single();

    if (error || !mall) return { fel: `Mallen sparades inte: ${error?.message ?? "okänt fel"}` };

    const { data: poster, error: postfel } = await db
      .from("coaching_template_item")
      .insert(
        rader.map((r) => ({
          template_id: mall.id,
          sort: r.sort,
          kind: r.kind,
          title: r.title,
          offset_days: r.offset_days,
          course_id: r.kind === "kurs" ? karta.get(`kurs:${r.kalla_slug}`) : null,
          document_id: r.kind === "lasning" ? karta.get(`lasning:${r.kalla_slug}`) : null,
        })),
      )
      .select("id, sort");

    if (postfel) return { fel: `Momenten sparades inte: ${postfel.message}` };

    const idPerSort = new Map((poster ?? []).map((p) => [p.sort, p.id]));
    const kopplingar = rader.flatMap((r) =>
      r.fokus.map((f) => ({ item_id: idPerSort.get(r.sort)!, focus_id: fokuskarta.get(f.toLowerCase())! })),
    );
    if (kopplingar.length > 0) await db.from("coaching_template_item_focus").insert(kopplingar);

    await db.from("audit_log").insert({
      actor_id: user.employee!.id,
      action: "coaching_template.created",
      object_type: "coaching_template",
      object_id: mall.id,
      meta: { name: namn, moment: rader.length },
    });

    revalidatePath("/coachning/mallar");
    return { ok: `Mallen "${namn}" är sparad med ${rader.length} moment.` };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

/**
 * Tillamper en mall pa en person.
 *
 * FRISTEN RAKNAS FRAN STARTDATUMET SOM ANGES, inte fran i dag. Samma rampplan
 * ska fungera for den som borjar i mars och den som borjar i november, och för
 * den som lades upp i efterhand tre veckor efter sin forsta dag.
 *
 * ALLA UPPGIFTER SKAPAS I EN INSERT. Faller den skapas ingen — en halv rampplan
 * ar varre an ingen, eftersom ingen kan se vilken halva som saknas.
 */
export async function tillampaMall(_prev: MallState, form: FormData): Promise<MallState> {
  try {
    const user = await kravCoach();
    const db = supabaseAdmin();

    const mallId = text(form, "template_id");
    const assignee = text(form, "assignee_id");
    const start = text(form, "start_date");

    if (!mallId) return { fel: "Välj en mall." };
    if (!assignee) return { fel: "Välj vem mallen gäller." };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return { fel: "Startdatumet är inte giltigt." };

    if (!(await arChefFor(user, assignee))) {
      return { fel: "Du kan bara lägga upp uppgifter för personer du är chef för." };
    }

    const [{ data: mall }, { data: poster }] = await Promise.all([
      db.from("coaching_template").select("id, name").eq("id", mallId).maybeSingle(),
      db
        .from("coaching_template_item")
        .select("id, sort, kind, title, description_md, verify_by, evidence, offset_days, course_id, document_id")
        .eq("template_id", mallId)
        .order("sort"),
    ]);

    if (!mall) return { fel: "Mallen finns inte." };
    if (!poster || poster.length === 0) return { fel: "Mallen har inga moment." };

    /**
     * ID:NA GENERERAS I FORVAG, och det ar inte en stilfraga.
     *
     * Forsta utkastet parade ihop de skapade uppgifterna med mallens moment
     * genom att lita pa att `.select()` efter en insert ger raderna i samma
     * ordning som de skickades. PostgREST lovar inte det. Hade ordningen kastats
     * om hade fokusomradena hamnat pa fel uppgift — tyst, och omojligt att se i
     * granssnittet.
     *
     * Med ett eget uuid per moment ar kopplingen exakt oavsett vad databasen
     * lamnar tillbaka.
     */
    const idPerMoment = new Map(poster.map((p) => [p.id, crypto.randomUUID()]));

    const { data: skapade, error } = await db
      .from("coaching_task")
      .insert(
        poster.map((p) => ({
          id: idPerMoment.get(p.id)!,
          title: p.title,
          description_md: p.description_md ?? "",
          kind: p.kind as Uppgiftstyp,
          assignee_id: assignee,
          created_by: user.employee!.id,
          verify_by: p.verify_by ?? "sjalv",
          evidence: p.evidence ?? "ingen",
          course_id: p.course_id,
          document_id: p.document_id,
          starts_on: start,
          due_date: laggTill(start, p.offset_days),
          template_id: mallId,
        })),
      )
      .select("id, title");

    if (error || !skapade) return { fel: `Uppgifterna skapades inte: ${error?.message ?? "okänt fel"}` };

    // Fokusomradena foljer med fran mallen.
    const { data: mallfokus } = await db
      .from("coaching_template_item_focus")
      .select("item_id, focus_id")
      .in("item_id", poster.map((p) => p.id));

    if (mallfokus && mallfokus.length > 0) {
      const kopplingar = mallfokus
        .map((f) => ({ task_id: idPerMoment.get(f.item_id), focus_id: f.focus_id }))
        .filter((k): k is { task_id: string; focus_id: string } => Boolean(k.task_id));
      if (kopplingar.length > 0) await db.from("coaching_task_focus").insert(kopplingar);
    }

    await db.from("coaching_task_event").insert(
      skapade.map((s) => ({ task_id: s.id, type: "tilldelad", by_employee_id: user.employee!.id })),
    );

    await db.from("audit_log").insert({
      actor_id: user.employee!.id,
      action: "coaching_template.applied",
      object_type: "coaching_template",
      object_id: mallId,
      meta: { assignee_id: assignee, start_date: start, uppgifter: skapade.length },
    });

    revalidatePath("/coachning");
    revalidatePath(`/coachning/${assignee}`);
    return { ok: `${skapade.length} uppgifter upplagda från "${mall.name}".` };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}
