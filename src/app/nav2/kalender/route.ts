import { NextResponse } from "next/server";
import { getCurrentUser, type CurrentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { FORINSTALLNINGAR, STEG, UPPREPA, WDL, arDatum, arVy, kvittoKopierad, plus, wd, type Upprepa, type Upptaget } from "@/lib/leveranskalender";
import { fonsterFran, hamtaHandelsedetalj, lk, upptagetFor } from "@/lib/leveranskalender-server";
import { KATEGORIFARGER, KATEGORINYCKEL, hamtaKalposter, kalDetalj, lasKategorier, ombudFor, sokKalender } from "@/lib/nav2/kalender";
import { kalPushNasta } from "@/lib/nav2/kalender-push";
import { svensktDatum } from "@/lib/klocka";
import { bucketen, huvudUppgifter, lagerForNyaFiler, signeraLank, signeraUppladdning, taBort } from "@/lib/lagring-server";
import { HORISONT_DAGAR, forekomster } from "@/lib/upprepning";
import { LASLAGE_TEXT, SKRIVLAGE, sammaUrsprung } from "@/lib/nav2/skrivlage";
import { skapaKalenderpost, stallInDelning } from "@/app/(app)/kalender/actions";
import {
  andraLangd,
  andraMote,
  beOmForberedelse,
  behallTid,
  bockaAv,
  flytta,
  flyttaSerie,
  foreslaTid,
  godkannForslag,
  kopiera,
  laggTillPunkt,
  sattPaminnelse,
  skapaLeverans,
  skapaMote,
  skapaSerie,
  stallIn,
  svara,
  type Resultat,
} from "@/app/(app)/kalender/moten/actions";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Nav 2.0: kalenderns poster när utkastet bläddrar eller visar en kollega.
 *
 *   ?vy=manad|team|vecka&dag=YYYY-MM-DD&visa=<id>,<id>   posterna, som /kalender
 *   ?detalj=<calendar_event.id>                           en händelse i sin helhet
 *   ?upptaget=<id>,<id>&fran=YYYY-MM-DD                   ledig/upptagen i 15 dagar, för assistenten
 *   ?sok=<text>&pers=<id>,<id>                            sökning i hela kalendern (pers: arrangörer vars namn matchar)
 *
 * BARA LASNING, med samma funktioner och samma delningsnivaer som sidan
 * (`hamtaLeveranskalender`, `hamtaHandelsedetalj`).
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user?.employee) return NextResponse.json({ fel: "Inte inloggad." }, { status: 401 });
  const url = new URL(request.url);
  const svar = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store, max-age=0" } });

  const detalj = url.searchParams.get("detalj");
  if (detalj) {
    if (!UUID.test(detalj)) return svar({ fel: "Okänd händelse." }, 400);
    const d = await kalDetalj(user, detalj);
    return d ? svar(d) : svar({ fel: "Händelsen finns inte, eller så får du inte se detaljerna." }, 404);
  }

  // Ledig/upptagen (Outlooks schemaassistent): repots `upptagetFor`, genom samma projektioner som kalendern,
  // så att läsaren bara får veta att tiden är tagen. Möten man tackat nej till och "Visa som ledig" räknas inte;
  // frånvaro hela dagen gör dagen upptagen. Högst 20 personer och 15 dagar, som repots hamtaUpptaget.
  const upp = url.searchParams.get("upptaget");
  if (upp !== null) {
    const fran = url.searchParams.get("fran");
    const personer = upp.split(",").filter((id) => UUID.test(id));
    if (!arDatum(fran) || !personer.length || personer.length > 20) return svar({ fel: "Okända personer eller dag." }, 400);
    const { till } = fonsterFran(fran, 15);
    return svar({ fran, till, upptaget: await medHeldagar(await upptagetFor(user, personer, fran, till), personer, fran, till) });
  }

  // Service workern (public/nav2/sw.js) när en tom push kommit: den äldsta kalendernotisen den här enheten inte visat.
  const push = url.searchParams.get("push");
  if (push !== null) {
    if (!/^https:\/\//.test(push) || push.length > 1000) return svar({ notis: null });
    return svar({ notis: await kalPushNasta(user.employee.id, push) });
  }

  const sok = url.searchParams.get("sok");
  if (sok !== null) {
    const pers = (url.searchParams.get("pers") ?? "").split(",").filter((id) => UUID.test(id)).slice(0, 20);
    return svar(await sokKalender(user, sok, pers));
  }

  const vy = url.searchParams.get("vy");
  const dag = url.searchParams.get("dag");
  if (!arVy(vy) || !arDatum(dag)) return svar({ fel: "Okänd vy eller dag." }, 400);
  const visa = (url.searchParams.get("visa") ?? "").split(",").filter((id) => UUID.test(id));
  const data = await hamtaKalposter(user, vy, dag, visa);
  return data ? svar(data) : svar({ fel: "Ingen kalender." }, 404);
}

/**
 * Nav 2.0: allt som ändrar kalendern, i en POST.
 *
 * ===========================================================================
 * REPOTS ACTIONS. Möten, serier och 1:1 (`skapaMote`, `skapaSerie`), svar och
 * förslag, flytt, längd, inställt och kopia (app/(app)/kalender/moten), uppgift
 * och coachning i kalendern (`skapaKalenderpost`), leveransmöten från kön
 * (`skapaLeverans`) och delningen (`stallInDelning`) — samma behörighet, samma
 * utkorg och samma ångra.
 *
 * Arrangörens beslut om ett förslag (`godkannForslag`, `behallTid`): "besluta". 1:1-kortet:
 * `beOmForberedelse`, `laggTillPunkt`, `bockaAv`.
 *
 * Det nya: ändra ett mötes rubrik, plats, agenda, deltagare och påminnelse
 * (`andraMote`, 0088), den egna påminnelsen (`sattPaminnelse`), "Varje månad"
 * (0089) och Privat (0090). Gäster utanför Clicknet med e-post på ett möte
 * (`lead_bjud_in`, 0135; se `gasterFran`).
 * ===========================================================================
 *
 * LÄSLÄGE: står `SKRIVLAGE.kalender` på false svarar rutten 423 innan något
 * skrivs.
 */
const UPPREPA_FRAN: Record<string, Upprepa> = { "Upprepas inte": "aldrig", "Varje vardag": "vardagar", "Varje vecka": "vecka", "Varannan vecka": "varannan", "Varje månad": "manad" };
const STEG_FRAN: Record<string, string> = Object.fromEntries(STEG.map((s) => [FORINSTALLNINGAR[s].lab, s]));

