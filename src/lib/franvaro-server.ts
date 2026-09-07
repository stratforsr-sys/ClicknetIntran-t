import "server-only";

import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { svensktDatum, svenskVeckodag } from "@/lib/klocka";
import { gallandeSchema } from "@/lib/raster";
import type { CurrentUser } from "@/lib/auth";
import { fullName, hasRole } from "@/lib/auth";
import {
  bemanningUnderPeriod,
  dagarna,
  datumPlus,
  omfattning,
  periodtext,
  saldoFor,
  saldotArGammalt,
  type Attestniva,
  type Bemanningstak,
  type Franvaroperiod,
  type Franvarotyp,
  type Provunderlag,
  type Regelverk,
  type Saldo,
  type Sparrperiod,
} from "@/lib/franvaro";

/**
 * Frånvaromodulens serversida. Allt som rör läsning ur databasen, ingen regel.
 *
 * Reglerna bor i `src/lib/franvaro.ts` och bedömer det som skickas in. Den här
 * filen hämtar det som ska skickas in — och gör ingenting annat, så att
 * regelmotorn går att prova utan databas.
 */

/**
 * Faltlistorna star som EN strangliteral var, inte som hopslagna delar.
 *
 * Supabase harleder radens typ ur select-strangen. En konkatenering — eller ett
 * `const` utan `as const` — vidgas till `string`, och da faller hela
 * typhardledningen tillbaka pa `GenericStringError`. Raderna blir langa; det
 * ar priset for att kompilatorn ska kunna se vad de innehaller.
 */
export const TYPFALT =
  "id, label, sort, notice_days, max_consecutive_days, waiting_days, approval_level, uses_balance, counts_in_staffing, allows_part_day, requestable, active" as const;

export const REGELFALT =
  "vacation_year_start_month, vacation_year_start_day, main_vacation_start_month, main_vacation_start_day, main_vacation_end_month, main_vacation_end_day, main_vacation_notice_days, saved_days_max_years, balance_stale_days, sick_certificate_day, sick_fk_day, sick_return_plan_day, sick_confirm_hours, relapse_days, repeat_sick_count, repeat_sick_months, unregistered_reminder_hours" as const;

/**
 * Reglerna som gäller nu.
 *
 * Läses med användarens egen token: `absence_type_read` och
 * `absence_policy_read` släpper in varje inloggad utom den som måste byta
 * lösenord (0017, 0019). AC-3.13 kräver att den anställda ser reglerna innan
 * hen skickar in, så det finns ingenting här att dölja.
 */
export async function hamtaRegelverk(): Promise<{ regler: Regelverk; typer: Franvarotyp[] } | null> {
  const supabase = await supabaseServer();

  const [{ data: policy }, { data: typer }] = await Promise.all([
    supabase.from("absence_policy").select(REGELFALT).maybeSingle(),
    supabase.from("absence_type").select(TYPFALT).eq("active", true).order("sort"),
  ]);

  if (!policy) return null;
  return { regler: policy as Regelverk, typer: (typer ?? []) as Franvarotyp[] };
}

/**
 * Allt regelmotorn behöver för att bedöma en ansökan från en viss person.
 *
 * Läses med SERVICE ROLE, och det är inte en genväg. Bemanningsräkningen i
 * E7.2 behöver veta hur många i teamet som är borta en viss dag — men den som
 * ansöker ska inte kunna läsa vilka de är. Med användarens egen token hade
 * frågan gett noll rader för en säljare, och varningen hade tyst blivit
 * "ingen är borta". Därför räknas antalet på servern och bara antalet lämnar
 * den. Se `varstaBemanningsdag`, som får perioderna men vars svar bara bär ett
 * datum och en siffra.
 */
