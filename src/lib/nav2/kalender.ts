import "server-only";

import type { CurrentUser } from "@/lib/auth";
import { svensktDatum } from "@/lib/klocka";
import { hamtaDelningar } from "@/lib/kalender-server";
import { hamtaEnskilt, hamtaHandelsedetalj, hamtaLeveranskalender } from "@/lib/leveranskalender-server";
import { intervallForVy, overlamning, regeltext, type Post, type Vy } from "@/lib/leveranskalender";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { SKRIVLAGE } from "./skrivlage";

/**
 * Nav 2.0: Kalendern, med samma funktioner som /kalender.
 *
 * Grunden är `hamtaLeveranskalender` — samma som sidan anropar — för den
 * inloggades egen kalender i månadens rutor. Kollegornas kalendrar och andra
 * månader hämtas när utkastet bläddrar dit eller kryssar i en kollega, via
 * `/nav2/kalender` (samma funktion, bara läsning). Delningsnivån avgör vad som
 * syns: en post med rubrik `null` är "Upptagen", som i navet.
 *
 * Förhandsvisningens plats, agenda och deltagarnas svar är `hamtaHandelsedetalj`,
 * också den med läsarens egen token.
 */

/**
 * En post med 0090:s flagga (privat möte), "Visa som" när den inte är upptagen, och mötets länk till den som
 * är med (organiserar, deltar eller äger kalendern), så att Anslut syns på posten, i Min dag och i påminnelsen.
 */
export type NdPost = Post & { privat?: boolean; visaSom?: string; online?: string; /** Heldag över flera dagar (0204): första och sista dagen. */ heldag?: { fran: string; till: string } };
export type NdKalposter = { fran: string; till: string; poster: NdPost[] };

export type NdKalender = NdKalposter & {
  mig: string;
  personer: { id: string; namn: string; grupp: "salj" | "lev" | "ovr"; farg: number; niva: string }[];
  /** Obesvarade inbjudningar från i dag och framåt. */
  vantar: number;
  /** Vem jag delar min kalender med, och på vilken nivå. */
  delning: { id: string; namn: string; niva: string }[];
  /** Leveranskön, för projektledare, leverans och säljchef. */
  lev: {
    farSe: boolean;
    ko: { orderId: string; kund: string; paket: string | null; saljare: string | null; due: string | null; over: number; av: number }[];
  };
  arChef: boolean;
  /** Sparar vyn (SKRIVLAGE.kalender)? Annars svarar /nav2/kalender (POST) med läsläge. */
  skriv: boolean;
  /** Platserna i mina senaste möten, för formulärets förslag (i stället för utkastets påhittade rum). */
  platser: string[];
  /** Mina färgkategorier (Outlook): namnen och vilka poster som har vilka färger. Bara mina, som i Outlook. */
  kategorier: Kategorier;
};

/**
 * Färgkategorier som i Outlook (beställaren 2026-10-22, svar 6): sex färger, var och en sätter sina egna på sina
 * poster och kan döpa om dem. De är personliga, som i Outlook, och ligger i `nav_preference` (`kal.kategorier`):
 * ingen annan ser dem och ingen migration behövs. En post i en serie får färgen för hela serien (`s:<serie>`).
 */
export const KATEGORIFARGER = ["rod", "orange", "gul", "gron", "bla", "lila"] as const;
export type Kategorier = { namn: Partial<Record<(typeof KATEGORIFARGER)[number], string>>; pa: Record<string, string[]> };
export const KATEGORINYCKEL = "kal.kategorier";