type Falt = {
  id?: string;
  typ?: string;
  t?: string;
  d?: string;
  s?: number;
  e?: number;
  delt?: string[];
  plats?: string;
  video?: string;
  agenda?: string;
  visa?: string;
  pamin?: number | null;
  upprepa?: string;
  /** Seriens slutdatum (Outlooks "Slutar"), tomt = löper vidare. */
  slut?: string | null;
  /** Valfria deltagare (Outlook, 0203): id:n bland `delt`. */
  valfria?: string[];
  /** Sista dagen för ett heldagsmöte över flera dagar (0204). */
  slutdag?: string;
  priv?: boolean;
  lev?: string;
  order?: string;
  heldag?: boolean;
  gaster?: string[];
  /** Boka åt (Outlooks ombud, 0201): ägarens id, när en delegat bokar ett möte i ägarens kalender. */
  for?: string;
};

/**
 * Gäster utanför Clicknet (beställaren 2026-10-20): "när jag lägger in ett möte
 * ska jag kunna lägga till en person, och då skickas ett vanligt mejl via
 * Resend". Samma utskick som Leads möten och Kalenderns leveransmöten:
 * `lead_bjud_in` (0135) lägger adressen i `calendar_attendee.external_email`
 * och köar `lk_ics_ko`, och utkorgen mejlar kalenderfilen från organisatören.
 * En adress som är en kollegas blir en vanlig deltagare.
 */
const EPOST = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
async function gasterFran(lista: unknown): Promise<{ epost: string[]; kolleger: string[] } | { fel: string }> {
  if (lista === undefined || lista === null) return { epost: [], kolleger: [] };
  if (!Array.isArray(lista) || lista.length > 20) return { fel: "Gästlistan stämmer inte." };
  const epost = [...new Set(lista.map((x) => String(x ?? "").trim().toLowerCase()))].filter(Boolean);
  const fel = epost.find((x) => !EPOST.test(x) || x.length > 254);
  if (fel) return { fel: `${fel} är ingen e-postadress.` };
  if (!epost.length) return { epost, kolleger: [] };
  const { data } = await supabaseAdmin().from("employee").select("id, email").in("email", epost);
  const kollega = new Map((data ?? []).map((r) => [String(r.email).toLowerCase(), String(r.id)]));
  return { epost: epost.filter((x) => !kollega.has(x)), kolleger: [...kollega.values()] };
}
const lista = (x: string[]) => (x.length > 1 ? `${x.slice(0, -1).join(", ")} och ${x[x.length - 1]}` : x[0]);
async function bjudIn(r: Resultat, eventId: string | null | undefined, epost: string[]): Promise<Resultat> {
  if (r.fel || !eventId || !epost.length) return r;
  const db = supabaseAdmin();
  const { data: fanns } = await db.from("calendar_attendee").select("external_email").eq("event_id", eventId).not("external_email", "is", null);
  const redan = new Set((fanns ?? []).map((x) => String(x.external_email).toLowerCase()));
  const fick: string[] = [];
  const inte: string[] = [];
  for (const adress of epost.filter((x) => !redan.has(x))) {
    const { error } = await db.rpc("lead_bjud_in", { p_event: eventId, p_epost: adress });
    (error ? inte : fick).push(adress);
  }
  const text = [fick.length ? `${lista(fick)} får en inbjudan med mejl.` : "", inte.length ? `Inbjudan till ${lista(inte)} gick inte att skicka.` : ""].filter(Boolean).join(" ");
  return text ? { ...r, kvitto: `${r.kvitto ?? "Sparat."} ${text}` } : r;
}

/**
 * Ctrl- eller Alt-dra (Outlook): en kopia av mötet på den dag och tid man släpper det. Repots `kopiera` lägger
 * kopian en vecka fram; att sedan flytta den hade gett deltagarna två utskick. Här blir kopian ett nytt möte med
 * samma rubrik, plats, agenda, deltagare, påminnelse, "Visa som" och Privat, och en enda inbjudan. Arrangören,
 * eller hens ombud, kopierar; kopian står i arrangörens kalender. Gäster
 * utanför Clicknet följer inte med, eftersom de annars fick ett mejl de inte bett om.
 */
async function kopieraTill(user: CurrentUser, id: string, dag: string, start: number): Promise<Resultat> {
  if (!UUID.test(id)) return { fel: "Händelsen finns inte längre." };
  const d = await hamtaHandelsedetalj(user, id);
  if (!d || d.installd) return { fel: "Händelsen finns inte längre." };
  if (d.slag !== "mote") return { fel: "Bara ett möte kopieras genom att dra. Ett 1:1 är en serie, och en leverans bokas från kön." };
  if (d.organisator !== user.employee?.id && !(await ombudFor(user.employee!.id)).has(d.organisator)) return { fel: "Bara arrangören kopierar mötet. Du kan föreslå en ny tid." };
  const db = supabaseAdmin();
  const [{ data: e }, { count: gaster }] = await Promise.all([
    db.from("calendar_event").select("show_as, is_private, online_url").eq("id", id).maybeSingle(),
    db.from("calendar_attendee").select("id", { count: "exact", head: true }).eq("event_id", id).not("external_email", "is", null),
  ]);
  const deltagare = d.deltagare.map((x) => x.id).filter((x) => x !== d.organisator);
  const r = await skapaMote({
    organisator: d.organisator,
    rubrik: d.rubrik,
    dag,
    start,
    minuter: d.minuter ?? 30,
    deltagare,
    plats: d.plats,
    agenda: d.agenda,
    paminnelse: d.paminnelse,
    visaSom: (e?.show_as as string | undefined) ?? undefined,
  });
  if (r.fel || !r.eventId) return r;
  if (e?.is_private || e?.online_url) await db.from("calendar_event").update({ is_private: Boolean(e.is_private), online_url: e.online_url ?? null }).eq("id", r.eventId);
  return { ...r, kvitto: kvittoKopierad(dag, start, deltagare.length > 0) + (gaster ? " Gästerna utanför Clicknet följer inte med." : "") };
}

/**
 * Valfria deltagare (beställaren 2026-10-22, svar 4; 0203): efter att mötet eller serien sparats sätts
 * `calendar_attendee.optional` på mötets eller seriens rader. Före 0203 finns kolumnen inte, och då står alla
 * som obligatoriska, som förut.
 */
