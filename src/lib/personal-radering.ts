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
  project: "Projekt",
  project_member: "Deltagare i projekt",
  project_message: "Repliker i projektchattar",
  project_message_read: "Lästa projektchattar",
  task: "Uppgifter",
  task_event: "Händelser på uppgifter",
  task_link: "Kopplingar på uppgifter",
  task_member: "Inbjudna i uppgifter",
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
  sick_note: "Anteckningar vid sjukfrånvaro",
  sick_report: "Sjukanmälningar",
  staffing_cap: "Bemanningstak",
  team: "Team",
  time_event: "Stämplingar",
  work_schedule: "Arbetsscheman",
  work_time_journal: "Arbetstidsjournalen",
  // Nav 2.0 (2026-10-21): resten av tabellerna med en nyckel mot employee, ur pg_constraint samma dag.
  absence_proposal: "Förslag på frånvaroperioder",
  buyout_commission_rate: "Provisionssatser vid utköp",
  calendar_attendee: "Deltagare i möten",
  calendar_event: "Möten och kalenderhändelser",
  calendar_series: "Återkommande möten",
  calendar_share: "Delade kalendrar",
  calendar_undo: "Ångra i kalendern",
  candidate_booking: "Bokningar med kandidater",
  candidate_merit_request: "Meritförfrågningar till kandidater",
  candidate_message: "Meddelanden till kandidater",
  candidate_note: "Anteckningar om kandidater",
  case_outcome: "Utfall i ärenden",
  coaching_drill: "Övningar i coachningen",
  coaching_meeting_request: "Önskemål om coachningssamtal",
  coaching_message: "Meddelanden i coachningen",
  coaching_person_focus: "Fokusområden i coachningen",
  coaching_task_note: "Anteckningar på coachningsuppgifter",
  commission_entry_reversal: "Återförda provisionsposter",
  commission_history: "Provisionshistorik",
  course_wish: "Kursönskemål",
  customer_note_pin: "Fästa kundanteckningar",
  delivery: "Leveranser",
  delivery_handoff: "Överlämningar till leveransen",
  document_area_watch: "Bevakade rutinområden",
  document_feedback: "Återkoppling på rutiner",
  document_note: "Egna anteckningar i rutiner",
  document_run: "Använda rutiner",
  document_saved: "Sparade rutiner",
  document_view_log: "Visningsloggen för rutiner",
  employee_access_level: "Nivån i Nav",
  employee_onboarding: "Onboardinguppgifter",
  error_occurrence: "Förekomster av fel",
  error_report_follower: "Bevakare av felrapporter",
  error_report_message: "Meddelanden i felrapporter",
  essay_return: "Prov som skickats tillbaka",
  essay_submission: "Inlämnade prov",
  finance_rate: "Finansavgifter",
  hr_case_attachment: "Bilagor i personalärenden",
  hr_case_confirmation: "Bekräftelser i personalärenden",
  hr_case_link: "Kopplingar i personalärenden",
  hr_case_read: "Lästa personalärenden",
  hr_case_reminder: "Påminnelser i personalärenden",
  interview_slot: "Intervjutider",
  landing_page_report: "Rapporterade landningssidor",
  lead: "Leads",
  lead_event: "Händelser på leads",
  learning_answer: "Svar i repetitionen",
  learning_note: "Anteckningar i utbildningen",
  learning_rule: "Egna regler i utbildningen",
  lecture: "Föreläsningar",
  lecture_followup: "Uppföljningar av föreläsningar",
  lecture_question: "Frågor till föreläsningar",
  lecture_signup: "Anmälningar till föreläsningar",
  manager_commission_rate: "Säljchefens provisionssatser",
  module_rating: "Betyg på utbildningsmoduler",
  nav_preference: "Egna inställningar i Nav",
  nav_setting: "Navets inställningar",
  news_ack: "Kvitterade nyheter",
  notification_event: "Notiser",
  onboarding_rule: "Regler för on- och offboarding",
  onboarding_template: "Checklistor för on- och offboarding",
  onboarding_template_item: "Punkter i checklistorna",
  one_on_one_item: "Punkter i enskilda samtal",
  one_on_one_point: "Att ta upp i enskilda samtal",
  order_grattis: "Grattis på order",
  order_list_seen: "Sedda orderlistor",
  order_manager_commission: "Säljchefens provision på order",
  payroll_period_sent: "Skickade lönerapporter",
  phone_call: "Samtal i växeln",
  phone_identity: "Kopplingar till växeln",
  push_sent: "Skickade pushnotiser",
  push_subscription: "Enheter för pushnotiser",
  recruitment_goal: "Rekryteringsmål",
  recruitment_position: "Tjänster i rekryteringen",
  recruitment_template: "Mallar i rekryteringen",
  roleplay_self: "Egna bedömningar av rollspel",
  sales_order_service: "Tilläggstjänster på order",
  sales_target: "Säljmål",
  sick_signal_ack: "Kvitterade sjuksignaler",
  task_day: "Planerade dagar",
  task_focus: "Dagens fokus",
  task_series: "Återkommande uppgifter",
  task_template: "Uppgiftsmallar",
  team_repetition: "Repetition för teamet",
  tid_view_log: "Visningsloggen för Tid",
  time_day_ack: "Kvitterade dagar i Tid",
  time_week_check: "Veckokontroller i Tid",
  vacation_wish_round: "Semesteromgångar",
  weekly_review: "Veckogenomgångar",
  work_schedule_seen: "Sedda arbetsscheman",
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

/**
 * S09 (F1-5, C7): en fil i lagringen vars rad forsvann med personen.
 *
 * `ta_bort_anstalld()` raderar raderna i databasen men ror inte lagringen.
 * Lakarintyget foljer sjukanmalan i kaskad och ärendebilagan foljer arendet,
 * och filerna lag kvar utan nagon rad som pekade pa dem. Ingen kunde hitta dem
 * for ett utdrag eller radera dem (art. 17). Raderingen samlar darfor
 * filerna fore (`personal-radering-server.ts`) och tar bort innehallet for de
 * rader som inte langre finns efter. Det som star kvar (avtal, inspelningar
 * till en order: foretagets underlag, 0170) rors inte.
 */
export type Lagringsrad = {
  id: string;
  tabell: "file_object" | "hr_case_attachment";
  store: string;
  bucket: string;
  path: string;
};

/** Raderna som fanns fore raderingen men inte efter. `kvar` innehaller `tabell|id`. */
export function forsvunna(fore: Lagringsrad[], kvar: Set<string>): Lagringsrad[] {
  return fore.filter((r) => !kvar.has(`${r.tabell}|${r.id}`));
}
