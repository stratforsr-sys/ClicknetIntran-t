import "server-only";

import { supabaseAdmin } from "@/lib/supabase/server";
import { medRoll, notifiera, notifieraFranUtkorgen } from "@/lib/notishandelse-server";
import { HANDELSEKALLOR, type Handelsekalla } from "@/lib/notiser";
import { ANGER_SEKUNDER, FORINSTALLNINGAR, arSteg, datumLang, dayLabel, hm, kundbrev, minuter, notistext, type Notisrad } from "@/lib/leveranskalender";
import { andraSchemalagt, avbrytSchemalagt, skickaEpost, type Bilaga } from "@/lib/epost";
import { inbjudan, type Mote } from "@/lib/ical";
import { adapter, type Crmstatus } from "@/lib/crm/adapter";

/**
 * Utkorgen (0069): allt som lämnar en kalenderändring.
 *
 * =============================================================================
 * RADERNA SKRIVS I SAMMA TRANSAKTION SOM ÄNDRINGEN — HÄR TÖMS DE
 *
 * `lk_*`-funktionerna i databasen skriver ändringen och utkorgens rader
 * tillsammans, med `not_before = now() + 10 s`. Här skickas de. Två vägar hit:
 *
 *   1. `after()` i den action som skrev raderna: väntar ut ångerfönstret och
 *      tömmer. Det är den vanliga vägen, och den gör att en inbjudan når
 *      klockan tio sekunder efter att den skickats.
 *   2. `/api/jobb/utkorg`, som `pg_cron` ringer varje minut. Reserven, för när
 *      funktionen dog innan fönstret gått ut.
 *
 * DE KAN INTE TA SAMMA RAD. `lk_utkorg_ta()` tar raderna med
 * `for update skip locked` och stämplar dem, och samma `idempotency_key` kan
 * aldrig skrivas två gånger. En rad som Ångra hunnit ta bort finns inte kvar
 * att ta, och en rad som tagits går inte längre att ångra (`lk_angra` vägrar).
 *
 * TRE MISSLYCKADE FÖRSÖK ger `error`, och admin får en notis. Raden försöks
 * inte igen — ett fel som kvarstår efter tre minuter är ett fel en människa
 * ska titta på.
 * =============================================================================
 */

const KALLOR = new Set<string>(HANDELSEKALLOR);

type Utkorgsrad = {
  id: number;
  kind: string;
  payload: Record<string, unknown>;
  attempts: number;
};

export type Tomning = { skickade: number; hoppade: number; fel: number; igen: number };

/** Töm det som är dags att skicka. Kastar aldrig. */
export async function tomUtkorgen(antal = 50): Promise<Tomning> {
  const utfall: Tomning = { skickade: 0, hoppade: 0, fel: 0, igen: 0 };
  const db = supabaseAdmin();

  const { data, error } = await db.rpc("lk_utkorg_ta", { p_antal: antal });
  if (error || !data) return utfall;

  for (const rad of data as unknown as Utkorgsrad[]) {
    let fel: string | null = null;
    try {
      const gick = await skicka(rad);
      if (gick) utfall.skickade++;
      else utfall.hoppade++;
    } catch (e) {
      fel = e instanceof Error ? e.message : String(e);
    }

    const { data: klar } = await db.rpc("lk_utkorg_klar", { p_id: rad.id, p_fel: fel });
    const svar = klar as unknown as "skickad" | "igen" | "fel" | null;
    if (svar === "fel") {
      utfall.fel++;
      await sagTillAdmin(rad, fel ?? "okänt fel");
    } else if (svar === "igen") {
      utfall.igen++;
    }
  }
  return utfall;
}

/**
 * Vänta ut ångerfönstret och töm. Anropas i `after()` av actionen som skrev
 * raderna, så att den som bjöd in inte står och väntar på Resend.
 */
export async function tomEfterFonstret(): Promise<void> {
  await new Promise((r) => setTimeout(r, (ANGER_SEKUNDER + 1) * 1000));
  await tomUtkorgen();
}