export function lasKategorier(v: unknown): Kategorier {
  const x = (v ?? {}) as { namn?: Record<string, unknown>; pa?: Record<string, unknown> };
  const namn: Kategorier["namn"] = {};
  for (const f of KATEGORIFARGER) if (typeof x.namn?.[f] === "string" && String(x.namn[f]).trim()) namn[f] = String(x.namn[f]).trim().slice(0, 40);
  const pa: Record<string, string[]> = {};
  for (const [k, f] of Object.entries(x.pa ?? {})) {
    const farger = (Array.isArray(f) ? f : []).filter((y): y is string => (KATEGORIFARGER as readonly string[]).includes(String(y)));
    if (farger.length) pa[k] = farger;
  }
  return { namn, pa };
}

/**
 * 0088: den egna påminnelsen. En deltagare kan ha valt en annan än mötets; den
 * står på deltagarraden, för mötet eller för serien. Bara läsarens egna rader
 * läses (service role, filtrerat på läsaren), och bara påminnelsen.
 */
/**
 * 0090: privata möten. Den som organiserar, är med eller äger kalendern ser
 * allt; alla andra ser "Privat". Bara flaggan läses, för de möten som redan
 * står i vyn.
 */
async function privata(mig: string, poster: NdPost[]): Promise<NdPost[]> {
  return markeraPrivata(mig, poster, await privataIds(poster));
}

type Extra = Map<string, { privat: boolean; visa: string; online: string | null }>;

/** Posternas möten: privat (0090), "Visa som" och länken. Bara de möten som redan står i vyn läses. */
async function privataIds(poster: NdPost[]): Promise<Extra> {
  const ids = [...new Set(poster.filter((p) => ["mote", "enskilt", "leverans"].includes(p.slag)).map((p) => p.ref).filter((r): r is string => Boolean(r)))];
  if (!ids.length) return new Map();
  const { data } = await supabaseAdmin().from("calendar_event").select("id, is_private, show_as, online_url").in("id", ids);
  return new Map((data ?? []).map((r) => [r.id as string, { privat: Boolean(r.is_private), visa: String(r.show_as ?? "upptagen"), online: (r.online_url as string | null) ?? null }]));
}

function markeraPrivata(mig: string, poster: NdPost[], extra: Extra): NdPost[] {
  if (!extra.size) return poster;
  return poster.map((p) => {
    const x = p.ref ? extra.get(p.ref) : undefined;
    if (!x) return p;
    const insyn = p.agare === mig || p.organisator === mig || p.deltagare.includes(mig);
    const ut: NdPost = { ...p };
    if (x.visa !== "upptagen") ut.visaSom = x.visa;
    if (x.online && insyn) ut.online = x.online;
    if (!x.privat) return ut;
    return insyn ? { ...ut, privat: true } : { ...ut, privat: true, rubrik: p.rubrik === null ? null : "Privat", href: null };
  });
}

function lasPaminnelser(mig: string) {
  return supabaseAdmin()
    .from("calendar_attendee")
    .select("event_id, series_id, reminder_min")
    .eq("employee_id", mig)
    .not("reminder_min", "is", null);
}

/** `las`: läsningen, om den startats tidigare (byggKalender). */
async function egnaPaminnelser(mig: string, poster: NdPost[], las: PromiseLike<{ data: { event_id: unknown; series_id: unknown; reminder_min: unknown }[] | null }> = lasPaminnelser(mig)): Promise<NdPost[]> {
  const { data } = await las;
  const perHandelse = new Map<string, number>(), perSerie = new Map<string, number>();
  for (const r of data ?? []) {
    if (r.event_id) perHandelse.set(r.event_id as string, Number(r.reminder_min));
    if (r.series_id) perSerie.set(r.series_id as string, Number(r.reminder_min));
  }
  if (!perHandelse.size && !perSerie.size) return poster;
  return poster.map((p) => {
    const egen = (p.ref ? perHandelse.get(p.ref) : undefined) ?? (p.serieId ? perSerie.get(p.serieId) : undefined);
    return egen === undefined ? p : { ...p, paminnelse: egen };
  });
}