async function sattValfria(eventId: string | null | undefined, valfria: readonly string[] | undefined): Promise<void> {
  if (!eventId || valfria === undefined) return;
  const db = supabaseAdmin();
  const { data: e } = await db.from("calendar_event").select("series_id").eq("id", eventId).maybeSingle();
  const pa = (q: ReturnType<ReturnType<typeof db.from>["update"]>) => (e?.series_id ? q.eq("series_id", e.series_id) : q.eq("event_id", eventId));
  const ids = valfria.filter((x) => UUID.test(x));
  await pa(db.from("calendar_attendee").update({ optional: false }));
  if (ids.length) await pa(db.from("calendar_attendee").update({ optional: true })).in("employee_id", ids);
}

/**
 * Heldag och möten över flera dagar (beställaren 2026-10-22, svar 3: Outlook har det; 0204). Ett möte utan klockslag,
 * också en lördag eller söndag, högst 32 dagar. Före 0204 svarar rutten att heldag kommer med uppdateringen.
 */
const DAGTEXT = (dag: string, slut: string | null) => {
  const f = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("sv-SE", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).replace(/\./g, "");
  return slut && slut > dag ? `${f(dag)}–${f(slut)}` : f(dag);
};
const HELDAG_SAKNAS = "Heldag kommer med databasens uppdatering (0204).";

async function skapaHeldag(
  user: CurrentUser,
  a: { rubrik: string; dag: string; slutdag: string | null; deltagare: string[]; plats: string | null; video: string | null; agenda: string; visaSom: string | null },
): Promise<Resultat> {
  if (!a.rubrik.trim()) return { fel: "Skriv en rubrik först." };
  if (!arDatum(a.dag)) return { fel: "Välj ett datum." };
  const slut = a.slutdag && arDatum(a.slutdag) && a.slutdag > a.dag ? a.slutdag : null;
  if (slut && slut > plus(a.dag, 31)) return { fel: "Ett möte över flera dagar är högst 32 dagar." };
  const r = await lk<{ event_id: string; undo_id: string; deltagare: string[] }>("lk_skapa_heldag", {
    p_aktor: user.employee!.id,
    p_title: a.rubrik.trim().slice(0, 200),
    p_dag: a.dag,
    p_slutdag: slut ?? a.dag,
    p_deltagare: a.deltagare,
    p_plats: a.plats,
    p_online_url: a.video,
    p_agenda: a.agenda,
    p_show_as: a.visaSom ?? "upptagen",
  });
  if (!r.ok) return { fel: /lk_skapa_heldag/.test(r.fel) ? HELDAG_SAKNAS : r.fel };
  const n = r.data.deltagare.length;
  return { ok: true, eventId: r.data.event_id, angra: r.data.undo_id, dag: a.dag, kvitto: `${a.rubrik.trim()} är bokat ${DAGTEXT(a.dag, slut)}, hela dagen.${n ? ` ${n === 1 ? "En deltagare får" : `${n} deltagare får`} en inbjudan.` : ""}` };
}

async function andraHeldag(user: CurrentUser, id: string, dag: string, slutdag: string | null, start: number | null, minuter: number | null): Promise<Resultat> {
  if (!arDatum(dag)) return { fel: "Välj ett datum." };
  if (slutdag && slutdag > plus(dag, 31)) return { fel: "Ett möte över flera dagar är högst 32 dagar." };
  if (start !== null && (start % 5 !== 0 || start < 0 || start > 1435)) return { fel: "Välj en starttid." };
  const r = await lk<{ event_id: string; undo_id: string; svara_igen: string[] }>("lk_andra_heldag", {
    p_aktor: user.employee!.id,
    p_event: id,
    p_dag: dag,
    p_slutdag: slutdag,
    p_tid: start === null ? null : `${String(Math.floor(start / 60)).padStart(2, "0")}:${String(start % 60).padStart(2, "0")}`,
    p_minuter: minuter,
  });
  if (!r.ok) return { fel: /lk_andra_heldag/.test(r.fel) ? HELDAG_SAKNAS : r.fel };
  const n = r.data.svara_igen.length;
  return { ok: true, eventId: id, angra: r.data.undo_id, dag, kvitto: `Flyttat till ${start === null ? `${DAGTEXT(dag, slutdag)}, hela dagen` : DAGTEXT(dag, null)}.${n ? ` ${n === 1 ? "En deltagare behöver" : `${n} deltagare behöver`} svara igen.` : ""}` };
}

/**
 * Ledig/upptagen: repots `upptagetFor` hoppar över poster utan klockslag. Ett heldagsmöte (0204) som inte visas som
 * ledigt gör hela dagen upptagen för arrangören och dem som inte tackat nej, som i Outlook.
 */
async function medHeldagar(upp: Upptaget, personer: string[], fran: string, till: string): Promise<Upptaget> {
  const db = supabaseAdmin();
  const { data: moten, error } = await db
    .from("calendar_event")
    .select("id, dag, slutdag, organizer_id, show_as")
    .is("tid", null)
    .is("cancelled_at", null)
    .eq("kind", "mote")
    .neq("show_as", "ledig")
    .lte("dag", till)
    .gte("starts_at", new Date(Date.parse(`${fran}T00:00:00Z`) - 32 * 864e5).toISOString());
  if (error || !moten?.length) return upp;
  const ids = moten.map((m) => m.id as string);
  const { data: med } = await db.from("calendar_attendee").select("event_id, employee_id, response").in("event_id", ids).in("employee_id", personer);
  for (const m of moten as { id: string; dag: string; slutdag: string | null; organizer_id: string }[]) {
    const vem = new Set<string>();
    if (personer.includes(m.organizer_id)) vem.add(m.organizer_id);
    for (const a of (med ?? []) as { event_id: string; employee_id: string; response: string }[]) if (a.event_id === m.id && a.response !== "nej") vem.add(a.employee_id);
    for (let d = m.dag; d <= (m.slutdag ?? m.dag); d = plus(d, 1)) {
      if (d < fran || d > till) continue;
      for (const p of vem) {
        upp[p] = upp[p] ?? {};
        upp[p][d] = { block: upp[p][d]?.block ?? [], ledig: true };
      }
    }
  }
  return upp;
}

