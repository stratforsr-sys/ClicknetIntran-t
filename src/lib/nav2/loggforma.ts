/**
 * Händelseloggen i Nav 2.0: raderna i utkastets form (`RLSLOGG` i moduler/rls.js).
 * Ren logik, inga importer utom typindelningen, så att den går att prova utan databas.
 *
 * ===========================================================================
 * RADEN SÄGER VAD SOM HÄNDE, VEM SOM GJORDE DET OCH VAD DET GÄLLDE. INTE MER.
 *
 * Utkastets rad är [dag, klockslag, typ, rubrik, vem, objekt]. Rubriken är en
 * svensk mening per action, typen är repots (`typFor`), och färgen säger typ,
 * aldrig allvar.
 *
 * Objektet byggs bara av sådant som redan står öppet i navet för den som får
 * läsa loggen: namn, en rutins eller kurs rubrik, ett företagsnamn, ett antal.
 * Aldrig `reason`, aldrig fritext ur `meta`, aldrig ett belopp:
 *   - ett personalärendes rubrik står bara i ärendet,
 *   - frånvarons detaljer står i Frånvaro, och en sjukanmälan heter
 *     "Frånvaro" här, så att raden inte säger något om hälsa,
 *   - lönekostnad, löner och provision står i sina vyer.
 * Ett personnummer som ändå hamnat i en rubrik maskeras.
 * ===========================================================================
 */
import { modulNamn, typFor, type Handelsetyp } from "@/lib/handelselogg";

export type RaHandelse = {
  id: number | string;
  actor_id: string | null;
  action: string;
  object_type: string | null;
  object_id: string | null;
  ts: string;
  meta: Record<string, unknown> | null;
};

/** En öppnad fil (`file_access_log`, K36): en inspelning, ett avtal, en bilaga. */
export type RaFilvisning = { id: number | string; file_id: string; actor_id: string | null; action: string; purpose: string | null; ts: string };
export type RaFil = { id: string; purpose: string; subject_employee_id: string | null; sales_order_id: string | null };

/** Det som slås upp för objekten. Allt är läst med den inloggades RLS. */
export type Uppslag = {
  namn: Map<string, string>;
  order: Map<string, string>;
  lead: Map<string, string>;
  rutin: Map<string, string>;
  nyhet: Map<string, string>;
  kurs: Map<string, string>;
  team: Map<string, string>;
  avtal: Map<string, string>;
  fel: Map<string, { titel: string | null; ganger: number }>;
  kandidat: Map<string, string>;
  lonperiod: Map<string, string>;
  fil: Map<string, RaFil>;
};

export type NdLoggRad = [string, string, Handelsetyp, string, string, string];
export type NdLogg = {
  /** Utkastets RLSLOGG: senaste först. */
  rader: NdLoggRad[];
  /** Utkastets RLSDAG: dagens rubrik, "I dag, tisdag 20 oktober". */
  dagar: Record<string, string>;
};

/**
 * Hur långt bakåt loggen går: i dag och de sex dagarna före, i svenska
 * kalenderdygn (beställaren 2026-10-20: "det räcker med 7 dagar för nu").
 * Taket skyddar bara mot en ovanligt stökig vecka; en vanlig vecka är ett
 * hundratal rader.
 */
export const LOGG_DAGAR = 7;
export const LOGG_TAK = 1000;

/**
 * Öppningar i en följd blir en rad (beställaren 2026-10-20): samma person och
 * samma fil, eller samma persons inspelningar på samma order (en order kan ha
 * flera samtal), där varje öppning kommer inom så här många minuter efter den
 * förra. Raden får klockslaget då följden började, och för inspelningarna
 * hur många samtal det var.
 */
export const SAMMA_LASNING_MIN = 10;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const arUuid = (s: unknown): s is string => typeof s === "string" && UUID.test(s);

/* ---------- Rubriken ---------- */

