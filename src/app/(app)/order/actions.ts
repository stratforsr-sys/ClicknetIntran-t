"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getCurrentUser, hasRole, type CurrentUser } from "@/lib/auth";
import { svensktDatum } from "@/lib/klocka";
import { kronor, manadsnamn, manadsnyckel, tolkaBelopp } from "@/lib/provision";
import { rattelseposter, rorPengar } from "@/lib/rattelse";
import { forberedUppladdning, registreraFil, taBortInnehall } from "@/lib/filer-server";
import { pdfText } from "@/lib/pdf";
import { tolkaAvtalstext, type Orderforslag } from "@/lib/orderbilaga";
import { notifiera, notifieraFlera, orderkretsen } from "@/lib/notishandelse-server";
import {
  gallandeSats,
  giltigTelefon,
  giltigtSigneringsdatum,
  harStangdPeriod,
  normaliseraOrgnr,
  ordervardeFor,
  periodFor,
  type Sats,
} from "@/lib/order";
import {
  affarenFor,
  arEgenForsaljning,
  gallandeChefssats,
  restpostenAtNoll,
  type Chefssats,
  type Overtack,
} from "@/lib/chefsprovision";

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
 * Manaderna som ar faststallda. En manad UTAN rad ar oppen (avsnitt 5.6).
 *
 * Lases med service role och inte med anvandarens token. `commission_period` ar
 * visserligen oppen for alla inloggade i RLS, men det ar en LASNING SOM STYR EN
 * SKRIVNING — en rad som av nagot skal inte kom med hade tyst gjort en
 * efterslapande order till en vanlig, och da ar pengarna borta igen.
 */
async function stangdaManader(): Promise<string[]> {
  const { data } = await supabaseAdmin().from("commission_period").select("period_month");
  return (data ?? []).map((p) => String(p.period_month).slice(0, 10));
}

/**
 * Bokfor provisionen for en order vars period redan ar faststalld.
 *
 * ===========================================================================
 * AVSNITT 5.6 OCH O11: EN STANGD PERIOD OPPNAS ALDRIG.
 *
 * Ordern hor till augusti — perioden bestams av signeringsdatumet (3.4) och det
 * andras inte. Men augusti ar rakad, bokford och last, sa pengarna kan inte
 * hamna dar. Forslaget i 5.6 ar darfor att de bokfors i den OPPNA perioden med
 * en anteckning om vilken manad de hor till, och det ar vad som sker har.
 *
 * ATT NEKA GODKANNANDET VORE FEL SVAR. Ordern ar en riktig affar. En affar som
 * inte gar att registrera forsvinner inte — den blir ett mejl till nagon, och
 * da ar navet inte langre stallet dar man ser vad som salts.
 *
 * ---------------------------------------------------------------------------
 * POSTEN AR `manual` OCH INTE `motor`, och det ar ett val.
 *
 * `motor` ar reserverat for det periodstangningen bokfor, med en deterministisk
 * `external_ref` per manad, person och slag. En efterslapande order hor inte
 * till den manadens rakning — den ar just en post motorn INTE kunde producera.
 *
 * Foljden ar att den syns som "Bokfört för hand" i provisionsvyn, vilket ar
 * sant: det ar en post vid sidan av motorn. Anteckningen sager vilken order och
 * vilken manad, sa fragan "vad ar det har for post" har ett svar i raden sjalv.
 *
 * INGEN VOLYMBONUS RAKNAS PA DEN. Bonusen ar en egenskap hos manadens
 * ordervolym (5.2), och den har ordern hor till en annan manad. Att lata den
 * hoja september hade gett bonus for en order september inte innehaller.
 * ---------------------------------------------------------------------------
 *
 * DUBBELBOKFORING AR OMOJLIG utan en `external_ref`, eftersom vagen hit gar
 * genom en statusandring: `godkannOrder` nekar allt som inte ar `inskickad`
 * eller `utkast`, och efterat ar ordern `signerad`. Samma order kan alltsa inte
 * godkannas tva ganger.
 */