export async function hamtaKalposter(user: CurrentUser, vy: Vy, dag: string, visa: string[]): Promise<NdKalposter | null> {
  const data = await hamtaLeveranskalender(user, vy, dag, visa, svensktDatum());
  if (!data) return null;
  const { fran, till } = intervallForVy(vy, dag);
  const poster = await flerdagar(user.employee!.id, data.poster, fran, till);
  return { fran, till, poster: await privata(user.employee!.id, await egnaPaminnelser(user.employee!.id, poster)) };
}

const plusDag = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

/**
 * Heldag över flera dagar (beställaren 2026-10-22, svar 3; 0204): projektionen ger mötet på sin första dag. Här står
 * det på varje dag i vyn (id:t får dagen som tillägg), och mina möten som började före vyn och slutar i den läggs
 * till. Alla dagarna bär `heldag` (första och sista), så att formuläret öppnar hela mötet.
 */
async function flerdagar(mig: string, poster: Post[], fran: string, till: string): Promise<NdPost[]> {
  const db = supabaseAdmin();
  const refs = [...new Set(poster.filter((p) => p.start === null && p.slag === "mote" && p.ref).map((p) => p.ref as string))];
  const [{ data: iVyn }, { data: egna }, { data: med }] = await Promise.all([
    refs.length ? db.from("calendar_event").select("id, dag, slutdag").in("id", refs).not("slutdag", "is", null) : Promise.resolve({ data: [] }),
    db.from("calendar_event").select("id, title, dag, slutdag, organizer_id").is("tid", null).is("cancelled_at", null).eq("organizer_id", mig).lt("dag", fran).gte("slutdag", fran),
    db.from("calendar_attendee").select("event_id").eq("employee_id", mig).neq("response", "nej").not("event_id", "is", null),
  ]);
  const medIds = ((med ?? []) as { event_id: string }[]).map((r) => r.event_id);
  const { data: inbjuden } = medIds.length
    ? await db.from("calendar_event").select("id, title, dag, slutdag, organizer_id").is("tid", null).is("cancelled_at", null).in("id", medIds).lt("dag", fran).gte("slutdag", fran)
    : { data: [] };
  type Rad = { id: string; title?: string; dag: string; slutdag: string; organizer_id?: string };
  const span = new Map<string, Rad>();
  for (const r of [...((iVyn ?? []) as Rad[]), ...((egna ?? []) as Rad[]), ...((inbjuden ?? []) as Rad[])]) span.set(r.id, { ...span.get(r.id), ...r });
  if (!span.size) return poster;

  const ut: NdPost[] = [];
  for (const p of poster) {
    const r = p.ref ? span.get(p.ref) : undefined;
    if (!r || p.start !== null) {
      ut.push(p);
      continue;
    }
    const heldag = { fran: r.dag, till: r.slutdag };
    ut.push({ ...p, heldag });
    for (let d = plusDag(r.dag > fran ? r.dag : plusDag(fran, -1), 1); d <= r.slutdag && d <= till; d = plusDag(d, 1)) {
      if (d > r.dag) ut.push({ ...p, id: `${p.id}:${d}`, dag: d, heldag });
    }
    span.delete(p.ref as string);
  }
  // Mina som började före vyn: ingen post ur projektionen att utgå från.
  for (const r of span.values()) {
    if (!r.title || r.dag >= fran) continue;
    const heldag = { fran: r.dag, till: r.slutdag };
    const bas: NdPost = {
      id: `${mig}:mote:${r.id}`, ref: r.id, slag: "mote", agare: mig, dag: fran, start: null, minuter: null, rubrik: r.title,
      svar: r.organizer_id === mig ? "org" : "ja", klar: false, href: null, organisator: r.organizer_id ?? null, deltagare: [],
      serie: false, serieId: null, steg: null, utfall: null, forsok: 1, paminnelse: 0, heldag,
    };
    for (let d = fran; d <= r.slutdag && d <= till; d = plusDag(d, 1)) ut.push({ ...bas, id: d === fran ? bas.id : `${bas.id}:${d}`, dag: d });
  }
  return ut;
}

