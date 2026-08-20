/**
 * E7 / M3 Frånvaro och ledighet. Ren logik — inga anrop, inga hemligheter.
 *
 * ===========================================================================
 * K35, AC-3.21: INGEN ORSAK, DIAGNOS ELLER SYMTOMBESKRIVNING.
 *
 * Ingen typ i den här filen bär ett fält där ett skäl kan hamna. Sjukfrånvaro
 * representeras av datum, omfattning och tidpunkter, ingenting annat. Det är
 * inte en förbiseende utelämning — det är kravet, och det är därför
 * `sick_report` i 0020 har noll textkolumner.
 * ===========================================================================
 *
 * AC-2.17, K5 gäller här som i lönerapporten: INGEN LÖN RÄKNAS. Modulen
 * redovisar dagar och minuter. Karensdagen märks ut, men inget avdrag beräknas
 * och ingen krona nämns.
 *
 * E7.15: REGLERNA KOMMER UTIFRÅN. Varje gräns motorn dömer efter skickas in
 * som argument och läses ur `absence_type`, `absence_policy`,
 * `absence_blackout` och `staffing_cap`. Det finns inget `if` här som
 * innehåller ett tal ur semesterlagen. Samma linje som provisionsreglerna ska
 * följa i E13, och samma skäl: en regel som står i koden går varken att ändra
 * utan deploy eller att visa för den som ska följa den (AC-3.13).
 *
 * Filen ska gå att prova utan att starta något — se `tests/franvaro.mjs`.
 */

// -----------------------------------------------------------------------------
// Datum. Allt räknas på "ÅÅÅÅ-MM-DD" i UTC, aldrig på lokal tid.
//
// En frånvarodag är en kalenderdag och ingenting annat. Skulle beräkningen gå
// via `new Date("2026-08-20")` i serverns zon skulle en period kunna börja
// dagen före sig själv på en server väster om Greenwich — samma sorts fel som
// `svenskTidpunkt()` finns för att undvika på stämplingssidan.
// -----------------------------------------------------------------------------

const DYGN = 86_400_000;

function tal(datum: string): number {
  return Date.UTC(+datum.slice(0, 4), +datum.slice(5, 7) - 1, +datum.slice(8, 10));
}

