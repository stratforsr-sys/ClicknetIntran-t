"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { giltigManad, kronor, tolkaBelopp } from "@/lib/provision";

export type ProvisionState = { fel?: string; ok?: string };

/**
 * E13.1. Vem som far bokfora intjanad provision.
 *
 * Ekonomi och VD, och ingen annan. Bestallarens besked i passet 2026-08-23 var
 * "manuell inmatning av ekonomi/VD". Saljchefen star medvetet utanfor: den som
 * satter malen ska inte ocksa vara den som knappar in utfallet.
 *
 * Kontrollen star bade har och i RLS-policyn i 0031, med olika uppgifter. Den
 * har hindrar skrivningen; policyn hindrar lasningen. Skrivningen sker med
 * service role och gar forbi RLS, sa den har raden ar det enda som star mellan
 * en saljare och nagon annans provision.
 */
async function kravBokforare() {
  const user = await getCurrentUser();
  if (!hasRole(user, "finance", "ceo") || !user?.employee) {
    throw new Error("Bara ekonomi och VD far bokfora provision.");
  }
  return user;
}

/**
 * Bokfor en post. Rattelse gors som en NEGATIV post — tabellen ar append-only
 * och triggern i 0031 nekar bade update och delete.
 */
export async function bokforProvision(
  _prev: ProvisionState,
  form: FormData,
): Promise<ProvisionState> {
  try {
    const user = await kravBokforare();

    const employeeId = String(form.get("employee_id") ?? "").trim();
    const manad = String(form.get("period_month") ?? "").trim();
    const beloppText = String(form.get("amount") ?? "").trim();
    const affarerText = String(form.get("deals") ?? "").trim();
    const note = String(form.get("note") ?? "").trim() || null;

    if (!employeeId) return { fel: "Valj vem posten galler." };
    if (!giltigManad(manad)) {
      return { fel: "Manaden ar inte giltig, eller ligger i framtiden." };
    }

    const belopp = tolkaBelopp(beloppText);
    if (belopp === null) return { fel: "Beloppet gick inte att tolka. Skriv till exempel 12 400." };
    if (belopp === 0) return { fel: "En post pa noll kronor sager ingenting. Lat bli i stallet." };

    let affarer: number | null = null;
    if (affarerText) {
      const n = Number(affarerText);
      if (!Number.isInteger(n) || n < 0) return { fel: "Antal affarer ska vara ett heltal." };
      affarer = n;
    }

    const { data: rad, error } = await supabaseAdmin()
      .from("commission_entry")
      .insert({
        employee_id: employeeId,
        period_month: manad,
        amount: belopp,
        deals: affarer,
        source: "manual",
        note,
        entered_by: user.employee!.id,
      })
      .select("id")
      .single();

    if (error || !rad) return { fel: `Posten sparades inte: ${error?.message ?? "okant fel"}` };

    // K12/AC-12.1: varje skrivning om en person lamnar ett spar. Beloppet star
    // med — en logg som bara sager "nagon bokforde nagot" gar inte att granska.
    await supabaseAdmin().from("audit_log").insert({
      actor_id: user.employee!.id,
      action: "commission.entered",
      object_type: "commission_entry",
      object_id: rad.id,
      meta: { employee_id: employeeId, period_month: manad, amount: belopp, deals: affarer },
    });

    revalidatePath("/provision");
    revalidatePath("/");
    return {
      ok:
        belopp < 0
          ? `Rattelse pa ${kronor(belopp)} bokford.`
          : `${kronor(belopp)} bokfort pa ${manad.slice(0, 7)}.`,
    };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Nagot gick fel." };
  }
}

/**
 * FILEN EXPORTERAR EN ENDA SAK, OCH DET AR MED FLIT.
 *
 * Allt som exporteras ur en `"use server"`-fil blir en publik andpunkt som gar
 * att anropa utifran. Sakerhetsgenomgangen 2026-08-23 hittade en hjalpare som
 * publicerats sa av misstag (`sattKvitto`). Behovs en uträkning i vyn: lagg den
 * i `src/lib/provision.ts` och anropa den fran server-komponenten.
 */
