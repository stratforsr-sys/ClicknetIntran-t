"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { svensktDatum } from "@/lib/klocka";
import { manadFore, manadsnyckel } from "@/lib/provision";
import { konfigurationsfel, troskelIProcent, type KvKriterium, type KvPolicy } from "@/lib/kv";

export type KvReglerState = { fel?: string; ok?: string };

/**
 * E13 steg 5: K&V-reglerna som konfiguration.
 *
 * Saljchef och VD, samma krets som volymtrappan. Ekonomi ser men andrar inte
 * (avsnitt 2).
 */
async function kravRegelagare() {
  const user = await getCurrentUser();
  if (!hasRole(user, "sales_manager", "ceo") || !user?.employee) {
    throw new Error("Bara saljchef och VD far andra K&V-reglerna.");
  }
  return user;
}

const VERKAN = ["denna_manad", "nu", "nasta_manad"] as const;
type Verkan = (typeof VERKAN)[number];

/** Samma tre val som volymtrappan (avsnitt 8.1). Se `regler/actions.ts` i provisionen. */
function galleFran(verkan: Verkan): string {
  const idag = svensktDatum(new Date());
  switch (verkan) {
    case "denna_manad":
      return manadsnyckel(idag);
    case "nu":
      return idag;
    case "nasta_manad":
      return manadFore(manadsnyckel(idag), -1);
  }
}

function tolkaVerkan(form: FormData): Verkan | null {
  const v = String(form.get("verkan") ?? "");
  return (VERKAN as readonly string[]).includes(v) ? (v as Verkan) : null;
}

