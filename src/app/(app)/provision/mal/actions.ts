"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { kronor, manadsnamn, manadsnyckel, tolkaBelopp } from "@/lib/provision";
import { notifiera } from "@/lib/notishandelse-server";

export type MalState = { fel?: string; ok?: string };

/**
 * E13 steg 10: manadsmalet per saljare (0049).
 *
 * ===========================================================================
 * KRETSEN AR SALJCHEF OCH VD — SAMMA SOM FOR REGLERNA, INTE SAMMA SOM FOR
 * BOKFORINGEN.
 *
 * `bokforProvision` slapper in ekonomi och VD: de knappar in UTFALL.
 * Den har filen slapper in saljchef och VD: de satter FORVANTAN.
 *
 * Gransen ar bestallarens fran 2026-08-24 och star i avsnitt 2 i
 * PROVISION_SPEC.md — *"den som satter malen ska inte ocksa vara den som knappar
 * in utfallet"*. Den som gor bada kan flytta ribban till dar bollen landade.
 *
 * Kontrollen star bade har och i RLS-policyn i 0049, med olika uppgifter. Den
 * har hindrar SKRIVNINGEN, som sker med service role och gar forbi RLS; policyn
 * hindrar LASNINGEN.
 * ===========================================================================
 */
async function kravMalsattare() {
  const user = await getCurrentUser();
  if (!hasRole(user, "sales_manager", "ceo") || !user?.employee) {
    throw new Error("Bara saljchef och VD far satta manadsmal.");
  }
  return user;
}

/**
 * Ar manaden giltig for ETT MAL?
 *
 * ===========================================================================
 * REGELN AR SPEGELVAND MOT `giltigManad` I `provision.ts`, OCH DET AR HELA
 * SKILLNADEN MELLAN ETT UTFALL OCH EN FORVANTAN.
 *
 * `giltigManad` nekar FRAMTIDA manader: en provisionspost i september som
 * bokfors i augusti ar inte en intjaning utan en prognos.
 *
 * Ett MAL ar en prognos. Att satta nasta manads mal den 25:e ar inte bara
 * tillatet, det ar det normala — malet ska finnas nar manaden borjar, annars
 * ar den forsta veckan omatt.
 *
 * DAREMOT NEKAS FORFLUTNA MANADER, och det ar den viktiga halvan. Ett mal som
 * gar att satta i efterhand ar inget mal: den som ser utfallet forst och
 * ribban sedan kan alltid skriva "i takt". Gransen gar vid innevarande manad,
 * som pagar och darfor fortfarande gar att styra.
 *
 * Taket ar tolv manader framat. Inte for att nagot gar sonder efter det, utan
 * for att ett mal for 2029 ar ett skrivfel.
 * ===========================================================================
 */
function giltigMalmanad(nyckel: string, nu: Date | string = new Date()): boolean {
  if (!/^\d{4}-\d{2}-01$/.test(nyckel)) return false;
  const manad = Number(nyckel.slice(5, 7));
  if (manad < 1 || manad > 12) return false;

  const denna = manadsnyckel(nu);
  if (nyckel < denna) return false;

  const ar = Number(denna.slice(0, 4));
  const m = Number(denna.slice(5, 7));
  const totalt = ar * 12 + (m - 1) + 12;
  const tak = `${Math.floor(totalt / 12)}-${String((totalt % 12) + 1).padStart(2, "0")}-01`;
  return nyckel <= tak;
}

/**
 * Satter eller andrar ett mal.
 *
 * RADEN UPPDATERAS PA PLATS. Se rubriken i 0049 for varfor maltabellen inte ar
 * append-only som huvudboken: ett mal ar ett forsok att styra en manad som
 * pagar, och att andra det mitt i ar en normal chefshandling.
 *
 * SPARET LIGGER I `audit_log`, och det ar darfor det gamla vardet lases forst.
 * Utan `fore` sager loggen bara att nagon satte ett mal — inte att nagon sankte
 * det fran tjugo till tio den 28:e, vilket ar den enda fragan nagon kommer att
 * stalla i efterhand.
 */
