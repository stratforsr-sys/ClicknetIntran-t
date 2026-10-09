"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { tomUtkorgen } from "@/lib/utkorg-server";
import {
  bolagsuppslag,
  inkioKonfigurerad,
  kundaktivitet,
  landningssida,
  type Kundaktivitet,
  type Landningssida,
} from "@/lib/crm/inkio";
import { getCurrentUser, hasRole, type CurrentUser } from "@/lib/auth";
import { svensktDatum } from "@/lib/klocka";
import { kronor, manadsnamn, manadsnyckel, tolkaBelopp } from "@/lib/provision";
import { rattelseposter, rorPengar } from "@/lib/rattelse";
import { forberedUppladdning, registreraFil, taBortInnehall } from "@/lib/filer-server";
import { las, taBort } from "@/lib/lagring-server";
import { tolkaLager } from "@/lib/lagring";
import { pdfText } from "@/lib/pdf";
import { tolkaAvtalstext, type Orderforslag } from "@/lib/orderbilaga";
import {
  kopplaForHand,
  provaSaljsamtal,
  samtalskandidater,
  svepKoppling,
  type Samtalskandidat,
} from "@/lib/samtal-order-server";
import { notifiera, notifieraFlera, orderkretsen } from "@/lib/notishandelse-server";
import {
  LOPTIDER,
  affarensVarde,
  avtalsslut,
  gallandeSats,
  giltigBindningstid,
  giltigMejl,
  giltigTelefon,
  giltigtSigneringsdatum,
  harStangdPeriod,
  normaliseraOrgnr,
  periodFor,
  type Orderstatus,
  type Sats,
  type Tjanst,
} from "@/lib/order";
import {
  affarenFor,
  arEgenForsaljning,
  gallandeChefssats,
  procentProvision,
  restpostenAtNoll,
  type Chefssats,
  type Overtack,
  type Saljarkalla,
} from "@/lib/chefsprovision";
import {
  gallandeUtkopssats,
  harUtkop,
  nettoEfterUtkop,
  utkopsprovision,
  type Utkopssats,
} from "@/lib/utkop";
import {
  finansavgift,
  finansprocent,
  gallandeFinanssats,
  nettoEfterFinans,
  procenttext,
  type Finanssats,
} from "@/lib/finans";

/**
 * Finansvalet, ur ett formular (0079).
 *
 * `null` betyder att formularet INTE RITADE kryssrutan — da galler det ordern
 * redan bar. Samma dolda falt som utkopet anvander, och av samma skal: en
 * kryssruta som inte ar ikryssad skickar ingenting alls, sa "nagon tog bort
 * krysset" gar annars inte att skilja fran "rutan fanns inte".
 */
function finansUrFormular(form: FormData): boolean | null {
  if (!form.has("finans_ritad")) return null;
  return form.get("finans") === "on";
}

/**
 * Meningen som forklarar finansavdraget, eller tomt nar affaren inte bar nagot.
 * Star i kvittensen av samma skal som `utkopstext`: ett lagre belopp an vantat
 * ska forklaras i samma andetag som det visas.
 */
function finanstext(f: { avgift: number; procent: number; procentPerAr: number; loptid: number } | null): string {
  if (!f) return "";
  return ` Finansavgiften ${kronor(f.avgift)} (${procenttext(f.procent)} — ${procenttext(f.procentPerAr)} per år i ${f.loptid} mån) är avdragen från ordervärdet.`;
}

/**
 * Utkopet, ur ett formular. `null` nar faltet ar tomt eller kryssrutan av.
 *
 * ETT TOMT FALT ÄR INTE NOLL. Kryssar nagon i "affaren har ett utkop" och sedan
 * i ur den igen star texten kvar i faltet, sa det ar KRYSSRUTAN som avgor —
 * annars hade ett bortglomt tal bytt provisionskalla pa en vanlig paketorder.
 *
 * Returnerar en STRANG vid fel i stallet for att kasta. Beloppet kommer fran en
 * manniska som skriver kronor, och "18 000" ska ga lika bra som "18000".
 */
function utkopUrFormular(form: FormData): { utkop: number | null } | { fel: string } {
  if (form.get("har_utkop") !== "on") return { utkop: null };

  const text = String(form.get("buyout_amount") ?? "").trim();
  if (!text) return { fel: "Kryssrutan för utköp är i, men beloppet saknas." };

  const belopp = tolkaBelopp(text);
  if (belopp === null) return { fel: "Utköpsbeloppet gick inte att tolka." };
  if (belopp <= 0) {
    return { fel: "Ett utköp på noll kronor är inget utköp. Ta bort krysset i stället." };
  }

  return { utkop: belopp };
}

/**
 * Svaret ett orderformular far tillbaka.
 *
 * `orderId` satts BARA av `skapaOrder`, och bara nar raden faktiskt skrevs.
 * Den finns for att avtalet ska ga att ladda upp utan att lamna formularet:
 * bade den signerade adressen och registreringen haenger pa orderns id (0039),
 * sa uppladdningsrutan kan inte ritas forran id:t finns. Se `Nyorder.tsx`.
 */
export type Orderstate = { fel?: string; ok?: string; orderId?: string };

/**
 * Tillaggstjansterna, ur formularet.
 *
 * ===========================================================================
 * LISTAN KOMMER SOM JSON I ETT FALT, och det ar ett val.
 *
 * Antalet tjanster ar obestamt — det ar hela poangen med raderna — och
 * indexerade faltnamn (`tjanst_namn_0`, `tjanst_namn_1`) tvingar servern att
 * gissa var listan tar slut genom att rakna uppat tills ett falt saknas. En
 * bortglomd rad mitt i hade da tyst kapat resten.
 *
 * DEN HAR FUNKTIONEN AR ENDA STALLET JSON:EN TOLKAS, och den litar inte pa
 * nagot i den: talen ar pengar som gar rakt in i provisionsunderlaget genom
 * `affarensVarde`. Varje falt provas, och ett fel blir en mening till
 * anvandaren i stallet for en rad i databasen.
 * ===========================================================================
 */
function tjansterUrFormular(form: FormData): { tjanster: Tjanst[] } | { fel: string } {
  const text = String(form.get("tjanster") ?? "").trim();
  if (!text) return { tjanster: [] };

  let ratt: unknown;
  try {
    ratt = JSON.parse(text);
  } catch {
    return { fel: "Tjänsterna på ordern gick inte att läsa. Ladda om sidan och försök igen." };
  }
  if (!Array.isArray(ratt)) {
    return { fel: "Tjänsterna på ordern gick inte att läsa. Ladda om sidan och försök igen." };
  }

  // Tjugo ar ingen asikt om hur manga tjanster en affar kan ha, utan en
  // yttre grans: en klient som skickar tusen rader ska motas av en mening och
  // inte av tusen inserts.
  if (ratt.length > 20) return { fel: "Högst tjugo tjänster per order." };

  const tjanster: Tjanst[] = [];

  for (const rad of ratt as Record<string, unknown>[]) {
    const namn = String(rad.name ?? "").trim();
    if (!namn) return { fel: "En tjänst saknar namn." };

    const fakturering = String(rad.billing ?? "");
    if (fakturering !== "engang" && fakturering !== "manad") {
      return { fel: `Välj engångsavgift eller månadsavgift för "${namn}".` };
    }

    const belopp =
      typeof rad.amount === "number" ? rad.amount : tolkaBelopp(String(rad.amount ?? ""));
    if (belopp === null || belopp <= 0) {
      return { fel: `Beloppet för "${namn}" gick inte att tolka.` };
    }

    // EN ENGANGSAVGIFT HAR ALDRIG EGEN BINDNINGSTID. Den kan inte loepa ut, och
    // `tjanst_engang_utan_bindning` i 0068 nekar raden — men beskedet ska komma
    // harifran som en mening, inte som ett villkorsnamn ur databasen.
    const egenBindning = fakturering === "manad" && rad.follows_order === false;

    let manader: number | null = null;
    let start: string | null = null;

    if (egenBindning) {
      manader = Number(rad.term_months);
      start = String(rad.starts_on ?? "");
      if (!giltigBindningstid(manader)) {
        return { fel: `Bindningstiden för "${namn}" ska vara 1–60 hela månader.` };
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) {
        return { fel: `Startdatumet för "${namn}" saknas.` };
      }
    }

    tjanster.push({
      name: namn,
      billing: fakturering,
      amount: belopp,
      follows_order: fakturering === "manad" && !egenBindning,
      term_months: manader,
      starts_on: start,
    });
  }

  return { tjanster };
}

/**
 * Skriver om orderns tjansterader till precis den lista som skickades in.
 *
 * ===========================================================================
 * ALLT BORT OCH ALLT IN IGEN, inte en jamforelse rad for rad.
 *
 * Raderna har ingen identitet i formularet — klientens `nyckel` ar Reacts och
 * nar aldrig hit — sa det finns inget satt att veta om rad tva ar samma rad som
 * forra gangen eller en ny pa samma plats. En "smart" jamforelse hade darfor
 * gissat, och gissningen syns forst nar ett belopp hamnat pa fel tjanst.
 *
 * Tjansteraderna bar ingenting eget som gar forlorat av en omskrivning — inget
 * id utat, ingen logg, ingen notis pekar pa dem. UNDANTAGET ar fornyelsen:
 * `renewal_outcome` pa en tjanst ar nagot nagon TRYCKT PA, och den far inte
 * suddas av en rattelse langre fram. Darfor lamnas rader som redan ar hanterade
 * i fred, och bara de ohanterade skrivs om.
 * ===========================================================================
 */
async function skrivTjanster(orderId: string, tjanster: Tjanst[]): Promise<string | null> {
  const db = supabaseAdmin();

  const { error: raderafel } = await db
    .from("sales_order_service")
    .delete()
    .eq("order_id", orderId)
    .is("renewal_outcome", null);

  if (raderafel) return `Tjänsterna kunde inte skrivas: ${raderafel.message}`;

  if (tjanster.length === 0) return null;

  const { error } = await db.from("sales_order_service").insert(
    tjanster.map((t, i) => ({
      order_id: orderId,
      name: t.name,
      billing: t.billing,
      amount: t.amount,
      follows_order: t.follows_order,
      term_months: t.term_months,
      starts_on: t.starts_on,
      sort: i,
    })),
  );

  return error ? `Tjänsterna kunde inte skrivas: ${error.message}` : null;
}

/** Tjansterna som ALREDAN star pa en order, i den form rakningen vill ha dem. */
async function tjansterPaOrder(orderId: string): Promise<Tjanst[]> {
  const { data } = await supabaseAdmin()
    .from("sales_order_service")
    .select("name, billing, amount, follows_order, term_months, starts_on")
    .eq("order_id", orderId)
    .order("sort");

  // Casten av samma skal som `hamtaRad` ovan: en select-strang over en viss
  // langd ger `GenericStringError` i stallet for en radtyp. Strangen har ar
  // kortare an den som fallde bygget 2026-09-24, men gransen ar inte skriven
  // nagonstans — och en cast kostar ingenting.
  const rader = (data ?? []) as unknown as Record<string, unknown>[];

  return rader.map((t) => ({
    name: String(t.name),
    billing: t.billing as Tjanst["billing"],
    amount: Number(t.amount),
    follows_order: Boolean(t.follows_order),
    term_months: t.term_months === null ? null : Number(t.term_months),
    starts_on: t.starts_on === null ? null : String(t.starts_on).slice(0, 10),
  }));
}

/**
 * Meningen som forklarar en utkopsaffar, eller tomt nar det inte ar en.
 *
 * STAR I KVITTENSEN OCH I NOTISEN, inte bara i en tabell. Den som godkant en
 * order pa 11 940 kr och far se 1 433 kr i provision ska fa veta VARFOR i samma
 * andetag — annars ar nasta steg ett mejl till saljchefen, och det ar precis
 * den sortens fraga navet finns for att slippa.
 */