/**
 * Fart (2026-10-20): de egna påminnelserna beror bara på vem man är och läses
 * samtidigt med kalendern, och de privata mötena samtidigt med påminnelserna.
 * Förut väntade de på varandra efter kalendern. Samma svar.
 */
export async function byggKalender(user: CurrentUser): Promise<NdKalender | null> {
  const idag = svensktDatum();
  const paminnP = user.employee ? Promise.resolve(lasPaminnelser(user.employee.id)) : null;
  paminnP?.catch(() => {});
  const platserP = user.employee
    ? supabaseAdmin().from("calendar_event").select("plats").eq("organizer_id", user.employee.id).not("plats", "is", null).order("created_at", { ascending: false }).limit(60)
    : null;
  const katP = user.employee
    ? supabaseAdmin().from("nav_preference").select("value").eq("employee_id", user.employee.id).eq("key", KATEGORINYCKEL).maybeSingle()
    : null;
  const [data, delningar, platsrader, katrad] = await Promise.all([
    hamtaLeveranskalender(user, "manad", idag, [], idag),
    hamtaDelningar(user),
    platserP ?? Promise.resolve({ data: [] }),
    katP ?? Promise.resolve({ data: null }),
  ]);
  if (!data) return null;
  const { fran, till } = intervallForVy("manad", idag);
  const allaPoster = await flerdagar(data.mig, data.poster, fran, till);
  const [medPaminnelser, priv] = await Promise.all([egnaPaminnelser(data.mig, allaPoster, paminnP ?? undefined), privataIds(allaPoster)]);
  return {
    fran,
    till,
    poster: markeraPrivata(data.mig, medPaminnelser, priv),
    mig: data.mig,
    personer: data.personer.filter((p) => p.id !== data.mig).map((p) => ({ id: p.id, namn: p.namn, grupp: p.grupp, farg: p.farg, niva: p.niva })),
    vantar: data.vantar,
    delning: delningar.utat.map((d) => ({ id: d.employee_id, namn: d.namn, niva: d.niva })),
    lev: {
      farSe: data.lev.farSe,
      ko: data.lev.ko.map((k) => {
        const o = overlamning({ kontakt: k.kontakt, telefon: k.telefon, mal: k.mal, lovat: k.lovat, basta_tid: k.bastaTid, risker: k.risker });
        return { orderId: k.orderId, kund: k.kund, paket: k.paket, saljare: k.saljare, due: k.due, over: o.har, av: o.av };
      }),
    },
    arChef: data.arChef,
    skriv: SKRIVLAGE.kalender,
    platser: [...new Set(((platsrader.data ?? []) as { plats: string | null }[]).map((r) => String(r.plats ?? "").trim()).filter(Boolean))].slice(0, 8),
    kategorier: lasKategorier((katrad.data as { value?: unknown } | null)?.value),
  };
}

/**
 * Ombuden (0201, beställaren 2026-10-22): vilka som delat sin kalender med läsaren på nivån "Kan planera om"
 * (redigera) eller "Delegat". Samma nivåer som databasens lk_far_andra släpper fram.
 */
export async function ombudFor(mig: string): Promise<Map<string, "redigera" | "delegat">> {
  const { data } = await supabaseAdmin().from("calendar_share").select("owner_id, level").eq("viewer_id", mig).in("level", ["redigera", "delegat"]);
  return new Map((data ?? []).map((r) => [String(r.owner_id), r.level as "redigera" | "delegat"]));
}