export async function sparaMal(_prev: MalState, form: FormData): Promise<MalState> {
  try {
    const user = await kravMalsattare();

    const employeeId = String(form.get("employee_id") ?? "").trim();
    const manad = String(form.get("period_month") ?? "").trim();
    const orderText = String(form.get("target_orders") ?? "").trim();
    const kronText = String(form.get("target_amount") ?? "").trim();
    const note = String(form.get("note") ?? "").trim() || null;

    if (!employeeId) return { fel: "Valj vem malet galler." };
    if (!giltigMalmanad(manad)) {
      return { fel: "Malet maste galla innevarande manad eller en manad framat." };
    }

    let malOrder: number | null = null;
    if (orderText) {
      const n = Number(orderText);
      if (!Number.isInteger(n) || n <= 0) {
        return { fel: "Ordermalet ska vara ett heltal storre an noll." };
      }
      malOrder = n;
    }

    let malKronor: number | null = null;
    if (kronText) {
      const n = tolkaBelopp(kronText);
      if (n === null) return { fel: "Kronmalet gick inte att tolka. Skriv till exempel 40 000." };
      if (n <= 0) return { fel: "Kronmalet ska vara storre an noll." };
      malKronor = n;
    }

    const db = supabaseAdmin();

    const { data: fore } = await db
      .from("sales_target")
      .select("id, target_orders, target_amount")
      .eq("employee_id", employeeId)
      .eq("period_month", manad)
      .maybeSingle();

    // BADA FALTEN TOMMA BETYDER "TA BORT MALET", inte "spara ett tomt mal".
    // Villkoret `sales_target_minst_ett` i 0049 hade nekat raden anda; att
    // tolka det som en radering i stallet for som ett formularfel ar det som
    // gor att man kan angra sig utan att leta efter en egen knapp.
    if (malOrder === null && malKronor === null) {
      if (!fore) return { fel: "Fyll i minst ett av malen." };
      return taBort(employeeId, manad, user.employee!.id, fore);
    }

    const { error } = await db.from("sales_target").upsert(
      {
        employee_id: employeeId,
        period_month: manad,
        target_orders: malOrder,
        target_amount: malKronor,
        note,
        set_by: user.employee!.id,
        set_at: new Date().toISOString(),
      },
      { onConflict: "employee_id,period_month" },
    );

    if (error) return { fel: `Malet sparades inte: ${error.message}` };

    // K12/AC-12.1: varje skrivning om en person lamnar ett spar. BADE fore och
    // efter star med — en logg som bara sager "nagon satte ett mal" gar inte att
    // granska, och det ar just andringen nagon kommer att fraga om.
    await supabaseAdmin()
      .from("audit_log")
      .insert({
        actor_id: user.employee!.id,
        action: "sales_target.set",
        object_type: "sales_target",
        object_id: fore?.id ?? null,
        meta: {
          employee_id: employeeId,
          period_month: manad,
          fore: fore
            ? { orders: fore.target_orders, amount: fore.target_amount }
            : null,
          efter: { orders: malOrder, amount: malKronor },
        },
      });

    // NOTISEN GAR TILL DEN MALET GALLER, aldrig till chefen sjalv — regeln
    // ligger i `notifiera()` och inte har.
    //
    // Ett mal ar en av de fa installningar som SKA notifiera. Regelandringar
    // (trappan, konsekvenstrappan, franvaropolicyn) gor det medvetet inte
    // (beslut 2026-09-04, star i /logg): de galler alla och star i vyn. Ett
    // manadsmal galler EN person, star inte nagon annanstans, och den som inte
    // vet om sitt mal kan inte styra mot det.
    await notifiera({
      till: employeeId,
      av: user.employee!.id,
      kalla: "provision-mal",
      typ: "provision",
      rubrik: fore
        ? `Ditt mål för ${manadsnamn(manad)} har ändrats`
        : `Du har fått ett mål för ${manadsnamn(manad)}`,
      detalj: beskrivMal(malOrder, malKronor),
      href: "/provision",
      objekt: { typ: "sales_target", id: employeeId },
    });

    revalidatePath("/provision");
    revalidatePath("/provision/mal");

    return {
      ok: `${manadsnamn(manad)}: ${beskrivMal(malOrder, malKronor)}.`,
    };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Nagot gick fel." };
  }
}

