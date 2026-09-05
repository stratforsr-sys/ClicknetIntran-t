"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getCurrentUser, hasRole, type CurrentUser } from "@/lib/auth";
import { svensktDatum } from "@/lib/klocka";
import { tolkaBelopp } from "@/lib/provision";
import { forberedUppladdning, registreraFil, taBortInnehall } from "@/lib/filer-server";
import { pdfText } from "@/lib/pdf";
import { tolkaAvtalstext, type Orderforslag } from "@/lib/orderbilaga";
import { notifiera, notifieraFlera, orderkretsen } from "@/lib/notishandelse-server";
import {
  gallandeSats,
  giltigTelefon,
  giltigtSigneringsdatum,
  normaliseraOrgnr,
  type Sats,
} from "@/lib/order";

export type Orderstate = { fel?: string; ok?: string };

/**
 * E13 steg 1. Vem som far gora vad med en order.
 *
 * Saljaren lagger sina EGNA order och skickar in dem. Saljchef, VD och ekonomi
 * godkanner, makulerar och kan lagga in en fardig order sjalva.
 *
 * Kontrollen star bade har och i RLS-policyn i 0034, med olika uppgifter. Den
 * har hindrar SKRIVNINGEN; policyn hindrar LASNINGEN. Skrivningen sker med
 * service role och gar forbi RLS, sa raderna nedan ar det enda som star mellan
 * en saljare och nagon annans order.
 */
function farHantera(user: CurrentUser | null): boolean {
  return hasRole(user, "sales_manager", "ceo", "finance");
}

async function kravInloggad(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user?.employee) throw new Error("Du måste vara inloggad.");
  return user;
}

async function kravHanterare(): Promise<CurrentUser> {
  const user = await kravInloggad();
  if (!farHantera(user)) {
    throw new Error("Bara säljchef, VD och ekonomi får godkänna och makulera order.");
  }
  return user;
}

/** Ordern, sa som skrivningen behover kanna den. */
async function hamtaRad(id: string) {
  const { data } = await supabaseAdmin()
    .from("sales_order")
    // `company_name` las inte fore 2026-09-03. Den behovs i notisrubrikerna:
    // "Din order pa Nordbygg AB godkandes" sager vilken order det galler,
    // "Din order godkandes" gor det inte for den som har fyra inne samtidigt.
    .select("id, status, salesperson_id, company_name, package_id, term_months, signed_on, commission_amount")
    .eq("id", id)
    .maybeSingle();
  return data;
}

async function logga(
  user: CurrentUser,
  action: string,
  id: string,
  meta: Record<string, unknown>,
) {
  // AC-12.1: varje skrivning om en person lamnar ett spar, och beloppet star
  // med. En logg som bara sager "nagon gjorde nagot" gar inte att granska.
  await supabaseAdmin().from("audit_log").insert({
    actor_id: user.employee!.id,
    action,
    object_type: "sales_order",
    object_id: id,
    meta,
  });
}

/**
 * Lagger en order.
 *
 * Saljaren far bara lagga den pa SIG SJALV. Kretsen ovan far valja saljare och
 * far dessutom godkanna direkt — det ar den enda vagen in for en order som
 * redan ar klar, och den ar avsiktligt inte oppen for saljaren sjalv.
 */