/** En händelse för förhandsvisningen: plats, agenda och deltagarnas svar. */
export async function kalDetalj(user: CurrentUser, id: string) {
  const d = await hamtaHandelsedetalj(user, id);
  if (!d) return null;
  // 0090: ett privat möte visar inte plats och agenda för den som inte är med.
  const [{ data: e }, { data: g }, { data: v }] = await Promise.all([
    supabaseAdmin().from("calendar_event").select("is_private, organizer_id").eq("id", id).maybeSingle(),
    supabaseAdmin().from("calendar_attendee").select("external_email").eq("event_id", id).not("external_email", "is", null),
    // Valfria deltagare (0203), på mötet eller serien. Före 0203 felar frågan, och då är alla obligatoriska.
    supabaseAdmin()
      .from("calendar_attendee")
      .select("employee_id")
      .eq("optional", true)
      .or(d.serie ? `event_id.eq.${id},series_id.eq.${d.serie.id}` : `event_id.eq.${id}`),
  ]);
  const { data: bl } = await supabaseAdmin()
    .from("calendar_attachment")
    .select("id, filename, size_bytes, mime_type, series_id")
    .or(d.serie ? `event_id.eq.${id},series_id.eq.${d.serie.id}` : `event_id.eq.${id}`)
    .order("uploaded_at");
  const bilagor = ((bl ?? []) as { id: string; filename: string; size_bytes: number; mime_type: string; series_id: string | null }[]).map((r) => ({ id: r.id, namn: r.filename, storlek: r.size_bytes, mime: r.mime_type, serie: Boolean(r.series_id) }));
  const valfria = new Set(((v ?? []) as { employee_id: string | null }[]).map((r) => r.employee_id).filter((x): x is string => Boolean(x)));
  const mig = user.employee!.id;
  // Ombud (0201): den som får planera om i arrangörens kalender gör det arrangören gör med mötet, och en delegat
  // svarar dessutom åt dem som delat sin kalender med hen.
  const ombud = await ombudFor(mig);
  const arrangor = d.organisator === mig || ombud.has(d.organisator);
  // 1:1: punkterna på agendan och säljarens K&V, med läsarens token (coachningskretsen, som /kalender).
  const enskilt = d.slag === "enskilt" ? await hamtaEnskilt(user, d).catch(() => null) : null;
  if (e?.is_private && e.organizer_id !== mig && !d.deltagare.some((x) => x.id === mig)) {
    return { plats: null, online: null, agenda: "", organisator: d.organisator, deltagare: [], gaster: [], serieText: d.serie ? regeltext(d.serie) : null, paminnelse: d.paminnelse, privat: true };
  }
  return {
    privat: Boolean(e?.is_private),
    plats: d.plats,
    online: d.onlineUrl,
    agenda: d.agenda,
    organisator: d.organisator,
    // Kommentaren till svaret och förslaget om ny tid är till arrangören och hens ombud, som i Outlook. De godkänner
    // eller behåller tiden i kortet (POST besluta).
    deltagare: d.deltagare.map((x) => ({ ...(arrangor ? { id: x.id, svar: x.svar, note: x.note, forslag: x.forslag } : { id: x.id, svar: x.svar }), ...(valfria.has(x.id) ? { valfri: true } : {}) })),
    farAndra: arrangor,
    // Beställaren 2026-10-22: "kunna dela behörighet till någon som kan flytta mina möten eller svara och boka åt
    // mig". De inbjudna som läsaren är delegat för, och som hen alltså svarar åt (POST svara med for).
    svaraFor: d.deltagare.filter((x) => x.id !== mig && x.id !== d.organisator && ombud.get(x.id) === "delegat").map((x) => x.id),
    // Bilagorna (0201): på mötet, eller på serien för en gång i en serie. Före 0201 felar frågan, och listan är tom.
    bilagor,
    // Inbjudna utanför Clicknet (calendar_attendee.external_email): de som fått mejlet med kalenderfilen.
    gaster: (g ?? []).map((x) => String(x.external_email)),
    serieText: d.serie ? regeltext(d.serie) : null,
    // Formulärets "Upprepas" och "Slutar" när en gång i serien öppnas (del 11; utkastet gissade på mönstret).
    serieRegel: d.serie
      ? { upprepa: d.serie.monster === "vardagar" ? "Varje vardag" : d.serie.monster === "manadsvis" ? "Varje månad" : d.serie.intervall === 2 ? "Varannan vecka" : "Varje vecka", slut: d.serie.ends_on }
      : null,
    paminnelse: d.paminnelse,
    enskilt: enskilt
      ? {
          serie: enskilt.seriesId,
          farSkriva: enskilt.farSkriva,
          kv: enskilt.siffror.kv,
          punkter: (enskilt.punkter ?? []).filter((p) => p.kind === "agenda").map((p) => ({ id: p.id, text: p.text, klar: p.klar })),
        }
      : null,
  };
}