/** Formulärets "Upprepas" → seriens regel (calendar_series). */
const MONSTER_FRAN: Record<string, { monster: "vardagar" | "veckovis" | "manadsvis"; intervall: 1 | 2 }> = {
  "Varje vardag": { monster: "vardagar", intervall: 1 },
  "Varje vecka": { monster: "veckovis", intervall: 1 },
  "Varannan vecka": { monster: "veckovis", intervall: 2 },
  "Varje månad": { monster: "manadsvis", intervall: 1 },
};

type Serieandring = { fran: "har" | "alla"; dag: string; start: number; minuter?: number; upprepa?: string; slut?: string | null; titel?: string };

/**
 * En serie som i Outlook (beställaren 2026-10-22, fråga 2: "ja, exakt som Outlook"): "den här och följande" eller
 * alla, med tid, längd, mönster, veckodag, slutdatum och rubrik (0202, `lk_andra_serie`). Det som inte skickas står
 * kvar som i serien. Förekomsterna räknas med samma regel som jobbet som fyller på serien (`forekomster`, åtta
 * veckor fram). Före 0202 svarar rutten att bara den här gången går att ändra.
 */
async function andraSerie(user: CurrentUser, id: string, a: Serieandring): Promise<Resultat> {
  if (!arDatum(a.dag)) return { fel: "Välj ett datum." };
  if (!Number.isInteger(a.start) || a.start < 0 || a.start > 1435 || a.start % 5 !== 0) return { fel: "Välj en starttid." };
  if (a.slut && !arDatum(a.slut)) return { fel: "Välj när serien slutar." };
  const db = supabaseAdmin();
  const { data: e } = await db.from("calendar_event").select("series_id").eq("id", id).maybeSingle();
  if (!e?.series_id) return { fel: "Händelsen är inte en del av en serie." };
  const { data: s } = await db.from("calendar_series").select("kind, title, minuter, monster, intervall, starts_on, ends_on").eq("id", e.series_id).maybeSingle();
  if (!s) return { fel: "Serien finns inte längre." };
  const regel = a.upprepa && MONSTER_FRAN[a.upprepa] ? MONSTER_FRAN[a.upprepa] : { monster: s.monster as "vardagar" | "veckovis" | "manadsvis", intervall: (s.intervall === 2 ? 2 : 1) as 1 | 2 };
  if (s.kind === "enskilt" && regel.monster !== "veckovis") return { fel: "En 1:1 är varje eller varannan vecka." };
  if (regel.monster === "veckovis" && wd(a.dag) > 5) return { fel: "Välj en vardag." };
  const minuter = a.minuter ?? (s.minuter as number);
  if (!Number.isInteger(minuter) || minuter < 5 || minuter > 480) return { fel: "Välj en längd mellan 5 minuter och 8 timmar." };
  const slut = a.slut === undefined ? ((s.ends_on as string | null) ?? null) : a.slut || null;
  const idag = svensktDatum();
  const fran = a.fran === "har" ? (a.dag < idag ? idag : a.dag) : idag;
  if (slut && slut < fran) return { fel: "Serien kan inte sluta innan den börjar." };
  const dagar = forekomster(
    { monster: regel.monster, veckodagar: regel.monster === "veckovis" ? [wd(a.dag)] : [], starts_on: a.fran === "har" ? a.dag : (s.starts_on as string), ends_on: slut, intervall: regel.intervall },
    fran,
    plus(idag, HORISONT_DAGAR),
  );
  const text = regel.monster === "vardagar" ? "varje vardag" : regel.monster === "manadsvis" ? "varje månad" : `${regel.intervall === 2 ? "varannan " : ""}${WDL[wd(a.dag)].toLowerCase()}${regel.intervall === 2 ? "" : "ar"}`;
  const r = await lk<{ undo_id: string; svara_igen: string[]; event_id: string }>("lk_andra_serie", {
    p_aktor: user.employee!.id,
    p_event: id,
    p_fran_har: a.fran === "har",
    p_tid: `${String(Math.floor(a.start / 60)).padStart(2, "0")}:${String(a.start % 60).padStart(2, "0")}`,
    p_minuter: minuter,
    p_monster: regel.monster,
    p_intervall: regel.intervall,
    p_veckodag: regel.monster === "veckovis" ? wd(a.dag) : null,
    p_ends_on: slut,
    p_dagar: dagar,
    p_regeltext: text,
    p_title: s.kind === "enskilt" ? null : (a.titel ?? "").trim().slice(0, 200) || null,
  });
  if (!r.ok) return { fel: /lk_andra_serie/.test(r.fel) ? "Serien ändras som i Outlook när databasen fått 0202. Bara den här gången går att ändra än." : r.fel };
  const igen = r.data.svara_igen.length;
  const vem = a.fran === "har" ? "Den här och kommande gånger" : "Hela serien";
  return {
    ok: true,
    eventId: r.data.event_id,
    angra: r.data.undo_id,
    dag: a.dag,
    kvitto: `${vem} ändrad: ${text}${slut ? ` till ${slut}` : ""}.${igen ? ` ${igen === 1 ? "En deltagare behöver" : `${igen} deltagare behöver`} svara igen.` : ""}`,
  };
}

/**
 * Ombud som i Outlook (beställaren 2026-10-22, efter del 9: "kunna dela behörighet till någon som kan flytta mina
 * möten eller svara och boka åt mig ifall jag tex har en assistent"; 0201). En händelse som redan finns ändras av
 * arrangören, eller av den som fått "Kan planera om" eller "Delegat" i arrangörens kalender (databasens
 * lk_far_andra). Svaret, förslaget, påminnelsen och 1:1-punkterna är deltagarens egna.
 */
const ARRANGORENS = ["besluta", "stallin", "kopiera", "flytta", "langd", "serie", "bilaga-forbered", "bilaga-registrera", "bilaga-bort"];
async function baraArrangoren(user: CurrentUser, id: string): Promise<Resultat | null> {
  if (!UUID.test(id)) return { fel: "Händelsen finns inte längre." };
  const { data } = await supabaseAdmin().from("calendar_event").select("organizer_id").eq("id", id).maybeSingle();
  if (!data) return { fel: "Händelsen finns inte längre." };
  if (data.organizer_id === user.employee?.id || (await ombudFor(user.employee!.id)).has(data.organizer_id)) return null;
  return { fel: "Bara arrangören, eller den som fått planera om i hens kalender, ändrar händelsen." };
}
/** Delegaten bokar åt ägaren och svarar på ägarens inbjudningar ("Kan planera om" flyttar bara). */
async function delegatFor(user: CurrentUser, agare: unknown): Promise<string | Resultat> {
  const id = String(agare ?? "");
  if (!UUID.test(id)) return { fel: "Okänd kalender." };
  return (await ombudFor(user.employee!.id)).get(id) === "delegat" ? id : { fel: "Du är inte delegat i den kalendern. Ägaren ger nivån under Dela." };
}
const OMBUD_SAKNAS = "Ombuden får boka och svara när databasen fått 0201.";

