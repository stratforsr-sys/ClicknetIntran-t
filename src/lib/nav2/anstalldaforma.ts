/**
 * Nav 2.0: Anställda i utkastets former.
 *
 * Ren logik — inga anrop, ingen Supabase. Filen körs både av läsningen och
 * rutten i Next och av provet lokalt mot riktig data.
 *
 * ===========================================================================
 * FRISTEN ÄR EN FÖRSKJUTNING, INTE ETT DATUM. En punkt sparar hur många dagar
 * före eller efter start- eller slutdagen den ska vara klar (0105). Datumet
 * räknas här, med samma regler som utkastets aeDue: före startdagen backar en
 * helgdag till närmaste arbetsdag före, efter startdagen till närmaste efter.
 * Ingen frist ligger före dagen listan skapades. `due_date` sätts bara när
 * någon flyttat datumet för hand, och då gäller det.
 *
 * Flyttas startdagen följer alltså alla frister med utan att en enda rad skrivs.
 * ===========================================================================
 */

import { arArbetsdag, dagPlus } from "@/lib/saljtakt";

export const AE_TYPER = ["vanlig", "konto", "avtal", "avtalsign", "valkomst", "boka", "fadder", "losen", "coach", "las7", "las30", "rutin", "kurs", "traff"] as const;
export type AeTyp = (typeof AE_TYPER)[number] | "regel";
export type AeOff = number | "skv" | "prov";

/** Utkastets aeDue. */
export function aeDue(bas: string, off: number): string {
  let d = dagPlus(bas, off);
  if (off < 0) while (!arArbetsdag(d)) d = dagPlus(d, -1);
  else if (off > 0) while (!arArbetsdag(d)) d = dagPlus(d, 1);
  return d;
}
/** Ett antal arbetsdagar framåt eller bakåt. */
export function arbetsdagar(fran: string, n: number): string {
  let d = fran;
  const steg = n < 0 ? -1 : 1;
  for (let i = 0; i < Math.abs(n); ) {
    d = dagPlus(d, steg);
    if (arArbetsdag(d)) i++;
  }
  return d;
}
function manadPlus(d: string, n: number): string {
  const t = new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1 + n, +d.slice(8, 10)));
  return t.toISOString().slice(0, 10);
}
/** Provanställningen: sex månader från startdagen (LAS 6 §), sista dagen dagen före. */
export const provSlut = (start: string): string => dagPlus(manadPlus(start, 6), -1);
/** SKV 1160: senast sista dagen i tredje månaden efter startmånaden. */
export const skvDag = (start: string): string => new Date(Date.UTC(+start.slice(0, 4), +start.slice(5, 7) + 3, 0)).toISOString().slice(0, 10);

/** Fristen för en punkt. Saknas start- eller slutdagen räknas den från listans dag. */
export function frist(p: { bas: string | null; skapad: string; off: number | null; spec: string | null; flyttad: string | null }): string {
  if (p.flyttad) return p.flyttad;
  const bas = p.bas || p.skapad;
  const d0 = p.spec === "skv" ? skvDag(bas) : p.spec === "prov" ? dagPlus(provSlut(bas), -14) : aeDue(bas, p.off ?? 0);
  return d0 < p.skapad ? p.skapad : d0;
}

