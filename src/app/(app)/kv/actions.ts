"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { svensktDatum } from "@/lib/klocka";

export type KvState = { fel?: string; ok?: string };

/**
 * E13 steg 5: K&V-samtal och bedomningar.
 *
 * SALJCHEF OCH VD BEDOMER. Det ar saljchefen som lyssnar pa samtalen; VD star
 * med av samma skal som overallt annars i navet, sa att modulen inte laser sig
 * nar en person ar borta. Ekonomi SER bedomningarna men satter dem inte.
 *
 * Kontrollen star bade har och i `far_bedoma_kv()` i 0036, med olika uppgifter:
 * funktionen styr lasningen, den har raden styr skrivningen. Skrivningen sker
 * med service role och gar forbi RLS, sa det ar den enda sparren som finns.
 */
async function kravBedomare() {
  const user = await getCurrentUser();
  if (!hasRole(user, "sales_manager", "ceo") || !user?.employee) {
    throw new Error("Bara saljchef och VD far registrera och bedoma K&V-samtal.");
  }
  return user;
}

/**
 * Registrerar ett samtal for bedomning.
 *
 * Urvalet sker UTANFOR navet tills dialer-API:t finns (steg 8). Chefen valjer
 * samtalet, navet bar bara vem, nar och vilken kund.
 */
export async function registreraSamtal(_prev: KvState, form: FormData): Promise<KvState> {
  try {
    const user = await kravBedomare();

    const employeeId = String(form.get("employee_id") ?? "").trim();
    const datum = String(form.get("call_date") ?? "").trim();
    const kund = String(form.get("customer") ?? "").trim();

    if (!employeeId) return { fel: "Valj vilken saljare samtalet galler." };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(datum)) return { fel: "Datumet ar inte giltigt." };

    // Framtida samtal nekas av samma skal som framtida signering nekas i
    // ordern: ett samtal som inte agt rum ar inte ett underlag utan en plan.
    if (datum > svensktDatum(new Date())) {
      return { fel: "Samtalet kan inte ligga i framtiden." };
    }
    if (!kund) return { fel: "Skriv vilken kund samtalet gallde." };

    const { data: rad, error } = await supabaseAdmin()
      .from("kv_call")
      .insert({
        employee_id: employeeId,
        call_date: datum,
        customer: kund,
        source: "manual",
        created_by: user.employee!.id,
      })
      .select("id")
      .single();

    if (error || !rad) return { fel: `Samtalet sparades inte: ${error?.message ?? "okant fel"}` };

    await supabaseAdmin().from("audit_log").insert({
      actor_id: user.employee!.id,
      action: "kv_call.created",
      object_type: "kv_call",
      object_id: rad.id,
      meta: { employee_id: employeeId, call_date: datum },
    });

    revalidatePath("/kv");
    return { ok: `Samtalet ${datum} är registrerat och väntar på bedömning.` };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Nagot gick fel." };
  }
}

/**
 * Sparar eller andrar en bedomning.
 *
 * ===========================================================================
 * EN BEDOMNING FAR ANDRAS I EFTERHAND (fraga 35), och det ar en avsiktlig
 * skillnad mot huvudboken, som ar append-only.
 *
 * Skalet: en bokford krona ar en handelse som intraffat, medan en bedomning ar
 * en manniskas omdome. Ett omdome som visar sig fel ska ga att rata, annars
 * blir chefen forsiktig med att skriva nagot alls — och da tappar protokollet
 * det som gor det till ett utvecklingsprotokoll.
 *
 * Andringen loggas i `audit_log` med bade det gamla och det nya talet. Ar
 * PERIODEN redan stangd andras ingen utbetalning: den delen ar bokford i
 * `commission_entry` och rattas i sa fall med en negativ post.
 * ===========================================================================
 */
