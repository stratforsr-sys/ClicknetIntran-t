/**
 * Nav 2.0, Rekrytering: navets rader i utkastets former. Ren logik, inga
 * importer utom typer, så att den går att prova lokalt.
 *
 * Utkastets kandidat (`S.rx.kand` i rx-blocket) byggs ur `candidate` (0030)
 * och det 0110 lade till. Historiken byggs ur det som faktiskt hänt:
 * stegloggen, scorecards, anteckningar, bokningar, begäran om meriter och
 * utskicken. Ett utskick som inte gått ut säger det, eftersom ingenting
 * skickar till kandidater än (se 0110, punkt 7).
 */

export type RxSteg = "new" | "screening" | "interview_1" | "interview_2" | "offer" | "hired" | "rejected";
export const RX_TRATT: RxSteg[] = ["new", "screening", "interview_1", "interview_2", "offer", "hired"];
const ETIKETT: Record<RxSteg, string> = { new: "Ny", screening: "Screening", interview_1: "Intervju 1", interview_2: "Intervju 2", offer: "Erbjudande", hired: "Anställd", rejected: "Avslag" };
const BOKNAMN: Record<string, string> = { tel: "Telefonscreening", int1: "Intervju 1", int2: "Intervju 2" };
const REK: Record<string, "ja" | "tveksam" | "nej"> = { yes: "ja", maybe: "tveksam", no: "nej" };
const REKTEXT: Record<string, string> = { ja: "Ja", tveksam: "Tveksam", nej: "Nej" };
const KALLA: Record<string, string> = { ansokningssida: "egen ansökningssida", platsbanken: "Platsbanken", linkedin: "LinkedIn", tips: "tips från anställd", spontan: "spontanansökan", annat: "annat" };
export const RX_MALLNAMN: Record<string, string> = {
  bekr: "Tack för din ansökan", lank: "Boka en intervju", bokad: "Intervjun är bokad", sms24: "Påminnelse dagen före", sms2: "Påminnelse samma dag",
  avslag1: "Avslag efter ansökan eller screening", avslag2: "Avslag efter intervju", erbj: "Erbjudande", pool: "Får vi höra av oss igen?",
  ringt: "SMS om att du ringt", pamin: "Påminnelse om erbjudandet", avbokad: "Avbokningen", merit: "Svaret om meriterna",
};

export type RaKandidat = {
  id: string; first_name: string; last_name: string; email: string; phone: string | null; source_slug: string; role_title: string;
  stage: RxSteg; applied_at: string; stage_at: string; no_show_count: number; rejected_reason: string | null; closed_at: string | null;
  hired_employee_id: string | null; talent_pool: boolean; talent_pool_consent: string | null; gdpr_purge_at: string | null; notes: string | null;
  created_by: string | null;
  // 0110, saknas när migrationen inte är körd
  position_id?: string | null; tipped_by?: string | null; tip_text?: string | null; application_answers?: unknown; cv_file_id?: string | null;
  offer_start?: string | null; offer_form?: string | null; offer_reply_by?: string | null; offer_sent_at?: string | null; pool_asked_at?: string | null;
};
export type RaHandelse = { candidate_id: string; from_stage: string | null; to_stage: string; at: string; by_employee: string | null; note: string | null };
export type RaScore = { candidate_id: string; stage: string; interviewer_id: string; recommendation: string; strengths: string | null; concerns: string | null; created_at: string; criteria?: unknown; screening?: unknown };
export type RaNot = { candidate_id: string; kind: string; body: string | null; by_employee: string | null; at: string };
export type RaBokning = { id: string; candidate_id: string; slot_id: string | null; kind: string; day: string; start_min: number; end_min: number; place: string; attendees: string[]; status: string; booked_by_candidate: boolean; calendar_event_id: string | null; created_at: string; cancelled_at: string | null };
export type RaTid = { id: string; day: string; start_min: number; end_min: number; place: string };
export type RaMeddelande = { candidate_id: string; booking_id: string | null; template: string; channel: string; status: string; created_at: string; sent_at: string | null };
export type RaMerit = { candidate_id: string; requested_at: string; answered_at: string | null };
export type RaLank = { candidate_id: string; kind: string; attendees: string[]; created_at: string };
export type RaTjanst = { id: string; slug: string; title: string; short_title: string; headcount: number; start_date: string; opened_at: string; platsbanken_until: string | null; linkedin_until: string | null; page_open: boolean; closed_at: string | null };
export type RaPolicy = { purge_after_days: number | null; job_text?: string | null; goal_name?: string | null; goal_count?: number | null; goal_by?: string | null; tips_asked_at?: string | null };