export async function hamtaProvunderlag(
  employeeId: string,
  teamId: string | null,
  typ: Franvarotyp,
  regler: Regelverk,
  fran: string,
  till: string,
): Promise<Provunderlag> {
  const db = supabaseAdmin();

  const [{ data: sparrar }, { data: tak }, { data: saldon }, { data: egna }, { data: andras }, { data: typer }] =
    await Promise.all([
      db.from("absence_blackout").select("id, label, starts_on, ends_on, type_ids, team_ids").lte("starts_on", till).gte("ends_on", fran),
      db.from("staffing_cap").select("team_id, max_absent"),
      db.from("absence_balance").select("type_id, days, as_of, earned_year").eq("employee_id", employeeId),
      db
        .from("absence_request")
        .select("employee_id, type_id, starts_on, ends_on, part_day_minutes")
        .eq("employee_id", employeeId)
        .in("status", ["submitted", "approved"]),
      db
        .from("absence_request")
        .select("employee_id, type_id, starts_on, ends_on, part_day_minutes, employee!inner(team_id)")
        .eq("status", "approved")
        .lte("starts_on", till)
        .gte("ends_on", fran),
      db.from("absence_type").select("id, counts_in_staffing"),
    ]);

  // Teamets eget tak går före bolagets. Saknar teamet ett gäller bolagets, och
  // saknas båda finns inget tak att varna mot.
  const taken = (tak ?? []) as Bemanningstak[];
  const mitt = taken.find((t) => t.team_id !== null && t.team_id === teamId) ?? null;
  const bolag = taken.find((t) => t.team_id === null) ?? null;

  return {
    typ,
    regler,
    idag: svensktDatum(),
    sparrperioder: (sparrar ?? []) as Sparrperiod[],
    teamId,
    saldon: ((saldon ?? []) as { type_id: string; days: string | number; as_of: string; earned_year: number | null }[]).map(
      (s): Saldo => ({ ...s, days: Number(s.days) }),
    ),
    egnaPerioder: egna ?? [],
    andrasPerioder: ((andras ?? []) as unknown as {
      employee_id: string;
      type_id: string;
      starts_on: string;
      ends_on: string;
      part_day_minutes: number | null;
      employee: { team_id: string | null } | null;
    }[]).map((p) => ({
      employee_id: p.employee_id,
      type_id: p.type_id,
      starts_on: p.starts_on,
      ends_on: p.ends_on,
      part_day_minutes: p.part_day_minutes,
      team_id: p.employee?.team_id ?? null,
    })),
    tak: mitt ?? bolag,
    raknasIBemanning: new Set(
      ((typer ?? []) as { id: string; counts_in_staffing: boolean }[])
        .filter((t) => t.counts_in_staffing)
        .map((t) => t.id),
    ),
  };
}

/**
 * Får den här personen besluta om den här ansökan?
 *
 * `approval_level` per typ (E7.15) sätter GOLVET, inte taket: säljchefen och VD
 * får alltid besluta. Skälet är AC-3.18:s chefsfallback — en säljare vars
 * teamledare är sjuk ska inte få vänta på semesterbesked till hen är tillbaka.
 */
export function farBesluta(
  user: CurrentUser | null,
  niva: Attestniva,
  ledare: boolean,
): boolean {
  if (!user?.employee) return false;
  if (hasRole(user, "sales_manager", "ceo")) return true;
  if (niva === "manager") return ledare;
  return false;
}

/** Leder den inloggade den här personen? Samma fråga som `leads_employee()` i SQL. */
export async function lederPersonen(user: CurrentUser | null, employeeId: string): Promise<boolean> {
  if (!user?.employee) return false;
  if (user.employee.id === employeeId) return false;

  const db = supabaseAdmin();
  const [{ data: person }, { data: team }] = await Promise.all([
    db.from("employee").select("manager_id, team_id").eq("id", employeeId).maybeSingle(),
    db.from("team").select("id").eq("lead_id", user.employee.id),
  ]);

  if (!person) return false;
  if (person.manager_id === user.employee.id) return true;
  return Boolean(person.team_id && (team ?? []).some((t) => t.id === person.team_id));
}

/**
 * Schemalagda minuter per person och dag.
 *
 * En dag utan schema ger noll. Det är samma hållning som `oppnaDagar()` i
 * lönerapporten: navet gissar inte en åttatimmarsdag åt någon vars schema det
 * inte känner. Följden är att frånvaro för den utan schema inte ger några
 * minuter i löneunderlaget — vilket är rätt sorts fel, eftersom det syns som
 * en nolla någon kan fråga om i stället för som en siffra ingen kan förklara.
 */