export async function sparaBedomning(_prev: KvState, form: FormData): Promise<KvState> {
  try {
    const user = await kravBedomare();
    const db = supabaseAdmin();

    const callId = String(form.get("call_id") ?? "").trim();
    if (!callId) return { fel: "Samtalet saknas." };

    const { data: samtal } = await db
      .from("kv_call")
      .select("id, call_date")
      .eq("id", callId)
      .maybeSingle();

    if (!samtal) return { fel: "Samtalet finns inte." };

    const { data: kriterier } = await db
      .from("kv_criterion")
      .select("id, label, max_points, active")
      .eq("active", true)
      .order("sort");

    const aktiva = kriterier ?? [];
    if (aktiva.length === 0) return { fel: "Inga områden är aktiva. Fyll i K&V-inställningarna." };

    const utanTak = aktiva.filter((k) => k.max_points === null);
    if (utanTak.length > 0) {
      return {
        fel: `Maxpoäng saknas för ${utanTak.map((k) => k.label).join(", ")}. Fyll i K&V-inställningarna först.`,
      };
    }

    // Poangen lases och kontrolleras HAR ocksa, inte bara i triggern. Triggern
    // ar det som galler, men ett felmeddelande som namner omradet ar battre an
    // ett databasfel som namner ett uuid.
    const poang: { criterion_id: string; points: number; note: string | null }[] = [];
    for (const k of aktiva) {
      const ratext = String(form.get(`points_${k.id}`) ?? "").trim().replace(",", ".");
      if (ratext === "") return { fel: `Sätt en poäng för ${k.label}.` };

      const tal = Number(ratext);
      if (!Number.isFinite(tal) || tal < 0) return { fel: `Poängen för ${k.label} går inte att tolka.` };

      const tak = Number(k.max_points);
      if (tal > tak) return { fel: `${k.label} kan ge högst ${tak} poäng.` };

      poang.push({
        criterion_id: k.id,
        points: tal,
        note: String(form.get(`note_${k.id}`) ?? "").trim() || null,
      });
    }

    const kommentar = String(form.get("comment") ?? "").trim() || null;

    const { data: fanns } = await db
      .from("kv_assessment")
      .select("call_id")
      .eq("call_id", callId)
      .maybeSingle();

    const gamla = fanns
      ? ((await db.from("kv_score").select("criterion_id, points").eq("call_id", callId)).data ?? [])
      : [];

    if (fanns) {
      const { error } = await db
        .from("kv_assessment")
        .update({ comment: kommentar, updated_by: user.employee!.id, updated_at: new Date().toISOString() })
        .eq("call_id", callId);
      if (error) return { fel: `Bedömningen sparades inte: ${error.message}` };
    } else {
      const { error } = await db.from("kv_assessment").insert({
        call_id: callId,
        assessed_by: user.employee!.id,
        comment: kommentar,
      });
      if (error) return { fel: `Bedömningen sparades inte: ${error.message}` };
    }

    // Poangraderna skrivs om i sin helhet. Ett omrade som tagits bort ur
    // konfigurationen ska inte ligga kvar och rakna med i summan.
    await db.from("kv_score").delete().eq("call_id", callId);

    const { error: poangfel } = await db
      .from("kv_score")
      .insert(poang.map((p) => ({ call_id: callId, ...p })));

    if (poangfel) return { fel: `Poängen sparades inte: ${poangfel.message}` };

    const summa = poang.reduce((s, p) => s + p.points, 0);

    await db.from("audit_log").insert({
      actor_id: user.employee!.id,
      action: fanns ? "kv_assessment.updated" : "kv_assessment.created",
      object_type: "kv_assessment",
      object_id: callId,
      meta: {
        call_date: samtal.call_date,
        summa,
        // Det gamla talet star med. En logg som bara sager att nagot andrades
        // gar inte att granska.
        tidigare: fanns ? gamla.reduce((s, g) => s + Number(g.points), 0) : null,
      },
    });

    revalidatePath("/kv");
    revalidatePath(`/kv/${callId}`);
    revalidatePath("/provision");

    return { ok: `Bedömningen är sparad. ${summa} poäng.` };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Nagot gick fel." };
  }
}