/** En träff i sökningen: ett möte, 1:1 eller leveransmöte. */
export type NdSokTraff = { ref: string; rubrik: string; dag: string; start: number | null; minuter: number | null; plats: string | null; slag: string };

/**
 * Sökning i hela kalendern (Outlook), inte bara i den laddade månaden: rubrik, plats och agenda, och arrangörens
 * namn. Med läsarens token, så RLS (`lk_ser_handelse`) avgör vilka möten som syns, som i förhandsvisningen. Ett
 * privat möte hittas bara av den som organiserar eller är med (0090). Kommande först, sedan det som varit.
 */
export async function sokKalender(user: CurrentUser, fraga: string, personer: string[]): Promise<{ poster: NdSokTraff[] }> {
  const mig = user.employee!.id;
  const t = fraga.replace(/[%,()*\\"']/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  if (t.length < 2) return { poster: [] };
  const villkor = [`title.ilike.%${t}%`, `plats.ilike.%${t}%`, `agenda_md.ilike.%${t}%`];
  if (personer.length) villkor.push(`organizer_id.in.(${personer.join(",")})`);
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("calendar_event")
    .select("id, title, dag, tid, minuter, plats, kind, organizer_id, series_id, is_private")
    .is("cancelled_at", null)
    .or(villkor.join(","))
    .order("dag", { ascending: false })
    .limit(80);
  const rader = (data ?? []) as unknown as { id: string; title: string; dag: string; tid: string | null; minuter: number | null; plats: string | null; kind: string; organizer_id: string; series_id: string | null; is_private: boolean }[];
  const privata = rader.filter((r) => r.is_private && r.organizer_id !== mig);
  let med = new Set<string>();
  if (privata.length) {
    const { data: a } = await supabaseAdmin()
      .from("calendar_attendee")
      .select("event_id, series_id")
      .eq("employee_id", mig)
      .or(`event_id.in.(${privata.map((r) => r.id).join(",")}),series_id.in.(${[...new Set(privata.map((r) => r.series_id).filter(Boolean))].join(",") || "00000000-0000-0000-0000-000000000000"})`);
    med = new Set(((a ?? []) as { event_id: string | null; series_id: string | null }[]).flatMap((x) => [x.event_id, x.series_id]).filter((x): x is string => Boolean(x)));
  }
  const idag = svensktDatum();
  const poster = rader
    .filter((r) => !r.is_private || r.organizer_id === mig || med.has(r.id) || (r.series_id !== null && med.has(r.series_id)))
    .map((r) => ({ ref: r.id, rubrik: r.title, dag: String(r.dag).slice(0, 10), start: r.tid ? Number(r.tid.slice(0, 2)) * 60 + Number(r.tid.slice(3, 5)) : null, minuter: r.minuter, plats: r.plats, slag: r.kind }))
    .sort((a, b) => (a.dag >= idag) !== (b.dag >= idag) ? (a.dag >= idag ? -1 : 1) : a.dag >= idag ? a.dag.localeCompare(b.dag) || (a.start ?? 0) - (b.start ?? 0) : b.dag.localeCompare(a.dag));
  return { poster: poster.slice(0, 50) };
}