async function bokforEfterslapning(arg: {
  user: CurrentUser;
  orderId: string;
  salesperson_id: string;
  company_name: string;
  signed_on: string;
  belopp: number;
}): Promise<{ manad: string } | { fel: string }> {
  const oppen = manadsnyckel();
  const ordernsManad = periodFor(arg.signed_on);

  // Den oppna manaden ar sjalv stangd. Det kraver att nagon faststallt manaden
  // pa dess sista dag OCH att en order fran en tidigare stangd manad godkanns
  // samma dygn — sallsynt, men tyst forlust igen om den slinker igenom. Ratt
  // svar ar att falla hogljutt och lata en manniska bokfora posten.
  if ((await stangdaManader()).includes(oppen)) {
    return {
      fel:
        `${manadsnamn(ordernsManad)} är fastställd och ${manadsnamn(oppen)} är det också. ` +
        `Ordern går inte att godkänna förrän en period är öppen — be ekonomi bokföra ` +
        `${kronor(arg.belopp)} för hand i stället.`,
    };
  }

  const { error } = await supabaseAdmin()
    .from("commission_entry")
    .insert({
      employee_id: arg.salesperson_id,
      period_month: oppen,
      amount: arg.belopp,
      // `deals` ar NULL och inte 1. Antalet beskriver den manadens ordervolym,
      // och den har ordern hor till en annan manad — en etta hade fatt
      // september att se ut att innehalla en order den inte har.
      deals: null,
      source: "manual",
      note:
        `Eftersläpande order: ${arg.company_name}, signerad ${arg.signed_on}. ` +
        `${manadsnamn(ordernsManad)} var redan fastställd när ordern godkändes, ` +
        `så provisionen bokförs här i stället (PROVISION_SPEC 5.6, Ö11).`,
      entered_by: arg.user.employee!.id,
    });

  if (error) return { fel: `Provisionen bokfördes inte: ${error.message}` };

  await logga(arg.user, "commission.efterslapning", arg.orderId, {
    salesperson_id: arg.salesperson_id,
    ordernsManad,
    bokfordManad: oppen,
    amount: arg.belopp,
  });

  return { manad: oppen };
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

    let affar: Extract<Framrakning, { klar: true }> | null = null;

    if (godkannDirekt) {
      const provision = await raknaFramProvision(paket, loptid, signerad, saljare, form);
      if (!provision.klar) return { fel: provision.fel };

      // Kontrollen star fore skrivningen, inte efter. Check-villkoret
      // `sales_order_manuell_kraver_skal` i 0034 hade fallt anda, men med ett
      // felmeddelande ur Postgres i stallet for ett som gar att forsta.
      //
      // `manager` kraver INGEN anteckning: beloppet kommer ur en versionerad
      // procentsats och inte ur nagons bedomning, sa skalet star i
      // konfigurationen. Se 0050.
      if (provision.satt.commission_source === "manual" && !note) {
        return { fel: "En handsatt provision kräver en anteckning om varför." };
      }

      affar = provision;
      Object.assign(insats, provision.satt, {
        approved_by: user.employee!.id,
        approved_at: new Date().toISOString(),
      });
    }

    // SAMMA GRANS SOM I `godkannOrder`, och den maste sta har ocksa: chefen kan
    // lagga in en fardig order med ett gammalt signeringsdatum och godkanna den
    // i samma steg. Det ar den vanligaste vagen in for en order som legat kvar.
    const forSent = godkannDirekt && harStangdPeriod(signerad, await stangdaManader());

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
      order_value: insats.order_value ?? null,
    });

    // OVERTACKET SKRIVS EFTER ORDERN, aldrig fore: raden pekar pa `order_id` med
    // en frammande nyckel, och triggern `order_manager_commission_inte_egen`
    // laser saljaren ur `sales_order`. Fore ordern finns ingenting att lasa.
    if (affar) await skrivOvertack(user, rad.id, bolag, affar.overtack);

    let efterslapning: string | null = null;
    if (forSent) {
      const utfall = await bokforEfterslapning({
        user,
        orderId: rad.id,
        salesperson_id: saljare,
        company_name: bolag,
        signed_on: signerad,
        belopp: Number(insats.commission_amount),
      });
      if ("fel" in utfall) return { fel: utfall.fel };
      efterslapning = utfall.manad;
    }

    revalidatePath("/order");
    revalidatePath("/provision");
    // TVA OBEROENDE OMSTANDIGHETER, och kvittensen maste kunna bara bada:
    // ordern kan ha hamnat i en stangd manad (efterslapningen, O11) OCH
    // provisionen kan ha overstigit ordervardet sa att overtacket klipptes.
    const klippt = affar?.restpostenKlipptes
      ? " Provisionen översteg ordervärdet, så övertäcket till säljchefen blev noll."
      : "";

    return {
      ok: efterslapning
        ? `Ordern på ${bolag} är godkänd. ${manadsnamn(periodFor(signerad))} var fastställd, så provisionen bokfördes på ${manadsnamn(efterslapning)}.${klippt}`
        : godkannDirekt
          ? `Ordern på ${bolag} är godkänd.${klippt}`
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
  | {
      klar: true;
      satt: {
        commission_amount: number;
        commission_source: string;
        commission_rate_id: string | null;
        order_value: number;
        order_value_source: string;
      };
      /** Saljchefens overtack, eller null. Skrivs som EGEN rad — se `skrivOvertack`. */
      overtack: Overtack | null;
      /** Sant nar godkannaren skrev in ett belopp sjalv och ordervardet ar lagre. */
      restpostenKlipptes: boolean;
    }
  | { klar: false; fel: string };

/**
 * ===========================================================================
 * DEN HAR FUNKTIONEN AVGOR VAD TRE OLIKA MANNISKOR FAR BETALT, och den ar det
 * enda stallet dar valet gors. Fyra fall, och de skiljer sig i BADA leden:
 *
 *   SALJARE + PAKET      matrisen                    + overtack till chefen
 *   SALJARE + FRI ORDER  handsatt belopp             + overtack till chefen
 *   CHEFEN  + PAKET      procent pa hela ordervardet + INGET overtack
 *   CHEFEN  + FRI ORDER  procent pa hela ordervardet + INGET overtack
 *
 * Sjalva valet ligger i `affarenFor()` i `chefsprovision.ts` och inte har.
 * Skalet ar att regeln maste ga att prova utan att starta Next, och att
 * inmatningens forhandsvisning ska kunna visa exakt samma tal som godkannandet
 * senare skriver. Tva tolkningar av "40 % eller matrisen" hade synts forst nar
 * nagon undrade over sin lon.
 * ===========================================================================
 *
 * ORDERVARDET RAKNAS HAR OCH FRYSES PA ORDERN. For ett paket ar det priset gange
 * loptiden; for en fri order skrivs det in. Uppslaget av bade provisionssatsen
 * och chefssatsen sker pa SIGNERINGSDATUMET och inte pa dagens datum — det ar
 * hela poangen med att bada tabellerna ar versionerade. En order som laggs in i
 * efterhand far de satser som gallde nar den skrevs.
 */
async function raknaFramProvision(
  paket: number,
  loptid: number,
  signerad: string,
  saljareId: string,
  form: FormData,
): Promise<Framrakning> {
  const db = supabaseAdmin();

  const [{ data: satsrader }, { data: paketrader }, { data: chefsrader }] = await Promise.all([
    db.from("commission_rate").select("id, package_id, term_months, amount, valid_from, valid_to"),
    db.from("sales_package").select("id, label, list_price, sort, active"),
    db
      .from("manager_commission_rate")
      .select("id, employee_id, override_percent, own_sale_percent, valid_from, valid_to"),
  ]);

  const chefssats = gallandeChefssats(
    (chefsrader ?? []).map((s) => ({
      ...s,
      override_percent: Number(s.override_percent),
      own_sale_percent: Number(s.own_sale_percent),
    })) as Chefssats[],
    signerad,
  );

  const chefenSaljer = arEgenForsaljning(chefssats, saljareId);

  // ---------------------------------------------------------------------------
  // 1. Ordervardet
  // ---------------------------------------------------------------------------
  const vardeText = String(form.get("order_value") ?? "").trim();
  const manuellText = String(form.get("commission_amount") ?? "").trim();

  // "Ordern foljer inte paketreglerna" kanns igen pa att ETT ordervarde skrivits
  // in. Kryssrutan i formularet visar bada falten, men det ar vardet som avgor:
  // en order utan inskrivet varde ar en paketorder, och da raknas vardet fram.
  const friOrder = vardeText.length > 0;

  let ordervarde: number;
  let vardekalla: string;

  if (friOrder) {
    const v = tolkaBelopp(vardeText);
    if (v === null) return { klar: false, fel: "Ordervärdet gick inte att tolka." };
    if (v <= 0) return { klar: false, fel: "Ordervärdet måste vara större än noll." };
    ordervarde = v;
    vardekalla = "manual";
  } else {
    const paketrad = (paketrader ?? []).find((p) => p.id === paket);
    if (!paketrad) {
      return { klar: false, fel: "Paketet finns inte. Välj ett paket eller skriv in ett ordervärde." };
    }
    ordervarde = ordervardeFor(Number(paketrad.list_price), loptid);
    vardekalla = "package";
  }

  // ---------------------------------------------------------------------------
  // 2. Saljarens provision — den som gallt UTAN chefsregeln
  //
  // Raknas fram aven nar chefen ar saljaren, eftersom den da inte anvands: valet
  // ligger i `affarenFor`. Undantaget ar en fri order som chefen tecknat, dar
  // godkannaren inte behover skriva nagot belopp alls — 40 % av ordervardet ar
  // hela svaret. Kravet pa ett handsatt belopp galler darfor bara ANDRAS order.
  // ---------------------------------------------------------------------------
  let saljarprovision: number;
  let saljarkalla: "matrix" | "manual";

  // MATRISRADEN SPARAS, inte bara dess belopp. `commission_rate_id` ar det som
  // gor att en utbetalning gar att harleda till raden den kom ur; villkoret
  // `sales_order_satskoppling` i 0050 kraver den for `matrix` och forbjuder den
  // for allt annat.
  let matrisrad: Sats | null = null;

  if (manuellText) {
    const belopp = tolkaBelopp(manuellText);
    if (belopp === null) return { klar: false, fel: "Provisionsbeloppet gick inte att tolka." };
    if (belopp < 0) {
      return { klar: false, fel: "Provisionen kan inte vara negativ. En makulering är vägen ut." };
    }
    saljarprovision = belopp;
    saljarkalla = "manual";
  } else if (friOrder && !chefenSaljer) {
    return {
      klar: false,
      fel: "En order utanför paketreglerna behöver både ett ordervärde och en provision.",
    };
  } else {
    const satser: Sats[] = (satsrader ?? []).map((s) => ({ ...s, amount: Number(s.amount) }));
    matrisrad = gallandeSats(satser, paket, loptid, signerad);

    // Chefen behover ingen matrisrad: hens belopp kommer ur ordervardet. En
    // saknad sats far darfor bara falla for de andra.
    if (!matrisrad && !chefenSaljer) {
      return {
        klar: false,
        fel: "Ingen provisionssats gällde för den kombinationen på signeringsdagen. Sätt beloppet för hand med en anteckning.",
      };
    }

    saljarprovision = matrisrad?.amount ?? 0;
    saljarkalla = "matrix";
  }

  // ---------------------------------------------------------------------------
  // 3. Affaren. Valet mellan de tva satserna sker HAR och ingen annanstans.
  // ---------------------------------------------------------------------------
  const affar = affarenFor({
    sats: chefssats,
    saljareId,
    ordervarde,
    saljarprovision,
    saljarkalla,
  });

  return {
    klar: true,
    satt: {
      commission_amount: affar.provision,
      commission_source: affar.kalla,
      // Bara ett matrisbelopp pekar pa sin rad. Ett handsatt belopp och ett
      // framraknat chefsbelopp gor det inte — `sales_order_satskoppling` i 0050
      // nekar annars insertet.
      commission_rate_id: affar.kalla === "matrix" ? (matrisrad?.id ?? null) : null,
      order_value: ordervarde,
      order_value_source: vardekalla,
    },
    overtack: affar.overtack,
    restpostenKlipptes: restpostenAtNoll(ordervarde, affar.provision),
  };
}

/**
 * Skriver saljchefens overtack som en egen rad.
 *
 * ===========================================================================
 * ETT MISSLYCKANDE HAR FAR INTE RIVA GODKANNANDET, och det ar ett val.
 *
 * Ordern ar redan godkand nar den har raden skrivs. Skulle skrivningen falla ar
 * alternativen tva: backa godkannandet, eller lata ordern sta och sakna sitt
 * overtack.
 *
 * Backa gar inte. `sales_order_stegbyte` i 0034 nekar varje andring pa en
 * godkand order, och en makulering hade bokfort ett avdrag i makuleringsmanaden
 * for en affar som ar fullt giltig. Boten hade varit varre an felet.
 *
 * Alltsa: ordern star, overtacket saknas, och det STAR I LOGGEN att det saknas.
 * En saknad rad ar dessutom lagbar i efterhand — perioden ar oppen tills nagon
 * stanger den — medan en felaktigt makulerad order inte gar att ta tillbaka.
 * ===========================================================================
 */
async function skrivOvertack(
  user: CurrentUser,
  orderId: string,
  bolag: string,
  overtack: Overtack | null,
): Promise<void> {
  if (!overtack) return;

  const { error } = await supabaseAdmin().from("order_manager_commission").insert({
    order_id: orderId,
    manager_id: overtack.manager_id,
    order_value: overtack.order_value,
    base: overtack.base,
    percent: overtack.percent,
    amount: overtack.amount,
    rate_id: overtack.rate_id,
  });

  await logga(
    user,
    error ? "sales_order.override_failed" : "sales_order.override",
    orderId,
    error
      ? { fel: error.message, manager_id: overtack.manager_id, amount: overtack.amount }
      : { manager_id: overtack.manager_id, amount: overtack.amount, percent: overtack.percent },
  );

  if (error) return;

  // NOTISEN GAR TILL MOTTAGAREN, INTE TILL SALJAREN.
  //
  // Beloppet ar chefens ersattning, och `order_manager_commission_read` i 0050
  // slapper inte in saljaren pa den raden. En notis som sa "Zen fick 1 044 kr pa
  // din order" hade gatt runt hela den policyn — samma sorts lacka som en notis
  // med ett lonebelopp i.
  //
  // Att chefen godkanner sina EGNA notiser ar inget att undvika: hen far veta
  // vad godkannandet var vart utan att behova oppna provisionsvyn, precis som
  // saljaren far det beloppet i sin notis.
  await notifiera({
    till: overtack.manager_id,
    av: user.employee!.id,
    kalla: "order-overtack",
    typ: "provision",
    rubrik: `Övertäck ${kronor(overtack.amount)}: ${bolag}`,
    detalj: `${overtack.percent} % på ${kronor(overtack.base)} · räknas i orderns månad`,
    href: "/provision",
    objekt: { typ: "sales_order", id: orderId },
  });
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

    // SALJAREN KOMMER UR ORDERN, inte ur formularet. Det ar hen som avgor om
    // chefsregeln galler, och en order som saljaren skickat in bar redan sitt
    // `salesperson_id` — godkannaren byter inte saljare, och triggern i 0034
    // hade nekat det anda.
    const provision = await raknaFramProvision(
      rad.package_id,
      rad.term_months,
      rad.signed_on,
      rad.salesperson_id,
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

    // ORDNINGEN AR MEDVETEN: kontrollen fore skrivningen.
    //
    // Ar bade orderns manad och den oppna manaden stangda gar posten ingenstans,
    // och da ska ordern INTE godkannas — en godkand order utan provision ar
    // precis den tysta forlusten som rattas har. Se `bokforEfterslapning`.
    const forSent = harStangdPeriod(rad.signed_on, await stangdaManader());

    const { error } = await supabaseAdmin().from("sales_order").update(andring).eq("id", id);
    if (error) return { fel: error.message };

    await logga(user, "sales_order.approved", id, {
      salesperson_id: rad.salesperson_id,
      commission_amount: provision.satt.commission_amount,
      commission_source: provision.satt.commission_source,
      order_value: provision.satt.order_value,
    });

    await skrivOvertack(user, id, rad.company_name, provision.overtack);

    // ===========================================================================
    // O11 / AVSNITT 5.6. Ordern hor till en manad som redan ar faststalld, sa
    // provisionen bokfors i den oppna perioden i stallet. En stangd period
    // oppnas aldrig.
    //
    // Fram till 2026-09-08 hande ingenting har, och foljden var att en godkand
    // order i en stangd manad aldrig kom med i nagon lonekorning. Tyst.
    // ===========================================================================
    let efterslapning: string | null = null;
    if (forSent) {
      const utfall = await bokforEfterslapning({
        user,
        orderId: id,
        salesperson_id: rad.salesperson_id,
        company_name: rad.company_name,
        signed_on: rad.signed_on,
        belopp: provision.satt.commission_amount,
      });
      if ("fel" in utfall) return { fel: utfall.fel };
      efterslapning = utfall.manad;
    }

    // Provisionen ar fryst i samma sekund. Beloppet star i notisen med flit:
    // det ar det tal saljaren annars far leta upp i provisionsvyn for att veta
    // vad godkannandet var vart. AR DEN EFTERSLAPANDE STAR DET OCKSA DAR — att
    // pengarna dyker upp i fel manad utan forklaring ar ett arende i vardande.
    await notifiera({
      till: rad.salesperson_id,
      av: user.employee!.id,
      kalla: "order-godkand",
      typ: "order",
      rubrik: `Din order är godkänd: ${rad.company_name}`,
      detalj: efterslapning
        ? `Provision ${kronor(provision.satt.commission_amount)} · ${manadsnamn(periodFor(rad.signed_on))} var redan fastställd, så beloppet bokförs på ${manadsnamn(efterslapning)}`
        : `Provision ${Number(provision.satt.commission_amount).toLocaleString("sv-SE")} kr · räknas från ${rad.signed_on}`,
      href: "/order",
      objekt: { typ: "sales_order", id },
    });

    revalidatePath("/order");
    revalidatePath("/provision");

    // Samma tva oberoende omstandigheter som i `skapaOrder`.
    const klippt = provision.restpostenKlipptes
      ? " Provisionen översteg ordervärdet, så övertäcket till säljchefen blev noll."
      : "";

    return {
      ok: efterslapning
        ? `Ordern är godkänd. ${manadsnamn(periodFor(rad.signed_on))} var fastställd, så ${kronor(provision.satt.commission_amount)} bokfördes på ${manadsnamn(efterslapning)} med en anteckning om varför.${klippt}`
        : `Ordern är godkänd och räknas från och med nu.${klippt}`,
    };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

/**
 * Rattar en godkand order.
 *
 * TVA KRETSAR MED OLIKA RACKVIDD. Chefskretsen rattar allt; upphovspersonen —
 * den som la upp ordern — rattar bara kunduppgifterna och far en egen, kort vag
 * langre ner. Resten av den har texten galler chefsvagen.
 *
 * ===========================================================================
 * TVA HELT OLIKA SAKER, OCH DET AR PERIODEN SOM AVGOR VILKEN.
 *
 * ORDERN LIGGER I EN OPPEN MANAD — det vanliga fallet. Ingenting ar bokfort;
 * hela manaden raknas live ur orderna varje gang nagon oppnar vyn. Rattelsen
 * ar da bara en `update`, och talet andrar sig av sig sjalvt vid nasta lasning.
 *
 * ORDERN LIGGER I EN FASTSTALLD MANAD. Da finns bokforda poster som sager vad
 * som betalades ut, de gar inte att skriva om (`commission_entry` ar
 * append-only) och de SKA inte skrivas om — lonespecen ar redan utfardad.
 * Skillnaden bokfors i stallet i INNEVARANDE manad. Bestallarens val
 * 2026-09-09: augusti orord, september far mellanskillnaden.
 *
 * Rakningen ligger i `rattelseposter()` i `src/lib/rattelse.ts` — ren logik med
 * eget prov, bland annat ett som slumpar hundra rattelser och kontrollerar att
 * bokfort plus rattelse blir exakt det nya utfallet per person.
 * ===========================================================================
 *
 * PERIODEN SKYDDAS AV DATABASEN, inte av den har funktionen. `sales_order_stegbyte`
 * i 0051 nekar att en order flyttas ut ur eller in i en faststalld manad. Det ar
 * ratt plats: koden ritar formularet, databasen avgor.
 */
export async function redigeraOrder(_prev: Orderstate, form: FormData): Promise<Orderstate> {
  try {
    const user = await kravInloggad();
    const hanterare = farHantera(user);
    const id = String(form.get("id") ?? "");

    const db = supabaseAdmin();
    const { data: raddata } = await db
      .from("sales_order")
      .select(
        "id, status, salesperson_id, company_name, org_number, contact_name, contact_phone," +
          " package_id, term_months, signed_on, period_month, is_addon, note," +
          " commission_amount, commission_source, order_value, created_by",
      )
      .eq("id", id)
      .maybeSingle();

    // CASTEN AR INTE KOSMETISK. Supabase harleder radens typ ur select-STRANGEN,
    // och en lang sammansatt strang far den inte att ga ihop — resultatet blir
    // `GenericStringError`, alltsa en typ utan nagon av kolumnerna, och bygget
    // faller pa `rad.status`. Samma falla som `hamtaChefsposter` gick i
    // 2026-09-09; foljden ar att kolumnnamnen harunder maste stamma med
    // strangen ovan for hand.
    const rad = raddata as unknown as Record<string, string | number | boolean | null> | null;

    if (!rad) return { fel: "Ordern finns inte." };

    // ---------------------------------------------------------------------------
    // VEM SOM FAR RATTA, OCH HUR MYCKET. Bestallarens beslut 2026-09-10.
    //
    // CHEFSKRETSEN rattar allt. UPPHOVSPERSONEN — den som la upp ordern — rattar
    // bara faktauppgifterna: bolagsnamn, organisationsnummer, kontaktperson,
    // telefon och anteckning. Ingen annan rattar nagonting.
    //
    // Skalet till gransen ar konkret. En saljare som far satta beloppen pa sin
    // egen redan godkanda order kan kryssa "satt ordervarde och provision sjalv"
    // och skriva vilken siffra som helst — och for en order i en faststalld manad
    // hade skillnaden bokforts som en rattelsepost i innevarande manad, alltsa
    // gatt rakt ut i lonen. Loggen hade visat vem, men forst efterat.
    //
    // Gransen dras HAR OCH INTE I FORMULARET. Ett falt som inte ritas gar anda
    // att skicka; det ar den har raden som avgor, inte vilka input-element som
    // rakade renderas.
    // ---------------------------------------------------------------------------
    if (!hanterare && rad.created_by !== user.employee!.id) {
      return { fel: "Bara säljchef, VD, ekonomi och den som la upp ordern får rätta den." };
    }

    // UTKAST OCH INSKICKADE RATTAS INTE HAR. De har inga pengar bokforda och
    // ingen fryst provision — for dem ar vagen `rattaFranAvtal` eller att
    // skicka tillbaka ordern till saljaren. En makulerad order nekas av
    // triggern i 0051, med sitt eget besked.
    if (rad.status !== "signerad" && rad.status !== "betald") {
      return {
        fel:
          rad.status === "makulerad"
            ? "En makulerad order rättas inte. Lägg en ny order i stället."
            : "Bara en godkänd order rättas här. Skicka tillbaka den till säljaren i stället.",
      };
    }

    // ---------------------------------------------------------------------------
    // De nya vardena. Ett tomt falt betyder "orort", inte "tomt" — formularet
    // skickar allt forifyllt, men en halv inskickning ska inte nolla nagot.
    // ---------------------------------------------------------------------------
    const text = (falt: string, gammalt: unknown) => {
      const v = String(form.get(falt) ?? "").trim();
      return v || String(gammalt ?? "");
    };

    const bolag = text("company_name", rad.company_name);
    const kontakt = text("contact_name", rad.contact_name);
    const telefon = text("contact_phone", rad.contact_phone);

    const orgnr = normaliseraOrgnr(String(form.get("org_number") ?? rad.org_number));
    if (!orgnr) return { fel: "Organisationsnumret ska vara tio siffror, till exempel 556677-8899." };
    if (!bolag) return { fel: "Bolagsnamnet saknas." };
    if (!kontakt) return { fel: "Kontaktpersonen saknas." };
    if (!giltigTelefon(telefon)) return { fel: "Telefonnumret ser inte ut som ett nummer." };

    const skal = String(form.get("reason") ?? "").trim();
    if (!skal) return { fel: "En rättelse kräver ett skäl. Det är det första någon frågar efter." };

    const note = String(form.get("note") ?? "").trim() || (rad.note as string | null);

    // ===========================================================================
    // UPPHOVSPERSONENS RATTELSE. Egen vag, och det ar avsiktligt.
    //
    // Den hade gatt att skriva som villkor i vagen nedan — "ta radens varde i
    // stallet for formularets nar personen inte ar chef" — men da hade varje
    // framtida falt behovt komma ihag samma villkor, och det ena som glommdes
    // hade blivit en oppen kassa. Har finns beloppen helt enkelt inte: ingen
    // omrakning, ingen `commission_entry`, ingen rad i
    // `order_manager_commission`. Bara fem kolumner, en logg och en revalidate.
    //
    // `sales_order_stegbyte` i 0051 skyddar perioden anda, sa en faststalld manad
    // ar utom fara aven om nagon skulle lagga till ett datumfalt har.
    // ===========================================================================
    if (!hanterare) {
      const { error } = await db
        .from("sales_order")
        .update({
          company_name: bolag,
          org_number: orgnr,
          contact_name: kontakt,
          contact_phone: telefon,
          note,
        })
        .eq("id", id);

      if (error) return { fel: `Ordern rättades inte: ${error.message}` };

      await logga(user, "sales_order.corrected", id, {
        skal,
        rackvidd: "fakta",
        fore: {
          company_name: rad.company_name,
          org_number: rad.org_number,
          contact_name: rad.contact_name,
          contact_phone: rad.contact_phone,
          note: rad.note,
        },
        efter: { company_name: bolag, org_number: orgnr, contact_name: kontakt, contact_phone: telefon, note },
        rattelseposter: 0,
      });

      // INGEN NOTIS. Notisen `order-rattad` betyder att ett belopp andrats, och
      // ett rattat telefonnummer betyder inte det. Se villkoret `rorPengar` i
      // chefsvagen nedan — det ar samma regel, tillampad genom att inte finnas.
      revalidatePath("/order");
      return { ok: "Kunduppgifterna är rättade. Beloppen ändras av säljchefen." };
    }

    // ---------------------------------------------------------------------------
    // Harifran ar det chefskretsen som rattar, och da ligger allt pa bordet.
    // ---------------------------------------------------------------------------
    const signerad = text("signed_on", rad.signed_on);
    const saljare = text("salesperson_id", rad.salesperson_id);
    const paket = Number(form.get("package_id") ?? rad.package_id);
    const loptid = Number(form.get("term_months") ?? rad.term_months);

    if (![1, 2, 3].includes(paket)) return { fel: "Välj ett paket." };
    if (![12, 24, 36].includes(loptid)) return { fel: "Välj en avtalstid." };
    if (!giltigtSigneringsdatum(signerad)) {
      return { fel: "Signeringsdatumet är ogiltigt eller ligger i framtiden." };
    }

    // ---------------------------------------------------------------------------
    // Affaren raknas om FRAN GRUNDEN, med samma funktion som godkannandet
    // anvander. Att rakna den pa ett andra satt har hade gett tva tolkningar av
    // "40 % eller matrisen", och den dagen de sager olika ar det inte uppenbart
    // vilken som har ratt.
    // ---------------------------------------------------------------------------
    const nya = await raknaFramProvision(paket, loptid, signerad, saljare, form);
    if (!nya.klar) return { fel: nya.fel };

    if (nya.satt.commission_source === "manual" && !note) {
      return { fel: "En handsatt provision kräver en anteckning om varför." };
    }

    // Det gamla overtacket, for att kunna rakna skillnaden och for att veta om
    // raden ska uppdateras, laggas till eller tas bort.
    const { data: overtacksdata } = await db
      .from("order_manager_commission")
      .select("manager_id, amount")
      .eq("order_id", id)
      .maybeSingle();

    const gammaltOvertack = overtacksdata as unknown as
      | { manager_id: string; amount: string | number }
      | null;

    const fore = {
      saljare: rad.salesperson_id as string,
      provision: Number(rad.commission_amount ?? 0),
      chef: gammaltOvertack?.manager_id ?? null,
      overtack: Number(gammaltOvertack?.amount ?? 0),
    };
    const efter = {
      saljare,
      provision: nya.satt.commission_amount,
      chef: nya.overtack?.manager_id ?? null,
      overtack: nya.overtack?.amount ?? 0,
    };

    // ---------------------------------------------------------------------------
    // Ar orderns manad faststalld?
    //
    // FRAGAN STALLS PA DEN GAMLA PERIODEN. Den nya kan inte vara en annan
    // faststalld manad — triggern i 0051 nekar bade att flytta ut ur och in i en
    // stangd period — sa de tva ar antingen samma manad eller bada oppna.
    // ---------------------------------------------------------------------------
    const { data: stangd } = await db
      .from("commission_period")
      .select("period_month")
      .eq("period_month", rad.period_month as string)
      .maybeSingle();

    let rattelser: { employee_id: string; belopp: number; text: string }[] = [];
    const bokforingsmanad = manadsnyckel();

    if (stangd) {
      rattelser = rattelseposter(fore, efter, `${bolag}, tecknad ${rad.signed_on}`);

      if (rattelser.length > 0) {
        // INNEVARANDE MANAD MASTE VARA OPPEN. Ar den redan faststalld ar dess
        // lonekorning pa vag, och en post som landar dar kan missas. Da ar ratt
        // svar att saga till — inte att gissa en annan manad at nagon.
        const { data: ocksaStangd } = await db
          .from("commission_period")
          .select("period_month")
          .eq("period_month", bokforingsmanad)
          .maybeSingle();

        if (ocksaStangd) {
          return {
            fel: `${manadsnamn(bokforingsmanad)} är också fastställd, så rättelsen har ingen öppen månad att landa i. Bokför den för hand på provisionssidan.`,
          };
        }
      }
    }

    // ---------------------------------------------------------------------------
    // Skrivningen. ORDNINGEN AR MEDVETEN — posterna forst, ordern sedan.
    //
    // Faller det mitt i star ordern kvar som den var, med ett par rattelseposter
    // bokforda som inte motsvarar nagon andring. Det ar synligt och gar att
    // rätta med en motpost. Omvand ordning hade gett en andrad order vars pengar
    // aldrig bokfordes — alltsa en tyst felaktig utbetalning.
    // ---------------------------------------------------------------------------
    if (rattelser.length > 0) {
      const { error } = await db.from("commission_entry").insert(
        rattelser.map((r) => ({
          employee_id: r.employee_id,
          period_month: bokforingsmanad,
          amount: r.belopp,
          kind: "rattelse",
          source: "manual",
          note: `${r.text} · ${skal}`,
          sales_order_id: id,
          entered_by: user.employee!.id,
        })),
      );

      if (error) return { fel: `Rättelseposterna bokfördes inte: ${error.message}` };
    }

    const { error: orderfel } = await db
      .from("sales_order")
      .update({
        company_name: bolag,
        org_number: orgnr,
        contact_name: kontakt,
        contact_phone: telefon,
        package_id: paket,
        term_months: loptid,
        salesperson_id: saljare,
        signed_on: signerad,
        is_addon: form.get("is_addon") === "on",
        note,
        ...nya.satt,
      })
      .eq("id", id);

    if (orderfel) return { fel: `Ordern rättades inte: ${orderfel.message}` };

    // OVERTACKET FOLJER MED. Raden ar skrivbar sedan 0051 — den beskriver
    // affaren som den ar, till skillnad fran huvudboken som beskriver vad som
    // bokforts. Tre fall: den fanns och ska bort, den ska finnas, eller ingetdera.
    if (gammaltOvertack && !nya.overtack) {
      await db.from("order_manager_commission").delete().eq("order_id", id);
    } else if (nya.overtack) {
      await db.from("order_manager_commission").upsert({
        order_id: id,
        manager_id: nya.overtack.manager_id,
        order_value: nya.overtack.order_value,
        base: nya.overtack.base,
        percent: nya.overtack.percent,
        amount: nya.overtack.amount,
        rate_id: nya.overtack.rate_id,
      });
    }

    // LOGGEN BAR FORE OCH EFTER. En logg som bara sager "ordern rattades" gar
    // inte att granska, och det ar granskningen hela rattelsevagen vilar pa.
    await logga(user, "sales_order.corrected", id, {
      skal,
      fore: {
        salesperson_id: fore.saljare,
        commission_amount: fore.provision,
        order_value: rad.order_value === null ? null : Number(rad.order_value),
        package_id: rad.package_id,
        term_months: rad.term_months,
        signed_on: rad.signed_on,
        overtack: fore.chef ? { manager_id: fore.chef, amount: fore.overtack } : null,
      },
      efter: {
        salesperson_id: efter.saljare,
        commission_amount: efter.provision,
        order_value: nya.satt.order_value,
        package_id: paket,
        term_months: loptid,
        signed_on: signerad,
        overtack: nya.overtack
          ? { manager_id: nya.overtack.manager_id, amount: nya.overtack.amount }
          : null,
      },
      rattelseposter: rattelser.length,
    });

    // NOTISEN GAR BARA UT NAR PENGAR ANDRATS. Ett rattat telefonnummer ska inte
    // saga till nagon om ett belopp — och en notis som ibland betyder pengar och
    // ibland inte ar en notis folk slutar lasa.
    if (rorPengar(fore, efter)) {
      const berorda = new Set([fore.saljare, efter.saljare]);
      if (fore.chef) berorda.add(fore.chef);
      if (efter.chef) berorda.add(efter.chef);
      berorda.delete(user.employee!.id);

      for (const person of berorda) {
        const min = rattelser.filter((r) => r.employee_id === person);
        const belopp = min.reduce((s, r) => s + r.belopp, 0);

        await notifiera({
          till: person,
          av: user.employee!.id,
          kalla: "order-rattad",
          typ: "order",
          rubrik: `Ordern ${bolag} är rättad`,
          detalj: stangd
            ? `${manadsnamn(String(rad.period_month))} är fastställd, så ${
                belopp === 0 ? "ingen skillnad" : kronor(belopp)
              } bokförs i ${manadsnamn(bokforingsmanad)}. ${skal}`
            : `${skal} · räknas om i ${manadsnamn(String(rad.period_month))}`,
          href: "/order",
          objekt: { typ: "sales_order", id },
        });
      }
    }

    revalidatePath("/order");
    revalidatePath("/provision");
    return {
      ok:
        rattelser.length > 0
          ? `Ordern är rättad. ${manadsnamn(String(rad.period_month))} står orörd — skillnaden är bokförd i ${manadsnamn(bokforingsmanad)} som ${rattelser.length} ${rattelser.length === 1 ? "post" : "poster"}.`
          : "Ordern är rättad.",
    };
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