const RUBRIK: Record<string, string> = {
  "absence.approved": "Frånvaro beviljad",
  "absence.balance_entered": "Saldo inmatat",
  "absence.blackout_added": "Spärrperiod tillagd",
  "absence.blackout_removed": "Spärrperiod borttagen",
  "absence.call_order_changed": "Ringordning ändrad",
  "absence.cancelled": "Frånvaro makulerad",
  "absence.cap_changed": "Frånvarotak ändrat",
  "absence.policy_changed": "Frånvaroregel ändrad",
  "absence.registered_for": "Frånvaro registrerad",
  "absence.rejected": "Frånvaro avslagen",
  "absence.requested": "Frånvaro ansökt",
  "absence.type_changed": "Frånvarotyp ändrad",
  "absence.withdrawn": "Frånvaro återtagen",
  "account.flagged_inactive": "Konto flaggat som oanvänt",
  "account.unflagged": "Kontots flagga borttagen",
  "anstallda.handelse": "Anställd uppdaterad",
  "attendance_incident.approved": "Frånvarohändelse beslutad",
  "attendance_incident.created": "Frånvarohändelse registrerad",
  "attendance_incident.rejected": "Frånvarohändelse avslagen",
  "attendance_incident.revoked": "Frånvarohändelse återkallad",
  "attendance_incident.suggested": "Frånvarohändelse föreslagen",
  "attendance_incident.viewed": "Sena och frånvaro öppnad",
  "attendance_incident.withdrawn": "Frånvarohändelse tillbakadragen",
  "auth.login": "Inloggning",
  "auth.logout": "Utloggning",
  "auth.login_failed": "Misslyckad inloggning",
  "auth.password_changed": "Lösenord bytt",
  "auth.temp_password_set": "Tillfälligt lösenord satt",
  "auth.step2_verified": "Enhet bekräftad",
  "auth.step2_failed": "Fel kod för enheten",
  "auth.step2_forgotten": "Enhet glömd",
  "calendar.feed_created": "Kalenderflöde skapat",
  "calendar.feed_revoked": "Kalenderflöde återkallat",
  "calendar.feed_rotated": "Kalenderflöde förnyat",
  "calendar.undone": "Kalenderhändelse ångrad",
  "candidate.created": "Kandidat registrerad",
  "candidate.hired": "Kandidat anställd",
  "case.assigned": "Ärende tilldelat",
  "case.closed_by_offboarding": "Ärende stängt vid avslut",
  "case.confirmed": "Ärende bekräftat löst",
  "case.created": "Ärende registrerat",
  "case.escalated": "Ärende över svarstiden",
  "case.reopened": "Ärende öppnat igen",
  "case.resolved": "Ärende avslutat",
  "case.status_changed": "Ärende ändrat",
  "case.unassigned_by_offboarding": "Ärende återlämnat vid avslut",
  "coaching_session.created": "Coachningssamtal registrerat",
  "coaching_task.cancelled": "Överenskommelse avbruten",
  "coaching_task.completed": "Överenskommelse klar",
  "coaching_task.created": "Överenskommelse skapad",
  "coaching_task.overdue": "Överenskommelse försenad",
  "coaching_task.rejected": "Överenskommelse underkänd",
  "coaching_template.applied": "Coachningsmall använd",
  "coaching_template.created": "Coachningsmall skapad",
  "commission.bonus": "Provisionstillägg bokat",
  "commission.bonus_removed": "Provisionstillägg borttaget",
  "commission.correction": "Provision rättad",
  "commission.efterslapning": "Efterslapande provision bokad",
  "commission.entered": "Provision bokförd",
  "commission.exported": "Provisionsunderlag exporterat",
  "commission.underlag_viewed": "Provisionsunderlag öppnat",
  "commission_bonus_level.closed": "Volymtrappa stängd",
  "commission_bonus_level.future_removed": "Kommande volymtrappa borttagen",
  "commission_bonus_level.set": "Volymtrappa satt",
  "commission_period.closed": "Provisionsperiod stängd",
  "commission_period.paid": "Provisionsperiod utbetald",
  "commission_period.reopened": "Provisionsperiod öppnad igen",
  "consequence_rule.removed": "Konsekvensregel borttagen",
  "consequence_rule.set": "Konsekvensregel satt",
  "contract.created": "Avtal skapat",
  "contract.draft_deleted": "Avtalsutkast raderat",
  "contract.file_added": "Avtal uppladdat",
  "contract.issued": "Avtal utfärdat",
  "contract.withdrawn": "Avtal tillbakadraget",
  "contract_template.archived": "Avtalsmall arkiverad",
  "contract_template.created": "Avtalsmall skapad",
  "contract_template.published": "Avtalsmall publicerad",
  "contract_template.updated": "Avtalsmall ändrad",
  "cost.birth_year_set": "Födelseår satt",
  "cost.calculated": "Lönekostnad beräknad",
  "cost.rate_review_due": "Sats behöver ses över",
  "cost.rate_set": "Sats satt",
  "cost.revenue_set": "Intäkt satt",
  "cost.salary_set": "Lön satt",
  "course.certified": "Certifikat utfärdat",
  "course.created": "Kurs skapad",
  "course.module_added": "Kursmodul tillagd",
  "course.quiz_failed": "Prov underkänt",
  "course.quiz_passed": "Prov godkänt",
  "course.renewed": "Certifikat förnyat",
  "course.status_changed": "Kurs ändrad",
  "course.updated": "Kurs ändrad",
  "customer.landing_page_reported": "Kampanjsida rapporterad",
  "customer.note_added": "Kundanteckning tillagd",
  "customer.note_pinned": "Kundanteckning fäst",
  "customer.note_unpinned": "Kundanteckning lossad",
  "deviation.commented": "Rastavvikelse kommenterad",
  "deviation.resolved": "Rastavvikelse avslutad",
  "deviation.viewed": "Rastavvikelser öppnade",
  "document.acked": "Rutin kvitterad",
  "document.archived": "Rutin arkiverad",
  "document.attachment_added": "Bilaga tillagd",
  "document.attachment_removed": "Bilaga borttagen",
  "document.created": "Rutin skapad",
  "document.draft_deleted": "Rutinutkast raderat",
  "document.published": "Rutin publicerad",
  "document.restored": "Rutin återställd",
  "document.reviewed": "Rutin granskad",
  "document.updated": "Rutin ändrad",
  "employee.activated": "Anställd aktiverad",
  "employee.created": "Anställd upplagd",
  "employee.data_export": "Registerutdrag uttaget",
  "employee.deleted": "Anställd raderad",
  "employee.employment_type": "Anställningsform ändrad",
  "employee.offboarded": "Anställning avslutad",
  "employee.onboarded": "Onboarding klar",
  "employee.org_changed": "Anställd flyttad i organisationen",
  "employee.status": "Anställds status ändrad",
  "error.ack": "Fel kvitterat",
  "error.assigned": "Fel tilldelat",
  "error.confirmed": "Fel bekräftat åtgärdat",
  "error.followed": "Fel följt",
  "error.new": "Fel fångat",
  "error.reopened": "Fel öppnat igen",
  "error.replied": "Fel besvarat",
  "error.unfollowed": "Fel inte längre följt",
  "error.workaround": "Tillfällig lösning skriven",
  "gate.disabled": "Spärr avstängd",
  "gate.document_linked": "Rutin kopplad till spärr",
  "gate.enabled": "Spärr påslagen",
  "guide.nudged": "Påminnelse om guide",
  "guide.onboarding_overdue": "Onboarding försenad",
  "job.night_ok": "Nattjobbet kördes",
  "job.night_partial": "Nattjobbet kördes med fel",
  "journal.exported": "Arbetstidsjournal exporterad",
  "journal.viewed": "Arbetstidsjournal öppnad",
  "kv_assessment.created": "K&V-bedömning gjord",
  "kv_assessment.updated": "K&V-bedömning ändrad",
  "kv_call.created": "K&V-samtal valt",
  "kv_criterion.set": "K&V-kriterium satt",
  "kv_policy.set": "K&V-regel satt",
  "late_arrival.commented": "Sen ankomst förklarad",
  "lead.assigned": "Lead tilldelat",
  "lead.created": "Lead inkommet",
  "lead.note_changed": "Leadanteckning ändrad",
  "lead.status_changed": "Lead ändrat",
  "lead.unassigned": "Lead återlämnat",
  "manager_commission_rate.set": "Chefens sats satt",
  "news.archived": "Nyhet arkiverad",
  "news.drafted": "Nyhet sparad som utkast",
  "news.published": "Nyhet publicerad",
  "news.unarchived": "Nyhet återställd",
  "offboarding.done": "Avslutspunkt klar",
  "offboarding.skipped": "Avslutspunkt hoppad över",
  "onboarding.courses_assigned": "Kurser tilldelade",
  "onboarding.documents_assigned": "Rutiner tilldelade",
  "onboarding.done": "Onboardingpunkt klar",
  "onboarding.schedule_assigned": "Arbetstid tilldelad",
  "onboarding.skipped": "Onboardingpunkt hoppad över",
  "payroll.adjusted": "Lönerapport justerad",
  "payroll.attested": "Lönerapport attesterad",
  "payroll.column_changed": "Lönerapportens kolumn ändrad",
  "payroll.exported": "Lönerapport exporterad",
  "payroll.generated": "Lönerapport framtagen",
  "payroll.period_created": "Löneperiod skapad",
  "payroll.sent": "Lönerapport skickad",
  "permission.granted": "Behörighet tilldelad",
  "permission.revoked": "Behörighet återkallad",
  "phone_call.transcript_read": "Samtalsutskrift läst",
  "prov.inlamnat": "Prov inlämnat",
  "role.granted": "Roll tilldelad",
  "role.revoked": "Roll återkallad",
  "sales_order.approved": "Order godkänd",
  "sales_order.attachment_added": "Avtal bifogat till order",
  "sales_order.attachment_removed": "Bilaga borttagen från order",
  "sales_order.call_linked": "Samtal kopplat till order",
  "sales_order.call_unlinked": "Samtal lossat från order",
  "sales_order.cancelled": "Order makulerad",
  "sales_order.cancelled_kept_in_crm": "Order makulerad, kvar i CRM",
  "sales_order.corrected": "Order rättad",
  "sales_order.deleted": "Order raderad",
  "sales_order.draft_created": "Orderutkast skapat",
  "sales_order.edited": "Order ändrad",
  "sales_order.not_renewed": "Order inte förnyad",
  "sales_order.override": "Chefens provision satt",
  "sales_order.override_failed": "Chefens provision kunde inte sättas",
  "sales_order.paid": "Order utbetald",
  "sales_order.prefilled": "Order förifylld",
  "sales_order.renewal_reopened": "Förnyelse öppnad igen",
  "sales_order.renewed": "Order förnyad",
  "sales_order.returned": "Order skickad tillbaka",
  "sales_order.submitted": "Order inskickad",
  "sales_target.removed": "Månadsmål borttaget",
  "sales_target.set": "Månadsmål satt",
  "schedule.break_acked": "Rast kvitterad",
  "schedule.break_set": "Raster satta",
  "schedule.work_set": "Arbetstid satt",
  // En sjukanmälan heter frånvaro här: raden får inte säga något om hälsa.
  "sick.cancelled": "Frånvaro makulerad",
  "sick.closed": "Frånvaro avslutad",
  "sick.confirmed": "Frånvaro bekräftad",
  "sick.deadline_done": "Frånvarofrist klar",
  "sick.escalated": "Frånvaro eskalerad",
  "sick.note_added": "Anteckning om frånvaro",
  "sick.registered": "Frånvaro anmäld",
  "task_series.created": "Uppgiftsserie skapad",
  "task_template.applied": "Uppgiftsmall använd",
  "task_template.created": "Uppgiftsmall skapad",
  "team.created": "Team skapat",
  "team.deleted": "Team raderat",
  "team.updated": "Team ändrat",
  "time.auto_closed": "Dag stängd av systemet",
  "time.correction_approved": "Rättelse godkänd",
  "time.correction_overdue": "Rättelse över tiden",
  "time.correction_rejected": "Rättelse avslagen",
  "time.correction_requested": "Rättelse begärd",
  "time.in": "Instämpling",
  "time.left_open": "Stämpling lämnad öppen",
  "time.out": "Utstämpling",
};