/** En rad. `true` = skickad, `false` = sållad av reglerna (inget att skicka). */
async function skicka(rad: Utkorgsrad): Promise<boolean> {
  if (rad.kind === "resend_schedule" || rad.kind === "resend_patch" || rad.kind === "resend_cancel") {
    return resend(rad);
  }
  if (rad.kind === "crm") return crm(rad);
  if (rad.kind === "ics") return ics(rad);
  if (rad.kind !== "notis") {
    // En okänd sort är ett fel, inte något att tyst markera som skickat.
    throw new Error(`Okänd sort i utkorgen: ${rad.kind}`);
  }

  const n = rad.payload as unknown as Notisrad;
  if (!KALLOR.has(n.kalla)) throw new Error(`Okänd källa: ${n.kalla}`);

  const underlag = await hamtaUnderlag(n);
  if (!underlag) return false;

  if (n.mall === "leverans-bokad-saljare" && typeof n.data?.ansvarig === "string") {
    const { data: a } = await supabaseAdmin().from("employee").select("first_name, last_name").eq("id", n.data.ansvarig).maybeSingle();
    if (a) n.data = { ...n.data, ansvarigNamn: `${a.first_name} ${a.last_name}` };
  }
  const text = notistext(n, underlag);
  if (!text) throw new Error(`Okänd mall: ${n.mall}`);

  const bilagor = n.event_id && ICS_MALLAR[n.mall] ? await kollegansIcs(n.event_id, n.till, ICS_MALLAR[n.mall]) : null;

  return notifieraFranUtkorgen({
    till: n.till,
    av: n.av,
    kalla: n.kalla as Handelsekalla,
    typ: n.task_id ? "uppgift" : n.order_id || (n.data as { order_id?: string })?.order_id ? "order" : "kalender",
    rubrik: text.rubrik,
    detalj: text.detalj,
    href: text.href,
    objekt: n.event_id
      ? { typ: "calendar_event", id: n.event_id }
      : n.task_id
        ? { typ: "task", id: n.task_id }
        : n.order_id
          ? { typ: "sales_order", id: n.order_id }
          : undefined,
    ...(bilagor ? { bilagor } : {}),
  });
}

/**
 * Det texten behöver: aktörens förnamn, rubriken och tiden. Läses NU, när
 * raden töms — tio sekunder efter handlingen är rubriken densamma.
 *
 * `null` när händelsen eller uppgiften inte längre finns: då finns det inget
 * att berätta, och raden räknas som hanterad.
 */
async function hamtaUnderlag(n: Notisrad) {
  const db = supabaseAdmin();

  const avNamn = n.av
    ? (((await db.from("employee").select("first_name").eq("id", n.av).maybeSingle()).data?.first_name as string | undefined) ?? null)
    : null;

  if (n.event_id) {
    const { data: e } = await db
      .from("calendar_event")
      .select("title, dag, tid")
      .eq("id", n.event_id)
      .maybeSingle();
    if (!e) return null;
    return {
      avNamn,
      rubrik: e.title as string,
      dag: e.dag as string,
      tid: e.tid ? String(e.tid).slice(0, 5) : null,
    };
  }

  // Leveransens rader bär ordern i stället för en händelse (0071).
  const orderId = n.order_id ?? ((n.data as { order_id?: string })?.order_id ?? null);
  if (!n.event_id && !n.task_id && orderId) {
    const { data: o } = await db.from("sales_order").select("company_name").eq("id", orderId).maybeSingle();
    if (!o) return null;
    return { avNamn, rubrik: o.company_name as string, dag: svensktIdag(), tid: null };
  }

  if (n.task_id) {
    const { data: t } = await db
      .from("task")
      .select("title, due_date, due_time")
      .eq("id", n.task_id)
      .maybeSingle();
    if (!t || !t.due_date) return null;
    return {
      avNamn,
      rubrik: t.title as string,
      dag: t.due_date as string,
      tid: t.due_time ? String(t.due_time).slice(0, 5) : null,
    };
  }

  return null;
}

/** Tredje misslyckade försöket. En notis per rad, aldrig en per försök. */
async function sagTillAdmin(rad: Utkorgsrad, fel: string): Promise<void> {
  const admins = await medRoll("admin");
  for (const till of admins) {
    await notifiera({
      till,
      av: null,
      kalla: "utkorg-fel",
      typ: "fel",
      rubrik: "Utkorgen kunde inte skicka en rad",
      detalj: `Rad ${rad.id} (${rad.kind}) efter tre försök: ${fel}`.slice(0, 300),
      href: "/fel",
    });
  }
}

function svensktIdag(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" }).format(new Date());
}

// -----------------------------------------------------------------------------
// Resend: mejlpåminnelserna (0071)
// -----------------------------------------------------------------------------

type Paminnelse = {
  id: string;
  event_id: string;
  recipient: "ansvarig" | "kund" | "deltagare";
  send_at: string;
  resend_id: string | null;
  status: string;
};

