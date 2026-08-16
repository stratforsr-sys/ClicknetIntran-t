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
 */
export const MFA_REQUIRED_ROLES: Role[] = ["sales_manager", "ceo", "finance", "admin"];

export const PERMISSIONS = ["payroll_cost_viewer"] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_LABEL: Record<Permission, string> = {
  payroll_cost_viewer: "Lönekostnad (M13)",
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