/** Ändelser som går att räkna fram när en action saknas ovan (repots /logg gör samma sak). */
const VERB: Record<string, string> = {
  created: "skapad", updated: "ändrad", deleted: "raderad", removed: "borttagen", added: "tillagd", set: "satt",
  closed: "stängd", granted: "tilldelad", revoked: "återkallad", published: "publicerad", archived: "arkiverad",
  approved: "godkänd", rejected: "avslagen", cancelled: "makulerad", resolved: "avslutad", assigned: "tilldelad",
  registered: "registrerad", submitted: "inlämnad", viewed: "öppnad", exported: "exporterad", paid: "betald",
};

export function rubrikFor(action: string): string {
  const fast = RUBRIK[action];
  if (fast) return fast;
  const andelse = action.split(".").slice(1).join(".");
  const verb = VERB[andelse];
  return verb ? `${modulNamn(action)} ${verb}` : `${modulNamn(action)} · ${andelse.replace(/_/g, " ")}`;
}

/* ---------- Objektet ---------- */

const ROLL: Record<string, string> = {
  sales_manager: "Säljchef", ceo: "VD", team_lead: "Teamledare", salesperson: "Säljare",
  finance: "Ekonomi", project_manager: "Projektledare", delivery: "Leverans", admin: "Administratör",
};
const BEHORIGHET: Record<string, string> = {
  payroll_cost_viewer: "Lönekostnad", recruiter: "Rekryterare", attendance_approver: "Besluta om ogiltig frånvaro",
};
const FORM: Record<string, string> = { permanent: "Tillsvidare", probation: "Provanställd", consultant: "Konsult", intern: "Praktikant" };
const MANAD = ["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"];
const VECKODAG = ["söndag", "måndag", "tisdag", "onsdag", "torsdag", "fredag", "lördag"];