/**
 * PREVIEWEN MEJLAR ALDRIG EN KUND. Den pekar på produktionsdatabasen, och en
 * provbokning på en riktig order hade annars skickat en påminnelse till en
 * riktig kund. Påminnelsen markeras med felet i stället, så att den syns.
 */
const kundmejlTillatet = (adress?: string | null) =>
  process.env.VERCEL_ENV === "production" || /@resend\.dev$/i.test(adress?.trim() ?? "");

async function resend(rad: Utkorgsrad): Promise<boolean> {
  const db = supabaseAdmin();
  const id = String(rad.payload.reminder_id ?? "");
  const { data: r } = await db.from("calendar_reminder").select("*").eq("id", id).maybeSingle();
  if (!r) return false;
  const p = r as unknown as Paminnelse;

  if (rad.kind === "resend_cancel") {
    if (!p.resend_id) return false;
    const u = await avbrytSchemalagt(p.resend_id);
    await logga("ut", { handling: "cancel", reminder: p.id, resend_id: p.resend_id, ok: u.skickat });
    if (!u.skickat && arSendOnly(u.orsak)) return avbokningsmejl(p);
    if (!u.skickat) throw new Error(u.orsak);
    await db.rpc("lk_resend_satt", { p_reminder: p.id, p_resend_id: null, p_status: "avbokad", p_fel: null });
    return true;
  }

  if (rad.kind === "resend_patch") {
    if (!p.resend_id || p.status !== "schemalagd") return false;
    if (Date.parse(p.send_at) <= Date.now()) return false;
    const u = await andraSchemalagt(p.resend_id, new Date(p.send_at).toISOString());
    await logga("ut", { handling: "patch", reminder: p.id, resend_id: p.resend_id, scheduled_at: p.send_at, ok: u.skickat });
    if (!u.skickat) throw new Error(u.orsak);
    return true;
  }

  // resend_schedule
  if (p.status !== "vantar" || p.resend_id) return false;
  if (Date.parse(p.send_at) <= Date.now() + 60_000) {
    await db.rpc("lk_resend_satt", { p_reminder: p.id, p_resend_id: null, p_status: "fel", p_fel: "Tiden hade redan passerat" });
    return false;
  }

  const { data: e } = await db
    .from("calendar_event")
    .select("id, title, dag, tid, cancelled_at, outcome, organizer_id, order_id")
    .eq("id", p.event_id)
    .maybeSingle();
  if (!e || e.cancelled_at || e.outcome) return false;

  const [{ data: org }, { data: o }] = await Promise.all([
    db.from("employee").select("first_name, email").eq("id", e.organizer_id).maybeSingle(),
    e.order_id
      ? db.from("sales_order").select("company_name, contact_name, contact_phone, contact_email").eq("id", e.order_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const tid = hm(minuter(e.tid as string) ?? 0);
  let till: string | null = null;
  let amne = "";
  let text = "";
  if (p.recipient === "kund") {
    if (!kundmejlTillatet(o?.contact_email as string | null | undefined)) {
      await db.rpc("lk_resend_satt", { p_reminder: p.id, p_resend_id: null, p_status: "fel", p_fel: "Förhandsvisningen skickar inte till kunder" });
      return false;
    }
    till = (o?.contact_email as string | null) ?? null;
    amne = `Påminnelse: vi hörs i dag kl ${tid}`;
    text = [
      o?.contact_name ? `Hej ${String(o.contact_name).split(" ")[0]},` : "Hej,",
      "",
      `En påminnelse om vårt samtal i dag, ${dayLabel(e.dag as string)} kl ${tid}.`,
      "",
      `Hälsningar,`,
      `${(org?.first_name as string | undefined) ?? ""}, Clicknet`,
    ].join("\n");
  } else {
    till = (org?.email as string | null) ?? null;
    amne = `Påminnelse: ${e.title} kl ${tid}`;
    text = [
      org?.first_name ? `Hej ${org.first_name},` : "Hej,",
      "",
      `${e.title} börjar kl ${tid} i dag.`,
      o?.contact_name ? `Kontakt: ${o.contact_name}${o.contact_phone ? `, ${o.contact_phone}` : ""}` : "",
      "",
      `Öppna i navet: ${navadress()}/kalender?dag=${e.dag}&handelse=${e.id}`,
    ]
      .filter((x, i, a) => x !== "" || a[i - 1] !== "")
      .join("\n");
  }
  if (!till) {
    await db.rpc("lk_resend_satt", { p_reminder: p.id, p_resend_id: null, p_status: "fel", p_fel: "Ingen e-postadress" });
    return false;
  }

  const u = await skickaEpost({ till, amne, text, schemalagtVid: new Date(p.send_at).toISOString() });
  await logga("ut", { handling: "schedule", reminder: p.id, mottagare: p.recipient, scheduled_at: p.send_at, ok: u.skickat, id: u.skickat ? u.id : null });
  if (!u.skickat) throw new Error(u.orsak);
  await db.rpc("lk_resend_satt", { p_reminder: p.id, p_resend_id: u.id, p_status: "schemalagd", p_fel: null });
  return true;
}

/**
 * Resend-nyckeln är send-only (beställarens val 2026-10-02): den får skicka och
 * schemalägga, men inte avboka ett schemalagt brev (`401 restricted_api_key`).
 */
const arSendOnly = (orsak: string) => /restricted_api_key|only send emails/i.test(orsak);

/**
 * PÅMINNELSEN KOMMER ÄNDÅ — SÄG DÄRFÖR ATT MÖTET ÄR AVBOKAT.
 *
 * När Resend inte låter navet avboka påminnelsen går den ut på sin tid. I stället
 * för tre misslyckade försök och en felnotis till admin får mottagaren genast ett
 * kort brev: "Det här mötet har avbokats." Påminnelsen markeras `fel` med skälet,
 * så att panelen inte påstår att den är avbokad.
 *
 * Bara för ett INSTÄLLT möte. Ett välkomstsamtal som markerats genomfört i förväg
 * får ingen sådan rad — mötet är inte avbokat, det är redan gjort.
 */
async function avbokningsmejl(p: Paminnelse): Promise<boolean> {
  const db = supabaseAdmin();
  const fel = "Resend kunde inte avboka påminnelsen (nyckeln får bara skicka)";
  const { data: e } = await db
    .from("calendar_event")
    .select("id, title, dag, tid, cancelled_at, organizer_id, order_id, step")
    .eq("id", p.event_id)
    .maybeSingle();
  if (!e || !e.cancelled_at || Date.parse(p.send_at) <= Date.now()) {
    await db.rpc("lk_resend_satt", { p_reminder: p.id, p_resend_id: null, p_status: "fel", p_fel: fel });
    return false;
  }

  const [{ data: org }, { data: o }] = await Promise.all([
    db.from("employee").select("first_name, email").eq("id", e.organizer_id).maybeSingle(),
    e.order_id
      ? db.from("sales_order").select("contact_name, contact_email").eq("id", e.order_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const kund = p.recipient === "kund";
  const till = kund ? ((o?.contact_email as string | null) ?? null) : ((org?.email as string | null) ?? null);
  if (!till || (kund && !kundmejlTillatet(till))) {
    await db.rpc("lk_resend_satt", { p_reminder: p.id, p_resend_id: null, p_status: "fel", p_fel: fel });
    return false;
  }

  const tid = hm(minuter(e.tid as string) ?? 0);
  const vad = kund ? (arSteg(e.step) ? `${FORINSTALLNINGAR[e.step].lab} med Clicknet` : "Mötet") : (e.title as string);
  const namn = kund ? (o?.contact_name as string | null | undefined)?.split(" ")[0] : (org?.first_name as string | undefined);
  const u = await skickaEpost({
    till,
    amne: `Avbokat: ${vad} ${dayLabel(e.dag as string)} kl ${tid}`,
    text: [
      namn ? `Hej ${namn},` : "Hej,",
      "",
      "Det här mötet har avbokats.",
      "",
      `${vad}, ${dayLabel(e.dag as string)} kl ${tid}.`,
      "Du kan bortse från påminnelsen om mötet.",
      ...(kund ? ["", "Hälsningar,", "Clicknet"] : []),
    ].join("\n"),
    ...(kund && org?.email ? { svaraTill: org.email as string } : {}),
  });
  await logga("ut", { handling: "avbokningsmejl", reminder: p.id, mottagare: p.recipient, ok: u.skickat, id: u.skickat ? u.id : null });
  if (!u.skickat) throw new Error(u.orsak);
  await db.rpc("lk_resend_satt", { p_reminder: p.id, p_resend_id: null, p_status: "fel", p_fel: `${fel}. Avbokningsmejl skickat.` });
  return true;
}

// -----------------------------------------------------------------------------
// .ics (0072): kollegornas bilaga och kundens inbjudan
// -----------------------------------------------------------------------------

/**
 * Mallarna vars mejl får en `.ics`. Det som ändrar NÄR mötet är: inbjudan,
 * flytten, det godkända förslaget och det inställda mötet. Svar och förslag
 * ändrar ingenting i mottagarens kalender och får ingen fil.
 */
const ICS_MALLAR: Record<string, "REQUEST" | "CANCEL"> = {
  inbjudan: "REQUEST",
  "bokat-at-dig": "REQUEST",
  flyttad: "REQUEST",
  "forslag-godkant": "REQUEST",
  installd: "CANCEL",
};

type Icshandelse = {
  id: string;
  kind: string;
  title: string;
  dag: string;
  tid: string | null;
  minuter: number | null;
  starts_at: string;
  plats: string | null;
  online_url: string | null;
  ics_sequence: number;
  cancelled_at: string | null;
  organizer_id: string;
  order_id: string | null;
  step: string | null;
  series_id: string | null;
  updated_at: string;
};

const ICS_KOLUMNER =
  "id, kind, title, dag, tid, minuter, starts_at, plats, online_url, ics_sequence, cancelled_at, organizer_id, order_id, step, series_id, updated_at";

function somMote(e: Icshandelse, rubrik: string, beskrivning: string | null): Mote {
  return {
    id: e.id,
    sekvens: e.ics_sequence,
    rubrik,
    start: new Date(e.starts_at),
    minuter: e.minuter ?? 30,
    plats: e.plats,
    url: e.online_url,
    beskrivning,
    andrad: new Date(e.updated_at),
  };
}

const liten = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

const icsBilaga = (innehall: string, metod: "REQUEST" | "CANCEL"): Bilaga => ({
  filnamn: metod === "CANCEL" ? "installt.ics" : "inbjudan.ics",
  innehall,
  typ: `text/calendar; charset=utf-8; method=${metod}`,
});

/**
 * Kollegans `.ics`, byggd när raden töms ur händelsens läge just då.
 *
 * NULL FÖR EN FÖREKOMST I EN SERIE. Den är en egen rad i navet men en del av
 * en regel i Outlook, och en fil per förekomst hade lagt sju fristående möten i
 * mottagarens kalender i stället för en serie. Serien syns i navet och i
 * iCal-flödet; mejlet bär ingen fil.
 */
async function kollegansIcs(eventId: string, till: string, metod: "REQUEST" | "CANCEL"): Promise<Bilaga[] | null> {
  try {
    const db = supabaseAdmin();
    const { data } = await db.from("calendar_event").select(ICS_KOLUMNER).eq("id", eventId).maybeSingle();
    const e = data as unknown as Icshandelse | null;
    if (!e || !e.tid || e.series_id) return null;
    if ((metod === "CANCEL") !== Boolean(e.cancelled_at)) return null;

    const { data: folk } = await db.from("employee").select("id, first_name, last_name, email").in("id", [e.organizer_id, till]);
    const p = new Map(((folk ?? []) as { id: string; first_name: string; last_name: string; email: string | null }[]).map((x) => [x.id, x]));
    const org = p.get(e.organizer_id);
    const mig = p.get(till);
    if (!org?.email || !mig?.email) return null;

    const ics = inbjudan(
      somMote(e, e.title, `Svara i navet: ${navadress()}/kalender?dag=${e.dag}&handelse=${e.id}`),
      metod,
      { namn: `${org.first_name} ${org.last_name}`, epost: org.email },
      { namn: `${mig.first_name} ${mig.last_name}`, epost: mig.email, svara: false },
    );
    return [icsBilaga(ics, metod)];
  } catch {
    // En fil som inte gick att bygga får aldrig fälla notisen. Mejlet går
    // fram utan den.
    return null;
  }
}

/**
 * Kundens inbjudan: ett eget mejl med `.ics`, från navets avsändare och med
 * organisatören som svarsadress.
 *
 * TVÅ SPÄRRAR innan något går ut, eftersom det här är navets enda brev till
 * någon utanför Clicknet som skickas på en kollegas klick:
 *   1. Raden ska fortfarande gälla. Har tiden ändrats igen (högre sekvens) är
 *      en nyare rad på väg; har mötet ställts in ska bara CANCEL gå.
 *   2. Previewen mejlar aldrig en riktig kund (`kundmejlTillatet`).
 */
async function ics(rad: Utkorgsrad): Promise<boolean> {
  const db = supabaseAdmin();
  const eventId = String(rad.payload.event_id ?? "");
  const epost = String(rad.payload.epost ?? "").trim().toLowerCase();
  const sekvens = Number(rad.payload.sekvens ?? -1);
  const metod = rad.payload.metod === "CANCEL" ? "CANCEL" : "REQUEST";

  const { data } = await db.from("calendar_event").select(ICS_KOLUMNER).eq("id", eventId).maybeSingle();
  const e = data as unknown as Icshandelse | null;
  if (!e || !e.tid || !epost) return false;
  if (e.ics_sequence !== sekvens) return false;
  if ((metod === "CANCEL") !== Boolean(e.cancelled_at)) return false;
  if (metod === "REQUEST") {
    const { data: kvar } = await db
      .from("calendar_attendee")
      .select("id")
      .eq("event_id", e.id)
      // ilike för versalerna; `_` och `%` i adressen är tecken, inte jokrar.
      .ilike("external_email", epost.replace(/[\\%_]/g, (t) => `\\${t}`))
      .limit(1);
    if (!kvar?.length) return false;
  }

  if (!kundmejlTillatet(epost)) {
    await logga("ut", { handling: "ics", event: e.id, metod, sekvens, ok: false, orsak: "Förhandsvisningen skickar inte till kunder" });
    return false;
  }

  const [{ data: org }, { data: o }] = await Promise.all([
    db.from("employee").select("first_name, last_name, email").eq("id", e.organizer_id).maybeSingle(),
    e.order_id
      ? db.from("sales_order").select("company_name, contact_name").eq("id", e.order_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (!org?.email) throw new Error("Organisatören saknar e-postadress");

  const orgNamn = `${org.first_name} ${org.last_name}`.trim();
  const vad = arSteg(e.step) ? FORINSTALLNINGAR[e.step].lab : e.title;
  const rubrik = `${vad} med Clicknet`;
  const start = minuter(e.tid) ?? 0;
  const nar = `${liten(datumLang(e.dag))} kl ${hm(start)}–${hm(start + (e.minuter ?? 30))}`;
  const kontakt = (o?.contact_name as string | null | undefined)?.split(" ")[0] ?? null;

  const ics = inbjudan(
    somMote(e, rubrik, null),
    metod,
    { namn: `${orgNamn}, Clicknet`, epost: org.email as string },
    { namn: (o?.contact_name as string | null | undefined) ?? null, epost, svara: true },
  );

  const { amne, text } = kundbrev({ metod, sekvens, rubrik, nar, kontakt, plats: e.plats, url: e.online_url, avsandare: org.first_name as string });
  const u = await skickaEpost({ till: epost, amne, text, svaraTill: org.email as string, bilagor: [icsBilaga(ics, metod)] });
  await logga("ut", { handling: "ics", event: e.id, metod, sekvens, ok: u.skickat, id: u.skickat ? u.id : null });
  if (!u.skickat) throw new Error(u.orsak);
  return true;
}

// -----------------------------------------------------------------------------
// CRM (0071)
// -----------------------------------------------------------------------------

async function crm(rad: Utkorgsrad): Promise<boolean> {
  const db = supabaseAdmin();
  const orderId = String(rad.payload.order_id ?? "");
  const status = String(rad.payload.status ?? "") as Crmstatus;
  const { data: d } = await db.from("delivery").select("crm_external_id").eq("order_id", orderId).maybeSingle();
  if (!d) return false;
  const a = adapter();
  await logga("ut", { system: a.namn, handling: "status", order_id: orderId, status, externt_id: d.crm_external_id }, "crm");
  try {
    if (!d.crm_external_id) throw new Error("Kunden saknar kund-ID i leverans-CRM:et. Klistra in det i Nav.");
    await a.sattStatus(d.crm_external_id as string, status);
    await db.rpc("lk_crm_klar", { p_order: orderId, p_fel: null });
    return true;
  } catch (e) {
    const fel = e instanceof Error ? e.message : String(e);
    await db.rpc("lk_crm_klar", { p_order: orderId, p_fel: fel });
    throw new Error(fel);
  }
}

async function logga(riktning: "ut" | "in", body: Record<string, unknown>, system: "resend" | "crm" = "resend") {
  await supabaseAdmin().from("integration_log").insert({ system, direction: riktning, body });
}

function navadress(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://clicknet-nav.vercel.app").replace(/\/+$/, "");
}