export type NdRxLogg = { d: string; tid: string; t: string; typ: "in" | "mejl" | "score" | "bok" | "fel" | "steg" | "not" };
export type NdRxBok = { id: string; typ: "tel" | "int1" | "int2"; d: string; s: string; e: string; med: string[]; plats: string; st: "bokad" | "klar" | "uteblev"; bokadAv: "kandidaten" | null; kev: string | null; sms: Record<string, string> };
export type NdRxScore = { steg: string; av: string; avId: string; rek: "ja" | "tveksam" | "nej"; d: string; krit?: Record<string, string>; screen?: Record<string, string>; styrkor: string; tveks: string };
export type NdRxKand = {
  id: string; namn: string; tel: string; epost: string; kalla: string; tj: string; steg: RxSteg; sokte: string; stegD: string;
  svar: string[] | null; cv: string | null; bok: NdRxBok[]; score: NdRxScore[]; logg: NdRxLogg[]; noShow: number;
  tipsAv: string | null; tips: string; avslag: { skal: string; d: string; mall: string | null; not: string } | null;
  pool: { fragad: string; samtycke: string | null } | null; merit: { d: string; besvarad: string | null } | null;
  erb: { start: string; form: string; senast: string; skickat: string } | null; pid: string | null; nadd: number | null; ringt: number;
  lank: { d: string; btyp: string; med: string[] } | null; gallras: string | null;
};
export type NdRxTid = { id: string; d: string; s: string; e: string; plats: string; kand: string | null };
export type NdRxTjanst = { id: string; slug: string; titel: string; kort: string; antal: number; start: string; oppnad: string; kanaler: { platsbanken: string | null; linkedin: string | null; sida: boolean } };