/** "2026-10-01" → "oktober 2026". */
function manad(s: unknown): string | null {
  const m = typeof s === "string" ? /^(\d{4})-(\d{2})/.exec(s) : null;
  return m ? `${MANAD[+m[2] - 1]} ${m[1]}` : null;
}
/** "2026-10-07" → "7 oktober". */
function datum(s: unknown): string | null {
  const m = typeof s === "string" ? /^(\d{4})-(\d{2})-(\d{2})/.exec(s) : null;
  return m ? `${+m[3]} ${MANAD[+m[2] - 1]}` : null;
}
const tal = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && /^\d+$/.test(v) ? +v : null);
const st = (n: number, en: string, fler: string) => `${n} ${n === 1 ? en : fler}`;

/** Ett personnummer i en rubrik eller ett namn visas aldrig, vem som än skrev det. */
export function maskera(s: string): string {
  return s.replace(/\b(?:19|20)?\d{6}[-+ ]?\d{4}\b/g, "••••••-••••");
}

const FRANVARO = "Detaljerna står i Frånvaro";
const TID = "Detaljerna står i Tid";

function objekt(r: RaHandelse, u: Uppslag): string {
  const m = (r.meta ?? {}) as Record<string, unknown>;
  const [prefix, andelse = ""] = r.action.split(".");
  const id = r.object_id ?? "";
  const person = (pid: unknown): string | null => (typeof pid === "string" && u.namn.get(pid)) || null;
  const objPerson = r.object_type === "employee" ? person(id) : null;
  const medPerson = (text: string, pid: unknown) => { const n = person(pid); return n ? `${text} · ${n}` : text; };

  // Frånvaro och sjukanmälan: bara att något hände. Detaljerna står i Frånvaro.
  if (prefix === "sick" || r.object_type === "sick_report" || r.object_type === "sick_deadline" || r.object_type === "absence_request") return FRANVARO;
  if (prefix === "absence") {
    if (andelse === "balance_entered") return medPerson("Saldo", r.object_type === "employee" ? id : m.employee_id);
    return "Frånvaroreglerna";
  }
  // Personalärenden: rubriken står bara i ärendet.
  if (prefix === "case" || r.object_type === "hr_case") return "Personalärende · rubriken visas bara i ärendet";

  switch (prefix) {
    case "auth": {
      if (andelse === "login") return m.metod === "lank" ? "Med länk" : "Med lösenord";
      if (andelse === "login_failed") return typeof m.orsak === "string" && m.orsak ? maskera(m.orsak.replace(/\.[\s\S]*$/, "")) : "Inloggningen misslyckades";
      if (andelse === "step2_verified") { const d = tal(m.dygn); return d ? `Ny enhet · gäller i ${d} dagar` : "Ny enhet"; }
      if (andelse === "temp_password_set") return objPerson ?? "En anställd";
      if (andelse === "password_changed") return m.tvingat ? "Bytt vid första inloggningen" : "Eget konto";
      return "Eget konto";
    }
    case "role": { const roll = typeof m.roll === "string" ? ROLL[m.roll] ?? m.roll : "Roll"; return objPerson ? `${roll} · ${objPerson}` : roll; }
    case "permission": { const b = typeof m.behorighet === "string" ? BEHORIGHET[m.behorighet] ?? m.behorighet : "Behörighet"; return objPerson ? `${b} · ${objPerson}` : b; }
    case "employee": {
      if (andelse === "deleted") return "Personen är borttagen ur Nav";
      if (andelse === "data_export") return m.egen ? "Egna uppgifter · en fil" : `${objPerson ?? "En anställd"} · en fil`;
      if (andelse === "employment_type" && typeof m.till === "string") return `${objPerson ?? "En anställd"} · ${FORM[m.till] ?? m.till}`;
      if (andelse === "created" && typeof m.roll === "string") return `${objPerson ?? "En anställd"} · ${ROLL[m.roll] ?? m.roll}`;
      return objPerson ?? "En anställd";
    }
    case "onboarding":
    case "offboarding": {
      const pid = r.object_type === "employee" ? id : m.employeeId ?? m.employee_id;
      const n = tal(m.antal);
      if (andelse === "courses_assigned" && n !== null) return medPerson(st(n, "kurs", "kurser"), pid);
      if (andelse === "documents_assigned" && n !== null) return medPerson(st(n, "rutin", "rutiner"), pid);
      return person(pid) ?? (prefix === "onboarding" ? "Onboarding" : "Avslut");
    }
    case "anstallda": return objPerson ?? "En anställd";
    case "account": return objPerson ?? "Ett konto";
    case "time": {
      if (andelse === "in" || andelse === "out") return m.i_efterhand && m.i_efterhand !== "0" && m.i_efterhand !== 0 ? "I efterhand" : "I Nav";
      if (andelse === "auto_closed" || andelse === "left_open") { const d = datum(m.datum); return objPerson ? (d ? `${objPerson} · ${d}` : objPerson) : TID; }
      return TID;
    }
    case "schedule": return andelse === "break_acked" ? "Rasten" : "Schemat";
    case "attendance_incident": {
      if (andelse === "viewed") return "Kön i Tid";
      const n = person(m.employee_id), d = datum(m.datum);
      return n ? (d ? `${n} · ${d}` : n) : TID;
    }
    case "late_arrival":
    case "deviation":
    case "journal":
      return TID;
    case "sales_order": {
      const namn = u.order.get(id) ?? (typeof m.company_name === "string" ? m.company_name : null);
      return namn ? `Order till ${maskera(namn)}` : "En order";
    }
    case "customer": return andelse === "landing_page_reported" ? "Kampanjsidan" : "Kundkortet";
    case "phone_call": return "Säljsamtal · utskriften";
    case "lead": {
      const namn = u.lead.get(id);
      const till = andelse === "assigned" ? person(m.till ?? m.assigned_to ?? m.employee_id) : null;
      return `${namn ? maskera(namn) : "Ett lead"}${till ? ` till ${till}` : ""}`;
    }
    case "document": return maskera(u.rutin.get(id) ?? (typeof m.titel === "string" ? m.titel : "En rutin"));
    case "news": return maskera(u.nyhet.get(id) ?? "En nyhet");
    case "course":
    case "prov":
      return maskera(u.kurs.get(id) ?? (typeof m.titel === "string" ? m.titel : "En kurs"));
    case "team": return maskera(u.team.get(id) ?? (typeof m.namn === "string" ? m.namn : "Ett team"));
    case "contract": return medPerson("Anställningsavtal", u.avtal.get(id));
    case "contract_template": return "Avtalsmallarna";
    case "candidate": {
      if (andelse === "hired") return person(m.employee_id) ?? "En kandidat";
      const roll = u.kandidat.get(id);
      return roll ? `Kandidat · ${maskera(roll)}` : "En kandidat";
    }
    case "error": {
      const f = u.fel.get(id);
      const titel = f?.titel ? maskera(f.titel) : "En felrapport";
      return f && f.ganger > 1 ? `${titel} · ${f.ganger} gånger` : titel;
    }
    case "job": {
      const res = m.resultat && typeof m.resultat === "object" ? Object.keys(m.resultat as object).length : 0, s = Number(m.sekunder), sek = Number.isFinite(s) && s >= 0 ? Math.max(1, Math.round(s)) : null;
      return [res ? st(res, "steg", "steg") : null, sek !== null ? st(sek, "sekund", "sekunder") : null].filter(Boolean).join(" · ") || "Nattjobbet";
    }
    case "payroll": {
      if (andelse === "column_changed") return "Lönerapportens kolumner";
      return u.lonperiod.get(id) ?? "Löneperioden";
    }
    case "commission_period": return `Provision för ${manad(m.period_month ?? id) ?? "en månad"}`;
    case "commission": {
      if (r.object_type === "commission_period") return `Provision för ${manad(m.period_month ?? id) ?? "en månad"}`;
      const n = person(m.employee_id), mn = manad(m.period_month);
      return [n, mn].filter(Boolean).join(" · ") || "Provisionen";
    }
    case "commission_bonus_level": return "Volymtrappan";
    case "manager_commission_rate": return person(m.employee_id ?? m.manager_id) ?? "Chefens sats";
    case "sales_target": { const n = person(m.employee_id), mn = manad(m.period_month); return [n, mn].filter(Boolean).join(" · ") || "Månadsmålet"; }
    case "coaching_task":
    case "coaching_session":
      return person(m.assignee_id ?? m.employee_id) ?? "Coachning";
    case "coaching_template": return "Coachningsmallarna";
    case "task_series": return "Uppgifter";
    case "task_template": return "Uppgiftsmallarna";
    case "kv_call": return person(m.employee_id) ?? "K&V";
    case "kv_assessment": return "K&V-samtalet";
    case "kv_criterion":
    case "kv_policy":
      return "K&V-reglerna";
    case "consequence_rule": return "Konsekvenstrappan";
    case "gate": return "Spärrarna";
    case "cost": return objPerson ?? "Lönekostnaden";
    case "calendar": return m.scope === "mine" ? "Eget kalenderflöde" : "Kalendern";
    case "guide": return objPerson ?? person(m.employee_id) ?? "Guiderna";
  }
  return objPerson ?? modulNamn(r.action);
}