/**
 * Tar bort ett mal.
 *
 * RADERING OCH INTE EN NOLLA. Ett mal pa noll order ar uppfyllt fran forsta
 * sekunden och skulle sta som "i takt" hela manaden — alltsa varre an inget
 * mal, for det ser ut som en matning.
 */
export async function taBortMal(_prev: MalState, form: FormData): Promise<MalState> {
  try {
    const user = await kravMalsattare();

    const employeeId = String(form.get("employee_id") ?? "").trim();
    const manad = String(form.get("period_month") ?? "").trim();

    if (!employeeId || !giltigMalmanad(manad)) return { fel: "Malet gick inte att hitta." };

    const { data: fore } = await supabaseAdmin()
      .from("sales_target")
      .select("id, target_orders, target_amount")
      .eq("employee_id", employeeId)
      .eq("period_month", manad)
      .maybeSingle();

    if (!fore) return { fel: "Det finns inget mal att ta bort." };

    return taBort(employeeId, manad, user.employee!.id, fore);
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Nagot gick fel." };
  }
}

/** Delad av `taBortMal` och av `sparaMal` med bada falten tomma. */
async function taBort(
  employeeId: string,
  manad: string,
  aktor: string,
  fore: { id: string; target_orders: number | null; target_amount: number | null },
): Promise<MalState> {
  const db = supabaseAdmin();

  const { error } = await db
    .from("sales_target")
    .delete()
    .eq("employee_id", employeeId)
    .eq("period_month", manad);

  if (error) return { fel: `Malet togs inte bort: ${error.message}` };

  await db.from("audit_log").insert({
    actor_id: aktor,
    action: "sales_target.removed",
    object_type: "sales_target",
    object_id: fore.id,
    meta: {
      employee_id: employeeId,
      period_month: manad,
      fore: { orders: fore.target_orders, amount: fore.target_amount },
    },
  });

  await notifiera({
    till: employeeId,
    av: aktor,
    kalla: "provision-mal",
    typ: "provision",
    rubrik: `Ditt mål för ${manadsnamn(manad)} är borttaget`,
    detalj: "Takten i provisionsvyn räknas fortfarande, men utan något mål att ställas mot.",
    href: "/provision",
    objekt: { typ: "sales_target", id: employeeId },
  });

  revalidatePath("/provision");
  revalidatePath("/provision/mal");

  return { ok: `Malet for ${manadsnamn(manad)} ar borttaget.` };
}

/** Malet i en mening. Samma text i kvittot som i notisen — ett mal, ett ord. */
function beskrivMal(order: number | null, belopp: number | null): string {
  const delar: string[] = [];
  if (order !== null) delar.push(`${order} order`);
  if (belopp !== null) delar.push(kronor(belopp));
  return delar.join(" och ");
}

/**
 * FILEN EXPORTERAR TVA SAKER, OCH INGEN AV DEM AR EN HJALPARE.
 *
 * Allt som exporteras ur en `"use server"`-fil blir en publik andpunkt som gar
 * att anropa utifran. Det har gatt fel tre ganger i det har repot — `skrivFel`,
 * `sattKvitto` och `registreraVisning`. `giltigMalmanad`, `taBort` och
 * `beskrivMal` star darfor oexporterade, och behovs de fran en vy hor de hemma
 * i `src/lib/saljtakt.ts`.
 */