function utkopstext(u: { utkop: number; netto: number; procent: number } | null): string {
  if (!u) return "";
  return ` Utköpet ${kronor(u.utkop)} är avdraget, så provisionen är ${u.procent} % av ${kronor(u.netto)}.`;
}

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

/**
 * Ordern, sa som skrivningen behover kanna den.
 *
 * ===========================================================================
 * TYPEN AR SKRIVEN FOR HAND, OCH DET ÄR INTE KOSMETIK.
 *
 * Supabase harleder radens typ ur select-STRANGEN. En strang over en viss langd
 * far den inte att ga ihop, och resultatet blir `GenericStringError` — alltsa en
 * typ UTAN nagon av kolumnerna. Bygget faller da pa `rad.salesperson_id`, inte
 * pa nagot som ar fel i fragan.
 *
 * Det hande har 2026-09-15: `buyout_amount` la till tretton tecken, strangen
 * tippade over gransen, och tre anropare som aldrig rorts slutade kompilera.
 * Samma falla som `hamtaChefsposter` gick i 2026-09-09 och `redigeraOrder`
 * strax darefter; de tva loste den med en cast till `Record<string, unknown>`.
 *
 * HAR STAR EN RIKTIG TYP I STALLET. Skillnaden mot en `Record`-cast ar att
 * anroparna behaller sitt skydd: `rad.package_id` ar ett `number` och inte ett
 * `unknown` som maste `Number()`:as pa varje anvandning. Priset ar att faltlistan
 * nedan maste stamma med select-strangen FOR HAND — de kontrolleras inte mot
 * varandra av nagot.
 * ===========================================================================
 */
type Orderrad_skrivning = {
  id: string;
  status: Orderstatus;
  salesperson_id: string;
  company_name: string;
  package_id: number;
  term_months: number;
  signed_on: string;
  /** 0068. Behovs av godkannandet: en fri order har sitt eget manadsbelopp. */
  monthly_amount: number | string | null;
  commission_amount: number | string | null;
  buyout_amount: number | string | null;
  /** 0079. Saljaren valde finans; godkannandet raknar avgiften. */
  financed: boolean;
};

