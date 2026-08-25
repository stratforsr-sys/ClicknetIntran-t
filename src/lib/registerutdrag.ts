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
  // E10.9. Punkterna handlar om dig aven om listan ar chefens arbetsredskap —
  // artikel 15 fragar inte vem tabellen ar skriven for.
  { tabell: "onboarding_task", kolumn: "employee_id", andamal: "Introduktionschecklista" },
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

  // E6.5. En rad per dygn du använt navet, utan klockslag och utan sidor.
  // Raden går inte att läsa via API:t — inte ens för säljchefen, se 0029 — men
  // den handlar om dig, och då ska den med i ditt utdrag. Statistiken som
  // byggs av den svarar med antal och aldrig med namn.
  { tabell: "activity_day", kolumn: "employee_id", andamal: "Dagar du använt navet" },

  // E10 / 0030. Blev du anställd genom navets rekrytering finns din
  // kandidatrad kvar och pekar på dig. Den bär hela processen: steg, källa och
  // intervjuomdömen. Det är uppgifter om dig och ska med i ditt utdrag.
  { tabell: "candidate", kolumn: "hired_employee_id", andamal: "Din rekryteringsprocess" },

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

  // 0025 E15. Lönen och vad bolaget räknat att du kostar. Att lönekostnaden är
  // sekretessbelagd i vardagen (K26) gör den inte mindre till en uppgift OM
  // personen — artikel 15 gäller ändå, och ett utdrag som utelämnar den vore
  // ett utdrag som döljer det mest närgångna navet räknat fram.
  { tabell: "salary_basis", kolumn: "employee_id", andamal: "Din inmatade månadslön" },
  { tabell: "cost_calculation", kolumn: "employee_id", andamal: "Beräknad lönekostnad per period" },
  { tabell: "revenue_entry", kolumn: "employee_id", andamal: "Inmatad intäkt per period" },

  // 0026 E0.6. En felrapport bär vad du skrev, vilken sida du var på och när.
  // Att den är teknisk gör den inte till något annat än en uppgift om dig:
  // raden säger att just du satt i navet vid en viss tidpunkt och att något
  // gick fel för dig. Texten är dessutom dina egna ord.
  { tabell: "error_report", kolumn: "reporter_id", andamal: "Felrapporter du skickat och fel du råkat ut för" },

  // 0028 E9.1. Ditt anställningsavtal. Raden bär den frysta avtalstexten och
  // de värden som fylldes i — lön, befattning, uppsägningstid. Det är den
  // mest närgångna uppgift navet har om en anställning, och den enda som
  // personen själv skrivit under.
  { tabell: "contract", kolumn: "employee_id", andamal: "Dina anställningsavtal" },

  // 0031 E13. Vad du tjänat in i provision, post för post. Till skillnad från
  // lönekostnaden ser du den redan i navet — men den ska med här ändå, för
  // utdraget ska vara fullständigt och inte bara innehålla det som är dolt.
  { tabell: "commission_entry", kolumn: "employee_id", andamal: "Din intjänade provision" },

  // 0034 E13 steg 1. Ordern bär kundens uppgifter, men raden handlar om
  // SÄLJAREN: den är underlaget för vad hen tjänat och för volymbonusen.
  // Utelämnad hade utdraget visat provisionsposterna utan att kunna svara på
  // vad de kom ifrån.
  { tabell: "sales_order", kolumn: "salesperson_id", andamal: "Order du sålt, och provisionen de gav" },
  // E13 steg 5. En K&V-bedomning ar ett omdome OM personen och hor darfor
  // hemma i utdraget, aven fritexten. Saljaren ser den redan i navet (fraga
  // 38) — men artikel 15 fragar inte om nagot redan visas nagon annanstans.
  { tabell: "kv_call", kolumn: "employee_id", andamal: "Samtal utvalda för K&V-bedömning" },
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
  { tabell: "onboarding_task", kolumn: "handled_by", skal: "Vem som kvitterade punkten" },
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
  { tabell: "cost_rate", kolumn: "owner_id", skal: "Vem som äger en sats (K28)" },

  // 0026. Vem som tog hand om någon annans felrapport.
  { tabell: "error_report", kolumn: "handled_by", skal: "Vem som hanterade en felrapport" },

  // 0028. Vem som skrev, utfärdade eller drog tillbaka någon annans avtal.
  { tabell: "contract", kolumn: "created_by", skal: "Vem som skapade avtalet" },
  { tabell: "contract", kolumn: "issued_by", skal: "Vem som utfärdade avtalet" },
  { tabell: "contract", kolumn: "withdrawn_by", skal: "Vem som drog tillbaka avtalet" },
  { tabell: "contract_template", kolumn: "created_by", skal: "Vem som skrev mallen" },
  { tabell: "contract_template", kolumn: "updated_by", skal: "Vem som ändrade mallen" },
  { tabell: "cost_rate", kolumn: "created_by", skal: "Vem som satte satsen" },
  { tabell: "cost_calculation", kolumn: "calculated_by", skal: "Vem som körde beräkningen" },
  { tabell: "salary_basis", kolumn: "entered_by", skal: "Vem som matade in lönen" },
  { tabell: "revenue_entry", kolumn: "entered_by", skal: "Vem som matade in intäkten" },

  // 0030 E10. En kandidat är inte en anställd, så raderna handlar i regel om
  // någon annan än den som begär utdraget. Undantaget står i KALLOR ovan:
  // `candidate.hired_employee_id` pekar på den som faktiskt blev anställd.
  { tabell: "candidate", kolumn: "created_by", skal: "Vem som lade upp kandidaten" },
  { tabell: "candidate_stage_event", kolumn: "by_employee", skal: "Vem som flyttade en kandidat" },
  { tabell: "interview_scorecard", kolumn: "interviewer_id", skal: "Vem som intervjuade en kandidat" },
  { tabell: "recruitment_policy", kolumn: "updated_by", skal: "Vem som ändrade rekryteringsreglerna" },

  // 0031 E13.
  { tabell: "commission_entry", kolumn: "entered_by", skal: "Vem som bokförde provisionen" },

  // 0034 E13 steg 1. Tre roller kring en order som INTE är säljarens egen:
  // den som lade in den, den som godkände den och den som makulerade den.
  // Säljarens egen koppling står i KALLOR ovan.
  { tabell: "sales_order", kolumn: "created_by", skal: "Vem som lade in ordern" },
  { tabell: "sales_order", kolumn: "approved_by", skal: "Vem som godkände ordern" },
  { tabell: "sales_order", kolumn: "cancelled_by", skal: "Vem som makulerade ordern" },
  { tabell: "commission_rate", kolumn: "set_by", skal: "Vem som satte provisionssatsen" },

  // 0035 E13 steg 3. Tre roller kring reglerna och perioden, ingen av dem en
  // uppgift OM den person raden pekar pa. Det den anstallda sjalv tjanat star i
  // `commission_entry`, som ligger i KALLOR.
  { tabell: "commission_bonus_level", kolumn: "set_by", skal: "Vem som satte bonusnivån" },
  { tabell: "commission_period", kolumn: "closed_by", skal: "Vem som fastställde perioden" },
  { tabell: "commission_period", kolumn: "paid_by", skal: "Vem som markerade utbetalningen" },

  // 0036 E13 steg 5. Vem som valde ut och bedomde ett samtal ar inte en uppgift
  // OM bedomaren. Sjalva bedomningen star i utdraget via `kv_call.employee_id`
  // i KALLOR ovan.
  { tabell: "kv_call", kolumn: "created_by", skal: "Vem som valde ut samtalet" },
  { tabell: "kv_assessment", kolumn: "assessed_by", skal: "Vem som bedömde samtalet" },
  { tabell: "kv_assessment", kolumn: "updated_by", skal: "Vem som ändrade bedömningen" },
  { tabell: "kv_criterion", kolumn: "set_by", skal: "Vem som satte maxpoängen" },
  { tabell: "kv_policy", kolumn: "set_by", skal: "Vem som satte K&V-reglerna" },
];
