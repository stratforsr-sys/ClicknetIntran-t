import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { SKRIVLAGE } from "./skrivlage";
import { fullName, hasRole, type CurrentUser } from "@/lib/auth";
import { ROLE_LABEL, type Role } from "@/lib/roles";
import { supabaseAdmin } from "@/lib/supabase/server";
import { hamtaChefsbild, hamtaRegelverk, type Chefsbild } from "@/lib/franvaro-server";
import { datumPlus, sjukfrister, upprepadKorttid, type Franvarotyp, type Regelverk, type Sjukanmalan } from "@/lib/franvaro";
import { dagarBakat, svensktDatum, svenskKlocka } from "@/lib/klocka";

/**
 * Nav 2.0: Frånvaro, med samma funktioner som /franvaro, /franvaro/attest och
 * /franvaro/sjuk: hamtaRegelverk, hamtaChefsbild, sjukfrister och
 * upprepadKorttid.
 *
 * Den egna frånvaron läses med den inloggades token. Chefsbilden är repots
 * egen och avgör själv vem som syns och vad som går att besluta. Ringordningen
 * byggs som på /franvaro/sjuk.
 *
 * Säljaren får teamets bemanning som ett antal per dag och aldrig namnen,
 * räknat som hamtaProvunderlag räknar: godkänd ledighet som räknas i
 * bemanningen, inom takets team eller hela bolaget om taket är bolagets.
 */

export type NdFranvaroPost = {
  id: string;
  vem: string;
  pid: string;
  typ: string;
  fran: string;
  till: string | null;
  st: string;
  omf?: number;
  reg?: string;
  bekr?: string | null;
  skal?: string | null;
  inskickad?: string | null;
  inDag?: string | null;
  del?: string | null;
  egen: boolean;
};

export type NdFranvaro = {
  /** 0093: önskemålsrundan för nästa sommar, eller null. */
  runda: { ar: number; skickas: string; svar: string; besked: string; skickad: boolean } | null;
  /** 0093: senaste förslaget på annan period, per ansökan. */
  forslag: Record<string, { fran: string; till: string; note: string | null; at: string }>;
  /** Sparar vyn (SKRIVLAGE.franvaro)? Annars svarar /nav2/franvaro med läsläge. */
  skriv: boolean;
  regler: Regelverk | null;
  typer: Franvarotyp[];
  sparrar: { l: string; fran: string; till: string; typer: string[] }[];
  tak: number | null;
  /** Andra som är borta per dag (godkänd ledighet), bara dagar med minst en. */
  bemanning: Record<string, number>;
  saldo: { vacation: { d: number; asof: string } | null; saved: { d: number; asof: string } | null };
  /**
   * Saldona per person, nyast först, för den som får mata in dem (repots
   * `mataInSaldo`: säljchef, VD och administratör). Null för alla andra.
   * Läst med service role: läsrätten i 0019 saknar administratören.
   */
  saldon: Record<string, NdSaldorad[]> | null;
  poster: NdFranvaroPost[];
  /** Som på /franvaro/sjuk: en rad per plats i ordningen, med numret om det finns. */
  ring: { vem: string; roll: string; antal: number; tel: string | null }[];
  frister: { kind: string; due_on: string }[];
  /**
   * Gamla Nav B: den inloggades kalenderflöden (`calendar_feed`, E7.3), som /franvaro: ledigheten, teamets och,
   * sedan beställaren 2026-10-21, mötena (`handelser`, 0072).
   * Bara `mine` och `team`: flödet bär bara beviljad ledighet (beställaren 2026-09-22), så mötesflödet
   * (`handelser`) visas inte här. Adressen är den egna och visas bara för ägaren.
   */
  floden: { scope: string; token: string; aktiv: boolean; lasningar: number; senast: string | null }[];
  chef: null | {
    ko: Chefsbild["ko"];
    kommande: Chefsbild["kommande"];
    sjuka: Chefsbild["sjuka"];
    /** `kvitterad`: 0093, chefen har dolt signalen vid det här antalet tillfällen. */
    rehab: { namn: string; antal: number; sedan: string; pid: string; kvitterad: boolean }[];
    team: number;
    /** De chefen ser i registret, utom hen själv: raderna i tavlan. */
    personer: string[];
    /** Namn till id, för att registrera frånvaro åt någon. */
    personIds: Record<string, string>;
    /** Öppen intygsfrist per sjukperiod (sick_report.id → sick_deadline.id), för "Intyg mottaget". */
    intygsfrist: Record<string, string>;
    /** Teamets perioder: kön (beslutbar), godkänd ledighet och sjukperioder. */
    poster: NdFranvaroPost[];
  };
};