export async function schemaminuter(): Promise<(employeeId: string, datum: string) => number> {
  const db = supabaseAdmin();

  const [{ data: personal }, { data: scheman }] = await Promise.all([
    db.from("employee").select("id, team_id"),
    db.from("work_schedule").select("id, scope, employee_id, team_id, weekday, start_time, end_time, valid_from"),
  ]);

  const team = new Map((personal ?? []).map((p) => [p.id, p.team_id]));

  return (employeeId, datum) => {
    const veckodag = svenskVeckodag(`${datum}T12:00:00.000Z`);
    const rad = gallandeSchema(
      (scheman ?? []).filter((s) => s.weekday === veckodag),
      employeeId,
      team.get(employeeId) ?? null,
      datum,
    )[0];

    if (!rad) return 0;

    const min = (t: string) => +t.slice(0, 2) * 60 + +t.slice(3, 5);
    return Math.max(0, min(rad.end_time) - min(rad.start_time));
  };
}

/** Antal kalenderdagar frånvaro per typ inom ett spann — för saldovyn. */
export function dagarPerTyp(
  perioder: { type_id: string; starts_on: string; ends_on: string; part_day_minutes: number | null }[],
  fran: string,
  till: string,
): Record<string, number> {
  const ut: Record<string, number> = {};
  for (const p of perioder) {
    // Del av dag räknas inte som en hel semesterdag i saldot. Att räkna två
    // timmar som en dag hade fått saldot att sjunka fortare än verkligheten.
    if (p.part_day_minutes !== null) continue;
    const dagar = dagarna(p.starts_on, p.ends_on).filter((d) => d >= fran && d <= till).length;
    if (dagar > 0) ut[p.type_id] = (ut[p.type_id] ?? 0) + dagar;
  }
  return ut;
}

/**
 * Fälten en BESLUTSVY läser ur en ansökan.
 *
 * `reason` står här och ingen annanstans. Bemanningsvyn, planeringsvyn,
 * dagsbilden och notisbygget har sina egna, kortare listor, och skälet får inte
 * smyga in i någon av dem — se rubriken i migration 0048 för varför.
 */
export const BESLUTSFALT =
  "id, employee_id, type_id, starts_on, ends_on, part_day_minutes, status, submitted_at, decided_by, decided_at, decision_note, reason, rules_broken, override_reason, withdrawn_at" as const;

export type Attestpost = {
  id: string;
  employeeId: string;
  namn: string;
  typId: string;
  typ: string;
  starts_on: string;
  ends_on: string;
  part_day_minutes: number | null;
  submitted_at: string | null;
  /** Null bara för rader som skickades in innan fältet fanns (före 0048). */
  skal: string | null;
  brutna: string[];
  bemanning: ReturnType<typeof bemanningUnderPeriod>;
  saldo: { dagar: number; asOf: string; gammalt: boolean } | null;
};

export type Bortarad = {
  employeeId: string;
  namn: string;
  /** Typen: "Semester", "Vård av sjukt barn". */
  etikett: string;
  /** Perioden och omfattningen, färdigskriven. */
  detalj: string;
  href: string;
  /** Sorteringsnyckel, och det som avgör om raden pågår eller ligger framåt. */
  fran: string;
};

export type Chefsbild = {
  ko: Attestpost[];
  /** Godkänd ledighet som pågår eller börjar inom fönstret. */
  kommande: Bortarad[];
  /** Pågående eller nyligen avslutade sjukperioder hos dem man ansvarar för. */
  sjuka: {
    id: string;
    employeeId: string;
    namn: string;
    forstaDag: string;
    sistaDag: string | null;
    omfattning: number;
    bekraftad: boolean;
    eskalerad: boolean;
    /** Öppna frister, närmast först. */
    frister: { kind: string; due_on: string }[];
    anteckningar: { id: string; text: string; av: string; nar: string }[];
  }[];
  /** Dagar framåt fönstret sträcker sig. Står i rubriken så att den inte gissas. */
  fonster: number;
};

