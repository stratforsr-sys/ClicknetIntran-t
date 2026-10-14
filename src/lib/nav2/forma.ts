/**
 * Nav 2.0: databasens rader i den form utkastet ritar.
 *
 * Ren logik, inga importer — samma skal som `lonekostnad.ts`. Filen kors bade
 * av route handlern i Next och av provet lokalt mot riktig data, sa att det
 * som provas ar exakt det som skickas.
 *
 * ===========================================================================
 * TRE ROLLER (beslut 2026-10-14). Befattningen i `employee_role` star kvar och
 * styr checklistor och utskick. Behorigheten i utkastet raknas fram ur den:
 *   superadmin — ceo, admin
 *   admin      — sales_manager, team_lead, finance, project_manager, delivery
 *   saljare    — salesperson
 * Leverans ar admin tills vidare (beslut 2026-10-14). Den hogsta vinner.
 * ===========================================================================
 */

export type Niva = "salesperson" | "admin" | "superadmin";

const NIVA_FRAN: Record<string, Niva> = {
  ceo: "superadmin",
  admin: "superadmin",
  sales_manager: "admin",
  team_lead: "admin",
  finance: "admin",
  project_manager: "admin",
  delivery: "admin",
  salesperson: "salesperson",
};
const ORDNING: Niva[] = ["salesperson", "admin", "superadmin"];

export function nivaFor(roller: string[]): Niva {
  let basta: Niva = "salesperson";
  for (const r of roller) {
    const n = NIVA_FRAN[r] ?? "salesperson";
    if (ORDNING.indexOf(n) > ORDNING.indexOf(basta)) basta = n;
  }
  return basta;
}

export type RaPerson = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  status: string;
  employment_type: string;
  start_date: string | null;
  end_date: string | null;
  employee_number: string | number | null;
  last_sign_in_at: string | null;
  birth_year: number | null;
  team_id: string | null;
  manager_id: string | null;
  roller: string[];
};

export type NdPerson = {
  id: string;
  namn: string;
  fornamn: string;
  efternamn: string;
  epost: string;
  roller: string[];
  niva: Niva | null;
  team: string;
  teamId: string | null;
  chef: string | null;
  chefId: string | null;
  form: string;
  start: string;
  slut: string | null;
  nr: string;
  senast: string | null;
  status: string;
  fodelsear: number | null;
};

/** "Zen " ar ett riktigt namn i registret: efternamnet ar tomt. Inga dubbla mellanslag. */
export function heltNamn(fornamn: string, efternamn: string): string {
  return [fornamn, efternamn].map((s) => (s ?? "").trim()).filter(Boolean).join(" ");
}

export function formaPerson(
  p: RaPerson,
  team: Map<string, string>,
  namn: Map<string, string>,
): NdPerson {
  const fornamn = (p.first_name ?? "").trim();
  const efternamn = (p.last_name ?? "").trim();
  return {
    id: p.id,
    namn: heltNamn(fornamn, efternamn),
    fornamn,
    efternamn,
    epost: p.email ?? "",
    roller: p.roller,
    niva: p.status === "offboarded" ? null : nivaFor(p.roller),
    team: p.team_id ? (team.get(p.team_id) ?? "") : "",
    teamId: p.team_id,
    chef: p.manager_id ? (namn.get(p.manager_id) ?? null) : null,
    chefId: p.manager_id,
    form: p.employment_type,
    start: p.start_date ?? "",
    slut: p.end_date,
    nr: p.employee_number === null || p.employee_number === undefined ? "" : String(p.employee_number),
    senast: p.last_sign_in_at ? p.last_sign_in_at.slice(0, 10) : null,
    status: p.status,
    fodelsear: p.birth_year ?? null,
  };
}

export type RaSats = {
  id: string;
  kind: string;
  applies_to: string | null;
  unit: string;
  value: number | string;
  valid_from: string;
  valid_to: string | null;
  owner_id: string | null;
  review_due: string | null;
  note: string | null;
  created_at: string;
  created_by: string | null;
};

export type NdSats = {
  id: string;
  kind: string;
  applies: string | null;
  unit: string;
  value: number;
  fran: string;
  till: string | null;
  agare: string | null;
  oversyn: string | null;
  note: string | null;
  skapad: string;
  av: string | null;
};

export function formaSats(r: RaSats, namn: Map<string, string>): NdSats {
  return {
    id: r.id,
    kind: r.kind,
    applies: r.applies_to,
    unit: r.unit,
    value: Number(r.value),
    fran: r.valid_from,
    till: r.valid_to,
    agare: r.owner_id ? (namn.get(r.owner_id) ?? null) : null,
    oversyn: r.review_due,
    note: r.note,
    skapad: (r.created_at ?? "").slice(0, 10),
    av: r.created_by ? (namn.get(r.created_by) ?? null) : null,
  };
}

export type RaLon = {
  id: string;
  employee_id: string;
  monthly_salary: number | string;
  valid_from: string;
  entered_at: string;
  entered_by: string | null;
};

export type NdLon = { id: string; pid: string; belopp: number; fran: string; inlagd: string; av: string };

export function formaLon(r: RaLon, namn: Map<string, string>): NdLon {
  return {
    id: r.id,
    pid: r.employee_id,
    belopp: Number(r.monthly_salary),
    fran: r.valid_from,
    inlagd: (r.entered_at ?? "").slice(0, 10),
    av: r.entered_by ? (namn.get(r.entered_by) ?? "Okänd") : "Okänd",
  };
}