function tal(form: FormData, falt: string): number | null {
  const t = String(form.get(falt) ?? "").trim().replace(/[\s ]/g, "").replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * Satter maxpoangen for ett omrade.
 *
 * ===========================================================================
 * DET AR HAR O4 LANDAR.
 *
 * Bestallaren svarade "200" pa fragan om poangskalan, och samma svar betydde
 * maxpoang 200, 400 eller 2 400 beroende pa lasning — alltsa troskeln 160 som
 * 80 %, 40 % eller 6,7 %. Svaret 2026-08-25 var 200 TOTALT for bada samtalen.
 *
 * Fordelningen pa de sex omradena ar daremot inte sagd, och den ska inte
 * gissas: "korrekt avtalshantering" och "behovsanalys" vager rimligen olika.
 * Sidan visar darfor lopande vad troskeln motsvarar i procent, sa att en skala
 * som gor troskeln meningslos eller omojlig syns INNAN den sparas.
 * ===========================================================================
 */
export async function sparaOmrade(_prev: KvReglerState, form: FormData): Promise<KvReglerState> {
  try {
    const user = await kravRegelagare();

    const id = String(form.get("criterion_id") ?? "").trim();
    const max = tal(form, "max_points");

    if (!id) return { fel: "Omradet saknas." };
    if (max === null || max <= 0) return { fel: "Maxpoängen ska vara ett tal större än noll." };

    const db = supabaseAdmin();
    const { error } = await db
      .from("kv_criterion")
      .update({ max_points: max, set_by: user.employee!.id, set_at: new Date().toISOString() })
      .eq("id", id);

    if (error) return { fel: `Maxpoängen sparades inte: ${error.message}` };

    await db.from("audit_log").insert({
      actor_id: user.employee!.id,
      action: "kv_criterion.set",
      object_type: "kv_criterion",
      object_id: id,
      meta: { max_points: max },
    });

    revalidatePath("/kv/regler");
    revalidatePath("/kv");

    return { ok: await beskrivLaget(`Maxpoängen är satt till ${max}.`) };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Nagot gick fel." };
  }
}

/**
 * Andrar reglerna: antal samtal, troskel, procent per vecka och tak.
 *
 * Versioneringen ar samma som volymtrappans — en ny rad, aldrig en uppdatering
 * pa plats, och den gamla far ett `valid_to`. En rad som aldrig hann galla ar
 * inte historik utan ett skrivfel och tas bort.
 */
export async function sparaRegler(_prev: KvReglerState, form: FormData): Promise<KvReglerState> {
  try {
    const user = await kravRegelagare();

    const samtal = tal(form, "calls_per_week");
    const troskel = tal(form, "threshold_points");
    const procent = tal(form, "percent_per_week");
    const tak = tal(form, "cap_percent");
    const verkan = tolkaVerkan(form);

    if (samtal === null || !Number.isInteger(samtal) || samtal < 1) {
      return { fel: "Antal samtal per vecka ska vara ett heltal större än noll." };
    }
    if (troskel === null || troskel < 0) return { fel: "Tröskeln gick inte att tolka." };
    if (procent === null || procent < 0) return { fel: "Procentsatsen gick inte att tolka." };
    if (tak === null || tak < 0) return { fel: "Taket gick inte att tolka." };
    if (!verkan) return { fel: "Välj från när ändringen ska gälla." };

    // Ett tak lagre an en enda veckas procent gor att ingen vecka nagonsin ger
    // nagot. Villkoret star ocksa i 0036; den har raden ger ett begripligt svar.
    if (tak < procent) {
      return { fel: `Taket ${tak} % är lägre än en enda veckas ${procent} %. Då ger ingen vecka något.` };
    }

    const db = supabaseAdmin();
    const franDatum = galleFran(verkan);

    const { data: gammal } = await db
      .from("kv_policy")
      .select("id, valid_from")
      .is("valid_to", null)
      .maybeSingle();

    if (gammal) {
      if (gammal.valid_from > franDatum) {
        return { fel: "En senare ändring ligger redan inne." };
      }

      const { error } =
        gammal.valid_from === franDatum
          ? await db.from("kv_policy").delete().eq("id", gammal.id)
          : await db.from("kv_policy").update({ valid_to: franDatum }).eq("id", gammal.id);

      if (error) return { fel: `Den gamla raden gick inte att stänga: ${error.message}` };
    }

    const { data: ny, error } = await db
      .from("kv_policy")
      .insert({
        calls_per_week: samtal,
        threshold_points: troskel,
        percent_per_week: procent,
        cap_percent: tak,
        valid_from: franDatum,
        set_by: user.employee!.id,
      })
      .select("id")
      .single();

    if (error || !ny) return { fel: `Reglerna sparades inte: ${error?.message ?? "okant fel"}` };

    await db.from("audit_log").insert({
      actor_id: user.employee!.id,
      action: "kv_policy.set",
      object_type: "kv_policy",
      object_id: ny.id,
      meta: { calls_per_week: samtal, threshold_points: troskel, percent_per_week: procent, cap_percent: tak, valid_from: franDatum },
    });

    revalidatePath("/kv/regler");
    revalidatePath("/kv");
    revalidatePath("/provision");

    return { ok: await beskrivLaget(`Reglerna gäller från ${franDatum}.`) };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Nagot gick fel." };
  }
}

/**
 * Lagger till kvittot vad troskeln nu motsvarar i procent, eller vad som
 * fortfarande fattas.
 *
 * Meddelandet ar halva poangen med sidan: den som andrar en maxpoang ska se
 * direkt vad det gjorde med troskeln, inte upptacka det nasta gang nagon
 * undrar varfor alla veckor blir godkanda.
 */
async function beskrivLaget(inledning: string): Promise<string> {
  const db = supabaseAdmin();

  const [{ data: k }, { data: p }] = await Promise.all([
    db.from("kv_criterion").select("id, label, max_points, sort, active").order("sort"),
    db.from("kv_policy").select("*").is("valid_to", null).maybeSingle(),
  ]);

  if (!p) return inledning;

  const kriterier = (k ?? []).map((r) => ({
    ...r,
    max_points: r.max_points === null ? null : Number(r.max_points),
  })) as KvKriterium[];

  const policy = {
    ...p,
    threshold_points: Number(p.threshold_points),
    percent_per_week: Number(p.percent_per_week),
    cap_percent: Number(p.cap_percent),
  } as KvPolicy;

  const fel = konfigurationsfel(kriterier, policy);
  if (fel) return `${inledning} ${fel}`;

  const procent = troskelIProcent(kriterier, policy);
  if (procent === null) return inledning;

  return `${inledning} Tröskeln ${policy.threshold_points} poäng motsvarar nu ${
    Math.round(procent * 10) / 10
  } % av maxpoängen.`;
}