/* ------------------------------------------------------------------ Mejlens ord */
export const ROLLNAMN: Record<string, string> = {
  salesperson: "Säljare",
  team_lead: "Teamledare",
  sales_manager: "Säljchef",
  ceo: "VD",
  finance: "Ekonomi",
  project_manager: "Projektledare",
  delivery: "Leverans",
  admin: "Administratör",
};
const MANAD = ["", "jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
export const kortDatum = (d: string | null): string => (d ? `${+d.slice(8, 10)} ${MANAD[+d.slice(5, 7)]}` : "");
export const fornamnAv = (namn: string): string => (namn || "").trim().split(/\s+/)[0] ?? "";

export type FyllPerson = { namn: string; roller: string[]; start: string | null; slut: string | null; jobbmejl: string; chef: string | null; team: string; nr: string };
/** Utkastets aeFyll: samma ord i regeln, i förhandsvisningen och i det som skickas. */
export function fyll(s: string, p: FyllPerson, mottagare: string, inloggad: string): string {
  const m: Record<string, string> = {
    namn: p.namn,
    fornamn: fornamnAv(p.namn),
    roll: p.roller.map((r) => (ROLLNAMN[r] ?? r).toLowerCase()).join(" och ") || "anställd",
    startdatum: kortDatum(p.start),
    slutdatum: kortDatum(p.slut),
    jobbmejl: p.jobbmejl,
    chef: p.chef || inloggad,
    team: p.team,
    nummer: p.nr,
    mottagare: fornamnAv(mottagare),
  };
  return String(s).replace(/\{(\w+)\}/g, (a, k: string) => (m[k] !== undefined ? m[k] : a));
}

/* ------------------------------------------------------------------ Raderna */
export type RaMall = { id: string; name: string; roles: string[]; is_exit: boolean; sort: number };
export type RaMallPunkt = {
  id: string; template_id: string; key: string; label: string; offset_days: number | null; offset_special: string | null;
  kind: string; law_ref: string | null; condition: string | null; owner: string; owner_id: string | null; sort: number;
};
export type RaRegel = {
  id: string; name: string; recipient_id: string | null; roles: string[] | null; trigger: string; due_offset: number; remind_days: number;
  ask_for: string | null; subject: string; body: string; active: boolean; sort: number;
};
export type RaPunkt = {
  id: string; employee_id: string; label: string; sort: number; state: string; skipped_reason: string | null; handled_by: string | null; handled_at: string | null;
  item_key: string | null; kind: string; offset_days: number | null; offset_special: string | null; due_date: string | null; law_ref: string | null; condition: string | null;
  owner: string; owner_id: string | null; self_owned: boolean; note: string | null; value: string | null; rule_id: string | null; created_on: string;
  sent_on: string | null; remind_days: number | null; ask_for: string | null; mail_subject: string | null; mail_body: string | null;
  reminded: string[] | null; auto_reminded_on: string | null; escalated_on: string | null; calendar_event_id: string | null;
};
export const PUNKTKOLUMNER =
  "id, employee_id, label, sort, state, skipped_reason, handled_by, handled_at, item_key, kind, offset_days, offset_special, due_date, law_ref, condition, owner, owner_id, self_owned, note, value, rule_id, created_on, sent_on, remind_days, ask_for, mail_subject, mail_body, reminded, auto_reminded_on, escalated_on, calendar_event_id";

/* ------------------------------------------------------------------ Utkastets former */
export type NdAeMallPunkt = { id: string; t: string; off: AeOff; typ: string; lag: string; villkor: string; ag: string; agId: string | null };
export type NdAeMall = { id: string; namn: string; roller: string[]; slut: boolean; punkter: NdAeMallPunkt[] };
export type NdAeRegel = {
  id: string; namn: string; mott: string; mottId: string | null; roller: "alla" | string[]; trigger: "start" | "slut"; klart: number; pamin: number;
  fraga: string; amne: string; text: string; aktiv: boolean;
};
export type NdAePunkt = {
  /** Mallens nyckel när den är unik i listan (utkastet slår upp "intro"), annars radens id. */
  id: string; rad: string; t: string; off: AeOff; due: string; typ: AeTyp; lag: string; villkor: string;
  /** Ägaren: "chef", "fadder" eller ett namn. */
  ag: string; agId: string | null; st: "open" | "done" | "skipped"; klar: { d: string; av: string } | null; skal: string;
  extra: string[]; not: string; varde: string; regel: string | null; skickat: string; pamin: number; fraga: string; amne: string; text: string; sjalv: boolean;
  pamint: string | null; ev: string | null;
};
export type NdAeLista = { mall: string | null; skapad: string; punkter: NdAePunkt[] };

export function formaMall(m: RaMall, punkter: RaMallPunkt[], namn: Map<string, string>): NdAeMall {
  return {
    id: m.id,
    namn: m.name,
    roller: m.roles ?? [],
    slut: m.is_exit,
    punkter: punkter
      .filter((x) => x.template_id === m.id)
      .sort((a, b) => a.sort - b.sort)
      .map((x) => ({
        id: x.key,
        t: x.label,
        off: (x.offset_special === "skv" || x.offset_special === "prov" ? x.offset_special : (x.offset_days ?? 0)) as AeOff,
        typ: x.kind,
        lag: x.law_ref ?? "",
        villkor: x.condition ?? "",
        ag: x.owner === "person" ? (x.owner_id ? (namn.get(x.owner_id) ?? "chef") : "chef") : x.owner,
        agId: x.owner === "person" ? x.owner_id : null,
      })),
  };
}

export function formaRegel(r: RaRegel, namn: Map<string, string>): NdAeRegel {
  return {
    id: r.id,
    namn: r.name,
    mott: r.recipient_id ? (namn.get(r.recipient_id) ?? "") : "",
    mottId: r.recipient_id,
    roller: r.roles && r.roles.length ? r.roles : "alla",
    trigger: r.trigger === "slut" ? "slut" : "start",
    klart: r.due_offset,
    pamin: r.remind_days,
    fraga: r.ask_for ?? "",
    amne: r.subject,
    text: r.body,
    aktiv: r.active,
  };
}

const dag = (ts: string | null): string => (ts ? ts.slice(0, 10) : "");

/**
 * En lista ur raderna. `bas` är startdagen för onboarding och slutdagen för
 * avslut. Rader som navet lagt in utan nyckel (rekryteringens anställning,
 * repots offboarda) får typ och frist ur mallens punkt med samma text.
 */
export function formaLista(
  rader: RaPunkt[],
  bas: string | null,
  mall: NdAeMall | null,
  namn: Map<string, string>,
  mallId: string | null,
): NdAeLista | null {
  if (!rader.length) return null;
  const skapad = rader.reduce((m, r) => (r.created_on < m ? r.created_on : m), rader[0].created_on);
  const nycklar = new Map<string, number>();
  for (const r of rader) if (r.item_key) nycklar.set(r.item_key, (nycklar.get(r.item_key) ?? 0) + 1);
  const punkter = rader.map((r): NdAePunkt => {
    const ur = !r.item_key && mall ? mall.punkter.find((x) => x.t === r.label) : undefined;
    const typ = (ur ? ur.typ : r.kind) as AeTyp;
    const spec = ur ? (typeof ur.off === "string" ? ur.off : null) : r.offset_special;
    const offDagar = ur ? (typeof ur.off === "number" ? ur.off : null) : r.offset_days;
    const off: AeOff = spec === "skv" || spec === "prov" ? spec : (offDagar ?? 0);
    const regel = typ === "regel";
    const skickat = r.sent_on ?? r.created_on;
    const due = frist({ bas, skapad: regel ? skickat : r.created_on, off: offDagar, spec, flyttad: r.due_date });
    const agare = r.owner === "person" && r.owner_id ? (namn.get(r.owner_id) ?? "chef") : r.owner === "fadder" ? "fadder" : "chef";
    const nyckel = r.item_key ?? ur?.id ?? null;
    return {
      id: nyckel && (nycklar.get(nyckel) ?? 1) <= 1 ? nyckel : r.id,
      rad: r.id,
      t: r.label,
      off,
      due,
      typ,
      lag: r.law_ref ?? ur?.lag ?? "",
      villkor: r.condition ?? ur?.villkor ?? "",
      ag: agare,
      agId: r.owner === "person" ? r.owner_id : null,
      st: r.state === "done" ? "done" : r.state === "skipped" ? "skipped" : "open",
      klar: r.state !== "open" ? { d: dag(r.handled_at) || r.created_on, av: r.handled_by ? (namn.get(r.handled_by) ?? "") : "" } : null,
      skal: r.skipped_reason ?? "",
      extra: [...(r.reminded ?? [])].sort(),
      not: r.note ?? "",
      varde: r.value ?? "",
      regel: r.rule_id,
      skickat,
      pamin: r.remind_days ?? 2,
      fraga: r.ask_for ?? "",
      amne: r.mail_subject ?? "",
      text: r.mail_body ?? "",
      sjalv: r.self_owned,
      pamint: r.auto_reminded_on,
      ev: r.calendar_event_id,
    };
  });
  punkter.sort((a, b) => a.due.localeCompare(b.due) || Number(a.typ === "regel") - Number(b.typ === "regel"));
  return { mall: mallId, skapad, punkter };
}

/* ------------------------------------------------------------------ Historiken */
export type RaHandelse = { actor_id: string | null; action: string; object_type: string | null; object_id: string | null; ts: string; reason: string | null; meta: Record<string, unknown> | null };
export type NdAeLogg = { pid: string; d: string; tid: string; t: string };

const TID = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
function svensk(ts: string): { d: string; tid: string } {
  const p = Object.fromEntries(TID.formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  return { d: `${p.year}-${p.month}-${p.day}`, tid: `${p.hour === "24" ? "00" : p.hour}:${p.minute}` };
}

/**
 * Personens historik ur audit_log, i utkastets meningar. `pid` är personen
 * raden gäller; den som gjorde det står först, och är det den inloggade står "Du".
 */
export function formaHandelse(h: RaHandelse, pid: string, namn: Map<string, string>, jagId: string, team: Map<string, string>, punkt = ""): NdAeLogg | null {
  const vem = h.actor_id === jagId ? "Du" : h.actor_id ? (namn.get(h.actor_id) ?? "Någon") : "Nav";
  const hen = fornamnAv(namn.get(pid) ?? "");
  const m = (h.meta ?? {}) as Record<string, unknown>;
  const roll = (r: unknown) => (ROLLNAMN[String(r)] ?? String(r)).toLowerCase();
  let t: string | null = null;
  switch (h.action) {
    case "employee.created": t = `${vem} lade upp ${hen} i navet${m.roll ? ` som ${roll(m.roll)}` : ""}.`; break;
    case "employee.activated": t = `${vem} markerade ${hen} som aktiv.`; break;
    case "employee.offboarded": t = `${vem} avslutade anställningen${m.slutdatum ? ` med sista dag ${kortDatum(String(m.slutdatum))}` : ""}.`; break;
    case "employee.onboarded": t = `${hen} fick ${m.guider ?? "sina"} systemguider.`; break;
    case "employee.org_changed": t = `${vem} ändrade ${m.team ? `team till ${team.get(String(m.team)) ?? "ett annat"}` : "teamet"}${m.chef ? ` och chef till ${namn.get(String(m.chef)) ?? "en annan"}` : ""}.`; break;
    case "employee.data_export": t = `${vem} tog ut registerutdraget.`; break;
    case "role.granted": t = `${vem} gav rollen ${roll(m.roll)}.`; break;
    case "role.revoked": t = `${vem} tog bort rollen ${roll(m.roll)}.`; break;
    case "auth.temp_password_set": t = `${vem} skapade ett tillfälligt lösenord.`; break;
    case "auth.password_changed": t = `${hen} bytte lösenordet.`; break;
    case "onboarding.documents_assigned": t = `${m.antal ?? "Inga"} rutiner tilldelades.`; break;
    case "onboarding.courses_assigned": t = `${m.antal ?? "Inga"} kurser tilldelades.`; break;
    case "onboarding.schedule_assigned": t = `Schemat lades in${m.tider ? `: ${m.tider}` : ""}.`; break;
    case "candidate.hired": t = `${vem} anställde ${hen} ur rekryteringen.`; break;
    case "onboarding.done": case "offboarding.done": t = `${vem} bockade av: ${punkt || "en punkt"}${m.varde ? ` (${String(m.varde)})` : ""}.`; break;
    case "onboarding.skipped": case "offboarding.skipped": t = `${vem} hoppade över: ${punkt || "en punkt"}.${h.reason ? ` Motivering: ${h.reason}` : ""}`; break;
    default:
      // Anställdas egna rader (rutten) bär meningen själv.
      if (h.action.startsWith("anstallda.") && typeof m.text === "string") t = `${vem} ${m.text}`;
  }
  if (!t) return null;
  const { d, tid } = svensk(h.ts);
  return { pid, d, tid, t: t.charAt(0).toUpperCase() + t.slice(1) };
}