/** Vem: den som gjorde det, Nav när ingen gjorde det, Okänd när ett inloggningsförsök inte hör till något konto. */
function vem(actor: string | null, prefix: string, u: Uppslag): string {
  if (!actor) return prefix === "auth" ? "Okänd" : "Nav";
  return u.namn.get(actor) ?? "Okänd";
}

/* ---------- Filerna ---------- */

function filRad(f: RaFilvisning, u: Uppslag, antal = 1): { rubrik: string; objekt: string } {
  const fil = u.fil.get(f.file_id);
  const andamal = fil?.purpose ?? f.purpose ?? "";
  const om = fil?.subject_employee_id ? u.namn.get(fil.subject_employee_id) ?? null : null;
  switch (andamal) {
    case "call_recording": {
      const kund = fil?.sales_order_id ? u.order.get(fil.sales_order_id) : undefined;
      const samtal = antal > 1 ? `${antal} säljsamtal` : "Säljsamtal";
      return { rubrik: "Inspelning öppnad", objekt: kund ? `${samtal} · order till ${maskera(kund)}` : fil?.sales_order_id ? `${samtal} till en order` : om ? `${samtal} · ${om}` : samtal };
    }
    case "employment_contract": return { rubrik: "Avtal öppnat", objekt: om ? `Anställningsavtal · ${om}` : "Anställningsavtal" };
    case "sales_order": return { rubrik: "Avtal öppnat", objekt: fil?.sales_order_id && u.order.get(fil.sales_order_id) ? `Order till ${maskera(u.order.get(fil.sales_order_id) as string)}` : "Avtal på en order" };
    case "roleplay": return { rubrik: "Testsamtal öppnat", objekt: om ? `Rollspel · ${om}` : "Rollspel" };
    case "coaching": return { rubrik: "Fil öppnad", objekt: om ? `Coachning · ${om}` : "Coachning" };
    case "document_attachment": return { rubrik: "Bilaga öppnad", objekt: "En rutin" };
    // Ett intyg säger något om hälsa: bara att en bilaga till frånvaron öppnades.
    case "sick_certificate": return { rubrik: "Bilaga öppnad", objekt: FRANVARO };
  }
  return { rubrik: "Fil öppnad", objekt: "En fil" };
}

