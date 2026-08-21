/**
 * AC-12.4, K25: vilka tabeller som bar uppgifter om en person.
 *
 * Ren data, inga importer — av samma skal som avvikelsemotorn och
 * losenordskraven: listan ska ga att prova utan att starta Next. Sjalva
 * hamtningen ligger i `registerutdrag-server.ts`.
 *
 * LISTAN ar hela sanningen. Laggs en tabell till som bar persondata utan att
 * den hamnar har, saknas den i utdraget — och det ar ett fel som ingen
 * upptacker, for ett utdrag som saknar nagot ser precis ut som ett utdrag dar
 * det inte fanns nagot. `tests/registerutdrag.mjs` jamfor darfor listan mot
 * databasens egna framande nycklar och faller nar en kolumn pekar pa
 * `employee` utan att sta i vare sig KALLOR eller UNDANTAG.
 */

/** En tabell som bar data om en person, och kolumnen som pekar ut hen. */
export type Kalla = {
  tabell: string;
  kolumn: string;
  /** Varfor raden finns. Star med i utdraget — artikel 15.1 a. */
  andamal: string;
};

export const KALLOR: Kalla[] = [
  { tabell: "employee", kolumn: "id", andamal: "Anställningsuppgifter" },
  { tabell: "employee_role", kolumn: "employee_id", andamal: "Behörighet i navet" },
  { tabell: "employee_permission", kolumn: "employee_id", andamal: "Särskild behörighet" },
  { tabell: "offboarding_task", kolumn: "employee_id", andamal: "Avslutscheckista" },
  { tabell: "document_ack", kolumn: "employee_id", andamal: "Kvitterade rutiner" },
  { tabell: "document_view", kolumn: "employee_id", andamal: "Lästa rutiner" },
  { tabell: "module_progress", kolumn: "employee_id", andamal: "Genomförda kursmoduler" },
  { tabell: "course_attempt", kolumn: "employee_id", andamal: "Provförsök" },
  { tabell: "certification", kolumn: "employee_id", andamal: "Certifikat" },
  { tabell: "time_event", kolumn: "employee_id", andamal: "Stämplingar" },
  { tabell: "work_schedule", kolumn: "employee_id", andamal: "Ditt arbetsschema" },
  { tabell: "work_time_journal", kolumn: "employee_id", andamal: "Arbetstidsjournal (K2)" },
  { tabell: "scheduled_break", kolumn: "employee_id", andamal: "Ditt rastschema" },
  { tabell: "break_schedule_ack", kolumn: "employee_id", andamal: "Kvitterat rastschema" },
  { tabell: "break_deviation", kolumn: "employee_id", andamal: "Rastavvikelser" },
  { tabell: "break_deviation_month", kolumn: "employee_id", andamal: "Månadsaggregat, raster" },
  { tabell: "late_arrival", kolumn: "employee_id", andamal: "Sen ankomst" },
  { tabell: "late_arrival_month", kolumn: "employee_id", andamal: "Månadsaggregat, sen ankomst" },
  { tabell: "payroll_row", kolumn: "employee_id", andamal: "Löneunderlag" },
  { tabell: "payroll_adjustment", kolumn: "employee_id", andamal: "Justeringar i löneunderlag" },
  { tabell: "hr_case", kolumn: "employee_id", andamal: "Personalärenden" },
  { tabell: "document", kolumn: "owner_id", andamal: "Rutiner du äger" },
  { tabell: "course", kolumn: "owner_id", andamal: "Kurser du äger" },
  { tabell: "news_post", kolumn: "author_id", andamal: "Nyhetsinlägg du skrivit" },
  { tabell: "notification_seen", kolumn: "employee_id", andamal: "När du senast öppnade notisklockan" },

  // E7 M3. Sjukanmälan är en uppgift om hälsa och därmed en särskild kategori
  // enligt artikel 9 — vilket gör den viktigare att kunna få ut, inte mindre.
  // Raderna bär datum, omfattning och tidpunkter; ingen orsak finns lagrad
  // (K35), så utdraget kan inte innehålla en heller.
  { tabell: "absence_request", kolumn: "employee_id", andamal: "Dina ledighetsansökningar" },
  { tabell: "absence_balance", kolumn: "employee_id", andamal: "Inmatade frånvarosaldon" },
  { tabell: "sick_report", kolumn: "employee_id", andamal: "Dina sjukanmälningar" },
  { tabell: "absence_reminder", kolumn: "employee_id", andamal: "Påminnelser om oregistrerad frånvaro" },
  { tabell: "calendar_feed", kolumn: "employee_id", andamal: "Ditt kalenderflöde" },

  // 0022. Filer som är uppgifter OM dig — i dag läkarintyg. Raden bär storlek,
  // checksumma och tidpunkt; själva filen hämtas separat, se `hamtaFiler` i
  // registerutdrag-server.ts. Öppningarna av dem ligger i `file_access_log`
  // och hämtas via filen, eftersom `actor_id` där pekar på den som läste och
  // inte på den filen handlar om.
  { tabell: "file_object", kolumn: "subject_employee_id", andamal: "Filer om dig" },

  // 0024 E8.7. Ett inlämnat rollspel är en inspelning av din egen röst och en
  // bedömning av den. Själva betyget och återkopplingen ligger i
  // `course_attempt`, som redan står ovan.
  { tabell: "roleplay_submission", kolumn: "employee_id", andamal: "Dina inlämnade rollspel" },
];

