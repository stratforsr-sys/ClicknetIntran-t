/** PRD §5.1. Ordningen styr hur roller visas i granssnittet. */
export const ROLES = [
  "sales_manager",
  "ceo",
  "team_lead",
  "salesperson",
  "finance",
  "project_manager",
  "delivery",
  "admin",
] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  sales_manager: "Säljchef",
  ceo: "VD",
  team_lead: "Teamledare",
  salesperson: "Säljare",
  finance: "Ekonomi",
  project_manager: "Projektledare",
  delivery: "Leverans",
  admin: "Administratör",
};

/**
 * PRD §5.1: MFA ar obligatoriskt for chefs- och ekonomiroller samt for alla med
 * payroll_cost_viewer (AC-1.1, K33).
 *
 * AVSTANGT 2026-08-16. Listan ar tom med flit, inte av forbiseende: mejlmallen
 * bar an sa lange bara en lank och ingen kod, sa ett pakopplat krav hade last
 * ute precis de roller det skulle skydda. Inloggning sker med losenord tills
 * vidare.
 *
 * Sla pa igen genom att satta tillbaka rollerna nedan. Ingenting annat behover
 * roras — spärren, kodsidan och kvittot star kvar och testas.
 *
 *   ["sales_manager", "ceo", "finance", "admin"]
 *
 * Forutsattningen ar DRIFTSATTNING punkt 0: {{ .Token }} i mallen och egen
 * SMTP. K33 ar alltsa inte uppfylld sa lange listan ar tom.
 */
export const MFA_REQUIRED_ROLES: Role[] = [];

/**
 * Behorigheter som INTE foljer av en roll.
 *
 * Listan speglar check-villkoret pa `employee_permission.permission` (0001,
 * utokad i 0030). Lagger du till en har maste du lagga till den dar ocksa —
 * annars nekar databasen tilldelningen och granssnittet ser ut att ha gatt
 * sonder.
 */
export const PERMISSIONS = ["payroll_cost_viewer", "recruiter", "attendance_approver"] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_LABEL: Record<Permission, string> = {
  payroll_cost_viewer: "Lönekostnad (M13)",
  recruiter: "Rekryterare (M7)",
  attendance_approver: "Besluta om ogiltig frånvaro (E13)",
};

export const EMPLOYMENT_TYPE_LABEL: Record<string, string> = {
  permanent: "Tillsvidare",
  probation: "Provanställd",
  consultant: "Konsult",
  intern: "Praktikant",
};

export const STATUS_LABEL: Record<string, string> = {
  active: "Aktiv",
  onboarding: "Onboarding",
  offboarded: "Avslutad",
};