export type Filfoljd = { f: RaFilvisning; filer: Set<string> };

/** Öppningarna i följder: den första öppningen i varje följd, och vilka filer följden öppnade. */
export function slaIhopFiler(filer: RaFilvisning[], u: Uppslag): Filfoljd[] {
  const oppen = new Map<string, { foljd: Filfoljd; sist: number }>();
  const kvar: Filfoljd[] = [];
  for (const f of [...filer].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))) {
    const fil = u.fil.get(f.file_id), order = (fil?.purpose ?? f.purpose) === "call_recording" ? fil?.sales_order_id : null;
    const nyckel = `${f.actor_id ?? ""}|${f.action}|${order ? `o${order}` : `f${f.file_id}`}`, t = Date.parse(f.ts), o = oppen.get(nyckel);
    if (o && t - o.sist <= SAMMA_LASNING_MIN * 60000) { o.foljd.filer.add(f.file_id); o.sist = t; continue; }
    const foljd = { f, filer: new Set([f.file_id]) };
    oppen.set(nyckel, { foljd, sist: t });
    kvar.push(foljd);
  }
  return kvar;
}

/* ---------- Dagen ---------- */

const plusDagar = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/** "I dag, tisdag 20 oktober", "I går, måndag 19 oktober", "Söndag 18 oktober", "Måndag 29 december 2025". */
export function dagRubrik(d: string, idag: string): string {
  const v = VECKODAG[new Date(`${d}T12:00:00Z`).getUTCDay()], dt = datum(d) as string, ar = d.slice(0, 4) === idag.slice(0, 4) ? "" : ` ${d.slice(0, 4)}`;
  if (d === idag) return `I dag, ${v} ${dt}`;
  if (d === plusDagar(idag, -1)) return `I går, ${v} ${dt}`;
  return `${v[0].toUpperCase()}${v.slice(1)} ${dt}${ar}`;
}

