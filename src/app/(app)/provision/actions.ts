"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { giltigManad, kronor, tolkaBelopp } from "@/lib/provision";
import { notifiera } from "@/lib/notishandelse-server";

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
 * Vem som far lagga en OVRIG BONUS.
 *
 * ===========================================================================
 * BREDARE KRETS AN `kravBokforare`, OCH SKILLNADEN AR AVSIKTLIG.
 *
 * Raden ovan speglar bestallarens besked 2026-08-23: *"manuell inmatning av
 * ekonomi/VD"*, med skalet att den som satter malen inte ocksa ska knappa in
 * utfallet. Den regeln star kvar for `bokforProvision`, som ar en fri post pa
 * vilket belopp som helst.
 *
 * Ovrig bonus ar nagot annat. Avsnitt 5.3: *"chefen kan bokfora en ovrig bonus
 * — ett fritt kronbelopp med obligatorisk anteckning"*, och bestallarens svar
 * 2026-09-09 var uttryckligen saljchef, VD och ekonomi — samma krets som redan
 * godkanner och makulerar order. Den som far avgora om en affar ar vard
 * provision far ocksa avgora om den var vard nagot extra.
 *
 * SKALET AR SPARREN, inte kretsen. `commission_entry_bonus_kraver_skal` i 0051
 * nekar en bonus utan anteckning, och varje post loggas med belopp och
 * mottagare. En bonus utan skal ar det forsta nagon ifragasatter i efterhand.
 * ===========================================================================
 */
async function kravBonusgivare() {
  const user = await getCurrentUser();
  if (!hasRole(user, "sales_manager", "finance", "ceo") || !user?.employee) {
    throw new Error("Bara saljchef, ekonomi och VD far lagga en ovrig bonus.");
  }
  return user;
}

/**
 * Ovrig bonus — pa en enskild affar eller pa en manad i stort.
 *
 * ===========================================================================
 * SAMMA HANDLING, TVA INGANGAR, OCH BARA `sales_order_id` SKILJER DEM.
 *
 * Bestallarens svar 2026-09-09 var "bade per affar och per manad". Det ar inte
 * tva sorters bonus utan en, sedd fran tva hall:
 *
 *   FRAN ORDERN   — knappen pa orderraden. Bonusen ar for just den affaren, och
 *                   manaden och personen kommer ur ordern sjalv. Ingen kan
 *                   valja fel manniska eller fel manad.
 *   FRAN MANADEN  — formularet pa provisionssidan. Belopp, person och manad
 *                   valjs fritt; ingen order ar inblandad.
 *
 * Att det ar EN funktion ar poangen: bada blir samma slag i huvudboken, bada
 * kraver skal, bada syns pa samma rad i vyn och bada foljer med i
 * lonekorningen. Tva funktioner hade gett tva stallen dar reglerna kan glida
 * isar.
 * ===========================================================================
 *
 * EN BONUS FALLER INTE VID EN KONSEKVENS. O8, besvarad 2026-08-25: ovrig bonus
 * ar chefens egen bedomning av nagot utover trappan — vill chefen inte ge den
 * kan hen lata bli att bokfora den, och da behover systemet inte ta tillbaka
 * den at hen. Motorn ror darfor aldrig de har posterna; de ligger i huvudboken
 * och laggs till i vyn som bokforda poster.
 */