const SV = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
/** "2026-10-07 09:12" i svensk tid. */
export function svTid(iso: string): string {
  const p = Object.fromEntries(SV.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}
const dag = (iso: string) => svTid(iso).slice(0, 10);
const kl = (iso: string) => svTid(iso).slice(11);
export const hmText = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const MAN = ["", "jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
const VD = ["sön", "mån", "tis", "ons", "tors", "fre", "lör"];
const dagDatum = (d: string) => { const t = new Date(d + "T12:00:00Z"); return `${VD[t.getUTCDay()]} ${t.getUTCDate()} ${MAN[t.getUTCMonth() + 1]}`; };
const fornamn = (n: string) => n.split(" ")[0] || n;

function strangar(v: unknown): Record<string, string> | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const ut: Record<string, string> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (typeof x === "string" && x) ut[k] = x;
  return Object.keys(ut).length ? ut : undefined;
}

export type Indata = {
  kandidater: RaKandidat[]; handelser: RaHandelse[]; scores: RaScore[]; noter: RaNot[]; bokningar: RaBokning[]; tider: RaTid[];
  meddelanden: RaMeddelande[]; meriter: RaMerit[]; lankar: RaLank[]; tjanster: RaTjanst[]; policy: RaPolicy | null;
  namn: Map<string, string>; cvNamn: Map<string, string>;
};

/** Hur långt ett avslag kom: steget det gick till avslag från. */
function naddFor(h: RaHandelse[]): number | null {
  const e = h.find((x) => x.to_stage === "rejected");
  if (!e || !e.from_stage) return null;
  const i = RX_TRATT.indexOf(e.from_stage as RxSteg);
  return i < 0 ? null : i;
}

export function formaKandidat(k: RaKandidat, x: Indata): NdRxKand {
  const N = (id: string | null | undefined) => (id ? x.namn.get(id) ?? "En tidigare anställd" : "Nav");
  const namn = `${k.first_name} ${k.last_name}`.trim();
  const h = x.handelser.filter((e) => e.candidate_id === k.id).sort((a, b) => a.at.localeCompare(b.at));
  const sc = x.scores.filter((s) => s.candidate_id === k.id).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const noter = x.noter.filter((n) => n.candidate_id === k.id);
  const bok = x.bokningar.filter((b) => b.candidate_id === k.id && b.status !== "avbokad").sort((a, b) => a.day.localeCompare(b.day) || a.start_min - b.start_min);
  const avbokade = x.bokningar.filter((b) => b.candidate_id === k.id && b.status === "avbokad");
  const medd = x.meddelanden.filter((m) => m.candidate_id === k.id);
  const merit = x.meriter.filter((m) => m.candidate_id === k.id).sort((a, b) => b.requested_at.localeCompare(a.requested_at))[0];
  const lank = x.lankar.filter((l) => l.candidate_id === k.id).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];

  const logg: NdRxLogg[] = [];
  const L = (iso: string, t: string, typ: NdRxLogg["typ"]) => logg.push({ d: dag(iso), tid: kl(iso), t, typ });

  for (const e of h) {
    if (!e.from_stage) {
      L(e.at, k.tipped_by ? `${N(k.tipped_by)} tipsade om ${fornamn(namn)}.` : e.by_employee ? `${N(e.by_employee)} lade upp ${fornamn(namn)}. Källa: ${KALLA[k.source_slug] ?? k.source_slug}.` : `Ansökan kom in via ${KALLA[k.source_slug] ?? k.source_slug}.`, "in");
    } else if (e.to_stage === "rejected") {
      L(e.at, `Avslag${k.rejected_reason ? `: ${k.rejected_reason.toLowerCase().replace(/\.$/, "")}` : ""}.${e.by_employee ? ` ${N(e.by_employee)}.` : ""}`, "steg");
    } else if (e.to_stage === "hired") {
      L(e.at, `${fornamn(namn)} lades upp i Anställda. Processen är avslutad.`, "steg");
    } else {
      L(e.at, `${ETIKETT[e.from_stage as RxSteg] ?? e.from_stage} → ${ETIKETT[e.to_stage as RxSteg] ?? e.to_stage}.${e.by_employee ? ` ${N(e.by_employee)}.` : ""}`, "steg");
    }
  }
  for (const s of sc) {
    const rek = REK[s.recommendation] ?? "tveksam";
    L(s.created_at, `${N(s.interviewer_id)} fyllde i ${s.stage === "screening" ? "screeningen" : "scorecarden för " + (ETIKETT[s.stage as RxSteg] ?? s.stage).toLowerCase()}: ${REKTEXT[rek]}.`, "score");
  }
  for (const n of noter) {
    const t = n.kind === "ring" ? `${N(n.by_employee)} ringde ${fornamn(namn)}.` : n.kind === "ej_svar" ? `${N(n.by_employee)} ringde, inget svar.` : n.kind === "cv" ? `${N(n.by_employee)} öppnade CV:t.` : `${fornamn(N(n.by_employee))}: ${n.body ?? ""}`;
    L(n.at, t, n.kind === "not" ? "not" : "in");
  }
  for (const b of [...bok, ...avbokade]) {
    L(b.created_at, `${BOKNAMN[b.kind] ?? b.kind} bokad ${dagDatum(b.day)} kl. ${hmText(b.start_min)}${b.booked_by_candidate ? ", av kandidaten via bokningslänken" : ""}.`, "bok");
    if (b.status === "avbokad" && b.cancelled_at) L(b.cancelled_at, `${BOKNAMN[b.kind] ?? b.kind} ${dagDatum(b.day)} kl. ${hmText(b.start_min)} avbokades.`, "bok");
    if (b.status === "uteblev") L(`${b.day}T${hmText(b.end_min)}:00+02:00`, `${fornamn(namn)} kom inte till ${(BOKNAMN[b.kind] ?? b.kind).toLowerCase()}.`, "fel");
  }
  for (const m of medd) {
    const nm = RX_MALLNAMN[m.template] ?? m.template;
    L(m.sent_at ?? m.created_at, m.status === "skickad" ? `${nm} gick ut.` : m.status === "fel" ? `${nm} gick inte att skicka.` : m.status === "avbruten" ? `${nm} skickades inte.` : `${nm} väntar på utskick. Navet skickar inte till kandidater än.`, "mejl");
  }
  if (merit) {
    L(`${merit.requested_at}T09:00:00+02:00`, `${fornamn(namn)} begärde uppgifter om meriterna hos den som fick jobbet (diskrimineringslagen 2 kap. 4 §).`, "in");
    if (merit.answered_at) L(merit.answered_at, "Svaret om meriterna är skrivet.", "steg");
  }
  if (k.talent_pool && k.talent_pool_consent) L(k.talent_pool_consent, `${fornamn(namn)} är i talangpoolen, med samtycke.`, "steg");
  if (k.notes) L(k.applied_at, `Anteckning när kandidaten lades upp: ${k.notes}`, "not");
  logg.sort((a, b) => (a.d + a.tid).localeCompare(b.d + b.tid));

  const svar = Array.isArray(k.application_answers) ? (k.application_answers as unknown[]).map((v) => (typeof v === "string" ? v : "")) : null;
  const avslagH = h.find((e) => e.to_stage === "rejected");
  const avslagMedd = medd.find((m) => m.template === "avslag1" || m.template === "avslag2");
  const stegH = [...h].reverse().find((e) => e.to_stage === k.stage);

  return {
    id: k.id,
    namn,
    tel: k.phone ?? "",
    epost: k.email,
    kalla: k.source_slug,
    tj: k.position_id ?? "roll:" + (k.role_title || "Säljare"),
    steg: k.stage,
    sokte: svTid(k.applied_at),
    stegD: dag(stegH ? stegH.at : k.stage_at),
    svar: svar && svar.some(Boolean) ? svar : null,
    cv: k.cv_file_id ? x.cvNamn.get(k.cv_file_id) ?? "CV" : null,
    bok: bok.map((b) => ({
      id: b.id,
      typ: (["tel", "int1", "int2"].includes(b.kind) ? b.kind : "int1") as NdRxBok["typ"],
      d: b.day,
      s: hmText(b.start_min),
      e: hmText(b.end_min),
      med: b.attendees.map((a) => x.namn.get(a) ?? "").filter(Boolean),
      plats: b.place,
      st: (b.status === "uteblev" ? "uteblev" : b.status === "klar" ? "klar" : "bokad") as NdRxBok["st"],
      bokadAv: b.booked_by_candidate ? "kandidaten" : null,
      kev: b.calendar_event_id,
      sms: Object.fromEntries(medd.filter((m) => m.booking_id === b.id).map((m) => [m.template, m.status])),
    })),
    score: sc.map((s) => ({
      steg: s.stage,
      av: N(s.interviewer_id),
      avId: s.interviewer_id,
      rek: REK[s.recommendation] ?? "tveksam",
      d: dag(s.created_at),
      krit: strangar(s.criteria),
      screen: strangar(s.screening),
      styrkor: s.strengths ?? "",
      tveks: s.concerns ?? "",
    })),
    logg,
    noShow: k.no_show_count ?? 0,
    tipsAv: k.tipped_by ? N(k.tipped_by) : null,
    tips: k.tip_text ?? "",
    avslag: k.stage === "rejected" ? { skal: k.rejected_reason ?? "Inget skäl angivet", d: dag(avslagH ? avslagH.at : k.closed_at ?? k.stage_at), mall: avslagMedd ? avslagMedd.template : null, not: "" } : null,
    pool: k.talent_pool && k.talent_pool_consent ? { fragad: dag(k.pool_asked_at ?? k.talent_pool_consent), samtycke: dag(k.talent_pool_consent) } : k.pool_asked_at ? { fragad: dag(k.pool_asked_at), samtycke: null } : null,
    merit: merit ? { d: merit.requested_at, besvarad: merit.answered_at ? dag(merit.answered_at) : null } : null,
    erb: k.offer_start && k.offer_reply_by ? { start: k.offer_start, form: k.offer_form ?? "probation", senast: k.offer_reply_by, skickat: dag(k.offer_sent_at ?? k.stage_at) } : null,
    pid: k.hired_employee_id,
    nadd: k.stage === "rejected" ? naddFor(h) : null,
    ringt: noter.filter((n) => n.kind === "ej_svar").length,
    lank: lank && k.stage !== "hired" && k.stage !== "rejected" && !bok.some((b) => b.status === "bokad") ? { d: dag(lank.created_at), btyp: lank.kind, med: lank.attendees.map((a) => x.namn.get(a) ?? "").filter(Boolean) } : null,
    gallras: k.gdpr_purge_at ? dag(k.gdpr_purge_at) : null,
  };
}