export async function skapaOrder(_prev: Orderstate, form: FormData): Promise<Orderstate> {
  try {
    const user = await kravInloggad();
    const hanterare = farHantera(user);

    const valdSaljare = String(form.get("salesperson_id") ?? "").trim();
    const saljare = hanterare && valdSaljare ? valdSaljare : user.employee!.id;

    if (!hanterare && valdSaljare && valdSaljare !== user.employee!.id) {
      return { fel: "Du kan bara lägga order på dig själv." };
    }

    const bolag = String(form.get("company_name") ?? "").trim();
    if (!bolag) return { fel: "Bolagsnamnet saknas." };

    const orgnr = normaliseraOrgnr(String(form.get("org_number") ?? ""));
    if (!orgnr) return { fel: "Organisationsnumret ska vara tio siffror, till exempel 556677-8899." };

    const kontakt = String(form.get("contact_name") ?? "").trim();
    if (!kontakt) return { fel: "Kontaktpersonen saknas." };

    const telefon = String(form.get("contact_phone") ?? "").trim();
    if (!giltigTelefon(telefon)) return { fel: "Telefonnumret ser inte ut som ett nummer." };

    const paket = Number(form.get("package_id"));
    const loptid = Number(form.get("term_months"));
    if (![1, 2, 3].includes(paket)) return { fel: "Välj ett paket." };
    if (![12, 24, 36].includes(loptid)) return { fel: "Välj en avtalstid." };

    const signerad = String(form.get("signed_on") ?? "").trim();
    if (!giltigtSigneringsdatum(signerad)) {
      return { fel: "Signeringsdatumet är ogiltigt eller ligger i framtiden." };
    }

    const note = String(form.get("note") ?? "").trim() || null;
    const tillagg = form.get("is_addon") === "on";

    // Chefen kan godkanna i samma steg. Saljaren skickar in.
    const godkannDirekt = hanterare && form.get("godkann") === "on";

    const insats: Record<string, unknown> = {
      company_name: bolag,
      org_number: orgnr,
      contact_name: kontakt,
      contact_phone: telefon,
      package_id: paket,
      term_months: loptid,
      salesperson_id: saljare,
      signed_on: signerad,
      is_addon: tillagg,
      note,
      status: godkannDirekt ? "signerad" : "inskickad",
      created_by: user.employee!.id,
    };

    if (godkannDirekt) {
      const provision = await raknaFramProvision(paket, loptid, signerad, form);
      if (!provision.klar) return { fel: provision.fel };

      // Kontrollen star fore skrivningen, inte efter. Check-villkoret
      // `sales_order_manuell_kraver_skal` i 0034 hade fallt anda, men med ett
      // felmeddelande ur Postgres i stallet for ett som gar att forsta.
      if (provision.satt.commission_source === "manual" && !note) {
        return { fel: "En handsatt provision kräver en anteckning om varför." };
      }

      Object.assign(insats, provision.satt, {
        approved_by: user.employee!.id,
        approved_at: new Date().toISOString(),
      });
    }

    const { data: rad, error } = await supabaseAdmin()
      .from("sales_order")
      .insert(insats)
      .select("id")
      .single();

    if (error || !rad) return { fel: `Ordern sparades inte: ${error?.message ?? "okänt fel"}` };

    await logga(user, godkannDirekt ? "sales_order.approved" : "sales_order.submitted", rad.id, {
      salesperson_id: saljare,
      package_id: paket,
      term_months: loptid,
      signed_on: signerad,
      commission_amount: insats.commission_amount ?? null,
    });

    revalidatePath("/order");
    return {
      ok: godkannDirekt
        ? `Ordern på ${bolag} är godkänd.`
        : `Ordern på ${bolag} är inskickad och väntar på godkännande.`,
    };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

/**
 * Provisionen som ska frysas pa ordern.
 *
 * Uppslaget sker pa SIGNERINGSDATUMET och inte pa dagens datum — det ar hela
 * poangen med att `commission_rate` ar versionerad. En order som laggs in i
 * efterhand far den sats som gallde nar den skrevs.
 *
 * Saknas satsen blir det INTE noll. En nolla hade sett ut som en order utan
 * provision i stallet for en konfiguration som inte ar ifylld.
 */
type Framrakning =
  | { klar: true; satt: { commission_amount: number; commission_source: string; commission_rate_id: string | null } }
  | { klar: false; fel: string };

async function raknaFramProvision(
  paket: number,
  loptid: number,
  signerad: string,
  form: FormData,
): Promise<Framrakning> {
  const manuellText = String(form.get("commission_amount") ?? "").trim();

  if (manuellText) {
    const belopp = tolkaBelopp(manuellText);
    if (belopp === null) return { klar: false, fel: "Provisionsbeloppet gick inte att tolka." };
    if (belopp < 0) {
      return { klar: false, fel: "Provisionen kan inte vara negativ. En makulering är vägen ut." };
    }
    return {
      klar: true,
      satt: {
        commission_amount: belopp,
        commission_source: "manual",
        commission_rate_id: null,
      },
    };
  }

  const { data } = await supabaseAdmin()
    .from("commission_rate")
    .select("id, package_id, term_months, amount, valid_from, valid_to");

  const satser: Sats[] = (data ?? []).map((s) => ({ ...s, amount: Number(s.amount) }));
  const sats = gallandeSats(satser, paket, loptid, signerad);

  if (!sats) {
    return {
      klar: false,
      fel: "Ingen provisionssats gällde för den kombinationen på signeringsdagen. Sätt beloppet för hand med en anteckning.",
    };
  }

  return {
    klar: true,
    satt: {
      commission_amount: sats.amount,
      commission_source: "matrix",
      commission_rate_id: sats.id,
    },
  };
}

/** Saljaren skickar in ett utkast. */
export async function skickaInOrder(_prev: Orderstate, form: FormData): Promise<Orderstate> {
  try {
    const user = await kravInloggad();
    const id = String(form.get("id") ?? "");
    const rad = await hamtaRad(id);
    if (!rad) return { fel: "Ordern finns inte." };

    if (rad.salesperson_id !== user.employee!.id && !farHantera(user)) {
      return { fel: "Det är inte din order." };
    }
    if (rad.status !== "utkast") return { fel: "Bara ett utkast går att skicka in." };

    const { error } = await supabaseAdmin()
      .from("sales_order")
      .update({ status: "inskickad" })
      .eq("id", id);
    if (error) return { fel: error.message };

    await logga(user, "sales_order.submitted", id, {});

    /**
     * ORDERN LIGGER I EN KO SOM INGEN BLEV TILLSAGD OM.
     *
     * Fram till 2026-09-03 var `inskickad` ett tillstand utan mottagare: den
     * som skickade in sag "Ordern ar inskickad" och den som skulle godkanna
     * fick veta det genom att sjalv oppna /order och rakna raderna. En order
     * som ligger ogodkand ligger ocksa oprovisionerad.
     *
     * Kretsen ar `far_hantera_order()`: saljchef, VD och ekonomi. Teamledaren
     * star utanfor (bestallarbeslut 2026-08-24).
     */
    await notifieraFlera(await orderkretsen(), {
      av: user.employee!.id,
      kalla: "order-inskickad",
      typ: "order",
      rubrik: `Order att godkänna: ${rad.company_name}`,
      detalj: `Tecknad ${rad.signed_on} · väntar på godkännande`,
      href: "/order",
      objekt: { typ: "sales_order", id },
    });

    revalidatePath("/order");
    return { ok: "Ordern är inskickad." };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

/**
 * Godkanner en inskickad order. HAR fryses provisionen.
 */
export async function godkannOrder(_prev: Orderstate, form: FormData): Promise<Orderstate> {
  try {
    const user = await kravHanterare();
    const id = String(form.get("id") ?? "");
    const rad = await hamtaRad(id);
    if (!rad) return { fel: "Ordern finns inte." };
    if (rad.status !== "inskickad" && rad.status !== "utkast") {
      return { fel: "Ordern är redan avgjord." };
    }

    const provision = await raknaFramProvision(
      rad.package_id,
      rad.term_months,
      rad.signed_on,
      form,
    );
    if (!provision.klar) return { fel: provision.fel };

    const note = String(form.get("note") ?? "").trim() || null;
    if (provision.satt.commission_source === "manual" && !note) {
      return { fel: "En handsatt provision kräver en anteckning om varför." };
    }

    const andring: Record<string, unknown> = {
      ...provision.satt,
      status: "signerad",
      approved_by: user.employee!.id,
      approved_at: new Date().toISOString(),
    };
    if (note) andring.note = note;

    const { error } = await supabaseAdmin().from("sales_order").update(andring).eq("id", id);
    if (error) return { fel: error.message };

    await logga(user, "sales_order.approved", id, {
      salesperson_id: rad.salesperson_id,
      commission_amount: provision.satt.commission_amount,
      commission_source: provision.satt.commission_source,
    });

    // Provisionen ar fryst i samma sekund. Beloppet star i notisen med flit:
    // det ar det tal saljaren annars far leta upp i provisionsvyn for att veta
    // vad godkannandet var vart.
    await notifiera({
      till: rad.salesperson_id,
      av: user.employee!.id,
      kalla: "order-godkand",
      typ: "order",
      rubrik: `Din order är godkänd: ${rad.company_name}`,
      detalj: `Provision ${Number(provision.satt.commission_amount).toLocaleString("sv-SE")} kr · räknas från ${rad.signed_on}`,
      href: "/order",
      objekt: { typ: "sales_order", id },
    });

    revalidatePath("/order");
    revalidatePath("/provision");
    return { ok: "Ordern är godkänd och räknas från och med nu." };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

/** Skickar tillbaka en inskickad order till saljaren. */
export async function returneraOrder(_prev: Orderstate, form: FormData): Promise<Orderstate> {
  try {
    const user = await kravHanterare();
    const id = String(form.get("id") ?? "");
    const skal = String(form.get("reason") ?? "").trim();
    if (!skal) return { fel: "Skriv vad som behöver rättas." };

    const rad = await hamtaRad(id);
    if (!rad) return { fel: "Ordern finns inte." };
    if (rad.status !== "inskickad") return { fel: "Bara en inskickad order går att skicka tillbaka." };

    const { error } = await supabaseAdmin()
      .from("sales_order")
      .update({ status: "utkast", note: skal })
      .eq("id", id);
    if (error) return { fel: error.message };

    await logga(user, "sales_order.returned", id, { reason: skal });

    /**
     * DEN HAR NOTISEN GAR INTE ATT HARLEDA, och det ar sjalva skalet till att
     * `notification_event` finns.
     *
     * En returnerad order far status `utkast` igen. Efterat ar den omojlig att
     * skilja fran ett utkast som aldrig skickats in — det finns ingen
     * `returned_at`, ingen raknare, ingenting. Skalet star i `note`, men
     * `note` sätts pa flera andra vagar ocksa. Klockan hade alltsa behovt gissa.
     */
    await notifiera({
      till: rad.salesperson_id,
      av: user.employee!.id,
      kalla: "order-returnerad",
      typ: "order",
      rubrik: `Din order behöver rättas: ${rad.company_name}`,
      detalj: skal,
      href: "/order",
      objekt: { typ: "sales_order", id },
    });

    revalidatePath("/order");
    return { ok: "Ordern är tillbaka hos säljaren." };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

/**
 * Makulerar en order.
 *
 * MAKULERINGEN BOKFORS I MAKULERINGSMANADEN. `cancelled_on` ar dagens datum i
 * svensk tid, och den genererade kolumnen `cancel_period_month` i 0034 gor
 * resten. En order fran mars som makuleras i augusti river darmed augusti,
 * inte mars — vilket ar bestallarens beslut och det enda som fungerar nar
 * marsperioden ar stangd och utbetald.
 */
export async function makuleraOrder(_prev: Orderstate, form: FormData): Promise<Orderstate> {
  try {
    const user = await kravHanterare();
    const id = String(form.get("id") ?? "");
    const skal = String(form.get("reason") ?? "").trim();
    if (!skal) return { fel: "En makulering kräver ett skäl." };

    const rad = await hamtaRad(id);
    if (!rad) return { fel: "Ordern finns inte." };
    if (rad.status !== "signerad" && rad.status !== "betald") {
      return { fel: "Bara en godkänd order går att makulera." };
    }

    const idag = svensktDatum();
    const { error } = await supabaseAdmin()
      .from("sales_order")
      .update({
        status: "makulerad",
        cancelled_on: idag,
        cancelled_by: user.employee!.id,
        cancel_reason: skal,
      })
      .eq("id", id);
    if (error) return { fel: error.message };

    await logga(user, "sales_order.cancelled", id, {
      salesperson_id: rad.salesperson_id,
      commission_amount: rad.commission_amount,
      cancelled_on: idag,
      reason: skal,
    });

    /**
     * DEN DYRASTE NOTISEN I NAVET.
     *
     * En makulering river saljarens provision i MAKULERINGSMANADEN, alltsa i en
     * annan manad an den hon tjanade in den. Utan raden nedan upptacks avdraget
     * forst pa lonebeskedet — och da som en siffra utan forklaring, i en manad
     * dar ingenting annat hant.
     *
     * Skalet foljer med. Det ar chefens egen text, och den ar det enda som gor
     * avdraget begripligt for den som tar emot det.
     */
    await notifiera({
      till: rad.salesperson_id,
      av: user.employee!.id,
      kalla: "order-makulerad",
      typ: "order",
      rubrik: `Din order är makulerad: ${rad.company_name}`,
      detalj: `${rad.commission_amount ? `Avdrag ${Number(rad.commission_amount).toLocaleString("sv-SE")} kr i ${idag.slice(0, 7)}` : "Provisionen dras tillbaka"} · ${skal}`,
      href: "/provision",
      objekt: { typ: "sales_order", id },
    });

    revalidatePath("/order");
    revalidatePath("/provision");
    return {
      ok: `Ordern är makulerad. Avdraget belastar ${idag.slice(0, 7)}, inte månaden den tecknades.`,
    };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

/**
 * Markerar en signerad order som betald. O13, besvarad 2026-08-26.
 *
 * ===========================================================================
 * DEN HAR STATUSEN ROR INGA PENGAR, och det ar hela poangen med den.
 *
 * PROVISIONEN UTGAR FRAN SIGNERING, inte fran betalning (fraga 10). `betald`
 * och `signerad` behandlas darfor lika overallt dar det raknas — se
 * `harGodkants()` i `order.ts`, som har bada. Statusen ar ren INFORMATION:
 * ekonomi kan se vilka order som faktiskt betalats utan att det andrar en enda
 * krona i provisionen.
 *
 * Fram till 2026-08-26 fanns statusen i schemat, i overgangsmatrisen och i
 * triggern i 0034 — men INGEN KOD KUNDE SATTA DEN. Den var alltsa onabar, inte
 * bara verkningslos, och den sortens dod vag ar precis vad nagon senare tolkar
 * som en bortfallen knapp.
 *
 * KRETSEN AR SMALARE AN `farHantera`: ekonomi och VD, inte saljchefen. Den som
 * ser betalningen komma in ar den som far saga att den kommit. Samma
 * uppdelning som `markeraUtbetald` i `provision/stangning.ts` gor for perioden.
 *
 * En betald order gar fortfarande att makulera (0034). Det ar avsiktligt:
 * pengar kommer tillbaka ibland, och avdraget bokfors da i makuleringsmanaden
 * som vanligt.
 * ===========================================================================
 */
export async function markeraBetald(_prev: Orderstate, form: FormData): Promise<Orderstate> {
  try {
    const user = await kravInloggad();
    if (!hasRole(user, "finance", "ceo")) {
      return { fel: "Bara ekonomi och VD får markera en order som betald." };
    }

    const id = String(form.get("id") ?? "");
    const rad = await hamtaRad(id);
    if (!rad) return { fel: "Ordern finns inte." };
    if (rad.status !== "signerad") {
      return { fel: "Bara en signerad order går att markera som betald." };
    }

    // Villkoret pa status star ocksa i `.eq()` nedan. Lasningen och skrivningen
    // ar tva turer, och en makulering som hinner emellan ska inte skrivas over.
    const { error } = await supabaseAdmin()
      .from("sales_order")
      .update({ status: "betald" })
      .eq("id", id)
      .eq("status", "signerad");

    if (error) return { fel: error.message };

    await logga(user, "sales_order.paid", id, {
      salesperson_id: rad.salesperson_id,
      commission_amount: rad.commission_amount,
    });

    // Ren information, precis som statusen sjalv. Notisen sager uttryckligen
    // att provisionen inte andras — annars ar "betald" ett besked som later
    // som om nagot hant med pengarna, och sa ar det inte (fraga 10).
    await notifiera({
      till: rad.salesperson_id,
      av: user.employee!.id,
      kalla: "order-betald",
      typ: "order",
      rubrik: `Betald: ${rad.company_name}`,
      detalj: "Kunden har betalat. Provisionen är oförändrad — den utgår från signeringen.",
      href: "/order",
      objekt: { typ: "sales_order", id },
    });

    revalidatePath("/order");
    return {
      ok: "Ordern är markerad som betald. Provisionen är oförändrad — den utgår från signeringen.",
    };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

/** Raderar ett utkast. Triggern i 0034 nekar allt annat. */
export async function raderaUtkast(_prev: Orderstate, form: FormData): Promise<Orderstate> {
  try {
    const user = await kravInloggad();
    const id = String(form.get("id") ?? "");
    const rad = await hamtaRad(id);
    if (!rad) return { fel: "Ordern finns inte." };
    if (rad.salesperson_id !== user.employee!.id && !farHantera(user)) {
      return { fel: "Det är inte din order." };
    }
    if (rad.status !== "utkast") return { fel: "Bara ett utkast går att radera." };

    const { error } = await supabaseAdmin().from("sales_order").delete().eq("id", id);
    if (error) return { fel: error.message };

    await logga(user, "sales_order.deleted", id, {});
    revalidatePath("/order");
    return { ok: "Utkastet är borta." };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

/**
 * FILEN EXPORTERAR BARA HANDLINGAR, OCH DET AR MED FLIT.
 *
 * Allt som exporteras ur en `"use server"`-fil blir en publik andpunkt som gar
 * att anropa utifran. Sakerhetsgenomgangen har hittat den bristen tva ganger
 * (`skrivFel` 22 augusti, `sattKvitto` 24 augusti). Behovs en hjalpare i vyn:
 * lagg den i `src/lib/order.ts` och anropa den fran server-komponenten.
 */

// -----------------------------------------------------------------------------
// E13 steg 9: orderbilagan (migration 0039)
//
// ===========================================================================
// UTLASNINGEN FORIFYLLER ETT FORMULAR. DEN SPARAR ALDRIG NAGOT.
//
// Bestallarens krav, PROVISION_SPEC.md avsnitt 3.1: ett falt som fyllts i av
// en maskin och godkants av en manniska ar nagot annat an ett falt ingen last.
//
// Det ar inte en artighet. Ordern bar ett provisionsbelopp som FRYSES vid
// godkannandet och betalas ut som pengar — en maskinlast lopstid som ingen
// kontrollerat ar skillnaden mellan 1 500 och 4 500 kronor, och felet upptacks
// forst nar nagon jamfor med papperet.
//
// Darfor finns det ingen vag harifran som skriver ett utlast varde till
// `sales_order`. `lasAvtalsforslag` returnerar ett forslag; sidan lagger det i
// formularfalten; manniskan trycker.
// ===========================================================================
// -----------------------------------------------------------------------------

/**
 * Vem som far bifoga en fil till en order.
 *
 * SAMMA KRETS SOM FAR SE ORDERN, alltsa saljaren sin egen och hanterarkretsen
 * allas. RLS-policyn i 0039 later bilagan arva orderns behorighet, och den har
 * kontrollen ar dess motsvarighet at skrivhallet — skrivningen sker med
 * service role och gar forbi RLS.
 */
async function kravBilageratt(orderId: string): Promise<CurrentUser> {
  const user = await kravInloggad();
  const rad = await hamtaRad(orderId);
  if (!rad) throw new Error("Ordern finns inte.");

  if (rad.salesperson_id !== user.employee!.id && !farHantera(user)) {
    throw new Error("Du får inte bifoga något till någon annans order.");
  }
  return user;
}

export async function forberedOrderbilaga(
  orderId: string,
  filnamn: string,
  mimetyp: string,
  storlek: number,
) {
  try {
    await kravBilageratt(orderId);
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Du saknar behörighet." };
  }
  return forberedUppladdning({ andamal: "sales_order", filnamn, mimetyp, storlek });
}

export async function registreraOrderbilaga(
  orderId: string,
  fileId: string,
  filnamn: string,
): Promise<Orderstate> {
  try {
    const user = await kravBilageratt(orderId);

    const resultat = await registreraFil({
      fileId,
      andamal: "sales_order",
      filnamn,
      uploadedBy: user.employee!.id,
      salesOrderId: orderId,
      // 0039: en orderbilaga hor till en KUNDAFFAR och till ingen manniska.
      // Check-villkoret nekar raden om subjektet sätts, och det ar meningen —
      // annars hade kundens avtal blivit en uppgift om saljaren och foljt med
      // ut i hens registerutdrag.
      subjectEmployeeId: null,
    });

    if ("fel" in resultat) return { fel: resultat.fel };

    await logga(user, "sales_order.attachment_added", orderId, { fil: fileId });
    revalidatePath("/order");
    return { ok: "Avtalet är bifogat." };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Bilagan kunde inte läggas till." };
  }
}

export async function taBortOrderbilaga(_prev: Orderstate, form: FormData): Promise<Orderstate> {
  const orderId = String(form.get("id") ?? "");
  const fileId = String(form.get("fil_id") ?? "");

  try {
    const user = await kravBilageratt(orderId);

    // Innehallet tas bort ur bucketen, raden och oppningsloggen star kvar
    // (0022). En fil som gick att radera helt hade tagit sin egen logg med sig.
    await taBortInnehall(fileId, user.employee!.id);

    await logga(user, "sales_order.attachment_removed", orderId, { fil: fileId });
    revalidatePath("/order");
    return { ok: "Bilagan är borttagen." };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Bilagan kunde inte tas bort." };
  }
}

/**
 * Laser en uppladdad avtals-PDF och svarar med ett FORSLAG till formularet.
 *
 * SKRIVER INGENTING. Se rubriken ovan. Att funktionen tar emot ett `fileId`
 * och inte en fil ar avsiktligt: filen ligger redan i den stangda bucketen med
 * sin atkomstlogg, och en vag in dar klienten skickar godtyckliga bytes hade
 * varit en andra, oskyddad vag.
 *
 * Behorigheten ar orderns egen. Textutlasningen ar en LASNING av filen, sa den
 * kraver samma ratt som att oppna den.
 */
export async function lasAvtalsforslag(
  orderId: string,
  fileId: string,
): Promise<{ forslag: Orderforslag } | { fel: string }> {
  try {
    await kravBilageratt(orderId);

    const { data: fil } = await supabaseAdmin()
      .from("file_object")
      .select("id, path, purpose, sales_order_id, removed_at")
      .eq("id", fileId)
      .maybeSingle();

    // Filen maste hora till DEN HAR ordern. Utan villkoret hade ett id fran
    // webblasaren kunnat peka pa vilken fil som helst i bucketen — inklusive
    // ett lakarintyg — och texten kommit tillbaka i svaret.
    if (!fil || fil.purpose !== "sales_order" || fil.sales_order_id !== orderId) {
      return { fel: "Filen hör inte till den här ordern." };
    }
    if (fil.removed_at) return { fel: "Filen är borttagen." };

    const { data } = await supabaseAdmin().storage.from("filer").download(String(fil.path));
    if (!data) return { fel: "Filen gick inte att läsa." };

    const text = await pdfText(new Uint8Array(await data.arrayBuffer()));

    // En inskannad PDF utan textlager ger ett TOMT forslag och inte ett fel.
    // Bilagan ska ga att bifoga anda; den forifyller bara ingenting.
    return { forslag: tolkaAvtalstext(text) };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Avtalet kunde inte läsas." };
  }
}

/**
 * Skriver de falt anvandaren VALT ur avtalsforslaget till ordern.
 *
 * ===========================================================================
 * DET HAR AR STEGET DAR EN MANNISKA HAR TRYCKT, och det ar hela skillnaden.
 *
 * `lasAvtalsforslag` laser och foreslar. Den har skriver — men bara det som
 * kryssats i formularet, och bara pa en order som ANNU INTE ar godkand.
 *
 * Tva sparrar, inte en:
 *
 *   Har: statusen provas fore skrivningen, sa att beskedet gar att forsta.
 *   I databasen: triggern `sales_order_stegbyte` i 0034 nekar att saljare,
 *   paket, lopstid, signeringsdatum, bolag eller belopp andras pa en order som
 *   ar `signerad`, `betald` eller `makulerad`.
 *
 * Den andra ar den som galler. Provisionen ar frusen pa ordern fran och med
 * godkannandet, och en lopstid som gick att andra efterat hade gjort det
 * frusna beloppet till ett pastaende om nagot annat an det som star dar.
 * ===========================================================================
 */
export async function rattaFranAvtal(_prev: Orderstate, form: FormData): Promise<Orderstate> {
  try {
    const orderId = String(form.get("id") ?? "");
    const user = await kravBilageratt(orderId);

    const rad = await hamtaRad(orderId);
    if (!rad) return { fel: "Ordern finns inte." };
    if (rad.status !== "utkast" && rad.status !== "inskickad") {
      return {
        fel:
          "En godkänd order skrivs inte om. Stämmer avtalet inte: makulera ordern" +
          " och lägg en ny.",
      };
    }

    // BARA DE FALT SOM SKICKATS MED. Ett tomt falt betyder "rör inte", inte
    // "sätt till tomt" — annars hade en avbockad ruta raderat ett värde
    // säljaren skrivit för hand.
    const andring: Record<string, unknown> = {};

    const bolag = String(form.get("company_name") ?? "").trim();
    if (bolag) andring.company_name = bolag;

    const orgnrText = String(form.get("org_number") ?? "").trim();
    if (orgnrText) {
      const orgnr = normaliseraOrgnr(orgnrText);
      if (!orgnr) return { fel: "Organisationsnumret ur avtalet gick inte att tolka." };
      andring.org_number = orgnr;
    }

    const kontakt = String(form.get("contact_name") ?? "").trim();
    if (kontakt) andring.contact_name = kontakt;

    const telefon = String(form.get("contact_phone") ?? "").trim();
    if (telefon) {
      if (!giltigTelefon(telefon)) return { fel: "Telefonnumret ur avtalet ser inte ut som ett nummer." };
      andring.contact_phone = telefon;
    }

    const paketText = String(form.get("package_id") ?? "").trim();
    if (paketText) {
      const paket = Number(paketText);
      if (![1, 2, 3].includes(paket)) return { fel: "Paketet ur avtalet finns inte." };
      andring.package_id = paket;
    }

    const loptidText = String(form.get("term_months") ?? "").trim();
    if (loptidText) {
      const loptid = Number(loptidText);
      if (![12, 24, 36].includes(loptid)) return { fel: "Avtalstiden ur avtalet finns inte." };
      andring.term_months = loptid;
    }

    const signerad = String(form.get("signed_on") ?? "").trim();
    if (signerad) {
      if (!giltigtSigneringsdatum(signerad)) {
        return { fel: "Signeringsdatumet ur avtalet är ogiltigt eller ligger i framtiden." };
      }
      andring.signed_on = signerad;
    }

    if (Object.keys(andring).length === 0) return { fel: "Inget fält var ikryssat." };

    const { error } = await supabaseAdmin()
      .from("sales_order")
      .update(andring)
      .eq("id", orderId)
      .in("status", ["utkast", "inskickad"]);

    if (error) return { fel: `Ordern rättades inte: ${error.message}` };

    await logga(user, "sales_order.prefilled", orderId, { falt: Object.keys(andring) });

    revalidatePath("/order");
    return {
      ok: `${Object.keys(andring).length} fält är hämtade ur avtalet. Kontrollera dem innan ordern godkänns.`,
    };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}