/**
 * Bilagor som i Outlook (beställaren 2026-10-22: ja; 0201, calendar_attachment). Arrangören och hens ombud bifogar
 * och tar bort; alla som ser mötets detaljer öppnar. En gång i en serie får filen för hela serien, så att den följer
 * med varje gång och överlever att serien ändras. Filen går direkt till lagringen (signerad uppladdning, som
 * ärendenas bilagor), och raden skrivs först när lagringen själv sagt vad som kom in.
 */
const BILAGA_MIME = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "text/plain",
  "text/csv",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);
const BILAGA_MAX = 25 * 1024 * 1024;
const BILAGA_SAKNAS = "Bilagor kommer med databasens uppdatering (0201).";
type Lager = ReturnType<typeof lagerForNyaFiler>;
/** Mötet eller, för en gång i en serie, serien: det bilagan hänger på. */
async function bilagansAgare(id: string): Promise<{ event_id: string } | { series_id: string } | null> {
  const { data } = await supabaseAdmin().from("calendar_event").select("id, series_id").eq("id", id).maybeSingle();
  if (!data) return null;
  return data.series_id ? { series_id: String(data.series_id) } : { event_id: String(data.id) };
}
async function bilaga(user: CurrentUser, handling: string, id: string, b: Record<string, unknown>): Promise<Record<string, unknown> & { status?: number }> {
  const db = supabaseAdmin();
  const agare = await bilagansAgare(id);
  if (!agare) return { fel: "Händelsen finns inte längre.", status: 404 };
  const mapp = `kalender/${"series_id" in agare ? agare.series_id : agare.event_id}`;
  const [kol, varde] = "series_id" in agare ? ["series_id", agare.series_id] : ["event_id", agare.event_id];
  switch (handling) {
    case "bilaga-forbered": {
      const mime = String(b.mime ?? "").toLowerCase();
      const storlek = Number(b.storlek ?? 0);
      if (!BILAGA_MIME.has(mime)) return { fel: "Bifoga PDF, bilder, Word, Excel, PowerPoint eller text.", status: 400 };
      if (!(storlek > 0 && storlek <= BILAGA_MAX)) return { fel: "Filen får vara högst 25 MB.", status: 400 };
      const { error } = await db.from("calendar_attachment").select("id", { head: true, count: "exact" }).limit(1);
      if (error) return { fel: BILAGA_SAKNAS, status: 400 };
      const lager = lagerForNyaFiler();
      const bucket = bucketen(lager);
      const filId = crypto.randomUUID();
      const path = `${mapp}/${filId}`;
      const v = await signeraUppladdning({ lager, bucket, path, mime, sekunder: 300 });
      if ("fel" in v) return { fel: v.fel, status: 500 };
      return { ok: "Klar att ladda upp.", lager, bucket, path, filId, ...v };
    }
    case "bilaga-registrera": {
      const lager = String(b.lager ?? "") as Lager;
      const bucket = String(b.bucket ?? "");
      const path = String(b.path ?? "");
      const filId = String(b.filId ?? "");
      if (!UUID.test(filId) || path !== `${mapp}/${filId}` || !["r2", "supabase"].includes(lager) || bucket !== bucketen(lager)) return { fel: "Fel sökväg.", status: 400 };
      // Lagringens egna uppgifter, inte klientens: storlek och typ provas här.
      const h = await huvudUppgifter({ lager, bucket, path, mapp, fileId: filId });
      if (!h || !BILAGA_MIME.has(h.mime) || !(h.storlek > 0 && h.storlek <= BILAGA_MAX)) {
        if (h) await taBort({ lager, bucket, path });
        return { fel: "Filen kom inte fram, eller är av fel sort.", status: 400 };
      }
      const filnamn = String(b.filnamn ?? "").replace(/[\/ -]/g, " ").trim().slice(0, 200) || "Bilaga";
      const { error } = await db.from("calendar_attachment").insert({ ...agare, store: lager, bucket, path, filename: filnamn, mime_type: h.mime, size_bytes: h.storlek, uploaded_by: user.employee!.id });
      if (error) {
        await taBort({ lager, bucket, path });
        return { fel: "Bilagan kunde inte sparas.", status: 500 };
      }
      return { ok: "series_id" in agare ? `${filnamn} är bifogad, för hela serien.` : `${filnamn} är bifogad.` };
    }
    case "bilaga-bort": {
      const bid = String(b.bilaga ?? "");
      if (!UUID.test(bid)) return { fel: "Bilagan finns inte.", status: 404 };
      const { data: f } = await db.from("calendar_attachment").select("store, bucket, path, filename").eq("id", bid).eq(kol, varde).maybeSingle();
      if (!f) return { fel: "Bilagan finns inte.", status: 404 };
      await db.from("calendar_attachment").delete().eq("id", bid);
      await taBort({ lager: f.store as Lager, bucket: String(f.bucket), path: String(f.path) });
      return { ok: `${f.filename} är borttagen.` };
    }
    case "bilaga-visa": {
      // En läsning: den som ser mötets detaljer (kalDetalj, med privata möten och delningsnivåerna) öppnar filen.
      const d = await kalDetalj(user, id);
      // Ett privat möte som läsaren inte är med på ger inga bilagor (kalDetalj svarar då utan dem).
      if (!d || !("bilagor" in d)) return { fel: "Du får inte se mötets bilagor.", status: 403 };
      const bid = String(b.bilaga ?? "");
      if (!UUID.test(bid)) return { fel: "Bilagan finns inte.", status: 404 };
      const { data: f } = await db.from("calendar_attachment").select("store, bucket, path, filename, mime_type").eq("id", bid).eq(kol, varde).maybeSingle();
      if (!f) return { fel: "Bilagan finns inte.", status: 404 };
      // PDF och bilder öppnas i fliken; Office och text laddas ned med sitt namn.
      const iFliken = f.mime_type === "application/pdf" || String(f.mime_type).startsWith("image/");
      const l = await signeraLank({ lager: f.store as Lager, bucket: String(f.bucket), path: String(f.path), sekunder: 60, laddaNedSom: iFliken ? null : String(f.filename) });
      return "url" in l ? { ok: "Öppnar bilagan.", url: l.url } : { fel: l.fel, status: 500 };
    }
  }
  return { fel: "Okänd handling.", status: 400 };
}