export function formaTider(tider: RaTid[], bokningar: RaBokning[]): NdRxTid[] {
  return tider.map((t) => {
    const b = bokningar.find((x) => x.slot_id === t.id && x.status !== "avbokad");
    return { id: t.id, d: t.day, s: hmText(t.start_min), e: hmText(t.end_min), plats: t.place, kand: b ? b.candidate_id : null };
  });
}

export function formaTjanst(t: RaTjanst): NdRxTjanst {
  return { id: t.id, slug: t.slug, titel: t.title, kort: t.short_title, antal: t.headcount, start: t.start_date, oppnad: t.opened_at, kanaler: { platsbanken: t.platsbanken_until, linkedin: t.linkedin_until, sida: t.page_open } };
}

/** ISO-veckan för ett datum. */
export function isoVecka(d: string): number {
  const t = new Date(d + "T12:00:00Z"), dg = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dg);
  const forsta = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - forsta.getTime()) / 86400000 + 1) / 7);
}

/** Ansökningar per vecka, de åtta senaste veckorna till och med i dag: [[vecka, antal]]. */
export function perVecka(kandidater: { applied_at: string }[], idag: string): [number, number][] {
  const ut: [number, number][] = [];
  const mandag = new Date(idag + "T12:00:00Z");
  mandag.setUTCDate(mandag.getUTCDate() - ((mandag.getUTCDay() || 7) - 1));
  for (let i = 7; i >= 0; i--) {
    const fran = new Date(mandag.getTime() - i * 7 * 86400000).toISOString().slice(0, 10);
    const till = new Date(mandag.getTime() - (i - 1) * 7 * 86400000).toISOString().slice(0, 10);
    ut.push([isoVecka(fran), kandidater.filter((k) => { const d = dag(k.applied_at); return d >= fran && d < till; }).length]);
  }
  return ut;
}