/**
 * Kolumner som pekar pa `employee` utan att bara uppgifter OM den personen.
 *
 * De sager vem som gjorde nagot at nagon annan. Att ta med dem hade gjort
 * utdraget till en lista over andras arenden och loner — ett dataintrang
 * utklaatt till en rattighet. Det man sjalv gjort star i handelseloggen, som
 * hamtas separat pa `actor_id`.
 */
export const UNDANTAG: { tabell: string; kolumn: string; skal: string }[] = [
  { tabell: "audit_log", kolumn: "actor_id", skal: "Hämtas separat, från båda hållen" },
  { tabell: "break_deviation", kolumn: "resolved_by", skal: "Vem som avslutade avvikelsen" },
  { tabell: "case_message", kolumn: "author_id", skal: "Hämtas via ärendet, inte direkt" },
  { tabell: "compliance_gate", kolumn: "enabled_by", skal: "Vem som slog på en modul" },
  { tabell: "course", kolumn: "created_by", skal: "Vem som skapade en kurs" },
  { tabell: "course_attempt", kolumn: "graded_by", skal: "Vem som rättade andras prov" },
  { tabell: "document", kolumn: "created_by", skal: "Vem som skapade ett dokument" },
  { tabell: "document_version", kolumn: "changed_by", skal: "Vem som ändrade en version" },
  { tabell: "employee", kolumn: "manager_id", skal: "Pekar på din chef, inte på dig" },
  { tabell: "employee_permission", kolumn: "granted_by", skal: "Vem som gav behörigheten" },
  { tabell: "employee_role", kolumn: "granted_by", skal: "Vem som gav rollen" },
  { tabell: "hr_case", kolumn: "assigned_to", skal: "Vem som handlägger andras ärenden" },
  { tabell: "hr_case", kolumn: "created_by", skal: "Vem som lade upp ärendet" },
  { tabell: "late_arrival", kolumn: "resolved_by", skal: "Vem som avslutade posten" },
  { tabell: "offboarding_task", kolumn: "handled_by", skal: "Vem som kvitterade punkten" },
  { tabell: "payroll_adjustment", kolumn: "created_by", skal: "Vem som gjorde justeringen" },
  { tabell: "payroll_period", kolumn: "attested_by", skal: "Vem som attesterade perioden" },
  { tabell: "payroll_period", kolumn: "generated_by", skal: "Vem som genererade perioden" },
  { tabell: "scheduled_break", kolumn: "created_by", skal: "Vem som lade rastschemat" },
  { tabell: "team", kolumn: "lead_id", skal: "Pekar på teamets ledare" },
  { tabell: "time_event", kolumn: "decided_by", skal: "Vem som beslutade om en rättelse" },
  { tabell: "time_event", kolumn: "requested_by", skal: "Vem som begärde rättelsen" },
  { tabell: "work_schedule", kolumn: "created_by", skal: "Vem som lade schemat" },

  // E7. Alla pekar ut vem som GJORDE något åt någon annan.
  { tabell: "absence_balance", kolumn: "entered_by", skal: "Vem som matade in saldot" },
  { tabell: "absence_blackout", kolumn: "created_by", skal: "Vem som lade spärrperioden" },
  { tabell: "absence_call_order", kolumn: "employee_id", skal: "Utpekad mottagare av sjukanmälan" },
  { tabell: "absence_call_order", kolumn: "created_by", skal: "Vem som satte mottagarordningen" },
  { tabell: "absence_policy", kolumn: "updated_by", skal: "Vem som ändrade reglerna" },
  { tabell: "absence_reminder", kolumn: "resolved_by", skal: "Vem som stängde påminnelsen" },
  { tabell: "absence_request", kolumn: "created_by", skal: "Vem som lade upp ansökan" },
  { tabell: "absence_request", kolumn: "decided_by", skal: "Vem som beslutade om andras ledighet" },
  { tabell: "absence_request", kolumn: "withdrawn_by", skal: "Vem som drog tillbaka eller ställde in" },
  { tabell: "calendar_feed", kolumn: "revoked_by", skal: "Vem som stängde flödet" },
  { tabell: "sick_deadline", kolumn: "completed_by", skal: "Vem som kvitterade fristen" },
  { tabell: "sick_report", kolumn: "cancelled_by", skal: "Vem som ställde in anmälan" },
  { tabell: "sick_report", kolumn: "confirmed_by", skal: "Vem som bekräftade andras anmälan" },
  { tabell: "sick_report", kolumn: "registered_by", skal: "Vem som knappade in anmälan" },
  { tabell: "sick_report", kolumn: "reported_to", skal: "Vem samtalet gick till" },
  { tabell: "staffing_cap", kolumn: "created_by", skal: "Vem som satte bemanningstaket" },

  // 0022 filer. `actor_id` i åtkomstloggen pekar på den som ÖPPNADE en fil.
  // Hämtas via filen i stället — se `hamtaRegisterutdrag`. Att hämta den på
  // actor_id hade gett en lista över andras läkarintyg som man råkat öppna.
  { tabell: "file_access_log", kolumn: "actor_id", skal: "Vem som öppnade en fil" },
  { tabell: "file_object", kolumn: "uploaded_by", skal: "Vem som laddade upp filen" },
  { tabell: "file_object", kolumn: "removed_by", skal: "Vem som tog bort filen" },
  { tabell: "roleplay_submission", kolumn: "graded_by", skal: "Vem som bedömde andras rollspel" },
];