function text(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Datumet n dagar senare. Negativt n går bakåt. */
export function datumPlus(datum: string, n: number): string {
  return text(tal(datum) + n * DYGN);
}

/** Antal dagar från a till b. Samma dag ger 0. */
export function dagarMellan(a: string, b: string): number {
  return Math.round((tal(b) - tal(a)) / DYGN);
}

/** Varje kalenderdag i perioden, båda ändarna inräknade. */
export function dagarna(fran: string, till: string): string[] {
  const ut: string[] = [];
  for (let d = tal(fran); d <= tal(till); d += DYGN) ut.push(text(d));
  return ut;
}

/** Antal kalenderdagar i perioden. En endagsledighet är 1, inte 0. */
export function antalDagar(fran: string, till: string): number {
  return dagarMellan(fran, till) + 1;
}

export function overlappar(aFran: string, aTill: string, bFran: string, bTill: string): boolean {
  return aFran <= bTill && bFran <= aTill;
}

// -----------------------------------------------------------------------------
// Formen på reglerna. Speglar tabellerna i 0019 utan att veta om databasen.
// -----------------------------------------------------------------------------

export type Attestniva = "manager" | "sales_manager" | "ceo";

export type Franvarotyp = {
  id: string;
  label: string;
  sort: number;
  notice_days: number;
  max_consecutive_days: number | null;
  waiting_days: number;
  approval_level: Attestniva;
  uses_balance: boolean;
  counts_in_staffing: boolean;
  allows_part_day: boolean;
  requestable: boolean;
  active: boolean;
};

export type Regelverk = {
  vacation_year_start_month: number;
  vacation_year_start_day: number;
  main_vacation_start_month: number;
  main_vacation_start_day: number;
  main_vacation_end_month: number;
  main_vacation_end_day: number;
  main_vacation_notice_days: number;
  saved_days_max_years: number;
  balance_stale_days: number;
  sick_certificate_day: number;
  sick_fk_day: number;
  sick_return_plan_day: number;
  sick_confirm_hours: number;
  relapse_days: number;
  repeat_sick_count: number;
  repeat_sick_months: number;
  unregistered_reminder_hours: number;
};

export type Sparrperiod = {
  id: string;
  label: string;
  starts_on: string;
  ends_on: string;
  /** Tom lista = alla typer. Samma tomma-betyder-alla som målgrupperna i M5. */
  type_ids: string[];
  /** Tom lista = hela bolaget. */
  team_ids: string[];
};

export type Bemanningstak = { team_id: string | null; max_absent: number };

export type Saldo = {
  type_id: string;
  days: number;
  as_of: string;
  earned_year: number | null;
};

/** En frånvaroperiod som redan finns, oavsett om den kommer från ansökan eller sjukanmälan. */
export type Franvaroperiod = {
  employee_id: string;
  type_id: string;
  starts_on: string;
  ends_on: string;
  part_day_minutes: number | null;
};

export type Ansokan = {
  employee_id: string;
  type_id: string;
  starts_on: string;
  ends_on: string;
  part_day_minutes: number | null;
};

// -----------------------------------------------------------------------------
// Regelbrotten
//
// Ett brott är en VARNING och aldrig en spärr. Chefen ska kunna godkänna ändå,
// men då med en motivering (AC-3.12, och villkoret som kräver den ligger i
// databasen). En regel som blockerar tvingar fram vägen runt systemet, och då
// vet ingen längre vem som är ledig — vilket var hela poängen med modulen.
//
// Koderna är stabila och lagras i `absence_request.rules_broken`. Texten kan
// skrivas om; koden kan den inte, för den står i gamla rader.
// -----------------------------------------------------------------------------

export type Brottkod =
  | "frist"
  | "huvudsemester"
  | "sparrperiod"
  | "maxlangd"
  | "bemanning"
  | "saldo"
  | "overlapp"
  | "deldag"
  | "bakat";

export type Regelbrott = { kod: Brottkod; text: string };

export type Provunderlag = {
  typ: Franvarotyp;
  regler: Regelverk;
  /** Idag, som "ÅÅÅÅ-MM-DD" i svensk tid. */
  idag: string;
  sparrperioder: Sparrperiod[];
  /** Sökandens team. Null när personen inte har något. */
  teamId: string | null;
  /** Saldon för sökanden, senast inmatade per typ och intjänandeår. */
  saldon: Saldo[];
  /** Sökandens egen frånvaro som redan är godkänd eller inskickad. */
  egnaPerioder: Franvaroperiod[];
  /** All annan frånvaro i perioden, för bemanningsräkningen. */
  andrasPerioder: (Franvaroperiod & { team_id: string | null })[];
  /** Taket för sökandens team, eller bolagets när teamet saknar ett. */
  tak: Bemanningstak | null;
  /** Vilka typer som räknas mot bemanningen. */
  raknasIBemanning: Set<string>;
};

/**
 * Ligger datumet i huvudsemesterfönstret? Månad och dag jämförs, aldrig året:
 * fönstret återkommer varje år.
 *
 * Fönstret får sträcka sig över ett årsskifte (t.ex. december–januari). Då är
 * start senare än slut i månadsordning, och villkoret vänds.
 */
export function iHuvudsemesterfonstret(datum: string, r: Regelverk): boolean {
  const md = datum.slice(5);
  const start = `${String(r.main_vacation_start_month).padStart(2, "0")}-${String(r.main_vacation_start_day).padStart(2, "0")}`;
  const slut = `${String(r.main_vacation_end_month).padStart(2, "0")}-${String(r.main_vacation_end_day).padStart(2, "0")}`;
  return start <= slut ? md >= start && md <= slut : md >= start || md <= slut;
}

/**
 * Semesteråret ett datum hör till, som "2026/27".
 *
 * Med semesteråret 1 april–31 mars hör mars 2027 till 2026/27, inte till
 * 2027/28. Med kalenderår som gränsvärde blir svaret "2026/26", vilket ser
 * konstigt ut men är rätt — se `semesteraretsEtikett`.
 */
export function semesteraret(datum: string, r: Regelverk): { start: string; slut: string } {
  const mm = String(r.vacation_year_start_month).padStart(2, "0");
  const dd = String(r.vacation_year_start_day).padStart(2, "0");
  const gransen = (y: number) => `${y}-${mm}-${dd}`;

  const ar = +datum.slice(0, 4);
  const start = datum >= gransen(ar) ? gransen(ar) : gransen(ar - 1);

  return { start, slut: datumPlus(gransen(+start.slice(0, 4) + 1), -1) };
}

export function semesteraretsEtikett(datum: string, r: Regelverk): string {
  const { start, slut } = semesteraret(datum, r);
  const a = +start.slice(0, 4);
  const b = +slut.slice(0, 4);
  return a === b ? String(a) : `${a}/${String(b).slice(2)}`;
}

/**
 * Vilka regler ansökan bryter mot.
 *
 * Ordningen i listan är den ordning de visas för den som ansöker. Fristerna
 * först: de går att åtgärda genom att söka en annan vecka. Bemanningen sist:
 * den är chefens avvägning, inte den sökandes fel.
 */
export function provaRegler(a: Ansokan, u: Provunderlag): Regelbrott[] {
  const brott: Regelbrott[] = [];
  const langd = antalDagar(a.starts_on, a.ends_on);
  const dagarKvar = dagarMellan(u.idag, a.starts_on);

  // 1. Ansökningsfristen. Negativt `dagarKvar` betyder att perioden redan
  //    börjat — det fångas av samma villkor, eftersom -3 alltid är mindre än
  //    en frist på 0 eller mer. Undantaget är typer med frist 0, där en
  //    registrering i efterhand är det normala (VAB).
  if (dagarKvar < 0 && u.typ.notice_days === 0) {
    // Tillåtet, men värt att säga: den som registrerar bakåt ska veta att
    // hen gör det.
    brott.push({
      kod: "bakat",
      text: `Perioden började ${a.starts_on}, alltså bakåt i tiden. Det går bra för ${u.typ.label.toLowerCase()}, men chefen ser att den registrerades i efterhand.`,
    });
  } else if (dagarKvar < u.typ.notice_days) {
    brott.push({
      kod: "frist",
      text: `${u.typ.label} ska sökas minst ${u.typ.notice_days} dagar i förväg. Det är ${dagarKvar} dagar kvar till ${a.starts_on}.`,
    });
  }

  // 2. Huvudsemestern har en egen, längre frist (11 § semesterlagen). Den
  //    gäller bara typer som drar semesterdagar och bara när perioden rör
  //    fönstret — en dags kompledigt i juli är inte huvudsemester.
  if (u.typ.uses_balance && dagarna(a.starts_on, a.ends_on).some((d) => iHuvudsemesterfonstret(d, u.regler))) {
    if (dagarKvar < u.regler.main_vacation_notice_days) {
      brott.push({
        kod: "huvudsemester",
        text: `Perioden ligger i huvudsemesterfönstret, där beskedet ska lämnas minst ${u.regler.main_vacation_notice_days} dagar i förväg. Det är ${dagarKvar} dagar kvar.`,
      });
    }
  }

  // 3. Spärrperioder. Tom typlista betyder alla typer, tom teamlista hela
  //    bolaget — samma "tomt betyder alla" som målgrupperna i M5 och M11.
  for (const s of u.sparrperioder) {
    if (s.type_ids.length > 0 && !s.type_ids.includes(a.type_id)) continue;
    if (s.team_ids.length > 0 && (u.teamId === null || !s.team_ids.includes(u.teamId))) continue;
    if (!overlappar(a.starts_on, a.ends_on, s.starts_on, s.ends_on)) continue;

    brott.push({
      kod: "sparrperiod",
      text: `Perioden krockar med "${s.label}" (${s.starts_on}–${s.ends_on}).`,
    });
  }

  // 4. Maxlängd.
  if (u.typ.max_consecutive_days !== null && langd > u.typ.max_consecutive_days) {
    brott.push({
      kod: "maxlangd",
      text: `${u.typ.label} är ${langd} dagar. Längsta sammanhängande period är ${u.typ.max_consecutive_days} dagar.`,
    });
  }

  // 5. Del av dag på en typ som inte tillåter det.
  if (a.part_day_minutes !== null && !u.typ.allows_part_day) {
    brott.push({
      kod: "deldag",
      text: `${u.typ.label} söks för hela dagar.`,
    });
  }

  // 6. Egen frånvaro som krockar. Databasen hindrar två GODKÄNDA perioder från
  //    att överlappa; det här fångar krocken redan i formuläret, så att den
  //    sökande får veta det innan chefen gör det.
  for (const p of u.egnaPerioder) {
    if (!overlappar(a.starts_on, a.ends_on, p.starts_on, p.ends_on)) continue;
    brott.push({
      kod: "overlapp",
      text: `Du har redan frånvaro registrerad ${p.starts_on}–${p.ends_on}.`,
    });
    break;
  }

  // 7. Saldot. Bara för typer som drar dagar; för övriga finns inget saldo i
  //    navet och ett påstående om ett vore en gissning.
  if (u.typ.uses_balance) {
    const kvar = saldoFor(u.saldon, a.type_id);
    if (kvar !== null && langd > kvar.days) {
      brott.push({
        kod: "saldo",
        text: `Ansökan är ${langd} dagar men saldot säger ${kvar.days} kvar (inmatat ${kvar.as_of}).`,
      });
    }
  }

  // 8. Bemanningen (E7.2, AC-3.2). Räknas per dag: en vecka där tre är lediga
  //    på onsdagen och ingen annan dag ska varna för onsdagen, inte för veckan.
  if (u.tak && u.typ.counts_in_staffing) {
    const varst = varstaBemanningsdag(a, u);
    if (varst && varst.antal >= u.tak.max_absent) {
      brott.push({
        kod: "bemanning",
        text: `${varst.datum} skulle ${varst.antal + 1} personer vara borta samtidigt. Taket är ${u.tak.max_absent}.`,
      });
    }
  }

  return brott;
}

/** Dagen i perioden då flest andra redan är borta, och hur många det är. */
export function varstaBemanningsdag(
  a: Ansokan,
  u: Provunderlag,
): { datum: string; antal: number } | null {
  const relevanta = u.andrasPerioder.filter(
    (p) =>
      p.employee_id !== a.employee_id &&
      u.raknasIBemanning.has(p.type_id) &&
      // Taket gäller det lag det är satt för. Ett bolagstak räknar alla.
      (u.tak?.team_id === null || u.tak?.team_id === undefined || p.team_id === u.tak.team_id),
  );

  let varst: { datum: string; antal: number } | null = null;
  for (const d of dagarna(a.starts_on, a.ends_on)) {
    const antal = relevanta.filter((p) => d >= p.starts_on && d <= p.ends_on).length;
    if (!varst || antal > varst.antal) varst = { datum: d, antal };
  }
  return varst;
}

/**
 * Det saldo som gäller för en typ: senaste `as_of`, och vid samma datum den
 * senast inmatade raden. Summerar över intjänandeår, eftersom sparade dagar
 * ligger i en rad per år.
 */
export function saldoFor(saldon: Saldo[], typId: string): { days: number; as_of: string } | null {
  const egna = saldon.filter((s) => s.type_id === typId);
  if (egna.length === 0) return null;

  const senastePerAr = new Map<number | null, Saldo>();
  for (const s of egna) {
    const fore = senastePerAr.get(s.earned_year);
    if (!fore || s.as_of > fore.as_of) senastePerAr.set(s.earned_year, s);
  }

  const rader = [...senastePerAr.values()];
  return {
    days: rader.reduce((s, r) => s + r.days, 0),
    as_of: rader.reduce((a, r) => (r.as_of < a ? r.as_of : a), rader[0].as_of),
  };
}

/** AC-3.5: ett saldo äldre än fristen visas som föråldrat, inte som sanning. */
export function saldotArGammalt(asOf: string, r: Regelverk, idag: string): boolean {
  return dagarMellan(asOf, idag) > r.balance_stale_days;
}

/**
 * AC-3.9, 18 § semesterlagen: sparade dagar måste tas ut inom fem år.
 *
 * Varningen kräver att inmatningen sagt vilket semesterår dagarna kommer från.
 * Saknas året går det inte att veta när de förfaller, och då varnas det inte —
 * en varning på gissad grund är värre än ingen, eftersom den skulle få folk
 * att ta ut dagar de inte behöver ta ut.
 */
export function femarsvarning(
  saldon: Saldo[],
  r: Regelverk,
  idag: string,
): { earned_year: number; days: number; forfaller: string }[] {
  const ut: { earned_year: number; days: number; forfaller: string }[] = [];
  const iAr = +semesteraret(idag, r).start.slice(0, 4);

  for (const s of saldon) {
    if (s.type_id !== "saved_vacation" || s.earned_year === null || s.days <= 0) continue;
    const forfallerAr = s.earned_year + r.saved_days_max_years;
    if (forfallerAr > iAr) continue;

    ut.push({
      earned_year: s.earned_year,
      days: s.days,
      forfaller: `${forfallerAr}-${String(r.vacation_year_start_month).padStart(2, "0")}-${String(r.vacation_year_start_day).padStart(2, "0")}`,
    });
  }

  return ut.sort((a, b) => a.earned_year - b.earned_year);
}

/**
 * AC-3.13: reglerna som gäller för en typ, i klartext, INNAN ansökan skickas.
 *
 * Samma tabellrader som `provaRegler` dömer efter. Att räkna ut listan på två
 * ställen hade gett en sida som säger en sak och ett avslag som säger en
 * annan — samma resonemang som `sparr_saknas` i 0016.
 */
export function reglerFor(typ: Franvarotyp, r: Regelverk): string[] {
  const ut: string[] = [];

  if (typ.notice_days > 0) ut.push(`Söks minst ${typ.notice_days} dagar i förväg.`);
  else ut.push("Kan registreras samma dag eller i efterhand.");

  if (typ.uses_balance) {
    ut.push(
      `Ligger perioden i juni–augusti gäller ${r.main_vacation_notice_days} dagars frist (11 § semesterlagen).`,
    );
    ut.push("Dras från ditt inmatade saldo.");
  }

  if (typ.max_consecutive_days !== null)
    ut.push(`Längst ${typ.max_consecutive_days} dagar i följd.`);

  ut.push(
    typ.allows_part_day ? "Kan sökas för del av dag." : "Söks för hela dagar.",
  );

  ut.push(
    typ.counts_in_staffing
      ? "Räknas mot bemanningen i ditt team."
      : "Räknas inte mot bemanningen.",
  );

  ut.push(
    {
      manager: "Beslutas av din närmaste chef.",
      sales_manager: "Beslutas av säljchefen.",
      ceo: "Beslutas av VD.",
    }[typ.approval_level],
  );

  if (typ.waiting_days > 0)
    ut.push(`Första ${typ.waiting_days} dagen är karensdag och märks ut i löneunderlaget.`);

  return ut;
}

// -----------------------------------------------------------------------------
// Sjukfrånvaron
// -----------------------------------------------------------------------------

export type Fristtyp = "certificate" | "fk_notice" | "return_plan";

export const FRIST_ETIKETT: Record<Fristtyp, string> = {
  certificate: "Läkarintyg",
  fk_notice: "Anmälan till Försäkringskassan",
  return_plan: "Plan för återgång i arbete",
};

export const FRIST_TEXT: Record<Fristtyp, string> = {
  certificate: "Den anställda ska lämna läkarintyg.",
  fk_notice: "Sjukfallet ska anmälas till Försäkringskassan.",
  return_plan: "Arbetsgivaren ska ha upprättat en plan för återgång i arbete.",
};

export type Sjukanmalan = {
  id: string;
  employee_id: string;
  first_sick_day: string;
  registered_at: string;
  confirmed_at: string | null;
  escalated_at: string | null;
  last_sick_day: string | null;
  cancelled_at: string | null;
};

/**
 * K37, AC-3.23: dag 8 intyg, dag 15 Försäkringskassan, dag 30 plan för
 * återgång.
 *
 * RÄKNAT FRÅN FÖRSTA SJUKDAGEN, ALDRIG FRÅN REGISTRERINGEN. Det är hela
 * skillnaden AC-3.16 kräver mellan `first_sick_day` och `registered_at`: den
 * som blir sjuk på lördagen och ringer på måndagen har dag 8 på lördagen om en
 * vecka. Räknades fristen från registreringen kunde en sen anmälan flytta
 * lagens frister framför sig, och det är precis vad de finns för att hindra.
 *
 * Dag 1 är första sjukdagen. Dag 8 är alltså sju dygn senare, inte åtta.
 */
export function sjukfrister(
  forstaSjukdag: string,
  r: Regelverk,
): { kind: Fristtyp; due_on: string }[] {
  return [
    { kind: "certificate" as const, dag: r.sick_certificate_day },
    { kind: "fk_notice" as const, dag: r.sick_fk_day },
    { kind: "return_plan" as const, dag: r.sick_return_plan_day },
  ]
    .map((f) => ({ kind: f.kind, due_on: datumPlus(forstaSjukdag, f.dag - 1) }))
    .sort((a, b) => a.due_on.localeCompare(b.due_on));
}

/**
 * AC-3.17: en anmälan som ingen chef bekräftat inom fristen ska eskalera.
 *
 * `nu` skickas in i stället för att läsas ur klockan, så att provet kan ställa
 * fram tiden utan att röra systemklockan.
 */
export function boreskalera(a: Sjukanmalan, r: Regelverk, nu: Date): boolean {
  if (a.confirmed_at || a.cancelled_at || a.escalated_at) return false;
  const timmar = (nu.getTime() - Date.parse(a.registered_at)) / 3_600_000;
  return timmar >= r.sick_confirm_hours;
}

/**
 * AC-3.24: återinsjuknande inom fristen hör till föregående period.
 *
 * Lämnar tillbaka den anmälan den nya ska kopplas till, eller null. Bland
 * flera möjliga väljs den senast avslutade — det är den man återinsjuknar i.
 */
export function aterinsjuknande(
  forstaSjukdag: string,
  tidigare: Sjukanmalan[],
  r: Regelverk,
): Sjukanmalan | null {
  const mojliga = tidigare
    .filter((t) => !t.cancelled_at && t.last_sick_day !== null && t.last_sick_day < forstaSjukdag)
    .filter((t) => dagarMellan(t.last_sick_day!, forstaSjukdag) <= r.relapse_days)
    .sort((a, b) => b.last_sick_day!.localeCompare(a.last_sick_day!));

  return mojliga[0] ?? null;
}

/**
 * AC-3.25: upprepad korttidsfrånvaro ger en TYST signal om rehabiliteringsansvar.
 *
 * Tyst betyder tre saker, och alla tre är byggda:
 *
 *   Ingen automatisk konsekvens. Signalen är en påminnelse om arbetsgivarens
 *   utredningsskyldighet enligt 30 kap. 6 § socialförsäkringsbalken, inte ett
 *   underlag för ett samtal om prestation. Samma gräns som K31 drar för
 *   rastavvikelser: `missing` är en arbetsmiljösignal, inte en tillsägelse.
 *
 *   Ingen notis till den anställda. Att få veta av ett system att man varit
 *   sjuk sex gånger är inte omsorg.
 *
 *   Ingen väg till kostnad eller provision. Signalen räknas fram ur
 *   `sick_report`, som `finance` och `payroll_cost_viewer` inte når (AC-3.26).
 */
export function upprepadKorttid(
  anmalningar: Sjukanmalan[],
  r: Regelverk,
  idag: string,
): { antal: number; sedan: string } | null {
  const sedan = datumPlus(idag, -Math.round(r.repeat_sick_months * 30.44));

  const antal = anmalningar.filter(
    (a) => !a.cancelled_at && a.first_sick_day >= sedan && a.first_sick_day <= idag,
  ).length;

  return antal >= r.repeat_sick_count ? { antal, sedan } : null;
}

// -----------------------------------------------------------------------------
// E7.4 / AC-3.4: in i lönerapporten
// -----------------------------------------------------------------------------

/**
 * Frånvarominuter per person och typ inom en period.
 *
 * `minuterForDag` kommer utifrån och slår upp personens schema för dagen. En
 * dag utan schema ger noll minuter — inte en gissad åttatimmarsdag. Det är
 * samma hållning som `oppnaDagar()` i lönerapporten: en dag navet inte vet
 * något om ska stå tom, inte fyllas med ett antagande.
 *
 * Deltidssjukskrivning räknas som sin andel av dagen. Del av dag räknas som
 * sina minuter, dock aldrig mer än dagen är lång.
 */
export function franvarominuter(
  perioder: (Franvaroperiod & { extent_percent?: number })[],
  periodStart: string,
  periodSlut: string,
  minuterForDag: (employeeId: string, datum: string) => number,
): Map<string, Record<string, number>> {
  const ut = new Map<string, Record<string, number>>();

  for (const p of perioder) {
    const fran = p.starts_on > periodStart ? p.starts_on : periodStart;
    const till = p.ends_on < periodSlut ? p.ends_on : periodSlut;
    if (fran > till) continue;

    const andel = (p.extent_percent ?? 100) / 100;

    for (const datum of dagarna(fran, till)) {
      const dagen = minuterForDag(p.employee_id, datum);
      if (dagen <= 0) continue;

      const minuter =
        p.part_day_minutes !== null && p.part_day_minutes !== undefined
          ? Math.min(p.part_day_minutes, dagen)
          : Math.round(dagen * andel);

      if (minuter <= 0) continue;

      const rad = ut.get(p.employee_id) ?? {};
      rad[p.type_id] = (rad[p.type_id] ?? 0) + minuter;
      ut.set(p.employee_id, rad);
    }
  }

  return ut;
}

// -----------------------------------------------------------------------------
// Etiketter
// -----------------------------------------------------------------------------

export type Ansokningsstatus = "submitted" | "approved" | "rejected" | "withdrawn" | "cancelled";

export const STATUS_ETIKETT: Record<Ansokningsstatus, string> = {
  submitted: "Väntar på beslut",
  approved: "Godkänd",
  rejected: "Avslagen",
  withdrawn: "Tillbakadragen",
  cancelled: "Inställd",
};

export const STATUS_TON: Record<Ansokningsstatus, "accent" | "ok" | "danger" | "neutral"> = {
  submitted: "accent",
  approved: "ok",
  rejected: "danger",
  withdrawn: "neutral",
  cancelled: "neutral",
};

/** "3 dagar" eller "2 tim 30 min" när det är del av dag. */
export function omfattning(p: { starts_on: string; ends_on: string; part_day_minutes: number | null }): string {
  if (p.part_day_minutes !== null) {
    const t = Math.floor(p.part_day_minutes / 60);
    const m = p.part_day_minutes % 60;
    return t === 0 ? `${m} min` : m === 0 ? `${t} tim` : `${t} tim ${m} min`;
  }
  const n = antalDagar(p.starts_on, p.ends_on);
  return n === 1 ? "1 dag" : `${n} dagar`;
}

/** "12 mars" eller "12–19 mars 2027" — utan att upprepa månaden i onödan. */
export function periodtext(fran: string, till: string): string {
  const manad = [
    "januari", "februari", "mars", "april", "maj", "juni",
    "juli", "augusti", "september", "oktober", "november", "december",
  ];
  const d = (s: string) => +s.slice(8, 10);
  const m = (s: string) => manad[+s.slice(5, 7) - 1];
  const y = (s: string) => s.slice(0, 4);

  if (fran === till) return `${d(fran)} ${m(fran)} ${y(fran)}`;
  if (fran.slice(0, 7) === till.slice(0, 7)) return `${d(fran)}–${d(till)} ${m(till)} ${y(till)}`;
  if (y(fran) === y(till)) return `${d(fran)} ${m(fran)}–${d(till)} ${m(till)} ${y(till)}`;
  return `${d(fran)} ${m(fran)} ${y(fran)}–${d(till)} ${m(till)} ${y(till)}`;
}