/**
 * Möteslänken (beslutsrundan 2026-10-20: Nav sparar en länk som skrivs in, men skapar ingen). Bara http(s).
 * `undefined` = klienten skickade ingen, och ett befintligt mötes länk står kvar.
 */
function lank(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  const t = String(v ?? "").trim();
  return /^https?:\/\/\S+$/i.test(t) && t.length <= 500 ? t : null;
}

const svarFran = (r: Resultat) => (r.fel ? { fel: r.fel } : { ok: r.kvitto ?? "Sparat.", angra: r.angra ?? null, id: r.eventId ?? null, dag: r.dag ?? null });

export async function POST(request: Request) {
  const user = await getCurrentUser();
  const svar2 = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store, max-age=0" } });
  if (!user?.employee) return svar2({ fel: "Inte inloggad." }, 401);
  if (!sammaUrsprung(request)) return svar2({ fel: "Fel ursprung." }, 403);
  let b: Record<string, unknown>;
  try {
    b = (await request.json()) as Record<string, unknown>;
  } catch {
    return svar2({ fel: "Ogiltig begäran." }, 400);
  }
  if (!SKRIVLAGE.kalender) return svar2({ fel: LASLAGE_TEXT, laslage: true }, 423);
  const handling = String(b.handling ?? "");
  const id = String(b.id ?? "");
  const ut = (r: Resultat) => {
    const x = svarFran(r);
    return svar2(x, "fel" in x && x.fel ? 400 : 200);
  };

  try {
    const andras = handling === "spara" ? String((b.falt as Falt | undefined)?.id ?? "") : ARRANGORENS.includes(handling) ? id : "";
    if (andras) {
      const nej = await baraArrangoren(user, andras);
      if (nej) return ut(nej);
    }
    switch (handling) {
      case "spara": {
        const f = (b.falt ?? {}) as Falt;
        const minuter = (f.e ?? 0) - (f.s ?? 0);
        const upprepa = UPPREPA_FRAN[f.upprepa ?? "Upprepas inte"] ?? "aldrig";
        if (!(UPPREPA as readonly string[]).includes(upprepa)) return svar2({ fel: "Välj hur det ska upprepas." }, 400);
        const deltagare = (f.delt ?? []).filter((x) => UUID.test(x));
        const video = lank(f.video);
        if (f.video && !video) return svar2({ fel: "Möteslänken ska börja med https://." }, 400);
        const g = await gasterFran(f.gaster);
        if ("fel" in g) return svar2({ fel: g.fel }, 400);
        g.kolleger.forEach((id) => deltagare.includes(id) || deltagare.push(id));
        if (g.epost.length && (f.typ === "uppgift" || f.typ === "coachning" || f.typ === "enskilt")) {
          return svar2({ fel: "Bara ett möte kan ha gäster utanför Clicknet." }, 400);
        }
        const privat = async (eventId?: string | null) => {
          if (eventId && f.priv !== undefined) await supabaseAdmin().from("calendar_event").update({ is_private: Boolean(f.priv) }).eq("id", eventId);
        };

        // Ändra ett befintligt möte: tiden med flytta/andraLangd, resten med andraMote.
        if (f.id) {
          if (!UUID.test(f.id)) return svar2({ fel: "Händelsen finns inte längre." }, 400);
          const { data: e } = await supabaseAdmin().from("calendar_event").select("dag, tid, minuter, kind, online_url, slutdag").eq("id", f.id).maybeSingle();
          if (!e) return svar2({ fel: "Händelsen finns inte längre." }, 404);
          if (g.epost.length && e.kind !== "mote") return svar2({ fel: "Bara ett möte kan ha gäster utanför Clicknet." }, 400);
          const start = f.s ?? 0;
          const fore = Number(String(e.tid ?? "00:00").slice(0, 2)) * 60 + Number(String(e.tid ?? "00:00").slice(3, 5));
          let sist: Resultat = { ok: true, eventId: f.id };
          // Heldag (0204): till, från eller inom heldag går genom lk_andra_heldag; resten som förut.
          if (e.kind === "mote" && (f.heldag || e.tid === null)) {
            const slut = f.heldag ? (f.slutdag && f.slutdag > (f.d ?? "") ? f.slutdag : null) : null;
            const lika = f.d === e.dag && (f.heldag ? e.tid === null && (e.slutdag ?? null) === slut : e.tid !== null && start === fore && minuter === e.minuter);
            if (!lika) {
              sist = await andraHeldag(user, f.id, f.d ?? "", slut, f.heldag ? null : start, f.heldag ? null : minuter);
              if (sist.fel) return ut(sist);
            }
          } else if (f.d && (f.d !== e.dag || start !== fore)) {
            sist = await flytta(f.id, f.d, start);
            if (sist.fel) return ut(sist);
          }
          if (!(e.kind === "mote" && (f.heldag || e.tid === null)) && minuter && minuter !== e.minuter) {
            sist = await andraLangd(f.id, minuter);
            if (sist.fel) return ut(sist);
          }
          if (e.kind === "mote") {
            sist = await andraMote(f.id, { rubrik: f.t ?? "", plats: f.plats ?? null, videolank: video === undefined ? ((e.online_url as string | null) ?? null) : video, agenda: f.agenda ?? "", deltagare, paminnelse: f.pamin ?? null, visaSom: f.visa ?? null });
            if (sist.fel) return ut(sist);
          }
          await privat(f.id);
          await sattValfria(f.id, f.valfria);
          return ut(await bjudIn(sist, sist.eventId ?? f.id, g.epost));
        }

        // Nytt. Åt någon annan bokas ett möte (Outlook bokar allt; här möten, som är det en assistent bokar).
        if (f.for && f.for !== user.employee.id && (f.typ !== "mote" || f.heldag || upprepa !== "aldrig" || f.lev)) {
          return svar2({ fel: "Åt någon annan bokas ett möte som inte upprepas och har ett klockslag." }, 400);
        }
        if (f.typ === "uppgift" || f.typ === "coachning") {
          const r = await skapaKalenderpost(
            {},
            form({ typ: f.typ, title: f.t ?? "", due_date: f.d ?? "", due_time: f.heldag ? "" : hhmm(f.s ?? 0), description_md: f.agenda ?? "", estimate_minutes: minuter || "", priority: "3", upprepas: upprepa === "aldrig" ? "" : "ja" }),
          );
          return r.fel ? svar2({ fel: r.fel }, 400) : svar2({ ok: r.ok ?? "Sparat." });
        }
        if (f.lev && f.order) {
          const steg = STEG_FRAN[f.lev];
          if (!steg) return svar2({ fel: "Välj en förinställning." }, 400);
          const r = await skapaLeverans({ orderId: f.order, steg, dag: f.d ?? "", start: f.s ?? 0, minuter: minuter || 30, deltagare, remMig: true, remKund: FORINSTALLNINGAR[steg as keyof typeof FORINSTALLNINGAR].kund });
          return ut(await bjudIn(r, r.eventId, g.epost));
        }
        // Heldag och flera dagar (0204), ett möte utan klockslag. En serie och en 1:1 har alltid ett klockslag.
        if (f.heldag) {
          if (f.typ === "enskilt" || upprepa !== "aldrig") return svar2({ fel: "En serie och en 1:1 har ett klockslag. Ta bort Heldag eller Upprepas." }, 400);
          const r = await skapaHeldag(user, { rubrik: f.t ?? "", dag: f.d ?? "", slutdag: f.slutdag ?? null, deltagare, plats: f.plats ?? null, video: video ?? null, agenda: f.agenda ?? "", visaSom: f.visa ?? null });
          if (!r.fel) {
            await privat(r.eventId);
            await sattValfria(r.eventId, f.valfria);
          }
          return ut(await bjudIn(r, r.eventId, g.epost));
        }
        if (f.typ === "enskilt" || upprepa !== "aldrig") {
          // En serie är många möten, och var och en vore ett eget mejl.
          if (g.epost.length) return svar2({ fel: "En person utanför Clicknet bjuds in till ett möte som inte upprepas." }, 400);
          const r = await skapaSerie({
            typ: f.typ === "enskilt" ? "enskilt" : "mote",
            rubrik: f.t ?? "",
            med: deltagare,
            dag: f.d ?? "",
            start: f.s ?? 0,
            minuter,
            upprepa: f.typ === "enskilt" && upprepa === "aldrig" ? "varannan" : upprepa,
            agenda: f.agenda ?? null,
            plats: f.plats ?? null,
            visaSom: f.visa,
            paminnelse: f.pamin ?? undefined,
          });
          if (!r.fel && (f.priv || video || f.slut) && r.eventId) {
            const { data: e } = await supabaseAdmin().from("calendar_event").select("series_id").eq("id", r.eventId).maybeSingle();
            if (e?.series_id) await supabaseAdmin().from("calendar_event").update({ ...(f.priv ? { is_private: true } : {}), ...(video ? { online_url: video } : {}) }).eq("series_id", e.series_id);
            // "Slutar" (Outlook): serien slutar där, och gångerna efter tas bort. Ångra tar bort hela serien som förut.
            if (e?.series_id && f.slut && arDatum(f.slut) && f.slut >= (f.d ?? "")) {
              await supabaseAdmin().from("calendar_series").update({ ends_on: f.slut }).eq("id", e.series_id);
              await supabaseAdmin().from("calendar_event").delete().eq("series_id", e.series_id).gt("dag", f.slut);
            }
          }
          if (!r.fel) await sattValfria(r.eventId, f.valfria);
          return ut(r);
        }
        // Ett möte, också ett leveransmöte från formuläret utan kund: förinställningens rubrik och längd. En delegat
        // bokar det åt ägaren (Outlooks "Från"): ägaren är arrangör, och delegaten är inte med om hen inte bjudit sig.
        let organisator: string | undefined;
        if (f.for && f.for !== user.employee.id) {
          const vem = await delegatFor(user, f.for);
          if (typeof vem !== "string") return ut(vem);
          organisator = vem;
        }
        const r0 = await skapaMote({ organisator, rubrik: f.t ?? "", dag: f.d ?? "", start: f.s ?? 0, minuter, deltagare: deltagare.filter((x) => x !== organisator), plats: f.plats ?? null, agenda: f.agenda ?? null, paminnelse: f.pamin ?? undefined, visaSom: f.visa });
        // Före 0201 nekar databasen ombudet med lk:behorighet ("Bara organisatören …").
        const r = organisator && r0.fel && /^Bara organisatören/.test(r0.fel) ? { fel: OMBUD_SAKNAS } : r0;
        if (!r.fel) {
          await privat(r.eventId);
          if (video && r.eventId) await supabaseAdmin().from("calendar_event").update({ online_url: video }).eq("id", r.eventId);
          await sattValfria(r.eventId, f.valfria);
        }
        return ut(await bjudIn(r, r.eventId, g.epost));
      }
      case "svara": {
        if (!b.for || b.for === user.employee.id) return ut(await svara(id, String(b.svar ?? "") as "ja" | "kanske" | "nej", String(b.kommentar ?? "") || null));
        // Delegaten svarar åt ägaren (0201, lk_svara_at): svaret blir ägarens, och arrangören får samma notis.
        const vem = await delegatFor(user, b.for);
        if (typeof vem !== "string") return ut(vem);
        const svaret = String(b.svar ?? "");
        if (!["ja", "kanske", "nej"].includes(svaret) || !UUID.test(id)) return svar2({ fel: "Välj ett svar." }, 400);
        const r = await lk<{ undo_id?: string }>("lk_svara_at", { p_aktor: user.employee.id, p_for: vem, p_event: id, p_svar: svaret, p_note: String(b.kommentar ?? "").trim().slice(0, 500) || null, p_hela_serien: b.helaSerien === true });
        if (!r.ok) return svar2({ fel: /lk_svara_at/.test(r.fel) ? OMBUD_SAKNAS : r.fel }, 400);
        const { data: p } = await supabaseAdmin().from("employee").select("first_name").eq("id", vem).maybeSingle();
        const namn = String(p?.first_name ?? "ägaren");
        return svar2({ ok: `Svarat ${svaret === "ja" ? "ja" : svaret === "nej" ? "nej" : "preliminärt"} åt ${namn}.`, angra: r.data.undo_id ?? null, id, dag: null });
      }
      case "foresla":
        return ut(await foreslaTid(id, String(b.dag ?? ""), Number(b.start), Number(b.langd), String(b.kommentar ?? "") || null, "kanske"));
      case "besluta": {
        // Arrangören om en deltagares förslag: godkänn (mötet flyttas, de andra svarar igen) eller behåll tiden.
        const person = String(b.person ?? "");
        return ut(await (b.godkann === true ? godkannForslag(id, person) : behallTid(id, person)));
      }
      // 1:1-kortet: be säljaren förbereda, en punkt på agendan, bocka av en punkt.
      case "forbered":
        return ut(await beOmForberedelse(id));
      case "punkt":
        return ut(await laggTillPunkt(String(b.serie ?? ""), "agenda", String(b.text ?? ""), b.dag ? String(b.dag) : null, null));
      case "bocka":
        return ut(await bockaAv(String(b.punkt ?? ""), b.klar === true));
      case "stallin":
        return ut(await stallIn(id));
      case "kopiera":
        // Med dag och start: Ctrl- eller Alt-dra. Utan: "Kopiera till nästa vecka", repots kopiera.
        if (b.dag !== undefined) return ut(await kopieraTill(user, id, String(b.dag ?? ""), Number(b.start)));
        return ut(await kopiera(id));
      case "flytta": {
        const dag = String(b.dag ?? ""), start = Number(b.start);
        if (b.serie === true) return ut(await flyttaSerie(id, dag, start));
        // "Den här och följande" i flyttbannern: samma regel, ny dag och tid från den här gången.
        if (b.serie === "foljande") return ut(await andraSerie(user, id, { fran: "har", dag, start }));
        const r = await flytta(id, dag, start);
        if (r.fel || b.langd === undefined) return ut(r);
        return ut(await andraLangd(id, Number(b.langd)));
      }
      // Formuläret på en gång i en serie, "Den här och följande" eller "Hela serien" (Outlook).
      case "serie": {
        const f = (b.falt ?? {}) as Falt;
        const r = await andraSerie(user, id, {
          fran: b.fran === "alla" ? "alla" : "har",
          dag: f.d ?? "",
          start: f.s ?? 0,
          minuter: (f.e ?? 0) - (f.s ?? 0) || undefined,
          upprepa: f.upprepa,
          slut: f.slut === undefined ? undefined : f.slut || null,
          titel: f.t,
        });
        if (r.fel) return ut(r);
        // Platsen, länken, Visa som och Privat från formuläret gäller de nya gångerna (0202 tar dem från den ändrade gången).
        const video = lank(f.video);
        const { data: e } = await supabaseAdmin().from("calendar_event").select("series_id").eq("id", r.eventId ?? id).maybeSingle();
        if (e?.series_id) {
          const fran = b.fran === "alla" ? svensktDatum() : (f.d ?? svensktDatum());
          await supabaseAdmin()
            .from("calendar_event")
            .update({ plats: f.plats ?? null, ...(video !== undefined ? { online_url: video } : {}), ...(f.visa ? { show_as: f.visa } : {}), ...(f.priv !== undefined ? { is_private: Boolean(f.priv) } : {}) })
            .eq("series_id", e.series_id)
            .gte("dag", fran)
            .eq("avviker", false);
        }
        return ut(r);
      }
      // Färgkategorierna (Outlook): mina egna, på en post eller en hel serie, och namnen. Bara min egen rad i nav_preference.
      case "kategori":
      case "kategorinamn": {
        const mig = user.employee.id;
        const db = supabaseAdmin();
        const { data: rad } = await db.from("nav_preference").select("value").eq("employee_id", mig).eq("key", KATEGORINYCKEL).maybeSingle();
        const k = lasKategorier(rad?.value);
        if (handling === "kategori") {
          const serie = String(b.serie ?? "");
          if (!UUID.test(id) || (serie && !UUID.test(serie))) return svar2({ fel: "Händelsen finns inte längre." }, 400);
          const farger = (Array.isArray(b.farger) ? b.farger : []).map(String).filter((f) => (KATEGORIFARGER as readonly string[]).includes(f));
          const nyckel = serie ? `s:${serie}` : id;
          if (farger.length) k.pa[nyckel] = [...new Set(farger)];
          else delete k.pa[nyckel];
        } else {
          const farg = String(b.farg ?? "");
          if (!(KATEGORIFARGER as readonly string[]).includes(farg)) return svar2({ fel: "Okänd färg." }, 400);
          const namn = String(b.namn ?? "").trim().slice(0, 40);
          if (namn) k.namn[farg as (typeof KATEGORIFARGER)[number]] = namn;
          else delete k.namn[farg as (typeof KATEGORIFARGER)[number]];
        }
        const { error } = await db.from("nav_preference").upsert({ employee_id: mig, key: KATEGORINYCKEL, value: k, updated_at: new Date().toISOString() }, { onConflict: "employee_id,key" });
        return error ? svar2({ fel: "Det gick inte att spara." }, 500) : svar2({ ok: handling === "kategori" ? "Kategorin är sparad." : "Namnet är sparat.", kategorier: k });
      }
      case "bilaga-forbered":
      case "bilaga-registrera":
      case "bilaga-bort":
      case "bilaga-visa": {
        const { status, ...x } = await bilaga(user, handling, id, b);
        return svar2(x, status ?? 200);
      }
      case "langd":
        return ut(await andraLangd(id, Number(b.langd)));
      case "pamin":
        return ut(await sattPaminnelse(id, b.min === null || b.min === undefined ? null : Number(b.min)));
      case "delning": {
        const r = await stallInDelning({}, form({ employee_id: String(b.person ?? ""), level: String(b.niva ?? "") }));
        return r.fel ? svar2({ fel: r.fel }, 400) : svar2({ ok: "Delningen är sparad. Ändringen syns direkt hos dem." });
      }
      case "angra": {
        const r = await lk<{ event_id: string | null }>("lk_angra", { p_aktor: user.employee.id, p_undo: String(b.undo ?? "") });
        return r.ok ? svar2({ ok: "Ångrat. Inget skickades." }) : svar2({ fel: r.fel }, 400);
      }
      default:
        return svar2({ fel: "Okänd handling." }, 400);
    }
  } catch (e) {
    return svar2({ fel: e instanceof Error ? e.message : "Något gick fel." }, 500);
  }
}

function form(falt: Record<string, unknown>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(falt)) if (v !== undefined && v !== null) f.set(k, String(v));
  return f;
}
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
