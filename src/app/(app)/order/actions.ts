"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getCurrentUser, hasRole, type CurrentUser } from "@/lib/auth";
import { svensktDatum } from "@/lib/klocka";
import { tolkaBelopp } from "@/lib/provision";
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
    .select("id, status, salesperson_id, package_id, term_months, signed_on, commission_amount")
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

    revalidatePath("/order");
    revalidatePath("/provision");
    return {
      ok: `Ordern är makulerad. Avdraget belastar ${idag.slice(0, 7)}, inte månaden den tecknades.`,
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