export async function laggOvrigBonus(
  _prev: ProvisionState,
  form: FormData,
): Promise<ProvisionState> {
  try {
    const user = await kravBonusgivare();
    const db = supabaseAdmin();

    const orderId = String(form.get("sales_order_id") ?? "").trim() || null;

    let employeeId = String(form.get("employee_id") ?? "").trim();
    let manad = String(form.get("period_month") ?? "").trim();

    // KOMMER BONUSEN UR EN ORDER hamtas bade personen och manaden DARIFRAN, inte
    // ur formularet. Skalet ar att de tva anda maste stamma med ordern — en
    // bonus pa Vlados affar som bokfors pa Fredrik i en annan manad ar inte en
    // bonus utan ett fel — och det enda sattet att garantera det ar att inte
    // fraga om dem.
    if (orderId) {
      const { data: orderdata } = await db
        .from("sales_order")
        .select("salesperson_id, period_month, status, company_name")
        .eq("id", orderId)
        .maybeSingle();

      // Casten av samma skal som i `redigeraOrder`: Supabase harleder radens
      // typ ur select-strangen och ger `GenericStringError` nar den inte gar
      // ihop, varpa bygget faller pa forsta kolumnuppslaget.
      const order = orderdata as unknown as Record<string, string> | null;

      if (!order) return { fel: "Ordern finns inte." };

      // En bonus pa ett utkast ar en bonus for en affar som inte finns an.
      if (order.status !== "signerad" && order.status !== "betald") {
        return { fel: "Bonus laggs pa en godkand order. Godkann den forst." };
      }

      employeeId = String(order.salesperson_id);
      manad = String(order.period_month);
    }

    if (!employeeId) return { fel: "Valj vem bonusen galler." };
    if (!giltigManad(manad)) return { fel: "Manaden ar inte giltig, eller ligger i framtiden." };

    const belopp = tolkaBelopp(String(form.get("amount") ?? "").trim());
    if (belopp === null) return { fel: "Beloppet gick inte att tolka. Skriv till exempel 2 000." };
    if (belopp === 0) return { fel: "En bonus pa noll kronor sager ingenting. Lat bli i stallet." };

    // SKALET AR OBLIGATORISKT. Kontrollen star fore skrivningen; villkoret
    // `commission_entry_bonus_kraver_skal` i 0051 hade fallt anda, men med ett
    // felmeddelande ur Postgres i stallet for ett som gar att forsta.
    const skal = String(form.get("note") ?? "").trim();
    if (!skal) {
      return { fel: "En ovrig bonus kraver ett skal. Det ar det forsta nagon fragar efter." };
    }

    const { data: rad, error } = await db
      .from("commission_entry")
      .insert({
        employee_id: employeeId,
        period_month: manad,
        amount: belopp,
        kind: "ovrig_bonus",
        source: "manual",
        note: skal,
        sales_order_id: orderId,
        entered_by: user.employee!.id,
      })
      .select("id")
      .single();

    if (error || !rad) return { fel: `Bonusen sparades inte: ${error?.message ?? "okant fel"}` };

    await db.from("audit_log").insert({
      actor_id: user.employee!.id,
      action: "commission.bonus",
      object_type: "commission_entry",
      object_id: rad.id,
      meta: {
        employee_id: employeeId,
        period_month: manad,
        amount: belopp,
        sales_order_id: orderId,
        note: skal,
      },
    });

    // MOTTAGAREN FAR VETA. En bonus ar ett besked, inte ett tillstand som ligger
    // och vantar — utan notis upptacker personen den forst nasta gang hen
    // oppnar provisionsvyn, eller inte alls.
    if (employeeId !== user.employee!.id) {
      await notifiera({
        till: employeeId,
        av: user.employee!.id,
        kalla: "provision-bonus",
        typ: "provision",
        rubrik: `${belopp > 0 ? "Bonus" : "Justering"} ${kronor(belopp)}`,
        detalj: `${skal} · ${manad.slice(0, 7)}`,
        href: "/provision",
        objekt: { typ: "commission_entry", id: rad.id },
      });
    }

    revalidatePath("/provision");
    revalidatePath("/order");
    revalidatePath("/");

    return {
      ok: orderId
        ? `${kronor(belopp)} bokfort pa affaren.`
        : `${kronor(belopp)} bokfort pa ${manad.slice(0, 7)}.`,
    };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Nagot gick fel." };
  }
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
 * FILEN EXPORTERAR TVA SAKER, OCH BADA AR HANDLINGAR.
 *
 * Allt som exporteras ur en `"use server"`-fil blir en publik andpunkt som gar
 * att anropa utifran. Sakerhetsgenomgangen 2026-08-23 hittade en hjalpare som
 * publicerats sa av misstag (`sattKvitto`). Behovs en uträkning i vyn: lagg den
 * i `src/lib/provision.ts` och anropa den fran server-komponenten.
 *
 * `kravBokforare` och `kravBonusgivare` ar darfor INTE exporterade, trots att de
 * ser ut som nagot en vy skulle vilja fraga. Vyn fragar `hasRole` sjalv.
 */