/**
 * ============================================================================
 * CHEFENS HELA FRÅNVAROBILD I EN VÄG.
 *
 * Före 2026-09-07 låg den på fyra sidor: kön på /franvaro/attest, årsvyn på
 * /franvaro/planering, sjukdomen på /franvaro/sjuk och dagens läge på
 * startsidan. Beställarens invändning var att ingen av dem svarade på frågan
 * hen faktiskt ställde — "vem är borta, och vad väntar på mig" — utan att man
 * bar svaret mellan flikar i huvudet.
 *
 * SEXTON FRÅGOR, EN TUR. Ingen av dem behöver svaret från en annan utom
 * bemanningsräkningen, som måste veta vilka perioder kön spänner över. Därför
 * två omgångar och inte en, och därför inte sexton — se `Promise.all` nedan.
 *
 * TVÅ TOKENS, OCH SKILLNADEN ÄR AVSIKTLIG:
 *
 *   - ANVÄNDARENS EGEN token läser allt som ska SYNAS. RLS drar kretsen en
 *     gång, och den här filen upprepar den inte. En teamledare får sitt team.
 *
 *   - SERVICE ROLE räknar bara BEMANNINGEN, och lämnar ifrån sig ett antal.
 *     Skälet är att ett bolagstak räknar hela bolaget: en teamledare vars
 *     RLS-krets är sex personer skulle annars få veta att "två är borta" en dag
 *     då fem är det, och sedan godkänna mot ett tak som redan var sprängt.
 *     NAMNEN kommer ur den egna token och aldrig ur service role-frågan —
 *     siffran får vara sann utan att kretsen vidgas.
 * ============================================================================
 */
