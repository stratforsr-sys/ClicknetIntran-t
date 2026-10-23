/**
 * F1-2. I vilken ordning registerutdragets kallor las.
 *
 * Utdraget laser varje tabell sidvis (`lasSidvis`), och sidorna maste komma ur
 * en ordning pa en unik nyckel. Annars kan en rad hamna pa tva sidor eller pa
 * ingen. Ordningen ar tabellens primarnyckel: `id` for de flesta, och
 * kolumnerna nedan for resten.
 *
 * Ligger i en egen fil och inte i `registerutdrag-server.ts`, for `server-only`
 * gar inte att importera i ett prov. `tests/registerutdrag.mjs` jamfor listan
 * med databasens primarnycklar, sa en ny kalla utan `id` marks dar.
 *
 * Listan tar aven med kallor som annu bara finns pa Nav 2.0-grenen. En rad for
 * en tabell som inte las ar ofarlig; en rad som saknas nar grenen mergas ger
 * en kalla som inte gar att lasa.
 */
export const ORDNING: Record<string, readonly string[]> = {
  activity_day: ["employee_id", "day"],
  break_deviation_month: ["employee_id", "month", "kind"],
  break_schedule_ack: ["schedule_id", "employee_id"],
  calendar_share: ["owner_id", "viewer_id"],
  commission_history: ["employee_id", "period_month"],
  delivery: ["order_id"],
  delivery_handoff: ["order_id"],
  document_ack: ["document_id", "employee_id", "version"],
  document_area_watch: ["employee_id", "area"],
  document_note: ["employee_id", "document_id"],
  document_saved: ["employee_id", "document_id"],
  document_view: ["document_id", "employee_id"],
  employee_access_level: ["employee_id"],
  employee_onboarding: ["employee_id"],
  employee_permission: ["employee_id", "permission"],
  employee_role: ["employee_id", "role"],
  error_report_follower: ["error_id", "employee_id"],
  guide_progress: ["employee_id", "guide_slug"],
  hr_case_confirmation: ["case_id"],
  hr_case_read: ["case_id", "employee_id"],
  late_arrival_month: ["employee_id", "month"],
  learning_note: ["employee_id", "key"],
  lecture_followup: ["lecture_id", "employee_id", "step"],
  lecture_signup: ["lecture_id", "employee_id"],
  module_progress: ["employee_id", "module_id"],
  module_rating: ["employee_id", "module_id"],
  nav_preference: ["employee_id", "key"],
  news_ack: ["post_id", "employee_id"],
  notification_dismissed: ["employee_id", "notice_id"],
  notification_seen: ["employee_id"],
  order_grattis: ["order_id", "employee_id"],
  order_list_seen: ["employee_id"],
  order_manager_commission: ["order_id"],
  project_member: ["project_id", "employee_id"],
  project_message_read: ["project_id", "employee_id"],
  push_sent: ["employee_id", "kind", "day"],
  roleplay_self: ["employee_id", "criterion_id"],
  sick_signal_ack: ["employee_id"],
  task_day: ["employee_id", "dag"],
  task_focus: ["employee_id", "dag", "position"],
  task_member: ["task_id", "employee_id"],
  time_day_ack: ["employee_id", "work_date", "kind"],
  time_week_check: ["employee_id", "week_start"],
  work_schedule_seen: ["employee_id", "valid_from"],
};

/** Tabellerna utdraget laser utover KALLOR: via arendet, uppgiften, filen och fran bada hallen. */
export const LASES_AVEN = ["case_message", "task_event", "file_access_log", "audit_log", "calendar_share"] as const;

export function ordningFor(tabell: string): readonly string[] {
  return ORDNING[tabell] ?? ["id"];
}
