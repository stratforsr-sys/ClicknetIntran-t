import "server-only";

import type { CurrentUser } from "@/lib/auth";
import { svensktDatum } from "@/lib/klocka";
import { hamtaDelningar } from "@/lib/kalender-server";
import { hamtaHandelsedetalj, hamtaLeveranskalender } from "@/lib/leveranskalender-server";
import { intervallForVy, overlamning, regeltext, type Post, type Vy } from "@/lib/leveranskalender";
import { supabaseAdmin } from "@/lib/supabase/server";
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

/** En post med 0090:s flagga: privat möte. */
export type NdPost = Post & { privat?: boolean };
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
};

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

/** Vilka av posternas möten som är privata. */
async function privataIds(poster: NdPost[]): Promise<Set<string>> {
  const ids = [...new Set(poster.map((p) => p.ref).filter((r): r is string => Boolean(r)))];
  if (!ids.length) return new Set();
  const { data } = await supabaseAdmin().from("calendar_event").select("id").in("id", ids).eq("is_private", true);
  return new Set((data ?? []).map((r) => r.id as string));
}

function markeraPrivata(mig: string, poster: NdPost[], priv: Set<string>): NdPost[] {
  if (!priv.size) return poster;
  return poster.map((p) => {
    if (!p.ref || !priv.has(p.ref)) return p;
    const insyn = p.agare === mig || p.organisator === mig || p.deltagare.includes(mig);
    return insyn ? { ...p, privat: true } : { ...p, privat: true, rubrik: p.rubrik === null ? null : "Privat", href: null };
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
  return { fran, till, poster: await privata(user.employee!.id, await egnaPaminnelser(user.employee!.id, data.poster)) };
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
  const [data, delningar] = await Promise.all([hamtaLeveranskalender(user, "manad", idag, [], idag), hamtaDelningar(user)]);
  if (!data) return null;
  const { fran, till } = intervallForVy("manad", idag);
  const [medPaminnelser, priv] = await Promise.all([egnaPaminnelser(data.mig, data.poster, paminnP ?? undefined), privataIds(data.poster)]);
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
  };
}

/** En händelse för förhandsvisningen: plats, agenda och deltagarnas svar. */
export async function kalDetalj(user: CurrentUser, id: string) {
  const d = await hamtaHandelsedetalj(user, id);
  if (!d) return null;
  // 0090: ett privat möte visar inte plats och agenda för den som inte är med.
  const { data: e } = await supabaseAdmin().from("calendar_event").select("is_private, organizer_id").eq("id", id).maybeSingle();
  const mig = user.employee!.id;
  if (e?.is_private && e.organizer_id !== mig && !d.deltagare.some((x) => x.id === mig)) {
    return { plats: null, online: null, agenda: "", organisator: d.organisator, deltagare: [], serieText: d.serie ? regeltext(d.serie) : null, paminnelse: d.paminnelse, privat: true };
  }
  return {
    privat: Boolean(e?.is_private),
    plats: d.plats,
    online: d.onlineUrl,
    agenda: d.agenda,
    organisator: d.organisator,
    deltagare: d.deltagare.map((x) => ({ id: x.id, svar: x.svar })),
    serieText: d.serie ? regeltext(d.serie) : null,
    paminnelse: d.paminnelse,
  };
}