async function hamtaRad(id: string): Promise<Orderrad_skrivning | null> {
  const { data } = await supabaseAdmin()
    .from("sales_order")
    // `company_name` las inte fore 2026-09-03. Den behovs i notisrubrikerna:
    // "Din order pa Nordbygg AB godkandes" sager vilken order det galler,
    // "Din order godkandes" gor det inte for den som har fyra inne samtidigt.
    // `buyout_amount` las in 2026-09-15. Utkopet skrivs av SALJAREN nar hen
    // skickar in ordern, och godkannandet maste rakna pa det — annars hade
    // affaren fatt matrisens belopp trots att en del av vardet redan gatt ut.
    .select(
      "id, status, salesperson_id, company_name, package_id, term_months, signed_on," +
        " monthly_amount, commission_amount, buyout_amount, financed",
    )
    .eq("id", id)
    .maybeSingle();
  return (data as unknown as Orderrad_skrivning | null) ?? null;
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

    // ===========================================================================
    // SALJAREN MASTE VARA VALD, och det ar bestallarens besked 2026-09-24:
    // *"personen ar alltid forvald"*.
    //
    // Formularet har inget forval langre, men ett tomt falt far inte tyst falla
    // tillbaka pa den inloggade — da hade borttagandet av forvalet bytt ett
    // synligt fel mot ett osynligt. For SALJAREN sjalv finns ingen valjare alls,
    // och da ar hen sjalvklar; kravet galler bara den som far valja.
    // ===========================================================================
    if (hanterare && !valdSaljare) return { fel: "Välj vilken säljare ordern gäller." };

    const bolag = String(form.get("company_name") ?? "").trim();
    if (!bolag) return { fel: "Bolagsnamnet saknas." };

    const orgnr = normaliseraOrgnr(String(form.get("org_number") ?? ""));
    if (!orgnr) return { fel: "Organisationsnumret ska vara tio siffror, till exempel 556677-8899." };

    const kontakt = String(form.get("contact_name") ?? "").trim();
    if (!kontakt) return { fel: "Kontaktpersonen saknas." };

    const telefon = String(form.get("contact_phone") ?? "").trim();
    if (!giltigTelefon(telefon)) return { fel: "Telefonnumret ser inte ut som ett nummer." };

    // MEJLEN AR FRIVILLIG (0060). Ett tomt falt ar ett giltigt svar; en ifylld
    // adress som inte ar en adress ar det inte — da ar det ett skrivfel, och det
    // ar battre att saga det nu an att nagon skickar avtalet till ingenstans.
    const mejlText = String(form.get("contact_email") ?? "").trim();
    if (mejlText && !giltigMejl(mejlText)) {
      return { fel: "Mejladressen ser inte ut som en adress. Lämna fältet tomt om den saknas." };
    }
    const mejl = mejlText || null;

    // KUNDENS ADRESS (0075). Inkio vägrar en kund utan, och Bolagsverket har
    // ingen för en enskild firma. Formuläret förifyller den för ett aktiebolag
    // (`slaUppBolag`); säljaren skriver den för en enskild firma.
    const gata = String(form.get("customer_street") ?? "").trim();
    const postnummer = String(form.get("customer_postal_code") ?? "").trim();
    const ort = String(form.get("customer_city") ?? "").trim();
    if (!gata || !postnummer || !ort) return { fel: "Skriv kundens adress: gata, postnummer och ort." };

    // AVTALET (0075, beställarens besked 2026-10-07): ingen order läggs upp utan
    // det påskrivna avtalet. Filen är redan uppladdad (`forberedNyttAvtal`) —
    // här kopplas den till ordern, innan ordern lämnar utkastet.
    const avtalFil = String(form.get("avtal_fil_id") ?? "").trim();
    const avtalStore = String(form.get("avtal_store") ?? "").trim();
    const avtalNamn = String(form.get("avtal_filnamn") ?? "").trim() || "avtal.pdf";
    if (!avtalFil) return { fel: "Ladda upp det påskrivna avtalet (PDF) innan ordern läggs upp." };

    const utkopsval = utkopUrFormular(form);
    if ("fel" in utkopsval) return { fel: utkopsval.fel };

    // FINANSEN (0079). Ny order: ingen ritad ruta betyder ingen finans.
    const finans = finansUrFormular(form) ?? false;

    const paket = Number(form.get("package_id"));
    const loptid = Number(form.get("term_months"));
    if (![1, 2, 3].includes(paket)) return { fel: "Välj ett paket." };

    // ===========================================================================
    // "FOLJER INTE PAKETREGLERNA" AVGOR VILKEN BINDNINGSTID SOM AR GILTIG.
    //
    // En paketorder maste halla sig till matrisens tre: provisionen slas upp pa
    // kombinationen paket + lopstid i `commission_rate`, och en lopstid utanfor
    // matrisen har ingen sats att sla upp — ordern hade fallit senare, pa ett
    // meddelande om saknad sats som inte sager vad som ar fel.
    //
    // En FRI order far vilket tal som helst inom databasens ram, for dess belopp
    // satts anda for hand. Bestallarens val 2026-09-24.
    // ===========================================================================
    const friOrder = hanterare && form.get("fri_order") === "on";

    if (friOrder) {
      if (!giltigBindningstid(loptid)) {
        return { fel: "Bindningstiden ska vara mellan 1 och 60 hela månader." };
      }
    } else if (!(LOPTIDER as readonly number[]).includes(loptid)) {
      return { fel: "Välj en bindningstid." };
    }

    const manadsbelopp = friOrder ? tolkaBelopp(String(form.get("monthly_amount") ?? "")) : null;
    if (friOrder && (manadsbelopp === null || manadsbelopp <= 0)) {
      return { fel: "Skriv vad kunden betalar per månad." };
    }

    const signerad = String(form.get("signed_on") ?? "").trim();
    if (!giltigtSigneringsdatum(signerad)) {
      return { fel: "Signeringsdatumet är ogiltigt eller ligger i framtiden." };
    }

    // ===========================================================================
    // STARTDATUMET, OCH VARFOR DET INTE FAR VARA SIGNERINGSDATUMET TYST.
    //
    // Ett avtal signeras ofta innan det borjar galla. Slutdatumet — och darmed
    // hela bevakningen — raknas fran STARTEN, sa ett falt som fyllde i sig sjalvt
    // hade last som ett svar nagon gett. Formularet har en knapp for den som vill
    // ha samma datum, och den kraver ett tryck.
    //
    // Framtiden ar TILLATEN har, till skillnad fran for signeringen: en
    // forlangning tecknas medan det gamla avtalet fortfarande loper, och da
    // borjar det nya nagon gang fram i tiden. Det ar inte en prognos utan ett
    // datum i avtalet.
    // ===========================================================================
    const startdatum = String(form.get("starts_on") ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startdatum)) {
      return { fel: "Skriv när avtalet börjar gälla." };
    }
    if (startdatum < signerad) {
      return { fel: "Avtalet kan inte börja gälla innan det signerades." };
    }

    const tjansteval = tjansterUrFormular(form);
    if ("fel" in tjansteval) return { fel: tjansteval.fel };

    const note = String(form.get("note") ?? "").trim() || null;
    const tillagg = form.get("is_addon") === "on";

    // Chefen kan godkanna i samma steg. Saljaren skickar in.
    const godkannDirekt = hanterare && form.get("godkann") === "on";

    const insats: Record<string, unknown> = {
      company_name: bolag,
      org_number: orgnr,
      contact_name: kontakt,
      contact_phone: telefon,
      contact_email: mejl,
      customer_street: gata,
      customer_postal_code: postnummer,
      customer_city: ort,
      package_id: paket,
      term_months: loptid,
      salesperson_id: saljare,
      signed_on: signerad,
      starts_on: startdatum,
      is_addon: tillagg,
      // MANADSBELOPPET SKRIVS REDAN PA EN INSKICKAD ORDER, av samma skal som
      // utkopet gor det: saljaren vet vad kunden betalar, godkannaren gor det
      // inte. `null` pa en paketorder — da star priset i `sales_package` tills
      // godkannandet fryser det pa raden.
      monthly_amount: manadsbelopp,
      // UTKOPET SKRIVS AVEN PA EN INSKICKAD ORDER. Saljaren vet om affaren bar
      // ett utkop; godkannaren gor det inte. Villkoret `sales_order_utkop_ryms`
      // i 0060 slapper darfor igenom ett utkop utan ordervarde, och biter forst
      // nar ordern godkanns och bada talen finns.
      buyout_amount: utkopsval.utkop,
      // FINANSVALET SKRIVS OCKSA PA EN INSKICKAD ORDER, av samma skal som
      // utkopet. Avgiften i kronor raknas och fryses forst vid godkannandet.
      financed: finans,
      note,
      status: godkannDirekt ? "signerad" : "inskickad",
      created_by: user.employee!.id,
    };

    let affar: Extract<Framrakning, { klar: true }> | null = null;

    if (godkannDirekt) {
      const provision = await raknaFramProvision(
        paket,
        loptid,
        signerad,
        saljare,
        form,
        utkopsval.utkop,
        { manadsbelopp, tjanster: tjansteval.tjanster, finans },
      );
      if (!provision.klar) return { fel: provision.fel };

      // ANTECKNINGSKRAVET ÄR BORTA (0060, bestallarens besked 2026-09-15).
      //
      // Har stod tidigare en sparr: ett handsatt belopp krävde en anteckning.
      // Regeln var vallovlig och kostade en dyrare uppgift an den skyddade.
      // Kravet slog till NAR KNAPPEN TRYCKTES, svaret kom tillbaka som ett fel,
      // React aterstallde formularet — och signeringsdatumet foll tillbaka pa
      // dagens datum. En augustiaffar hamnade i september utan att nagon sag det
      // ske. Hela resonemanget star i 0060 avsnitt 3.
      //
      // Sparbarheten bars anda: `audit_log` bar belopp och kalla pa varje
      // godkannande, och `commission_source = 'manual'` sager rakt ut att nagon
      // skrev in talet. Anteckningen finns kvar som falt, och vyn uppmuntrar
      // den — men den hindrar inte langre en riktig affar fran att registreras.

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

    // ===========================================================================
    // TRE SKRIVNINGAR I EN BESTAMD ORDNING, OCH ORDNINGEN AR HELA POANGEN.
    //
    // Tjansterna ligger i en EGEN TABELL och kan darfor inte skrivas i samma
    // insert som ordern — de behover orderns id, som inte finns forran raden ar
    // gjord. Samtidigt raknas deras varde IN i `order_value`, som fryses i samma
    // sekund ordern blir `signerad`.
    //
    // Skrevs ordern direkt som godkand och tjansterna efterat, skulle ett fel i
    // andra steget lamna en godkand order vars frusna ordervarde — och darmed
    // provision och overtack — bygger pa tjanster som inte finns. En tyst
    // felaktig utbetalning, alltsa, och just den sortens fel som 0051 och 5.6
    // handlar om.
    //
    // Darfor: ordern som UTKAST, tjansterna, och forst da statusen och beloppen.
    // Faller nagot pa vagen star ett utkast kvar — synligt, rattbart, och utan
    // en enda krona bokford. `utkast -> inskickad` och `utkast -> signerad` ar
    // bada tillatna steg i triggern (0034), sa vagen ar densamma som forut.
    // ===========================================================================
    // De falt som bara far finnas fran och med `signerad`. Villkoret
    // `sales_order_provision_satt` i 0034 nekar dem pa ett utkast — ett belopp
    // pa ett utkast ser ut som ett loste — sa de lyfts ur och skrivs i steg tre.
    const FRYSTA = [
      "commission_amount",
      "commission_source",
      "commission_rate_id",
      "order_value",
      "order_value_source",
      "monthly_amount",
      // Finansavgiften fryses med provisionen (0079). Den ar en del av
      // rakningen, inte av avtalet — valet `financed` star kvar pa utkastet.
      "finance_amount",
      "finance_rate_id",
      "approved_by",
      "approved_at",
    ] as const;

    const slutligStatus = insats.status;
    const slutligt: Record<string, unknown> = {};

    for (const nyckel of FRYSTA) {
      // BARA DE FALT SOM FAKTISKT SATTES. En inskickad order har ingen
      // provision, och att skriva `undefined` over `monthly_amount` hade nollat
      // det saljaren just skrev in.
      if (nyckel in insats) {
        slutligt[nyckel] = insats[nyckel];
        delete insats[nyckel];
      }
    }

    // Manadsbeloppet hor inte till provisionen och ska sta kvar pa utkastet.
    // Det ar en uppgift OM AVTALET, inte om pengar till nagon.
    if ("monthly_amount" in slutligt) {
      insats.monthly_amount = slutligt.monthly_amount;
    }

    insats.status = "utkast";

    const { data: rad, error } = await supabaseAdmin()
      .from("sales_order")
      .insert(insats)
      .select("id")
      .single();

    if (error || !rad) return { fel: `Ordern sparades inte: ${error?.message ?? "okänt fel"}` };

    const tjanstfel = await skrivTjanster(rad.id, tjansteval.tjanster);
    if (tjanstfel) {
      return {
        fel: `${tjanstfel} Ordern ligger kvar som utkast på ${bolag} — komplettera den där.`,
        orderId: rad.id,
      };
    }

    // Avtalet pa ordern INNAN den lamnar utkastet — samma skal som tjansterna:
    // faller det star ett utkast kvar, och `skickaInOrder` kraver avtalet.
    const avtalet = await registreraFil({
      fileId: avtalFil,
      andamal: "sales_order",
      filnamn: avtalNamn,
      store: avtalStore,
      uploadedBy: user.employee!.id,
      salesOrderId: rad.id,
      subjectEmployeeId: null,
    });
    if ("fel" in avtalet) {
      return {
        fel: `Avtalet kunde inte kopplas till ordern: ${avtalet.fel} Ordern ligger kvar som utkast på ${bolag} — ladda upp avtalet där och skicka in den.`,
        orderId: rad.id,
      };
    }

    // SÄLJSAMTALET (beställaren 2026-10-08): ingen order lämnar utkastet utan
    // säljarens eget samtal från Lynes på kundens nummer. Samma skäl som
    // avtalet ovan — faller det står ett utkast kvar, och på det finns
    // "Koppla säljsamtal" för fallet att kunden ringde från ett annat nummer.
    const saljsamtal = await provaSaljsamtal(rad.id);
    if (!saljsamtal.ok) {
      return {
        fel: `${saljsamtal.skal} Ordern ligger kvar som utkast på ${bolag} — koppla säljsamtalet där och skicka in den.`,
        orderId: rad.id,
      };
    }

    const { error: stegfel } = await supabaseAdmin()
      .from("sales_order")
      .update({ ...slutligt, status: slutligStatus })
      .eq("id", rad.id);

    if (stegfel) {
      return {
        fel: `Ordern sparades men kunde inte ${godkannDirekt ? "godkännas" : "skickas in"}: ${stegfel.message}. Den ligger kvar som utkast på ${bolag}.`,
        orderId: rad.id,
      };
    }

    await logga(user, godkannDirekt ? "sales_order.approved" : "sales_order.submitted", rad.id, {
      salesperson_id: saljare,
      package_id: paket,
      term_months: loptid,
      signed_on: signerad,
      starts_on: startdatum,
      ends_on: avtalsslut(startdatum, loptid),
      monthly_amount: manadsbelopp,
      tjanster: tjansteval.tjanster.length,
      commission_amount: insats.commission_amount ?? null,
      commission_percent: affar?.handsattProcent ?? null,
      order_value: insats.order_value ?? null,
      buyout_amount: utkopsval.utkop,
      financed: finans,
      finance_amount: slutligt.finance_amount ?? null,
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
      ? " Provisionen översteg det som blev kvar av affären, så övertäcket till säljchefen blev noll."
      : "";
    // Finansen fore utkopet: utkopstexten namner nettot, och det nettot ar
    // redan efter finansavgiften.
    const utkopet = finanstext(affar?.finansen ?? null) + utkopstext(affar?.utkopet ?? null);

    // EN INSKICKAD ORDER MED UTKOP SAGER DET OCKSA, men utan procentsatsen:
    // beloppen raknas forst vid godkannandet, och ett tal i kvittensen som
    // sedan blir ett annat ar samre an inget tal.
    const inskickatUtkop =
      (harUtkop(utkopsval.utkop)
        ? ` Utköpet ${kronor(utkopsval.utkop)} följer med och dras av när ordern godkänns.`
        : "") +
      (finans ? " Ordern går via finans — avgiften dras av när ordern godkänns." : "");

    // ===========================================================================
    // FORLANGNINGEN KOPPLAS IHOP HAR, sist av allt.
    //
    // `forlanger_id` foljer med fran knappen "Forlang" pa den gamla orderns kort.
    // Kopplingen skrivs EFTER att den nya affaren ar klar — bokford, notifierad
    // och allt — eftersom den gamla orderns bevakning inte ska slackas forran det
    // faktiskt finns nagot som ersatter den.
    //
    // Behorigheten provas anda: en klient kan skicka vilket id som helst, och
    // utan kontrollen hade vem som helst kunnat slacka bevakningen pa nagon
    // annans kund.
    // ===========================================================================
    let forlangningsbesked = "";
    const forlangerId = String(form.get("forlanger_id") ?? "").trim();

    if (forlangerId && forlangerId !== rad.id) {
      try {
        const { rad: gammal } = await kravFornyelseratt(forlangerId);
        const kopplingsfel = await markeraForlangd(user, forlangerId, rad.id);
        forlangningsbesked = kopplingsfel
          ? ` Det gamla avtalet på ${gammal.company_name} kunde inte markeras som förlängt (${kopplingsfel}) — det ligger kvar i bevakningen.`
          : ` Det gamla avtalet på ${gammal.company_name} är markerat som förlängt och bevakas inte längre.`;
      } catch (e) {
        forlangningsbesked = ` Den nya ordern är lagd, men det gamla avtalet kunde inte markeras som förlängt: ${e instanceof Error ? e.message : "okänt fel"}`;
      }
    }

    // SLUTDATUMET STAR I KVITTENSEN. Det ar den uppgift hela passet handlar om,
    // och den som just skrivit ordern ska se den innan hen gar vidare — inte
    // leta reda pa den i listan tre manader senare.
    const loper = ` Avtalet löper till ${avtalsslut(startdatum, loptid)}; påminnelsen tänds 90 dagar innan.${forlangningsbesked}`;

    return {
      // `orderId` gor att avtalet gar att ladda upp direkt i formularet. Se
      // `Orderstate` och rubriken i `Nyorder.tsx`.
      orderId: rad.id,
      ok: efterslapning
        ? `Ordern på ${bolag} är godkänd. ${manadsnamn(periodFor(signerad))} var fastställd, så provisionen bokfördes på ${manadsnamn(efterslapning)}.${utkopet}${klippt}${loper}`
        : godkannDirekt
          ? `Ordern på ${bolag} är godkänd.${utkopet}${klippt}${loper}`
          : `Ordern på ${bolag} är inskickad och väntar på godkännande.${inskickatUtkop}${loper}`,
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
        /** Vad kunden betalar per manad, fryst pa ordern. Se 0068. */
        monthly_amount: number;
        /** Utkopet, sa som det ska sta pa ordern. `null` nar affaren inte bar nagot. */
        buyout_amount: number | null;
        /** 0079. Valet, sa som rakningen forstod det. Skrivs med resten av `satt`. */
        financed: boolean;
        /** 0079. Finansavgiften i kronor, eller null nar affaren inte ar finansierad. */
        finance_amount: number | null;
        /** 0079. Satsen avgiften kom ur. Spar en utbetalning till sin rad, som `commission_rate_id`. */
        finance_rate_id: string | null;
      };
      /**
       * Underlaget for finansavdraget, nar affaren bar ett. Bara kvittensen och
       * notisen anvander det — beloppet ligger redan i `satt`.
       */
      finansen: { avgift: number; procent: number; procentPerAr: number; loptid: number } | null;
      /**
       * Underlaget for en utkopsaffar, nar det ar en sadan. Bara vyn anvander
       * det — beloppen ligger redan i `satt` — men kvittensen ska kunna saga
       * "12 % pa 15 000 kr" i stallet for bara ett tal.
       */
      utkopet: { utkop: number; netto: number; procent: number } | null;
      /** Saljchefens overtack, eller null. Skrivs som EGEN rad — se `skrivOvertack`. */
      overtack: Overtack | null;
      /**
       * Procentsatsen nar provisionen skrevs in som procent, annars null. Bara
       * loggen anvander den: pa ordern star kronorna, och utan den har raden
       * hade "4 380 kr" i loggen inte sagt att nagon menade 33 1/3 %.
       */
      handsattProcent: number | null;
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
  /**
   * Utkopet pa affaren, eller null. SKICKAS IN, slas inte upp har.
   *
   * Skalet ar att de tre anroparna vet olika saker. `skapaOrder` laser det ur
   * formularet, `godkannOrder` ur ORDERN — saljaren skrev in det nar hen
   * skickade in, och godkannaren ska inte behova upprepa det — och
   * `redigeraOrder` ur formularet med ordern som fallback. Ett uppslag har hade
   * behovt kanna till alla tre fallen.
   */
  utkop: number | null = null,
  /**
   * Affarens tva egna tal, nar de INTE kommer ur paketet.
   *
   * `manadsbelopp` ar `null` for en paketorder — da hamtas manadspriset ur
   * `sales_package.list_price`, precis som fore 0068. Ar det satt ar det en fri
   * order, och da ar talet sanningen.
   *
   * SKICKAS IN AV SAMMA SKAL SOM `utkop` GOR DET: de tre anroparna vet olika
   * saker. `skapaOrder` laser bada ur formularet, `godkannOrder` ur ORDERN —
   * saljaren skrev in dem nar hen skickade in — och `redigeraOrder` ur
   * formularet med ordern som fallback.
   */
  /*
   * `finans` (0079) ar OBLIGATORISK, inte defaultad. De tre anroparna vet olika
   * saker om den — formularet, ordern, eller formularet med ordern som
   * fallback — och en glomd anropare ska falla i bygget, inte tyst rakna en
   * finansaffar som om finanspartnern inte tog nagot.
   */
  affaren: { manadsbelopp: number | null; tjanster: Tjanst[]; finans: boolean },
): Promise<Framrakning> {
  const db = supabaseAdmin();

  const [
    { data: satsrader },
    { data: paketrader },
    { data: chefsrader },
    { data: utkopsrader },
    { data: finansrader },
  ] = await Promise.all([
    db.from("commission_rate").select("id, package_id, term_months, amount, valid_from, valid_to"),
    db.from("sales_package").select("id, label, list_price, sort, active"),
    db
      .from("manager_commission_rate")
      .select("id, employee_id, override_percent, own_sale_percent, valid_from, valid_to"),
    db.from("buyout_commission_rate").select("id, percent, valid_from, valid_to"),
    db.from("finance_rate").select("id, percent_per_year, valid_from, valid_to"),
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

  const utkopssats = gallandeUtkopssats(
    (utkopsrader ?? []).map((s) => ({ ...s, percent: Number(s.percent) })) as Utkopssats[],
    signerad,
  );

  // EN NOLLA SILAS BORT HAR, en gang, och resten av funktionen fragar bara
  // `utkopBelopp !== null`. Ett `harUtkop()` upprepat pa sex stallen ar sex
  // tillfallen att skriva det ena fel — och det ena som glomdes hade latit en
  // nolla byta provisionskalla fran matrisen till procentsatsen.
  const utkopBelopp: number | null = harUtkop(utkop) ? utkop : null;

  // ---------------------------------------------------------------------------
  // 1. Ordervardet
  // ---------------------------------------------------------------------------
  // ===========================================================================
  // KRONOR ELLER PROCENT, OCH VALJAREN AR DET SOM GOR BELOPPET HANDSATT.
  //
  // Bestallaren 2026-10-09: pa en fri order ska provisionen kunna skrivas
  // "antingen procent sats eller fast belopp" — aven pa chefens egen order.
  // Formularen skickar darfor `provision_form` (`belopp` | `procent`) och det
  // ena av tva falt.
  //
  // UTAN VALJAREN ar allt som fore: `commission_amount` lases, och chefsregeln
  // overprovar det pa chefens order. En klient som inte ritar valjaren — eller
  // en halv inskickning — kan alltsa inte rubba 40 %-regeln av misstag. Se
  // `handsatt` i `affarenFor`.
  // ===========================================================================
  const provisionsform = String(form.get("provision_form") ?? "").trim();
  const procentText =
    provisionsform === "procent" ? String(form.get("commission_percent") ?? "").trim() : "";
  const manuellText =
    provisionsform === "procent" ? "" : String(form.get("commission_amount") ?? "").trim();
  const handsatt = provisionsform !== "" && (procentText !== "" || manuellText !== "");

  // ===========================================================================
  // EN FRI ORDER KANNS IGEN PA MANADSBELOPPET, inte pa ett inskrivet ordervarde.
  //
  // Fram till 0068 var regeln "ETT ordervarde har skrivits in", och den var ett
  // uttryck for hur formularet sag ut snarare an for vad ordern ar. Nu skrivs
  // inget ordervarde alls — bestallaren skriver vad kunden betalar i manaden och
  // hur lange, och vardet RAKNAS. De tva talen behovs anda, eftersom det ar de
  // som sager nar avtalet tar slut.
  // ===========================================================================
  const friOrder = affaren.manadsbelopp !== null;

  let manadsbelopp: number;
  let vardekalla: string;

  if (friOrder) {
    if (affaren.manadsbelopp! <= 0) {
      return { klar: false, fel: "Månadsbeloppet måste vara större än noll." };
    }
    manadsbelopp = affaren.manadsbelopp!;
    vardekalla = "manual";
  } else {
    const paketrad = (paketrader ?? []).find((p) => p.id === paket);
    if (!paketrad) {
      return {
        klar: false,
        fel: "Paketet finns inte. Välj ett paket eller kryssa i att ordern inte följer paketreglerna.",
      };
    }
    manadsbelopp = Number(paketrad.list_price);
    vardekalla = "package";
  }

  // ORDERVARDET RAKNAS PA ETT STALLE, och det ar `affarensVarde` i lib/order.ts
  // — samma funktion som formularets forhandsvisning anropar. Tjansterna ingar
  // (bestallarbeslut 2026-09-24), och en engangsavgift ganges inte med
  // loptiden; se `tjanstensVarde` for varfor den skillnaden ar en pengafraga.
  const ordervarde = affarensVarde(manadsbelopp, loptid, affaren.tjanster);

  // ---------------------------------------------------------------------------
  // 1b. Utkopet, och nettot det lamnar efter sig
  //
  // ===========================================================================
  // ORDERVARDET STAR KVAR BRUTTO PA ORDERN. Det ar NETTOT som gar vidare in i
  // rakningen, och skillnaden mellan de tva ar hela poangen med kolumnen.
  //
  // Bestallaren 2026-09-15: *"da ska det dras minus pa affaren och sen ska det
  // raknas pa 12 % for saljaren i provision pa det som ar over efter utkopet"*.
  // Tva led i den meningen, och bada galler:
  //
  //   AFFAREN BLIR MINDRE      nettot, inte bruttot, ar vad bolaget fick behalla
  //   SALJAREN FAR PROCENT     pa nettot, i stallet for matrisens belopp
  //
  // Nettot skickas in i `affarenFor` som "ordervardet", sa att BADE saljarens
  // och saljchefens rakning utgar fran samma tal. Bestallarens val samma dag:
  // utkopspengarna ar utbetalda till kunden och ar inte bolagets marginal, sa
  // overtacket far inte raknas pa dem heller.
  // ===========================================================================
  // ---------------------------------------------------------------------------
  // 1c. Finansen (0079)
  //
  // ===========================================================================
  // AVGIFTEN RAKNAS PA BRUTTOT OCH DRAS FRAN NETTOT.
  //
  // Bestallaren 2026-10-09: finanspartnern tar 11 % av ordervardet per ar, och
  // ordervardet ar HELA vardet — tjansterna inraknade, fore utkopet. Avgiften
  // ar sedan pengar bolaget aldrig far, precis som utkopet, sa den dras fran
  // samma netto: chefens sats, overtacket, utkopssatsen och en handsatt procent
  // raknas alla pa det som blir kvar. Paketmatrisens FASTA belopp rors inte —
  // det ar ocksa bestallarens svar, och det foljer av att matrisgrenen nedan
  // aldrig laser nettot.
  // ===========================================================================
  let finansen: { avgift: number; procent: number; procentPerAr: number; loptid: number } | null =
    null;
  let finanssatsId: string | null = null;

  if (affaren.finans) {
    const finanssats = gallandeFinanssats(
      (finansrader ?? []).map((s) => ({
        ...s,
        percent_per_year: Number(s.percent_per_year),
      })) as Finanssats[],
      signerad,
    );

    // EN SAKNAD SATS BLIR INTE NOLL — en nolla hade raknat finansaffaren som
    // gratis. Samma resonemang som for utkopssatsen nedan.
    if (!finanssats) {
      return {
        klar: false,
        fel: "Ingen finanssats gällde på signeringsdagen. Ordern kan inte räknas som finans förrän en sats är satt.",
      };
    }

    finanssatsId = finanssats.id;
    finansen = {
      avgift: finansavgift(ordervarde, loptid, finanssats.percent_per_year),
      procent: finansprocent(finanssats.percent_per_year, loptid),
      procentPerAr: finanssats.percent_per_year,
      loptid,
    };
  }

  const netto = nettoEfterFinans(nettoEfterUtkop(ordervarde, utkopBelopp), finansen?.avgift ?? null);

  // UTKOP OCH FINANS MASTE RYMMAS TILLSAMMANS. Var for sig kan de vara rimliga
  // och anda ata upp mer an hela affaren — `sales_order_finans_ryms` i 0079
  // nekar det i databasen, men beskedet ska komma har, med talen i.
  if (finansen && finansen.avgift + (utkopBelopp ?? 0) > ordervarde) {
    return {
      klar: false,
      fel: `Utköpet (${kronor(utkopBelopp ?? 0)}) och finansavgiften (${kronor(finansen.avgift)}) är tillsammans större än ordervärdet (${kronor(ordervarde)}). Kontrollera talen.`,
    };
  }

  if (utkopBelopp !== null) {
    if (utkopBelopp > ordervarde) {
      return {
        klar: false,
        fel: `Utköpet (${kronor(utkopBelopp)}) är större än ordervärdet (${kronor(ordervarde)}). Kontrollera talen.`,
      };
    }
    // EN SAKNAD SATS BLIR INTE NOLL. En nolla hade sett ut som "utkopsaffarer ger
    // ingen provision" i stallet for "ingen sats ar satt" — samma resonemang som
    // `gallandeSats` for om matrisen.
    // Ett handsatt belopp behover ingen sats — det ar ju det felmeddelandet
    // nedan foreslar. Fram till 2026-10-09 nekades det anda.
    if (!utkopssats && !chefenSaljer && !manuellText && !procentText) {
      return {
        klar: false,
        fel: "Ingen utköpssats gällde på signeringsdagen. Lägg en sats under Provision → Regler, eller sätt beloppet för hand.",
      };
    }
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
  let saljarkalla: Saljarkalla;

  // MATRISRADEN SPARAS, inte bara dess belopp. `commission_rate_id` ar det som
  // gor att en utbetalning gar att harleda till raden den kom ur; villkoret
  // `sales_order_satskoppling` i 0050 kraver den for `matrix` och forbjuder den
  // for allt annat.
  let matrisrad: Sats | null = null;
  let handsattProcent: number | null = null;

  if (procentText) {
    // PROCENTEN RAKNAS PA NETTOT, samma bas som chefssatsen och utkopssatsen.
    // Det som fryses ar kronorna; procenten ar bara hur de skrevs.
    const procent = tolkaBelopp(procentText.replace(/%$/, ""));
    if (procent === null) return { klar: false, fel: "Procentsatsen gick inte att tolka." };
    if (procent < 0 || procent > 100) {
      return { klar: false, fel: "Procentsatsen ska vara mellan 0 och 100." };
    }
    saljarprovision = procentProvision(netto, procent);
    saljarkalla = "manual";
    handsattProcent = procent;
  } else if (manuellText) {
    const belopp = tolkaBelopp(manuellText);
    if (belopp === null) return { klar: false, fel: "Provisionsbeloppet gick inte att tolka." };
    if (belopp < 0) {
      return { klar: false, fel: "Provisionen kan inte vara negativ. En makulering är vägen ut." };
    }
    saljarprovision = belopp;
    saljarkalla = "manual";
  } else if (utkopBelopp !== null && !chefenSaljer) {
    // ===========================================================================
    // UTKOPSSATSEN ERSATTER MATRISEN, den kommer inte utover den.
    //
    // Bestallarens beslut 2026-09-15, och skalet ar att de tva annars hade
    // dubbelraknat samma pengar: matrisens 1 500 kr ar redan bolagets andel av
    // ett FULLT ordervarde, och pa en affar dar en del av vardet gick till att
    // kopa ut kunden finns inte den marginalen.
    //
    // ORDNINGEN AR MEDVETEN. Ett HANDSATT belopp star fore utkopssatsen i
    // if-kedjan: skriver godkannaren in ett tal har hen sett bada uppgifterna
    // och tagit ett beslut, och da ska inte en procentsats overprova det.
    // ===========================================================================
    saljarprovision = utkopsprovision(utkopssats!, netto);
    saljarkalla = "buyout";
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
  // BASEN AR NETTOT, inte bruttot. Pa en affar utan utkop ar de tva samma tal —
  // `nettoEfterUtkop` lamnar ordervardet orort da — sa raden nedan ar oforandrad
  // for allt som fanns fore 0060.
  const affar = affarenFor({
    sats: chefssats,
    saljareId,
    ordervarde: netto,
    saljarprovision,
    saljarkalla,
    handsatt,
  });

  return {
    klar: true,
    satt: {
      commission_amount: affar.provision,
      commission_source: affar.kalla,
      // Bara ett matrisbelopp pekar pa sin rad. Ett handsatt belopp, ett
      // framraknat chefsbelopp och en utkopsprovision gor det inte —
      // `sales_order_satskoppling` i 0060 nekar annars insertet.
      commission_rate_id: affar.kalla === "matrix" ? (matrisrad?.id ?? null) : null,
      // ORDERVARDET SKRIVS BRUTTO. Avtalet sager bruttot, och utkopet star i sin
      // egen kolumn — se 0060 for varfor de inte far slas ihop till ett tal.
      order_value: ordervarde,
      order_value_source: vardekalla,
      // MANADSBELOPPET FRYSES MED RESTEN (0068). For en paketorder ar det
      // paketets pris den dagen; andras prislistan i november sager ordern
      // fortfarande vad kunden faktiskt betalar.
      monthly_amount: manadsbelopp,
      buyout_amount: utkopBelopp,
      // FINANSEN SKRIVS SOM TRE KOLUMNER (0079): valet, avgiften och satsen.
      // Villkoren i 0079 kraver att de tva sista ar tomma nar valet ar nej.
      financed: affaren.finans,
      finance_amount: finansen?.avgift ?? null,
      finance_rate_id: finanssatsId,
    },
    finansen,
    overtack: affar.overtack,
    // KLIPPNINGEN MATS PA NETTOT, av samma skal som overtacket raknas pa det:
    // en provision som overstiger nettot har atit upp restposten aven om den ar
    // mindre an bruttot.
    restpostenKlipptes: restpostenAtNoll(netto, affar.provision),
    handsattProcent,
    utkopet:
      utkopBelopp === null
        ? null
        : { utkop: utkopBelopp, netto, procent: utkopssats?.percent ?? 0 },
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
    if (!(await harAvtal(id))) {
      return { fel: "Ladda upp det påskrivna avtalet (PDF) på ordern innan den skickas in." };
    }
    const saljsamtal = await provaSaljsamtal(id);
    if (!saljsamtal.ok) return { fel: `${saljsamtal.skal} Koppla säljsamtalet innan ordern skickas in.` };

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

    // Spärren en gång till, här också: en order som skickades in före
    // 2026-10-08 har aldrig passerat den, och ett godkännande är sista steget
    // innan provisionen fryses och ordern går till Inkio.
    const saljsamtal = await provaSaljsamtal(id);
    if (!saljsamtal.ok) return { fel: `${saljsamtal.skal} Ordern kan inte godkännas utan säljsamtalet.` };

    // SALJAREN KOMMER UR ORDERN, inte ur formularet. Det ar hen som avgor om
    // chefsregeln galler, och en order som saljaren skickat in bar redan sitt
    // `salesperson_id` — godkannaren byter inte saljare, och triggern i 0034
    // hade nekat det anda.
    // UTKOPET KOMMER UR ORDERN, inte ur godkannandeformularet. Saljaren angav
    // det nar hen skickade in; godkannaren ska inte behova upprepa en uppgift
    // som redan star pa raden — och en tom ruta i formularet hade tyst nollat
    // den. Ska utkopet andras ar vagen rattelsen, dar bade talet och skalet
    // hamnar i loggen.
    const utkopPaOrdern = rad.buyout_amount == null ? null : Number(rad.buyout_amount);

    // ===========================================================================
    // MANADSBELOPPET OCH TJANSTERNA KOMMER UR ORDERN, inte ur godkannandets
    // formular — exakt samma skal som utkopet ovan.
    //
    // Saljaren skrev dem nar hen skickade in. En tom ruta i godkannarens
    // formular hade tyst nollat bada, och for en FRI order betyder det att
    // `raknaFramProvision` skulle falla tillbaka pa paketets prislista — alltsa
    // rakna en affar som uttryckligen inte foljer paketreglerna som om den gjorde
    // det.
    // ===========================================================================
    const manadsbeloppPaOrdern = rad.monthly_amount == null ? null : Number(rad.monthly_amount);

    const provision = await raknaFramProvision(
      rad.package_id,
      rad.term_months,
      rad.signed_on,
      rad.salesperson_id,
      form,
      utkopPaOrdern,
      {
        manadsbelopp: manadsbeloppPaOrdern,
        tjanster: await tjansterPaOrder(id),
        // FINANSVALET KOMMER UR ORDERN, av samma skal som utkopet ovan.
        finans: rad.financed === true,
      },
    );
    if (!provision.klar) return { fel: provision.fel };

    // Anteckningskravet ar borta sedan 0060 — se `skapaOrder` for resonemanget.
    const note = String(form.get("note") ?? "").trim() || null;

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
      commission_percent: provision.handsattProcent,
      order_value: provision.satt.order_value,
      finance_amount: provision.satt.finance_amount,
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
      // UTKOPET STAR MED I NOTISEN. Saljaren ser annars ett belopp som inte
      // stammer med matrisen och har ingen forklaring i handen.
      detalj: efterslapning
        ? `Provision ${kronor(provision.satt.commission_amount)} · ${manadsnamn(periodFor(rad.signed_on))} var redan fastställd, så beloppet bokförs på ${manadsnamn(efterslapning)}`
        : provision.utkopet
          ? `Provision ${kronor(provision.satt.commission_amount)} · ${provision.utkopet.procent} % av ${kronor(provision.utkopet.netto)} efter utköp ${kronor(provision.utkopet.utkop)}${provision.finansen ? ` och finans ${kronor(provision.finansen.avgift)}` : ""}`
          : provision.finansen
            ? `Provision ${kronor(provision.satt.commission_amount)} · finans ${kronor(provision.finansen.avgift)} avdragen från ordervärdet`
            : `Provision ${Number(provision.satt.commission_amount).toLocaleString("sv-SE")} kr · räknas från ${rad.signed_on}`,
      href: "/order",
      objekt: { typ: "sales_order", id },
    });

    revalidatePath("/order");
    revalidatePath("/provision");

    // Samma tva oberoende omstandigheter som i `skapaOrder`, plus utkopet.
    const klippt = provision.restpostenKlipptes
      ? " Provisionen översteg det som blev kvar av affären, så övertäcket till säljchefen blev noll."
      : "";
    const utkopet = finanstext(provision.finansen) + utkopstext(provision.utkopet);

    return {
      ok: efterslapning
        ? `Ordern är godkänd. ${manadsnamn(periodFor(rad.signed_on))} var fastställd, så ${kronor(provision.satt.commission_amount)} bokfördes på ${manadsnamn(efterslapning)} med en anteckning om varför.${utkopet}${klippt}`
        : `Ordern är godkänd och räknas från och med nu.${utkopet}${klippt}`,
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
          " contact_email, package_id, term_months, signed_on, starts_on, period_month," +
          " is_addon, note, monthly_amount, commission_amount, commission_source," +
          " order_value, order_value_source, buyout_amount, financed, finance_amount, created_by",
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

    // MEJLEN GAR ATT TA BORT, till skillnad fran de fyra ovan. `text()` ovan
    // laser ett tomt falt som "orort", vilket ar ratt for uppgifter en order
    // MASTE ha — men adressen ar frivillig, och da maste en tomning kunna
    // betyda tomning. Annars gar en felskriven adress aldrig att radera, bara
    // att skriva over.
    const mejlText = String(form.get("contact_email") ?? "").trim();
    if (mejlText && !giltigMejl(mejlText)) {
      return { fel: "Mejladressen ser inte ut som en adress. Lämna fältet tomt om den saknas." };
    }
    const mejl = mejlText || null;

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
          contact_email: mejl,
          note,
        })
        .eq("id", id);

      if (error) return { fel: `Ordern rättades inte: ${error.message}` };

      // Ett rättat nummer ska hitta sina samtal nu, inte i natt.
      if (telefon !== rad.contact_phone) await svepKoppling({ orderId: id }).catch(() => undefined);

      await logga(user, "sales_order.corrected", id, {
        skal,
        rackvidd: "fakta",
        fore: {
          company_name: rad.company_name,
          org_number: rad.org_number,
          contact_name: rad.contact_name,
          contact_phone: rad.contact_phone,
          contact_email: rad.contact_email,
          note: rad.note,
        },
        efter: {
          company_name: bolag,
          org_number: orgnr,
          contact_name: kontakt,
          contact_phone: telefon,
          contact_email: mejl,
          note,
        },
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

    // ===========================================================================
    // MANADSBELOPPET AR DET SOM AVGOR OM ORDERN AR FRI — HAR OCKSA (0068).
    //
    // Rattelseformularet ritade fore 0068 ett falt "Ordervarde i kronor", och
    // `raknaFramProvision` kande igen en fri order pa att det faltet var ifyllt.
    // Bada ar borta nu: formularet skriver manadsbelopp och bindningstid, och
    // vardet raknas.
    //
    // ORDERN ar fallbacken, inte paketet. En fri order som rattas utan att
    // faltet skickades med — en klient som skickar en halv inskickning — ska
    // behalla sitt manadsbelopp; annars hade rattelsen tyst raknat om affaren
    // som om den foljde paketreglerna, och skillnaden hade bokforts som en
    // rattelsepost rakt ut i lonen.
    // ===========================================================================
    const manadstext = String(form.get("monthly_amount") ?? "").trim();
    const manadsbelopp = manadstext
      ? tolkaBelopp(manadstext)
      : rad.monthly_amount == null
        ? null
        : Number(rad.monthly_amount);

    // En order ar fri om den HAR ett eget manadsbelopp och det inte bara ar
    // paketets pris som frostes pa raden vid godkannandet. Kallan pa ordern ar
    // det som vet skillnaden.
    const friOrder = manadsbelopp !== null && rad.order_value_source !== "package";

    if (manadstext && (manadsbelopp === null || manadsbelopp <= 0)) {
      return { fel: "Månadsbeloppet gick inte att tolka." };
    }

    if (friOrder) {
      if (!giltigBindningstid(loptid)) {
        return { fel: "Bindningstiden ska vara mellan 1 och 60 hela månader." };
      }
    } else if (!(LOPTIDER as readonly number[]).includes(loptid)) {
      return { fel: "Välj en bindningstid." };
    }

    if (!giltigtSigneringsdatum(signerad)) {
      return { fel: "Signeringsdatumet är ogiltigt eller ligger i framtiden." };
    }

    const startdatum = text("starts_on", rad.starts_on);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startdatum)) {
      return { fel: "Skriv när avtalet börjar gälla." };
    }
    if (startdatum < signerad) {
      return { fel: "Avtalet kan inte börja gälla innan det signerades." };
    }

    // ---------------------------------------------------------------------------
    // Affaren raknas om FRAN GRUNDEN, med samma funktion som godkannandet
    // anvander. Att rakna den pa ett andra satt har hade gett tva tolkningar av
    // "40 % eller matrisen", och den dagen de sager olika ar det inte uppenbart
    // vilken som har ratt.
    // ---------------------------------------------------------------------------
    // UTKOPET UR FORMULARET, med ordern som fallback saknas kryssrutan helt.
    //
    // Rattelseformularet ritar bade kryssrutan och beloppet for chefskretsen, sa
    // ett medvetet borttaget kryss MASTE kunna betyda "affaren har inget utkop
    // langre". Darfor ar `utkopUrFormular` sanningen nar formularet skickade med
    // sig kryssrutefaltet, och ordern bara nar det inte gjorde det — vilket bara
    // hander for en klient som skickar en halv inskickning.
    const utkopsval = utkopUrFormular(form);
    if ("fel" in utkopsval) return { fel: utkopsval.fel };

    const utkopet = form.has("har_utkop_ritad")
      ? utkopsval.utkop
      : rad.buyout_amount == null
        ? null
        : Number(rad.buyout_amount);

    // TJANSTERNA KOMMER UR ORDERN och inte ur rattelseformularet, som inte ritar
    // dem. De ingar i ordervardet (0068), sa de MASTE med i omrakningen — utan
    // dem hade varje rattelse av en order med tjanster tyst dragit bort deras
    // varde ur affaren och bokfort skillnaden som en rattelsepost.
    // FINANSEN UR FORMULARET, med ordern som fallback — samma regel som utkopet
    // ovan, med samma dolda falt (`finans_ritad`).
    const finans = finansUrFormular(form) ?? rad.financed === true;

    const nya = await raknaFramProvision(paket, loptid, signerad, saljare, form, utkopet, {
      manadsbelopp: friOrder ? manadsbelopp : null,
      tjanster: await tjansterPaOrder(id),
      finans,
    });
    if (!nya.klar) return { fel: nya.fel };

    // Anteckningskravet ar borta sedan 0060 — se `skapaOrder` for resonemanget.

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
        contact_email: mejl,
        package_id: paket,
        term_months: loptid,
        salesperson_id: saljare,
        signed_on: signerad,
        starts_on: startdatum,
        is_addon: form.get("is_addon") === "on",
        note,
        // `nya.satt` bar `buyout_amount` och skrivs sist, sa det ar rakningens
        // svar som star pa ordern och inte formularets rader — de tva ar samma
        // tal, men bara ett av dem har gatt genom kontrollerna.
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
        buyout_amount: rad.buyout_amount == null ? null : Number(rad.buyout_amount),
        financed: rad.financed === true,
        finance_amount: rad.finance_amount == null ? null : Number(rad.finance_amount),
        monthly_amount: rad.monthly_amount == null ? null : Number(rad.monthly_amount),
        package_id: rad.package_id,
        term_months: rad.term_months,
        signed_on: rad.signed_on,
        starts_on: rad.starts_on,
        overtack: fore.chef ? { manager_id: fore.chef, amount: fore.overtack } : null,
      },
      efter: {
        salesperson_id: efter.saljare,
        commission_amount: efter.provision,
        order_value: nya.satt.order_value,
        buyout_amount: nya.satt.buyout_amount,
        financed: nya.satt.financed,
        finance_amount: nya.satt.finance_amount,
        monthly_amount: nya.satt.monthly_amount,
        package_id: paket,
        term_months: loptid,
        signed_on: signerad,
        starts_on: startdatum,
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

    // INKIO (0075): bara nar bocken ar kvar. En order kan makuleras for att den
    // lagts dubbelt i Nav, for att den ska laggas om — eller efter att Inkio
    // redan borjat fakturera. Den som makulerar avgor.
    const { data: iInkio } = await supabaseAdmin()
      .from("crm_order")
      .select("crm_order_id")
      .eq("order_id", id)
      .maybeSingle();
    let inkiotext = "";
    if (iInkio?.crm_order_id) {
      if (form.get("makulera_i_inkio") === "on") {
        await supabaseAdmin().from("outbox").insert({
          kind: "crm",
          payload: { handling: "makulera", order_id: id },
          idempotency_key: `crm-makulera:${id}`,
          not_before: new Date(Date.now() + 10_000).toISOString(),
        });
        after(async () => {
          await new Promise((r) => setTimeout(r, 11_000));
          await tomUtkorgen();
        });
        inkiotext = " Den makuleras också i Inkio.";
      } else {
        await logga(user, "sales_order.cancelled_kept_in_crm", id, { crm_order_id: iInkio.crm_order_id });
        inkiotext = " Den ligger kvar orörd i Inkio.";
      }
    }

    revalidatePath("/order");
    revalidatePath("/provision");
    return {
      ok: `Ordern är makulerad. Avdraget belastar ${idag.slice(0, 7)}, inte månaden den tecknades.${inkiotext}`,
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

    // Genom `radera_order` (0077) och inte en DELETE rakt på tabellen: ett
    // utkast kan bära samtal sedan säljsamtalsspärren, och en vanlig DELETE tog
    // inspelningarnas registerrader med sig i kaskaden — och föll sedan på
    // `phone_call_inspelning`, utan ett begripligt besked.
    return await raderaGenomDatabasen(user, rad, null);
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

/**
 * Raderar en order helt — beställarens besked 2026-10-08: "jag ska kunna ta
 * bort ordrar".
 *
 * ===========================================================================
 * RADERA ÄR INTE MAKULERA
 *
 * En makulering är en händelse: affären fanns, kunden hoppade av, provisionen
 * dras i makuleringsmånaden. En radering säger att ordern ALDRIG skulle ha
 * funnits — en testorder, en dubblett, en felregistrering. Den går därför bara
 * så länge ingenting har byggt vidare på ordern. Reglerna står i databasen
 * (`radera_order` i 0077), inte här, och felmeddelandet därifrån säger när
 * makulering är vägen i stället.
 *
 * Skälet krävs för allt utom ett utkast. Det står i loggen, eftersom ordern inte
 * längre finns att titta på.
 * ===========================================================================
 */
export async function raderaOrder(_prev: Orderstate, form: FormData): Promise<Orderstate> {
  try {
    const user = await kravInloggad();
    const id = String(form.get("id") ?? "");
    const skal = String(form.get("reason") ?? "").trim();
    const rad = await hamtaRad(id);
    if (!rad) return { fel: "Ordern finns inte." };

    if (rad.status === "utkast") {
      if (rad.salesperson_id !== user.employee!.id && !farHantera(user)) {
        return { fel: "Det är inte din order." };
      }
    } else {
      if (!farHantera(user)) {
        return { fel: "Bara säljchef, VD och ekonomi får radera en order som lämnat utkastet." };
      }
      if (!skal) return { fel: "Skriv varför ordern raderas — det står i loggen." };
    }

    return await raderaGenomDatabasen(user, rad, skal || null);
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

/**
 * Den gemensamma vägen för båda raderingarna. Databasen prövar, lossar samtalen
 * och raderar i en transaktion; härifrån töms avtalsfilerna ur lagringen.
 *
 * LAGRINGEN TÖMS EFTERÅT, aldrig före. Föll raderingen i databasen ska avtalet
 * finnas kvar — och registerraderna är redan borta när svaret kommer, så det är
 * svaret som bär var filerna låg. Misslyckas en borttagning ligger filen kvar
 * oåtkomlig i lagringen, och sökvägen står i loggen.
 */
async function raderaGenomDatabasen(
  user: CurrentUser,
  rad: Orderrad_skrivning,
  skal: string | null,
): Promise<Orderstate> {
  const { data, error } = await supabaseAdmin().rpc("radera_order", { p_order: rad.id });
  if (error) return { fel: error.message };

  const svar = (data ?? {}) as {
    status?: string;
    samtal?: number;
    filer?: { id: string; store: string; bucket: string; path: string; filename: string | null }[];
  };
  const filer = svar.filer ?? [];

  const kvarILagringen: string[] = [];
  for (const f of filer) {
    const borta = await taBort({ lager: tolkaLager(f.store), bucket: f.bucket, path: f.path });
    if (!borta.ok) kvarILagringen.push(f.path);
  }

  await logga(user, "sales_order.deleted", rad.id, {
    skal,
    status: rad.status,
    company_name: rad.company_name,
    salesperson_id: rad.salesperson_id,
    signed_on: rad.signed_on,
    commission_amount: rad.commission_amount == null ? null : Number(rad.commission_amount),
    samtal_lossade: svar.samtal ?? 0,
    avtal: filer.map((f) => f.filename ?? f.id),
    kvar_i_lagringen: kvarILagringen,
  });

  // SÄLJAREN FÅR VETA NÄR EN GODKÄND ORDER FÖRSVINNER — då försvinner också
  // provisionen, och det är samma sorts besked som en makulering. Ett utkast
  // eller en inskickad order bar inga pengar.
  if ((rad.status === "signerad" || rad.status === "betald") && rad.salesperson_id !== user.employee!.id) {
    await notifiera({
      till: rad.salesperson_id,
      av: user.employee!.id,
      kalla: "order-makulerad",
      typ: "order",
      rubrik: `Din order är borttagen: ${rad.company_name}`,
      detalj: skal ? `${skal} · provisionen räknas inte längre` : "Provisionen räknas inte längre",
      href: "/order",
      objekt: { typ: "sales_order", id: rad.id },
    });
  }

  revalidatePath("/order");
  revalidatePath("/provision");

  const samtal = svar.samtal ?? 0;
  return {
    ok:
      `${rad.company_name} är borttagen.` +
      (samtal > 0 ? ` ${samtal} samtal lossades och finns kvar med sina inspelningar.` : "") +
      (kvarILagringen.length > 0 ? " Avtalsfilen gick inte att ta bort ur lagringen — det står i loggen." : ""),
  };
}

/**
 * Redigerar en order som ÄNNU INTE ÄR GODKÄND — utkast eller inskickad.
 * Beställaren 2026-10-08: "du måste lägga in så att jag kan redigera ordrarna".
 *
 * ===========================================================================
 * VARFÖR EN EGEN VÄG OCH INTE `redigeraOrder`
 *
 * `redigeraOrder` rättar en GODKÄND order: provisionen är fryst, och varje
 * ändring räknas om och bokförs som rättelseposter om månaden är stängd. Inget
 * av det gäller här. En ej godkänd order bär inga pengar — ordervärde och
 * provision sätts först i `godkannOrder` — så redigeringen är bara en
 * uppdatering med samma kontroller som `skapaOrder`.
 *
 * VEM: säljaren sitt eget UTKAST (det är där spärren lämnar en order som
 * saknar säljsamtalet, och numret måste gå att rätta), chefskretsen alla
 * utkast och inskickade. Säljare och "följer inte paketreglerna" ändras bara
 * av chefskretsen, samma gräns som i `skapaOrder`.
 * ===========================================================================
 */
export async function redigeraOgodkand(_prev: Orderstate, form: FormData): Promise<Orderstate> {
  try {
    const user = await kravInloggad();
    const hanterare = farHantera(user);
    const id = String(form.get("id") ?? "");

    const db = supabaseAdmin();
    const { data: raddata } = await db
      .from("sales_order")
      .select(
        "id, status, salesperson_id, company_name, org_number, contact_name, contact_phone, contact_email, customer_street, customer_postal_code, customer_city, package_id, term_months, signed_on, starts_on, is_addon, monthly_amount, buyout_amount, financed, note",
      )
      .eq("id", id)
      .maybeSingle();
    // Samma cast som i `redigeraOrder` — se kommentaren där.
    const rad = raddata as unknown as Record<string, string | number | boolean | null> | null;
    if (!rad) return { fel: "Ordern finns inte." };

    const egen = rad.salesperson_id === user.employee!.id;
    if (rad.status === "utkast") {
      if (!egen && !hanterare) return { fel: "Det är inte din order." };
    } else if (rad.status === "inskickad") {
      if (!hanterare) return { fel: "En inskickad order redigeras av säljchef, VD eller ekonomi." };
    } else {
      return {
        fel:
          rad.status === "makulerad"
            ? "En makulerad order redigeras inte."
            : "En godkänd order rättas med Rätta ordern.",
      };
    }

    const bolag = String(form.get("company_name") ?? "").trim();
    if (!bolag) return { fel: "Bolagsnamnet saknas." };

    const orgnr = normaliseraOrgnr(String(form.get("org_number") ?? ""));
    if (!orgnr) return { fel: "Organisationsnumret ska vara tio siffror, till exempel 556677-8899." };

    const kontakt = String(form.get("contact_name") ?? "").trim();
    if (!kontakt) return { fel: "Kontaktpersonen saknas." };

    const telefon = String(form.get("contact_phone") ?? "").trim();
    if (!giltigTelefon(telefon)) return { fel: "Telefonnumret ser inte ut som ett nummer." };

    const mejlText = String(form.get("contact_email") ?? "").trim();
    if (mejlText && !giltigMejl(mejlText)) {
      return { fel: "Mejladressen ser inte ut som en adress. Lämna fältet tomt om den saknas." };
    }

    // ADRESSEN: alla tre eller ingen. Order från före 0075 saknar den, och en
    // redigering ska inte tvinga fram en — men en halv adress är ett skrivfel.
    const gata = String(form.get("customer_street") ?? "").trim();
    const postnummer = String(form.get("customer_postal_code") ?? "").trim();
    const ort = String(form.get("customer_city") ?? "").trim();
    const adressdelar = [gata, postnummer, ort].filter(Boolean).length;
    if (adressdelar > 0 && adressdelar < 3) return { fel: "Skriv kundens hela adress: gata, postnummer och ort." };

    const paket = Number(form.get("package_id"));
    if (![1, 2, 3].includes(paket)) return { fel: "Välj ett paket." };
    const loptid = Number(form.get("term_months"));

    // FRI ORDER: chefskretsen väljer med kryssrutan; säljaren behåller det
    // ordern redan är. Ett månadsbelopp på ordern ÄR det som gör den fri —
    // se `raknaFramProvision` och `godkannOrder`.
    const friOrder = hanterare ? form.get("fri_order") === "on" : rad.monthly_amount != null;
    let manadsbelopp: number | null = null;
    if (friOrder) {
      manadsbelopp = hanterare
        ? tolkaBelopp(String(form.get("monthly_amount") ?? ""))
        : Number(rad.monthly_amount);
      if (manadsbelopp === null || !(manadsbelopp > 0)) return { fel: "Skriv vad kunden betalar per månad." };
      if (!giltigBindningstid(loptid)) return { fel: "Bindningstiden ska vara mellan 1 och 60 hela månader." };
    } else if (!(LOPTIDER as readonly number[]).includes(loptid)) {
      return { fel: "Välj en bindningstid." };
    }

    const signerad = String(form.get("signed_on") ?? "").trim();
    if (!giltigtSigneringsdatum(signerad)) {
      return { fel: "Signeringsdatumet är ogiltigt eller ligger i framtiden." };
    }
    const startdatum = String(form.get("starts_on") ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startdatum)) return { fel: "Skriv när avtalet börjar gälla." };
    if (startdatum < signerad) return { fel: "Avtalet kan inte börja gälla innan det signerades." };

    const valdSaljare = String(form.get("salesperson_id") ?? "").trim();
    const saljare = hanterare && valdSaljare ? valdSaljare : (rad.salesperson_id as string);

    // Utköpet med samma dolda fält som rättelsen — se `Rattelse` i Atgarder.tsx.
    const utkopsval = utkopUrFormular(form);
    if ("fel" in utkopsval) return { fel: utkopsval.fel };
    const utkop = form.has("har_utkop_ritad")
      ? utkopsval.utkop
      : rad.buyout_amount == null
        ? null
        : Number(rad.buyout_amount);

    // Finansen med samma dolda fält som utköpet (0079). Bara valet — avgiften
    // räknas först vid godkännandet.
    const finans = finansUrFormular(form) ?? rad.financed === true;

    const efter = {
      company_name: bolag,
      org_number: orgnr,
      contact_name: kontakt,
      contact_phone: telefon,
      contact_email: mejlText || null,
      customer_street: gata || null,
      customer_postal_code: postnummer || null,
      customer_city: ort || null,
      package_id: paket,
      term_months: loptid,
      monthly_amount: manadsbelopp,
      signed_on: signerad,
      starts_on: startdatum,
      salesperson_id: saljare,
      is_addon: form.get("is_addon") === "on",
      buyout_amount: utkop,
      financed: finans,
      note: String(form.get("note") ?? "").trim() || null,
    };

    // STATUSEN I VILLKORET: hann ordern godkännas medan formuläret stod öppet
    // ska redigeringen inte skriva över en fryst order.
    const { data: skrivet, error } = await db
      .from("sales_order")
      .update(efter)
      .eq("id", id)
      .eq("status", rad.status as string)
      .select("id");
    if (error) return { fel: `Ordern sparades inte: ${error.message}` };
    if (!skrivet || skrivet.length === 0) return { fel: "Ordern hann ändra status. Ladda om sidan." };

    // Numret är sömmen till säljsamtalet. Rättas det ska samtalen hittas nu.
    await svepKoppling({ orderId: id }).catch(() => undefined);

    // numeric kommer som sträng ur PostgREST ("1495.00"), så belopp jämförs
    // som tal — annars hade varje sparning loggat ett oförändrat belopp.
    const TAL = new Set(["package_id", "term_months", "monthly_amount", "buyout_amount"]);
    const lika = (k: string, a: unknown, b: unknown) =>
      TAL.has(k) && a != null && b != null ? Number(a) === Number(b) : String(a ?? "") === String(b ?? "");
    const andrat = Object.fromEntries(Object.entries(efter).filter(([k, v]) => !lika(k, v, rad[k])));
    await logga(user, "sales_order.edited", id, {
      status: rad.status,
      fore: Object.fromEntries(Object.keys(andrat).map((k) => [k, rad[k] ?? null])),
      efter: andrat,
    });

    revalidatePath("/order");
    return { ok: Object.keys(andrat).length === 0 ? "Inget var ändrat." : "Ordern är sparad." };
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

// -----------------------------------------------------------------------------
// Fornyelsen
//
// =============================================================================
// DET HAR AR HALVAN SOM SLACKER BEVAKNINGEN, och utan den tjatar den vidare
// efter att samtalet ar ringt.
//
// Notisen om ett avtal som narmar sig sitt slut ar HARLEDD: den raknas fram ur
// `sales_order` vid varje lasning, sa lange slutdatumet ligger inom nittio
// dagar. Det ar ratt halva — en paminnelse om nagot ogjort ska inte ga att
// glomma bort genom att klicka bort den — men det betyder ocksa att nagot
// maste kunna gora saken GJORD.
//
// Tva utfall, och bestallaren valde bada uttryckligen 2026-09-24:
//
//   FORLANGD   kunden skrev pa igen, och en NY ORDER bar den nya affaren med
//              eget startdatum, egen bindningstid och egen provision. Den gamla
//              pekar pa den nya. Skalet till att det inte racker med en
//              kvittering: en forlangning ar en affar, och en affar som inte
//              finns i ordertabellen ger ingen provision, syns inte i nagon
//              summering och gar inte att bevaka nasta gang.
//
//   AVSLUTAD   kunden ville inte. ORSAKEN KRAVS — villkoret
//              `sales_order_fornyelse_skal` i 0068 haller den — och det ar hela
//              skillnaden mot en tyst knapp: en lista over varfor kunder lamnar
//              ar det enda stallet ett monster kan visa sig.
// =============================================================================

/**
 * Vem som far bokfora ett fornyelseutfall.
 *
 * SAMMA KRETS SOM SER BEVAKNINGEN, och det ar med flit: saljaren ringer sina
 * egna kunder, kretsen ser alla. En vy som visar en rad med en knapp som sedan
 * nekar ar samre an ingen knapp — samma regel som `farRatta()` i provmodulen
 * fick av samma skal.
 */
async function kravFornyelseratt(orderId: string): Promise<{ user: CurrentUser; rad: Orderrad_skrivning }> {
  const user = await kravInloggad();
  const rad = await hamtaRad(orderId);
  if (!rad) throw new Error("Ordern finns inte.");
  if (rad.salesperson_id !== user.employee!.id && !farHantera(user)) {
    throw new Error("Du får bara hantera förnyelsen på dina egna order.");
  }
  return { user, rad };
}

/**
 * Bokfor att kunden forlangt: den gamla ordern pekar pa den nya.
 *
 * ===========================================================================
 * DEN HAR AR INGEN EGEN KNAPP, OCH DET AR HELA POANGEN MED BESTALLARENS VAL.
 *
 * Fragan stalldes 2026-09-24 — vad hander nar kunden forlanger? — och svaret
 * var "en ny order pa kunden", inte "en kvittering". En forlangning ar en
 * AFFAR: den ger provision, den syns i manadens summering, och den har ett eget
 * slutdatum som ska bevakas i sin tur. Allt det finns redan i `skapaOrder`.
 *
 * Darfor ar vagen: knappen "Forlang" pa den gamla ordern oppnar det vanliga
 * inmatningsformularet med kundens uppgifter ifyllda, och NAR DEN NYA ORDERN AR
 * LAGD skriver `skapaOrder` kopplingen genom den har funktionen. Utfallet och
 * affaren blir da samma handelse, och det gar inte att fa det ena utan det
 * andra.
 *
 * Ett misslyckande HAR river inte ordern. Den nya affaren ar riktig och redan
 * bokford; det som saknas ar en pekare, och foljden av att den saknas ar att
 * den gamla ordern star kvar i bevakningen — alltsa att nagon far fragan en
 * gang till. Samma avvagning som `skrivOvertack` gor, och at samma hall: hellre
 * en paminnelse for mycket an en affar som backas.
 * ===========================================================================
 */
async function markeraForlangd(
  user: CurrentUser,
  gammalId: string,
  nyId: string,
): Promise<string | null> {
  const { error } = await supabaseAdmin()
    .from("sales_order")
    .update({
      renewal_outcome: "forlangd",
      renewal_at: new Date().toISOString(),
      renewal_by: user.employee!.id,
      renewal_order_id: nyId,
    })
    .eq("id", gammalId)
    // BARA EN OHANTERAD ORDER. Utan filtret skriver ett andra klick over ett
    // utfall nagon annan redan bokfort — och `renewal_by` hade da pekat pa fel
    // person utan att nagot syntes.
    .is("renewal_outcome", null);

  if (error) return error.message;

  await logga(user, "sales_order.renewed", gammalId, { ny_order_id: nyId });
  return null;
}

/**
 * Bokfor att kunden INTE forlangde, med orsaken.
 *
 * ORSAKEN AR INTE EN ARTIGHET. Bestallarens val 2026-09-24 var uttryckligen
 * utfall MED orsak framfor en ren kvittering, och skalet star i valet: utan den
 * gar det att rakna hur manga kunder som lamnat men aldrig se varfor.
 */
export async function avslutaAvtal(_prev: Orderstate, form: FormData): Promise<Orderstate> {
  try {
    const id = String(form.get("id") ?? "");
    const orsak = String(form.get("renewal_reason") ?? "").trim();

    const { user, rad } = await kravFornyelseratt(id);

    if (!orsak) {
      return {
        fel: "Skriv varför kunden inte förlänger. Utan orsak går raden inte att lära sig något av.",
      };
    }

    const { error } = await supabaseAdmin()
      .from("sales_order")
      .update({
        renewal_outcome: "avslutad",
        renewal_at: new Date().toISOString(),
        renewal_by: user.employee!.id,
        renewal_reason: orsak,
      })
      .eq("id", id)
      .is("renewal_outcome", null);

    if (error) return { fel: `Avslutet bokfördes inte: ${error.message}` };

    await logga(user, "sales_order.not_renewed", id, {
      company_name: rad.company_name,
      renewal_reason: orsak,
    });

    revalidatePath("/order");
    return { ok: `${rad.company_name} är markerad som avslutad. Påminnelsen är släckt.` };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

/**
 * Tar tillbaka ett fornyelseutfall som blev fel.
 *
 * ===========================================================================
 * DEN HAR FINNS FOR ATT UTFALLET SLACKER EN PAMINNELSE, och en slackt
 * paminnelse om en kund ingen ringt ar tyst pa precis det satt hela passet
 * finns for att sluta med.
 *
 * Kretsen ar SMALARE an den som bokfor: bara den som far hantera order. Att
 * bokfora ett utfall ar att beratta vad som hande; att ta tillbaka det ar att
 * saga att nagon annan berattade fel.
 * ===========================================================================
 */
export async function aterupptaBevakning(_prev: Orderstate, form: FormData): Promise<Orderstate> {
  try {
    const user = await kravHanterare();
    const id = String(form.get("id") ?? "");

    const rad = await hamtaRad(id);
    if (!rad) return { fel: "Ordern finns inte." };

    const { error } = await supabaseAdmin()
      .from("sales_order")
      .update({
        renewal_outcome: null,
        renewal_at: null,
        renewal_by: null,
        renewal_reason: null,
        renewal_order_id: null,
      })
      .eq("id", id);

    if (error) return { fel: `Bevakningen togs inte tillbaka: ${error.message}` };

    await logga(user, "sales_order.renewal_reopened", id, { company_name: rad.company_name });

    revalidatePath("/order");
    return { ok: `${rad.company_name} bevakas igen.` };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

// -----------------------------------------------------------------------------

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
  store: string,
): Promise<Orderstate> {
  try {
    const user = await kravBilageratt(orderId);

    const resultat = await registreraFil({
      fileId,
      andamal: "sales_order",
      filnamn,
      store,
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
      .select("id, store, bucket, path, purpose, sales_order_id, removed_at")
      .eq("id", fileId)
      .maybeSingle();

    // Filen maste hora till DEN HAR ordern. Utan villkoret hade ett id fran
    // webblasaren kunnat peka pa vilken fil som helst i bucketen — inklusive
    // ett lakarintyg — och texten kommit tillbaka i svaret.
    if (!fil || fil.purpose !== "sales_order" || fil.sales_order_id !== orderId) {
      return { fel: "Filen hör inte till den här ordern." };
    }
    if (fil.removed_at) return { fel: "Filen är borttagen." };

    // Genom lagringsmodulen, inte rakt pa Supabase. En orderbilaga laddad upp
    // efter omlaggningen ligger i R2, och en hardkodad bucket hade gett
    // "Filen gick inte att lasa" pa varenda ny bilaga.
    const data = await las({
      lager: tolkaLager(fil.store),
      bucket: String(fil.bucket),
      path: String(fil.path),
    });
    if (!data) return { fel: "Filen gick inte att läsa." };

    const text = await pdfText(new Uint8Array(data));

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

    if ("contact_phone" in andring) await svepKoppling({ orderId }).catch(() => undefined);

    await logga(user, "sales_order.prefilled", orderId, { falt: Object.keys(andring) });

    revalidatePath("/order");
    return {
      ok: `${Object.keys(andring).length} fält är hämtade ur avtalet. Kontrollera dem innan ordern godkänns.`,
    };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

/**
 * "Försök igen" på en order vars Inkio-synk misslyckats (0074).
 *
 * Lägger en NY rad i utkorgen — den gamla står kvar med sitt fel, så att
 * historiken säger att det misslyckades — och tömmer den efter svaret.
 * Samma handling som raden som föll: en makulerad order makuleras, annars
 * läggs den in.
 *
 * Bara för den som får hantera order. Ett försök som skapar en kund i CRM:et
 * är en skrivning i ett annat system, inte något en säljare ska kunna trycka
 * fram på någon annans order.
 */
export async function synkaTillInkio(_prev: Orderstate, form: FormData): Promise<Orderstate> {
  try {
    await kravHanterare();
    const id = String(form.get("id") ?? "");
    const db = supabaseAdmin();

    const { data: o } = await db.from("sales_order").select("status").eq("id", id).maybeSingle();
    if (!o) return { fel: "Ordern finns inte." };
    const { data: k } = await db.from("crm_order").select("state").eq("order_id", id).maybeSingle();
    if (k?.state !== "fel") return { fel: "Ordern har inget misslyckat försök att göra om." };

    const handling = o.status === "makulerad" ? "makulera" : "skapa";
    const { error } = await db.from("outbox").insert({
      kind: "crm",
      payload: { handling, order_id: id },
      idempotency_key: `crm-${handling}:${id}:${Date.now()}`,
      not_before: new Date().toISOString(),
    });
    if (error) return { fel: error.message };

    after(async () => {
      await tomUtkorgen();
    });
    revalidatePath("/order");
    return { ok: "Försöker igen nu. Ladda om sidan om en stund för att se utfallet." };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

/** Har ordern ett uppladdat avtal? (0075 — kravet for att lagga upp den.) */
async function harAvtal(orderId: string): Promise<boolean> {
  const { count } = await supabaseAdmin()
    .from("file_object")
    .select("id", { count: "exact", head: true })
    .eq("sales_order_id", orderId)
    .eq("purpose", "sales_order")
    .is("removed_at", null);
  return (count ?? 0) > 0;
}

/**
 * Kandidaterna till säljsamtalet, för "Koppla säljsamtal" på ett utkast eller
 * en inskickad order. Samma behörighet som bilagorna: säljaren på sin egen
 * order, säljchef/VD/ekonomi på alla.
 */
export async function hamtaSamtalskandidater(
  orderId: string,
): Promise<{ kandidater: Samtalskandidat[] } | { fel: string }> {
  try {
    await kravBilageratt(orderId);
    return { kandidater: await samtalskandidater(orderId) };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Samtalen gick inte att hämta." };
  }
}

/**
 * Kopplar ett av säljarens samtal till ordern för hand — när kunden ringde
 * från ett annat nummer än det på ordern.
 *
 * Kopplingen bär `order_linked_by`, så nattens svepning rör den aldrig. Samtalet
 * måste vara en av kandidaterna: säljarens eget, utan annan affär, inom
 * fönstret. Ett id från webbläsaren prövas alltså mot samma urval som listan
 * visade, och kan inte peka på någon annans samtal.
 */
export async function kopplaSaljsamtal(_prev: Orderstate, form: FormData): Promise<Orderstate> {
  try {
    const orderId = String(form.get("id") ?? "");
    const samtalId = String(form.get("samtal_id") ?? "");
    const user = await kravBilageratt(orderId);

    const rad = await hamtaRad(orderId);
    if (!rad) return { fel: "Ordern finns inte." };
    if (rad.status !== "utkast" && rad.status !== "inskickad") {
      return { fel: "Säljsamtalet kopplas innan ordern godkänns." };
    }

    const kandidater = await samtalskandidater(orderId);
    if (!kandidater.some((k) => k.id === samtalId)) {
      return { fel: "Samtalet går inte att koppla till den här ordern." };
    }

    const svar = await kopplaForHand({ samtalId, orderId, beslutadAv: user.employee!.id });
    if (svar.fel) return { fel: svar.fel };

    await logga(user, "sales_order.call_linked", orderId, { samtal: samtalId });
    revalidatePath("/order");
    return { ok: "Säljsamtalet är kopplat till ordern." };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Samtalet kunde inte kopplas." };
  }
}

/**
 * Avtalet i orderformularet (0075). Laddas upp INNAN ordern finns — samma
 * vag in i lagringen som orderkortets bilaga (`forberedUppladdning`, samma
 * andamal och samma stig), och `skapaOrder` kopplar den till ordern.
 * En fil som aldrig kopplas blir aldrig en rad i `file_object`.
 */
export async function forberedNyttAvtal(filnamn: string, mimetyp: string, storlek: number) {
  try {
    await kravInloggad();
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Du måste vara inloggad." };
  }
  return forberedUppladdning({ andamal: "sales_order", filnamn, mimetyp, storlek });
}

/**
 * Orderformularets uppslag pa organisationsnumret (0075): namn och adress fran
 * Bolagsverket via Inkio. Null nar Inkio inte ar kopplat (previewen) eller
 * numret inte gar att sla upp — da fylls adressen i for hand.
 */
export async function slaUppBolag(orgnr: string) {
  try {
    await kravInloggad();
    return await bolagsuppslag(orgnr);
  } catch {
    return null;
  }
}

/**
 * Kundkortets flik "Aktivitet" (Inkio, varv 3): allt som hänt med kunden i Inkio.
 *
 * VEM SOM SER DEN avgörs av `sales_order`s RLS — ordern läses med
 * ANVÄNDARENS token. Säljaren ser aktiviteten för sina egna kunder, säljchef,
 * VD och ekonomi för alla. Det är samma krets som ser kundkortet, och Inkio
 * läses först när den frågan är besvarad.
 */
export async function hamtaInkioAktivitet(
  orderId: string,
): Promise<{ fel: string } | { ejKopplat: true } | Kundaktivitet> {
  try {
    const orgnr = await orgnrForInkio(orderId);
    if (typeof orgnr !== "string") return orgnr;
    return await kundaktivitet(orgnr);
  } catch (e) {
    return { fel: e instanceof Error ? `Inkio svarade inte: ${e.message}` : "Inkio svarade inte." };
  }
}

/**
 * Överst i fliken "Aktivitet" (Inkio, varv 4): är kundens landningssida uppe?
 * Adressen är kundens "Webbplats" i Inkio, och Nav anropar den när fliken
 * öppnas. Samma krets som ser aktiviteten — se `hamtaInkioAktivitet`.
 */
export async function hamtaLandningssida(
  orderId: string,
): Promise<{ fel: string } | { ejKopplat: true } | Landningssida> {
  try {
    const orgnr = await orgnrForInkio(orderId);
    if (typeof orgnr !== "string") return orgnr;
    return await landningssida(orgnr);
  } catch (e) {
    return { fel: e instanceof Error ? `Inkio svarade inte: ${e.message}` : "Inkio svarade inte." };
  }
}

/**
 * Orderns organisationsnummer, läst med ANVÄNDARENS token — RLS avgör om hen
 * får fråga Inkio om kunden alls. Ett objekt i stället för en sträng betyder
 * att frågan stannar här.
 */
async function orgnrForInkio(orderId: string): Promise<string | { fel: string } | { ejKopplat: true }> {
  await kravInloggad();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId)) {
    return { fel: "Ordern finns inte." };
  }
  const rls = await supabaseServer();
  const { data } = await rls.from("sales_order").select("org_number").eq("id", orderId).maybeSingle();
  if (!data) return { fel: "Ordern finns inte, eller så får du inte se den." };
  if (!inkioKonfigurerad()) return { ejKopplat: true };
  return String(data.org_number ?? "");
}

