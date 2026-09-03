/**
 * Namn pa svenska for tabellerna i raderingens forhandsvisning.
 *
 * Forhandsvisningen kommer fran `referenser_till_anstalld()`, som laser
 * pg_constraint och darfor talar databasens sprak: `payroll_row`,
 * `coaching_task_event`, `break_schedule_ack`. En chef som ska ta stallning
 * till om en person far raderas kan inte forvantas veta vad de heter.
 *
 * Registret ar med FLIT INTE uttommande, och funktionen faller tillbaka pa
 * tabellnamnet i stallet for att kasta. En ny tabell dyker upp i listan samma
 * dag den far en nyckel mot `employee` — den ska da synas pa sitt rakodade
 * namn, inte forsvinna ur en lista vars hela syfte ar att vara fullstandig.
 */
const TABELL: Record<string, string> = {
  absence_balance: "Frånvarosaldon",
  absence_blackout: "Spärrade frånvaroperioder",
  absence_call_order: "Ringordning vid frånvaro",
  absence_policy: "Frånvaroregler",
  absence_reminder: "Frånvaropåminnelser",
  absence_request: "Frånvaroansökningar",
  activity_day: "Aktivitetsdagar",
  attendance_incident: "Närvarohändelser",
  audit_log: "Händelseloggen",
  break_deviation: "Rastavvikelser",
  break_deviation_month: "Rastavvikelser per månad",
  break_schedule_ack: "Kvitterade rastscheman",
  calendar_feed: "Kalenderflöden",
  candidate: "Kandidater",
  candidate_stage_event: "Steg i rekryteringen",
  case_message: "Meddelanden i ärenden",
  certification: "Certifieringar",
  coaching_session: "Coachningssamtal",
  coaching_task: "Coachningsuppgifter",
  coaching_task_event: "Händelser på coachningsuppgifter",
  coaching_template: "Coachningsmallar",
  commission_bonus_level: "Volymbonusnivåer",
  commission_entry: "Provisionsposter",
  commission_period: "Provisionsperioder",
  commission_rate: "Provisionssatser",
  compliance_gate: "Läskrav",
  consequence_rule: "Konsekvensregler",
  contract: "Avtal",
  contract_template: "Avtalsmallar",
  cost_calculation: "Lönekostnadsberäkningar",
  cost_rate: "Lönekostnadssatser",
  course: "Kurser",
  course_attempt: "Kursförsök",
  document: "Dokument och rutiner",
  document_ack: "Kvitterade dokument",
  document_version: "Dokumentversioner",
  document_view: "Lästa dokument",
  employee: "Personalposten",
  employee_permission: "Behörigheter",
  employee_role: "Roller",
  error_report: "Felrapporter",
  file_access_log: "Filåtkomstloggen",
  file_object: "Filer",
  guide_nudge: "Knuffar om systemguider",
  guide_progress: "Framsteg i systemguider",
  hr_case: "Personalärenden",
  interview_scorecard: "Intervjuprotokoll",
  kv_assessment: "K&V-bedömningar",
  kv_call: "K&V-samtal",
  kv_criterion: "K&V-kriterier",
  kv_policy: "K&V-regler",
  late_arrival: "Sena ankomster",
  late_arrival_month: "Sena ankomster per månad",
  module_progress: "Framsteg i utbildningsmoduler",
  news_post: "Nyheter",
  notification_dismissed: "Avfärdade notiser",
  notification_seen: "Sedda notiser",
  offboarding_task: "Offboardingchecklistan",
  onboarding_task: "Onboardingchecklistan",
  payroll_adjustment: "Lönejusteringar",
  payroll_period: "Löneperioder",
  payroll_row: "Lönerader",
  recruitment_policy: "Rekryteringsregler",
  revenue_entry: "Intäktsposter",
  roleplay_submission: "Inspelade rollspel",
  salary_basis: "Löneunderlag",
  sales_order: "Kundorder",
  scheduled_break: "Schemalagda raster",
  sick_deadline: "Frister vid sjukfrånvaro",
  sick_report: "Sjukanmälningar",
  staffing_cap: "Bemanningstak",
  team: "Team",
  time_event: "Stämplingar",
  work_schedule: "Arbetsscheman",
  work_time_journal: "Arbetstidsjournalen",
};

export type Referens = {
  tabell: string;
  kolumn: string;
  antal: number;
  atgard: "raderas" | "behalls";
};

export function tabellnamn(tabell: string): string {
  return TABELL[tabell] ?? tabell;
}

/**
 * Slar ihop till en rad per tabell.
 *
 * `sales_order` kan traffas av bade `salesperson_id` och `created_by`, och
 * `Kundorder 1` tva ganger under varandra sager mindre an `Kundorder 3`. Att
 * summera antalen ar inte heller ratt — samma rad kan traffas av bada
 * kolumnerna, och da hade summan overdrivit. Det storsta antalet ar det
 * narmaste sanna svaret utan att fraga databasen en gang till.
 */
export function perTabell(rader: Referens[]): { tabell: string; antal: number }[] {
  const per = new Map<string, number>();
  for (const r of rader) {
    per.set(r.tabell, Math.max(per.get(r.tabell) ?? 0, Number(r.antal)));
  }
  return [...per.entries()]
    .map(([tabell, antal]) => ({ tabell: tabellnamn(tabell), antal }))
    .sort((a, b) => b.antal - a.antal || a.tabell.localeCompare(b.tabell, "sv"));
}