/* ---------- Hela loggen ---------- */

type Tid = { dag: (ts: string) => string; klocka: (ts: string) => string };

export function formaLogg(handelser: RaHandelse[], filer: RaFilvisning[], u: Uppslag, idag: string, tid: Tid): NdLogg {
  const alla: { ts: string; nyckel: string; rad: () => NdLoggRad | null }[] = [
    ...handelser.map((r) => ({
      ts: r.ts,
      nyckel: `a${String(r.id).padStart(12, "0")}`,
      rad: (): NdLoggRad | null => {
        const typ = typFor(r.action);
        return typ ? [tid.dag(r.ts), tid.klocka(r.ts), typ, rubrikFor(r.action), vem(r.actor_id, r.action.split(".")[0], u), objekt(r, u)] : null;
      },
    })),
    // Uppladdningar står redan i audit_log (contract.file_added, sales_order.attachment_added).
    ...slaIhopFiler(filer.filter((f) => f.action !== "upload"), u).map(({ f, filer: antal }) => ({
      ts: f.ts,
      nyckel: `f${String(f.id).padStart(12, "0")}`,
      rad: (): NdLoggRad => { const x = filRad(f, u, antal.size); return [tid.dag(f.ts), tid.klocka(f.ts), "utlamnande", x.rubrik, vem(f.actor_id, "file", u), x.objekt]; },
    })),
  ];
  alla.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : a.nyckel < b.nyckel ? 1 : -1));
  const forsta = plusDagar(idag, -(LOGG_DAGAR - 1));
  const rader: NdLoggRad[] = [];
  for (const x of alla) {
    if (rader.length >= LOGG_TAK) break;
    const r = x.rad();
    if (r && r[0] >= forsta) rader.push(r);
  }
  const dagar: Record<string, string> = {};
  for (const r of rader) if (!dagar[r[0]]) dagar[r[0]] = dagRubrik(r[0], idag);
  return { rader, dagar };
}