export async function hamtaChefsbild(
  user: CurrentUser,
  regler: Regelverk | null,
  typer: Franvarotyp[],
  idag: string,
  fonster = 14,
): Promise<Chefsbild> {
  const supabase = await supabaseServer();
  const db = supabaseAdmin();
  const mig = user.employee!.id;
  const slutFonster = datumPlus(idag, fonster);

  const typkarta = new Map(typer.map((t) => [t.id, t]));

  const [{ data: koRader }, { data: bortaRader }, { data: sjukRader }] = await Promise.all([
    supabase.from("absence_request").select(BESLUTSFALT).eq("status", "submitted").order("starts_on"),

    supabase
      .from("absence_request")
      .select("id, employee_id, type_id, starts_on, ends_on, part_day_minutes")
      .eq("status", "approved")
      .lte("starts_on", slutFonster)
      .gte("ends_on", idag)
      .order("starts_on"),

    supabase
      .from("sick_report")
      .select("id, employee_id, first_sick_day, last_sick_day, extent_percent, confirmed_at, escalated_at")
      .is("cancelled_at", null)
      .or(`last_sick_day.is.null,last_sick_day.gte.${idag}`)
      .order("first_sick_day", { ascending: false }),
  ]);

  // Alla personer som förekommer någonstans i bilden. En fråga, inte tre.
  const berorda = [
    ...new Set([
      ...(koRader ?? []).map((a) => a.employee_id),
      ...(bortaRader ?? []).map((a) => a.employee_id),
      ...(sjukRader ?? []).map((s) => s.employee_id),
    ]),
  ];

  const ko = (koRader ?? []).filter((a) => a.employee_id !== mig);
  const sjuka = (sjukRader ?? []).filter((s) => s.employee_id !== mig);
  const rapportIds = sjuka.map((s) => s.id);

  // Bemanningsspannet: från tidigaste start i kön till senaste slut. Utan kö
  // ställs frågan inte alls — den hade ändå gett noll rader att räkna på.
  const spannFran = ko.length ? ko.reduce((a, r) => (r.starts_on < a ? r.starts_on : a), ko[0].starts_on) : null;
  const spannTill = ko.length ? ko.reduce((a, r) => (r.ends_on > a ? r.ends_on : a), ko[0].ends_on) : null;

  const [{ data: personer }, { data: taken }, { data: saldon }, { data: frister }, { data: anteckningar }, { data: bemanning }] =
    await Promise.all([
      berorda.length
        ? db.from("employee").select("id, first_name, last_name, team_id").in("id", berorda)
        : Promise.resolve({ data: [] as { id: string; first_name: string; last_name: string; team_id: string | null }[] }),

      db.from("staffing_cap").select("team_id, max_absent"),

      berorda.length
        ? db.from("absence_balance").select("employee_id, type_id, days, as_of, earned_year").in("employee_id", berorda)
        : Promise.resolve({ data: [] as { employee_id: string; type_id: string; days: string | number; as_of: string; earned_year: number | null }[] }),

      rapportIds.length
        ? db.from("sick_deadline").select("report_id, kind, due_on, completed_at").in("report_id", rapportIds)
        : Promise.resolve({ data: [] as { report_id: string; kind: string; due_on: string; completed_at: string | null }[] }),

      // Anteckningarna läses med SERVICE ROLE och inte med användarens token,
      // fast policyn hade släppt igenom precis dessa rader. Skälet är att
      // rapporterna redan är filtrerade av `sick_report_read` ovan: raden finns
      // i listan bara för att den inloggade får se den, och en andra
      // RLS-utvärdering per anteckning hade varit samma svar en gång till.
      rapportIds.length
        ? db.from("sick_note").select("id, sick_report_id, body, author_id, created_at").in("sick_report_id", rapportIds).order("created_at", { ascending: false })
        : Promise.resolve({ data: [] as { id: string; sick_report_id: string; body: string; author_id: string | null; created_at: string }[] }),

      spannFran && spannTill
        ? db
            .from("absence_request")
            .select("employee_id, type_id, starts_on, ends_on, part_day_minutes, employee!inner(team_id)")
            .eq("status", "approved")
            .lte("starts_on", spannTill)
            .gte("ends_on", spannFran)
        : Promise.resolve({ data: [] as unknown[] }),
    ]);

  const person = new Map((personer ?? []).map((p) => [p.id, p]));
  const namnet = (id: string) => {
    const p = person.get(id);
    return p ? fullName(p) : "Okänd";
  };

  /**
   * ATTESTNIVÅN FILTRERAS HÄR OCH INTE I SIDAN.
   *
   * RLS avgör vilka rader som SYNS; `approval_level` avgör vilka som går att
   * göra något åt. En teamledare ser studieledigheten i sitt team men beslutar
   * inte om den — VD gör det (E7.15) — och en kö med rader man inte kan röra
   * slutar man titta i.
   *
   * Frågan "vem leder jag" ställs en gång för hela kön och inte en gång per
   * rad, precis som `leads_employee()` gör i SQL men utan turen per post.
   */
  const [{ data: minaTeam }, { data: minaDirekt }] = await Promise.all([
    db.from("team").select("id").eq("lead_id", mig),
    db.from("employee").select("id").eq("manager_id", mig),
  ]);
  const teamIds = new Set((minaTeam ?? []).map((t) => t.id));
  const direkt = new Set((minaDirekt ?? []).map((e) => e.id));
  const leder = (employeeId: string) => {
    const p = person.get(employeeId);
    return Boolean(p && (direkt.has(p.id) || (p.team_id && teamIds.has(p.team_id))));
  };

  // Skribenten på en anteckning kan vara någon som inte annars finns i bilden —
  // en säljchef som skrev en rad om någon annans team. Slås upp separat.
  const skribentIds = [...new Set((anteckningar ?? []).map((n) => n.author_id).filter(Boolean) as string[])].filter(
    (id) => !person.has(id),
  );
  const { data: skribenter } = skribentIds.length
    ? await db.from("employee").select("id, first_name, last_name").in("id", skribentIds)
    : { data: [] as { id: string; first_name: string; last_name: string }[] };
  const skribent = new Map((skribenter ?? []).map((p) => [p.id, fullName(p)]));

  const taket = (taken ?? []) as Bemanningstak[];
  const raknasIBemanning = new Set(typer.filter((t) => t.counts_in_staffing).map((t) => t.id));

  // NAMNEN kommer härifrån och ingen annanstans: `bortaRader` är läst med
  // användarens egen token. Den som inte får se en person får ett antal utan
  // namn, vilket är rätt sorts ofullständighet — siffran är sann, kretsen är
  // orörd.
  const synligaNamn = new Map((bortaRader ?? []).map((b) => [b.employee_id, namnet(b.employee_id)]));

  const andras = ((bemanning ?? []) as unknown as {
    employee_id: string;
    type_id: string;
    starts_on: string;
    ends_on: string;
    part_day_minutes: number | null;
    employee: { team_id: string | null } | null;
  }[]).map((p) => ({
    employee_id: p.employee_id,
    type_id: p.type_id,
    starts_on: p.starts_on,
    ends_on: p.ends_on,
    part_day_minutes: p.part_day_minutes,
    team_id: p.employee?.team_id ?? null,
    namn: synligaNamn.get(p.employee_id) ?? "",
  })) as (Franvaroperiod & { team_id: string | null; namn: string })[];

  const saldorader: (Saldo & { employee_id: string })[] = ((saldon ?? []) as {
    employee_id: string;
    type_id: string;
    days: string | number;
    as_of: string;
    earned_year: number | null;
  }[]).map((s) => ({ ...s, days: Number(s.days) }));

  const beslutbara = ko.filter((a) => {
    const typ = typkarta.get(a.type_id);
    return Boolean(typ) && farBesluta(user, typ!.approval_level, leder(a.employee_id));
  });

  const attestko: Attestpost[] = beslutbara.map((a) => {
    const p = person.get(a.employee_id);
    const typ = typkarta.get(a.type_id);
    const mitt = taket.find((t) => t.team_id !== null && t.team_id === (p?.team_id ?? null)) ?? null;
    const bolag = taket.find((t) => t.team_id === null) ?? null;

    const egnaSaldon = saldorader.filter((s) => s.employee_id === a.employee_id);
    const s = typ?.uses_balance ? saldoFor(egnaSaldon, a.type_id) : null;

    return {
      id: a.id,
      employeeId: a.employee_id,
      namn: namnet(a.employee_id),
      typId: a.type_id,
      typ: typ?.label ?? a.type_id,
      starts_on: a.starts_on,
      ends_on: a.ends_on,
      part_day_minutes: a.part_day_minutes,
      submitted_at: a.submitted_at,
      skal: a.reason,
      brutna: (a.rules_broken ?? []) as string[],
      bemanning: typ?.counts_in_staffing
        ? bemanningUnderPeriod(a, andras, raknasIBemanning, mitt ?? bolag)
        : null,
      saldo:
        s && regler
          ? { dagar: s.days, asOf: s.as_of, gammalt: saldotArGammalt(s.as_of, regler, idag) }
          : s
            ? { dagar: s.days, asOf: s.as_of, gammalt: false }
            : null,
    };
  });

  const kommande: Bortarad[] = (bortaRader ?? [])
    .map((b) => ({
      employeeId: b.employee_id,
      namn: namnet(b.employee_id),
      etikett: typkarta.get(b.type_id)?.label ?? b.type_id,
      detalj: `${periodtext(b.starts_on, b.ends_on)} · ${omfattning(b)}`,
      href: `/franvaro/${b.id}`,
      fran: b.starts_on,
    }))
    .sort((a, b) => a.fran.localeCompare(b.fran) || a.namn.localeCompare(b.namn, "sv"));

  const fristPer = new Map<string, { kind: string; due_on: string }[]>();
  for (const f of frister ?? []) {
    if (f.completed_at) continue;
    fristPer.set(f.report_id, [...(fristPer.get(f.report_id) ?? []), { kind: f.kind, due_on: f.due_on }]);
  }

  const antPer = new Map<string, { id: string; text: string; av: string; nar: string }[]>();
  for (const n of anteckningar ?? []) {
    antPer.set(n.sick_report_id, [
      ...(antPer.get(n.sick_report_id) ?? []),
      {
        id: n.id,
        text: n.body,
        av: n.author_id ? (person.has(n.author_id) ? namnet(n.author_id) : (skribent.get(n.author_id) ?? "Okänd")) : "Okänd",
        nar: n.created_at,
      },
    ]);
  }

  return {
    ko: attestko,
    kommande,
    fonster,
    sjuka: sjuka.map((s) => ({
      id: s.id,
      employeeId: s.employee_id,
      namn: namnet(s.employee_id),
      forstaDag: s.first_sick_day,
      sistaDag: s.last_sick_day,
      omfattning: s.extent_percent,
      bekraftad: Boolean(s.confirmed_at),
      eskalerad: Boolean(s.escalated_at),
      frister: (fristPer.get(s.id) ?? []).sort((a, b) => a.due_on.localeCompare(b.due_on)),
      anteckningar: antPer.get(s.id) ?? [],
    })),
  };
}