/** En inmatning i `absence_balance`. Raderna läggs till och ändras aldrig; den senaste per typ gäller. */
export type NdSaldorad = { typ: string; d: number; asof: string; ar: number | null; av: string; nar: string };

/** Startad innan den väntas in: ett fel kommer fram där den väntas in, inte som ett ohanterat avslag medan något annat väntas in. */
function tidig<T>(p: Promise<T>): Promise<T> {
  p.catch(() => {});
  return p;
}

/**
 * Fart (2026-10-20): det som inte beror på något annat läses i första
 * omgången, och chefsbilden så fort regelverket finns. Förut väntade elva
 * omgångar på varandra för chefen; nu är det fem (tre av dem i repots
 * `hamtaChefsbild`). Samma frågor och samma svar.
 */
export async function byggFranvaro(supabase: SupabaseClient, user: CurrentUser): Promise<NdFranvaro> {
  const mig = user.employee!.id;
  const idag = svensktDatum();
  const db = supabaseAdmin();
  const rvP = tidig(hamtaRegelverk());
  // Gamla Nav B: de egna kalenderflödena för ledighet. RLS släpper också säljchef och VD på andras, så filtret på den egna raden behövs.
  const flodeP = tidig(Promise.resolve(supabase.from("calendar_feed").select("scope, token, revoked_at, read_count, last_read_at").eq("employee_id", mig).in("scope", ["mine", "handelser", "team"])));
  // Bemanningen: antal andra som är borta per dag, ett år framåt. Läst med
  // service role som i hamtaProvunderlag, och bara antalet lämnar servern.
  const andrasP = tidig(Promise.resolve(db
    .from("absence_request")
    .select("employee_id, type_id, starts_on, ends_on, employee!absence_request_employee_id_fkey(team_id)")
    .eq("status", "approved")
    .lte("starts_on", datumPlus(idag, 365))
    .gte("ends_on", idag)));
  // 0093: rundan för nästa sommar (laget först, annars den för alla) och förslagen på mina ansökningar.
  // Nästa sommar: från september är det nästa år.
  const sommar = Number(idag.slice(0, 4)) + (Number(idag.slice(5, 7)) >= 9 ? 1 : 0);
  const rundaP = tidig(Promise.all([
    supabase.from("vacation_wish_round").select("summer_year, team_id, send_on, answer_by, decide_by, sent_at").eq("summer_year", sommar),
    supabase.from("absence_proposal").select("request_id, starts_on, ends_on, note, proposed_at").order("proposed_at", { ascending: false }),
  ]));
  // Chefens halva: repots egen chefsbild, när regelverket finns, och teamets perioder.
  const chefsvy = hasRole(user, "sales_manager", "ceo", "team_lead", "admin");
  const saldovy = hasRole(user, "sales_manager", "ceo", "admin");
  const inmatatP = saldovy
    ? tidig(Promise.resolve(db
        .from("absence_balance")
        .select("employee_id, type_id, days, as_of, earned_year, entered_by, entered_at")
        .order("as_of", { ascending: false })
        .order("entered_at", { ascending: false })
        .limit(1000)))
    : null;
  const bildP = chefsvy ? tidig(rvP.then((rv) => hamtaChefsbild(user, rv?.regler ?? null, rv?.typer ?? [], idag, 30))) : null;
  const teamP = chefsvy
    ? tidig(Promise.all([
        supabase.from("sick_report").select("employee_id, first_sick_day, last_sick_day, registered_at, confirmed_at, cancelled_at, escalated_at, extent_percent, id").is("cancelled_at", null).gte("first_sick_day", dagarBakat(idag, 400)).order("first_sick_day").order("registered_at"),
        supabase.from("employee").select("id, first_name, last_name, status"),
        supabase.from("absence_request").select("id, employee_id, type_id, starts_on, ends_on, part_day_minutes, reason").eq("status", "approved").gte("ends_on", dagarBakat(idag, 60)).lte("starts_on", datumPlus(idag, 335)).neq("employee_id", mig).order("starts_on").order("created_at"),
        supabase.from("sick_signal_ack").select("employee_id, occasions"),
      ]))
    : null;

  const [{ data: egna }, { data: sjuk }, { data: saldon }, { data: sparrar }, { data: tak }, { data: ordning }, { data: jag }] = await Promise.all([
    supabase.from("absence_request").select("id, type_id, starts_on, ends_on, part_day_minutes, status, submitted_at, reason").eq("employee_id", mig).gte("ends_on", dagarBakat(idag, 365)).order("starts_on", { ascending: false }),
    supabase.from("sick_report").select("id, first_sick_day, last_sick_day, extent_percent, registered_at, confirmed_at, cancelled_at, escalated_at").eq("employee_id", mig).is("cancelled_at", null).order("first_sick_day", { ascending: false }),
    supabase.from("absence_balance").select("type_id, days, as_of").eq("employee_id", mig).order("as_of", { ascending: false }),
    supabase.from("absence_blackout").select("label, starts_on, ends_on, type_ids, team_ids").gte("ends_on", idag).order("starts_on"),
    supabase.from("staffing_cap").select("team_id, max_absent"),
    supabase.from("absence_call_order").select("sort, target_kind, role, employee_id, phone, team_id").eq("active", true).order("sort"),
    supabase.from("employee").select("manager_id, team_id").eq("id", mig).maybeSingle(),
  ]);
  const rv = await rvP;

  // Ringordningen, byggd som på /franvaro/sjuk: teamets rader och bolagets,
  // chefen slås upp per person, en roll blir en rad med alla som har den, och
  // telefonnumret står på raden i ordningen. Namnen med service role: en
  // säljare får inte läsa registret, men navet visar redan vem hen ska ringa.
  const rader = (ordning ?? []).filter((o) => o.team_id === null || o.team_id === (jag?.team_id ?? null));
  const roller = rader.filter((o) => o.target_kind === "role").map((o) => o.role as string);
  const utpekade = rader.filter((o) => o.target_kind === "person").map((o) => o.employee_id as string);
  const [{ data: chefen }, { data: medRoll }, { data: namngivna }] = await Promise.all([
    jag?.manager_id ? db.from("employee").select("first_name, last_name").eq("id", jag.manager_id).maybeSingle() : Promise.resolve({ data: null }),
    roller.length ? db.from("employee_role").select("role, employee!employee_role_employee_id_fkey(id, first_name, last_name, status)").in("role", roller) : Promise.resolve({ data: [] }),
    utpekade.length ? db.from("employee").select("id, first_name, last_name").in("id", utpekade) : Promise.resolve({ data: [] }),
  ]);
  const perRoll = new Map<string, { first_name: string; last_name: string }[]>();
  for (const r of (medRoll ?? []) as unknown as { role: string; employee: { first_name: string; last_name: string; status: string } }[]) {
    if (r.employee.status === "offboarded") continue;
    perRoll.set(r.role, [...(perRoll.get(r.role) ?? []), r.employee]);
  }
  const namngiven = new Map(((namngivna ?? []) as { id: string; first_name: string; last_name: string }[]).map((p) => [p.id, p]));
  const ring: NdFranvaro["ring"] = rader
    .map((o) => {
      if (o.target_kind === "manager") return chefen ? { vem: fullName(chefen), roll: "Din närmaste chef", antal: 1, tel: o.phone ?? null } : null;
      if (o.target_kind === "role") {
        const folk = perRoll.get(o.role as string) ?? [];
        return folk.length ? { vem: folk.map(fullName).join(", "), roll: ROLE_LABEL[o.role as Role] ?? (o.role as string), antal: folk.length, tel: o.phone ?? null } : null;
      }
      const p = namngiven.get(o.employee_id as string);
      return p ? { vem: fullName(p), roll: "Utpekad mottagare", antal: 1, tel: o.phone ?? null } : null;
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  const minNamn = [user.employee!.first_name, user.employee!.last_name].map((s) => (s ?? "").trim()).filter(Boolean).join(" ");
  const poster: NdFranvaroPost[] = [
    ...(egna ?? []).map((a) => ({
      id: a.id,
      vem: minNamn,
      pid: mig,
      typ: a.type_id,
      fran: a.starts_on,
      till: a.ends_on,
      st: a.status,
      skal: a.reason ?? null,
      inskickad: a.submitted_at ? svenskKlocka(a.submitted_at) : null,
      inDag: a.submitted_at ? svensktDatum(a.submitted_at) : null,
      del: a.part_day_minutes !== null ? `${Math.round(a.part_day_minutes / 60 * 10) / 10} h` : null,
      egen: true,
    })),
    ...(sjuk ?? []).map((s) => ({
      id: s.id,
      vem: minNamn,
      pid: mig,
      typ: "sick",
      fran: s.first_sick_day,
      till: s.last_sick_day,
      st: "sick",
      omf: s.extent_percent,
      reg: svenskKlocka(s.registered_at),
      bekr: s.confirmed_at ? svenskKlocka(s.confirmed_at) : null,
      egen: true,
    })),
  ];

  const saldo = (typ: string) => {
    const s = (saldon ?? []).find((x) => x.type_id === typ);
    return s ? { d: Number(s.days), asof: s.as_of } : null;
  };
  // Teamets eget tak går före bolagets, som i hamtaProvunderlag.
  const mittTak = (tak ?? []).find((t) => t.team_id !== null && t.team_id === (jag?.team_id ?? null)) ?? (tak ?? []).find((t) => t.team_id === null) ?? null;

  // Bemanningen (läst ovan).
  const raknas = new Set((rv?.typer ?? []).filter((t) => t.counts_in_staffing).map((t) => t.id));
  const { data: andras } = await andrasP;
  const bemanning: Record<string, number> = {};
  for (const p of (andras ?? []) as unknown as { employee_id: string; type_id: string; starts_on: string; ends_on: string; employee: { team_id: string | null } | null }[]) {
    if (p.employee_id === mig || !raknas.has(p.type_id)) continue;
    if (mittTak?.team_id != null && p.employee?.team_id !== mittTak.team_id) continue;
    for (let d = p.starts_on < idag ? idag : p.starts_on; d <= p.ends_on; d = datumPlus(d, 1)) bemanning[d] = (bemanning[d] ?? 0) + 1;
  }
  const oppen = (sjuk ?? []).find((s) => !s.last_sick_day || s.last_sick_day >= idag);

  const { data: flodeRader } = await flodeP;
  const ut: NdFranvaro = {
    regler: rv?.regler ?? null,
    typer: rv?.typer ?? [],
    // En spärr med team gäller bara de teamen; tom lista gäller alla.
    sparrar: (sparrar ?? [])
      .filter((b) => !(b.team_ids ?? []).length || (jag?.team_id && (b.team_ids as string[]).includes(jag.team_id)))
      .map((b) => ({ l: b.label, fran: b.starts_on, till: b.ends_on, typer: b.type_ids ?? [] })),
    tak: mittTak ? mittTak.max_absent : null,
    bemanning,
    saldo: { vacation: saldo("vacation"), saved: saldo("saved_vacation") },
    saldon: null,
    poster,
    ring,
    frister: oppen && rv ? sjukfrister(oppen.first_sick_day, rv.regler) : [],
    floden: ((flodeRader ?? []) as { scope: string; token: string; revoked_at: string | null; read_count: number | null; last_read_at: string | null }[])
      .map((f) => ({ scope: f.scope, token: f.token, aktiv: !f.revoked_at, lasningar: f.read_count ?? 0, senast: f.last_read_at ? svensktDatum(f.last_read_at) : null }))
      .sort((a, b) => ["mine", "handelser", "team"].indexOf(a.scope) - ["mine", "handelser", "team"].indexOf(b.scope)),
    chef: null,
    runda: null,
    forslag: {},
    skriv: SKRIVLAGE.franvaro,
  };

  if (saldovy && inmatatP) {
    const { data: inmatat } = await inmatatP;
    const rader = (inmatat ?? []) as { employee_id: string; type_id: string; days: number | string; as_of: string; earned_year: number | null; entered_by: string; entered_at: string }[];
    const avIds = [...new Set(rader.map((r) => r.entered_by))];
    const { data: av } = avIds.length ? await db.from("employee").select("id, first_name, last_name").in("id", avIds) : { data: [] };
    const avNamn = new Map(((av ?? []) as { id: string; first_name: string; last_name: string }[]).map((e) => [e.id, fullName(e)]));
    const saldon: Record<string, NdSaldorad[]> = {};
    for (const r of rader) (saldon[r.employee_id] ??= []).push({ typ: r.type_id, d: Number(r.days), asof: r.as_of, ar: r.earned_year, av: avNamn.get(r.entered_by) ?? "Okänd", nar: svenskKlocka(r.entered_at) });
    ut.saldon = saldon;
  }

  // 0093: rundan och förslagen (lästa ovan).
  const [{ data: rundor }, { data: forslagRader }] = await rundaP;
  const runda = (rundor ?? []).find((r) => r.team_id && r.team_id === (jag?.team_id ?? null)) ?? (rundor ?? []).find((r) => !r.team_id) ?? null;
  if (runda) ut.runda = { ar: runda.summer_year as number, skickas: runda.send_on as string, svar: runda.answer_by as string, besked: runda.decide_by as string, skickad: Boolean(runda.sent_at) };
  for (const f of forslagRader ?? []) {
    const id = f.request_id as string;
    if (!ut.forslag[id]) ut.forslag[id] = { fran: f.starts_on as string, till: f.ends_on as string, note: (f.note as string | null) ?? null, at: f.proposed_at as string };
  }

  // Chefens halva: repots egen chefsbild. Den som inte leder någon får en tom kö.
  if (chefsvy && bildP && teamP) {
    const [bild, [{ data: allaSjuk }, { data: alla }, { data: godkanda }, { data: kvittenser }]] = await Promise.all([bildP, teamP]);
    const namn = new Map((alla ?? []).map((p) => [p.id, fullName(p)]));
    const pers = (alla ?? []).filter((p) => p.status !== "offboarded");
    const per = new Map<string, Sjukanmalan[]>();
    for (const s of (allaSjuk ?? []) as unknown as (Sjukanmalan & { employee_id: string })[]) per.set(s.employee_id, [...(per.get(s.employee_id) ?? []), s]);
    const rehab: NonNullable<NdFranvaro["chef"]>["rehab"] = [];
    const kvitt = new Map((kvittenser ?? []).map((k) => [k.employee_id as string, Number(k.occasions)]));
    if (rv) for (const p of pers) { const u = upprepadKorttid(per.get(p.id) ?? [], rv.regler, idag); if (u) rehab.push({ namn: fullName(p), ...u, pid: p.id as string, kvitterad: (kvitt.get(p.id as string) ?? -1) >= u.antal }); }
    const del = (m: number | null) => (m !== null ? `${Math.round((m / 60) * 10) / 10} h` : null);
    const teamPoster: NdFranvaroPost[] = [
      ...bild.ko.map((a) => ({ id: a.id, vem: a.namn, pid: a.employeeId, typ: a.typId, fran: a.starts_on, till: a.ends_on, st: "submitted", skal: a.skal, inskickad: a.submitted_at ? svenskKlocka(a.submitted_at) : null, inDag: a.submitted_at ? svensktDatum(a.submitted_at) : null, del: del(a.part_day_minutes), egen: false })),
      ...(godkanda ?? []).map((a) => ({ id: a.id, vem: namn.get(a.employee_id) ?? "Okänd", pid: a.employee_id, typ: a.type_id, fran: a.starts_on, till: a.ends_on, st: "approved", skal: a.reason ?? null, del: del(a.part_day_minutes), egen: false })),
      ...(allaSjuk ?? [])
        .filter((s) => s.employee_id !== mig && (!s.last_sick_day || s.last_sick_day >= dagarBakat(idag, 60)))
        .map((s) => ({ id: s.id, vem: namn.get(s.employee_id) ?? "Okänd", pid: s.employee_id, typ: "sick", fran: s.first_sick_day, till: s.last_sick_day, st: "sick", omf: s.extent_percent, reg: svenskKlocka(s.registered_at), bekr: s.confirmed_at ? svenskKlocka(s.confirmed_at) : null, egen: false })),
    ];
    const personer = pers.filter((p) => p.id !== mig).map((p) => fullName(p)).sort((a, b) => a.localeCompare(b, "sv"));
    const personIds = Object.fromEntries(pers.filter((p) => p.id !== mig).map((p) => [fullName(p), p.id as string]));
    const sjukIds = bild.sjuka.map((s) => s.id);
    const { data: fristRader } = sjukIds.length
      ? await supabase.from("sick_deadline").select("id, report_id, kind").in("report_id", sjukIds).eq("kind", "certificate").is("completed_at", null)
      : { data: [] as { id: string; report_id: string; kind: string }[] };
    const intygsfrist = Object.fromEntries((fristRader ?? []).map((f) => [f.report_id as string, f.id as string]));
    ut.chef = { ko: bild.ko, kommande: bild.kommande, sjuka: bild.sjuka, rehab, team: personer.length, personer, personIds, intygsfrist, poster: teamPoster };
  }
  return ut;
}
