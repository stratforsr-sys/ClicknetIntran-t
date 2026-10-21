-- 0155_rls_initplan (Nav 2.0, fart, 2026-10-20)
--
-- Samma policyer, samma regler, i den form Postgres räknar snabbt: ett anrop
-- utan kolumner som argument (current_employee_id(), has_any_role(ARRAY[...]),
-- can_read_all_employees() …) står i ( SELECT f() ), så att det räknas en gång
-- per sats i stället för en gång per rad. Funktionerna är STABLE, så svaret är
-- detsamma inom en sats (Supabase: "wrap functions with SELECT").
--
-- Varför: 97 % av databasens arbete när /nav2 laddas var policyfunktionerna,
-- som räknades om per rad (Zen: 1 220 ms med RLS, 30 ms utan). Med 0155, mätt
-- i en transaktion som rullades tillbaka: en laddnings frågor tar ~1,3 s i
-- Postgres före och ~0,4 s efter (Zen, Fredrik, Mick).
--
-- Bara uttrycken ändras (ALTER POLICY): roller, kommando och namn står kvar.
-- Anrop med kolumner som argument (leads_employee(employee_id) …) är orörda.
-- Bevis: varje ändrad policy ger samma sant/falskt på varje rad för konton i
-- varje roll och läge (bevisa.mjs: 1 449 prov, 163 035 rader, 0 avvikelser).
-- news_ack_read (0130) har tomma tabeller och är prövad på 3 360 påhittade
-- par av anställd och nyhet (bevisa-tom.mjs), 0 avvikelser.
--
-- Planerna blir andra (index i stället för tabellgenomläsning), så rader som en
-- fråga inte sorterar kan komma i annan ordning. Där det syntes sorterar koden
-- uttryckligen sedan 2026-10-21 (Provision, Frånvaro, Coachning, lönerapporten,
-- notiserna): hela datan för tolv konton är densamma före och med 0155.
--
-- Genererad ur pg_policies (inte ur äldre migrationer) av
-- ~/nav2-utkast/delar/fart/rls/generera.mjs. Vakten nedan avbryter om någon av
-- policyerna har ändrats sedan dess: skriv då om filen. Kör den efter de andra
-- Nav 2.0-migrationerna och skriv om den först om de har lagt till policyer.
-- Återställning: supabase/ner/0155_rls_initplan.sql.

SET LOCAL lock_timeout = '5s';

DO $vakt$
DECLARE avviker text;
BEGIN
  SELECT string_agg(v.t || '.' || v.p, ', ') INTO avviker
  FROM (VALUES
    ('public', 'absence_balance', 'absence_balance_read', '3aca04eb4ac236d0e2272e5ac38015da', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'absence_blackout', 'absence_blackout_read', '92d1e493b7ff300ba4c1a2b3c25f1815', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'absence_call_order', 'absence_call_order_read', '92d1e493b7ff300ba4c1a2b3c25f1815', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'absence_policy', 'absence_policy_read', '92d1e493b7ff300ba4c1a2b3c25f1815', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'absence_reminder', 'absence_reminder_read', '1956fbc123f3ebc11ba63df3f6c4c42f', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'absence_request', 'absence_request_read', '3aca04eb4ac236d0e2272e5ac38015da', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'absence_type', 'absence_type_read', '92d1e493b7ff300ba4c1a2b3c25f1815', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'attendance_incident', 'attendance_incident_read', '6c182ad4c6ab710cbb88efb15e6e2e1c', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'audit_log', 'audit_log_read', 'a59c308ba68add5679d62960853b2897', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'break_deviation', 'break_deviation_read', '0febe439ecd9a23bb8762d8c608a1714', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'break_deviation_month', 'break_deviation_month_read', '0febe439ecd9a23bb8762d8c608a1714', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'break_schedule_ack', 'break_schedule_ack_read', '0febe439ecd9a23bb8762d8c608a1714', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'calendar_attendee', 'calendar_attendee_read', '4b215ae29cd512ddd7731aff2ff627fe', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'calendar_event', 'calendar_event_read', '87a4d177a1bdedd099f5d4ca6abe82eb', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'calendar_feed', 'calendar_feed_read', '552a5cd789992bd8967a68e9302c49f6', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'calendar_series', 'calendar_series_read', 'a256675436aa255ad956e9de7d35caad', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'calendar_share', 'calendar_share_read', '6699821c9ad4de43396382b39ac4535c', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'candidate', 'candidate_read', '5989d29174bad24990b7417461bb9411', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'candidate_booking', 'candidate_booking_read', '5989d29174bad24990b7417461bb9411', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'candidate_merit_request', 'candidate_merit_request_read', '5989d29174bad24990b7417461bb9411', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'candidate_message', 'candidate_message_read', '5989d29174bad24990b7417461bb9411', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'candidate_note', 'candidate_note_read', '5989d29174bad24990b7417461bb9411', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'candidate_stage_event', 'candidate_stage_event_read', '5989d29174bad24990b7417461bb9411', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'case_category', 'case_category_read', '92d1e493b7ff300ba4c1a2b3c25f1815', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'case_message', 'case_message_read', '2d332ebc30d2a044b7325fe8cdbbfb02', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'case_outcome', 'case_outcome_andra', 'bcf91e8c599e1b8c967105070c1e89e3', 'bcf91e8c599e1b8c967105070c1e89e3'),
    ('public', 'case_outcome', 'case_outcome_las', '0d6df89da20a9d1754de60e57a4c35da', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'case_outcome', 'case_outcome_skriv', 'd41d8cd98f00b204e9800998ecf8427e', 'bb1b4440060e90158742438f2ddd898a'),
    ('public', 'case_outcome', 'case_outcome_ta_bort', 'bcf91e8c599e1b8c967105070c1e89e3', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'certification', 'certification_read', '0febe439ecd9a23bb8762d8c608a1714', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'coaching_drill', 'coaching_drill_read', 'a0de82c4671442b116f8bff6f242d1ec', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'coaching_meeting_request', 'coaching_meeting_request_read', '0febe439ecd9a23bb8762d8c608a1714', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'coaching_message', 'coaching_message_read', '47c5207a610826a28f28bbdf3259b2b1', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'coaching_person_focus', 'coaching_person_focus_read', '0febe439ecd9a23bb8762d8c608a1714', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'coaching_session', 'coaching_session_read', 'b5c2399c087ad0207f6ee36a68c4b0b5', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'coaching_task', 'coaching_task_read', 'cce53df6ae464ce43522c6e37a1aafa5', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'coaching_template', 'coaching_template_read', '710543637e5c763a21cc70d76a2d302e', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'commission_entry', 'commission_entry_read', '2a9e5381f997731d4d9f555556dadcee', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'commission_history', 'commission_history_las', '2a9e5381f997731d4d9f555556dadcee', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'company', 'company_read', '92d1e493b7ff300ba4c1a2b3c25f1815', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'compliance_gate', 'compliance_gate_read', '92d1e493b7ff300ba4c1a2b3c25f1815', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'contract', 'contract_read', '4f576bc7762794b0704e9ce3ebd08ba7', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'contract_template', 'contract_template_read', '4f8228d7254c58b9086171fa117f86a4', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'cost_calculation', 'cost_calculation_read', '321aaf73b9a80f7d7800a4acd43be4c5', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'cost_rate', 'cost_rate_read', '321aaf73b9a80f7d7800a4acd43be4c5', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'course', 'course_read', '9043eaa115d45621bfd710cea521f699', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'course_attempt', 'course_attempt_read', '0febe439ecd9a23bb8762d8c608a1714', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'course_wish', 'course_wish_read', 'f11eb67108e08360fa719a4813987a8c', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'document', 'document_read', 'ee3520e8b993b5e63ec3c7ecd3fbc03f', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'document_ack', 'document_ack_read', '886c0597e5f09d5548d45704ba121aae', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'document_area_watch', 'document_area_watch_read', '725a98923b8aa7a37e15c30be0456b74', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'document_feedback', 'document_feedback_read', '2339ef3dbdb4975793858d64940981f5', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'document_note', 'document_note_read', '725a98923b8aa7a37e15c30be0456b74', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'document_run', 'document_run_read', '5b34354de2189dd4578106271ec9f6cf', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'document_saved', 'document_saved_read', '725a98923b8aa7a37e15c30be0456b74', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'document_search_miss', 'document_search_miss_read', '6fa1ae609a9699585eb2169d4e226e48', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'document_view', 'document_view_read', 'f11eb67108e08360fa719a4813987a8c', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'document_view_log', 'document_view_log_read', 'f11eb67108e08360fa719a4813987a8c', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'employee', 'employee_read', '56c28c83eeaa03d7aa9d3ab3d691c31c', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'employee_access_level', 'employee_access_level_read', '8027ccda49351a668f7224a22bea8583', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'employee_onboarding', 'employee_onboarding_read', 'd17b53fe4d4179561083d87f0766a61f', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'employee_permission', 'employee_permission_read', '552a5cd789992bd8967a68e9302c49f6', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'employee_role', 'employee_role_read', '0febe439ecd9a23bb8762d8c608a1714', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'error_occurrence', 'error_occurrence_las', 'a59c308ba68add5679d62960853b2897', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'error_report', 'error_report_read', '5294144f7e3d542e7ad7adcb0a75eb07', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'error_report_follower', 'error_report_follower_las', '45903335f15b7cf33e7fe899e2b3864d', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'essay_submission', 'essay_submission_read', '74912e1aed9381b8a5e3f6e19e17985d', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'file_object', 'file_object_read', 'a777a82b5348e9c2b56f6de6fce04e6d', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'guide_nudge', 'guide_nudge_read', '0febe439ecd9a23bb8762d8c608a1714', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'guide_progress', 'guide_progress_read', '0febe439ecd9a23bb8762d8c608a1714', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'hr_case', 'hr_case_read', 'b10c8299c22c72f712bb307e6eb6ac4a', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'hr_case_attachment', 'hr_case_attachment_skriv', 'd41d8cd98f00b204e9800998ecf8427e', 'd4bcb70aded4c7e590f666774041e689'),
    ('public', 'hr_case_confirmation', 'hr_case_confirmation_skriv', 'd41d8cd98f00b204e9800998ecf8427e', '42a1d6bb13044e64557e0d9a3da4da8f'),
    ('public', 'hr_case_link', 'hr_case_link_skriv', 'd41d8cd98f00b204e9800998ecf8427e', 'b543adc87ecd43a145ffc4ce4d47ec99'),
    ('public', 'hr_case_read', 'hr_case_read_andra', '725a98923b8aa7a37e15c30be0456b74', '725a98923b8aa7a37e15c30be0456b74'),
    ('public', 'hr_case_read', 'hr_case_read_skriv', 'd41d8cd98f00b204e9800998ecf8427e', '852fbee8943655951029f4fad26eb13e'),
    ('public', 'hr_case_read', 'hr_case_read_ta_bort', '725a98923b8aa7a37e15c30be0456b74', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'hr_case_reminder', 'hr_case_reminder_skriv', 'd41d8cd98f00b204e9800998ecf8427e', 'b50b0fdf0622f8793fffef539093c673'),
    ('public', 'interview_scorecard', 'interview_scorecard_read', '0fde420f9883d7917ae8e353b986b4dd', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'interview_slot', 'interview_slot_read', '5989d29174bad24990b7417461bb9411', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'kv_assessment', 'kv_assessment_read', '6a0a02ff148a6a10e43924e22b173332', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'kv_call', 'kv_call_read', '2a9e5381f997731d4d9f555556dadcee', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'kv_score', 'kv_score_read', 'bd01f6e1460a794b88aaf4557d2be0b8', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'late_arrival', 'late_arrival_read', '0febe439ecd9a23bb8762d8c608a1714', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'late_arrival_month', 'late_arrival_month_read', '0febe439ecd9a23bb8762d8c608a1714', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'lead', 'lead_read', '272cad690b9be34d7162dd92fc8d9872', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'lead_event', 'lead_event_read', '3544545f039e0e83588f27c51733587f', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'learning_answer', 'learning_answer_read', '26ed214c8f497276c457ab6a5f2788e2', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'learning_note', 'learning_note_mal_chef', 'f104497871e689f72556b1ba04423cf3', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'learning_note', 'learning_note_read', '725a98923b8aa7a37e15c30be0456b74', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'learning_rule', 'learning_rule_read', '725a98923b8aa7a37e15c30be0456b74', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'lecture', 'lecture_read', '0d6df89da20a9d1754de60e57a4c35da', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'lecture_followup', 'lecture_followup_read', 'f11eb67108e08360fa719a4813987a8c', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'lecture_question', 'lecture_question_read', 'b73ed662ce08062bb633c4653b4268e2', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'lecture_signup', 'lecture_signup_read', 'd7c0192a8f64a8c96e424dbbcae4d81e', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'manager_commission_rate', 'manager_commission_rate_read', '47d26fe6ae12b0160d744ce8def4bc07', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'module_progress', 'module_progress_read', '0febe439ecd9a23bb8762d8c608a1714', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'module_rating', 'module_rating_read', 'f11eb67108e08360fa719a4813987a8c', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'nav_preference', 'nav_preference_read', '725a98923b8aa7a37e15c30be0456b74', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'news_ack', 'news_ack_read', '05879497bf70922449fb03f1e98fa50c', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'news_post', 'news_post_read', '9f2f9d767a5f1729bdb688ff66d5712f', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'notification_dismissed', 'notification_dismissed_read', '725a98923b8aa7a37e15c30be0456b74', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'notification_event', 'notification_event_read', '725a98923b8aa7a37e15c30be0456b74', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'notification_seen', 'notification_seen_read', '725a98923b8aa7a37e15c30be0456b74', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'offboarding_task', 'offboarding_task_read', 'd17b53fe4d4179561083d87f0766a61f', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'onboarding_rule', 'onboarding_rule_read', 'd17b53fe4d4179561083d87f0766a61f', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'onboarding_task', 'onboarding_task_read', 'd17b53fe4d4179561083d87f0766a61f', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'onboarding_template', 'onboarding_template_read', 'd17b53fe4d4179561083d87f0766a61f', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'onboarding_template_item', 'onboarding_template_item_read', 'd17b53fe4d4179561083d87f0766a61f', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'one_on_one_point', 'one_on_one_point_read', '6126172753706d3b1187f5878c7ac2cb', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'order_grattis', 'order_grattis_read', '725a98923b8aa7a37e15c30be0456b74', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'order_list_seen', 'order_list_seen_las', '725a98923b8aa7a37e15c30be0456b74', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'order_manager_commission', 'order_manager_commission_read', 'e782606bc521ec9beaf9c372be38b1cf', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'payroll_adjustment', 'payroll_adjustment_read', '915d4ae782f6446cd9365943916ff667', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'payroll_export_column', 'payroll_export_column_read', '8fca5afe52965a456af7791a72f7d842', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'payroll_period', 'payroll_period_read', '8fca5afe52965a456af7791a72f7d842', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'payroll_period_sent', 'payroll_period_sent_read', '8fca5afe52965a456af7791a72f7d842', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'payroll_row', 'payroll_row_read', '915d4ae782f6446cd9365943916ff667', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'phone_call', 'phone_call_read', 'febc3c9445dd0399eb4908abea4cd02a', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'phone_identity', 'phone_identity_read', '3aca04eb4ac236d0e2272e5ac38015da', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'project', 'project_read', '67bef12a7984ec7acfb69fb8248c2cde', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'project_member', 'project_member_read', '825bbd481b5c371fbd553c3c76f9c3d3', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'project_message', 'project_message_read_policy', '825bbd481b5c371fbd553c3c76f9c3d3', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'project_message_read', 'project_message_read_egen', '725a98923b8aa7a37e15c30be0456b74', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'push_sent', 'push_sent_read', '725a98923b8aa7a37e15c30be0456b74', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'push_subscription', 'push_subscription_read', '725a98923b8aa7a37e15c30be0456b74', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'recruitment_goal', 'recruitment_goal_read', '5989d29174bad24990b7417461bb9411', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'recruitment_policy', 'recruitment_policy_read', '5989d29174bad24990b7417461bb9411', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'recruitment_position', 'recruitment_position_read', '5989d29174bad24990b7417461bb9411', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'recruitment_source', 'recruitment_source_read', '5989d29174bad24990b7417461bb9411', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'recruitment_template', 'recruitment_template_read', '5989d29174bad24990b7417461bb9411', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'revenue_entry', 'revenue_entry_read', '321aaf73b9a80f7d7800a4acd43be4c5', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'roleplay_self', 'roleplay_self_read', '9f92f4b9c7280fda4fc9e8ee5180c276', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'roleplay_submission', 'roleplay_submission_read', '3aca04eb4ac236d0e2272e5ac38015da', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'salary_basis', 'salary_basis_read', '321aaf73b9a80f7d7800a4acd43be4c5', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'sales_order', 'sales_order_read', '074d9643cc47e6456e6cd61b43fcc5da', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'sales_order_service', 'sales_order_service_read', '734b27f846a77510a28c9fbb2f0eab46', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'sales_target', 'sales_target_read', '2a9e5381f997731d4d9f555556dadcee', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'scheduled_break', 'scheduled_break_read', 'a8833a505431d41335935715ab44bb13', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'sick_deadline', 'sick_deadline_read', '29d31faf401f5c92d5a2b83e787e019d', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'sick_note', 'sick_note_read', 'd3e4ddf0e3ebf37a8323f4c4271d0d81', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'sick_report', 'sick_report_read', '3aca04eb4ac236d0e2272e5ac38015da', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'sick_signal_ack', 'sick_signal_ack_las', 'bcf91e8c599e1b8c967105070c1e89e3', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'staffing_cap', 'staffing_cap_read', '92d1e493b7ff300ba4c1a2b3c25f1815', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'task', 'task_read', 'd0f2c7bf5c5fa2db51bb443031c0dcf9', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'task_day', 'task_day_las', '725a98923b8aa7a37e15c30be0456b74', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'task_event', 'task_event_read', 'c696c3a17f313f1a4e7180e1cfc163da', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'task_focus', 'task_focus_las', '725a98923b8aa7a37e15c30be0456b74', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'task_link', 'task_link_read', 'c696c3a17f313f1a4e7180e1cfc163da', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'task_member', 'task_member_read', 'c696c3a17f313f1a4e7180e1cfc163da', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'task_series', 'task_series_read', 'fb8fd5adab47084e2676564f23c5c907', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'task_template', 'task_template_read', 'e28c9dd3fc72a4225def8181f56ac09d', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'team', 'team_read', '92d1e493b7ff300ba4c1a2b3c25f1815', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'tid_view_log', 'tid_view_log_read', 'e0d8468db0217dfdc9953996c8378084', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'time_day_ack', 'time_day_ack_read', '0febe439ecd9a23bb8762d8c608a1714', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'time_event', 'time_event_read', '0febe439ecd9a23bb8762d8c608a1714', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'time_week_check', 'time_week_check_read', '0febe439ecd9a23bb8762d8c608a1714', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'vacation_wish_round', 'vacation_wish_round_las', '0d6df89da20a9d1754de60e57a4c35da', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'weekly_review', 'weekly_review_read', '725a98923b8aa7a37e15c30be0456b74', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'work_schedule', 'work_schedule_read', 'a8833a505431d41335935715ab44bb13', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'work_schedule_seen', 'work_schedule_seen_read', '0febe439ecd9a23bb8762d8c608a1714', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'work_time_journal', 'work_time_journal_read', '28cb106316c0cc97cdf48868a52e80ea', 'd41d8cd98f00b204e9800998ecf8427e')
  ) AS v(s, t, p, q, w)
  LEFT JOIN pg_policies x ON x.schemaname = v.s AND x.tablename = v.t AND x.policyname = v.p
  WHERE x.policyname IS NULL OR md5(coalesce(x.qual, '')) <> v.q OR md5(coalesce(x.with_check, '')) <> v.w;
  IF avviker IS NOT NULL THEN
    RAISE EXCEPTION '0155: policyer har ändrats sedan filen skrevs (%). Skriv om filen med ~/nav2-utkast/delar/fart/rls/generera.mjs.', avviker;
  END IF;
END $vakt$;

ALTER POLICY "absence_balance_read" ON public."absence_balance" USING (((employee_id = ( SELECT current_employee_id() AS current_employee_id)) OR leads_employee(employee_id) OR ( SELECT has_any_role(ARRAY['sales_manager'::text, 'ceo'::text]) AS has_any_role)));
ALTER POLICY "absence_blackout_read" ON public."absence_blackout" USING ((NOT ( SELECT kraver_losenordsbyte() AS kraver_losenordsbyte)));
ALTER POLICY "absence_call_order_read" ON public."absence_call_order" USING ((NOT ( SELECT kraver_losenordsbyte() AS kraver_losenordsbyte)));
ALTER POLICY "absence_policy_read" ON public."absence_policy" USING ((NOT ( SELECT kraver_losenordsbyte() AS kraver_losenordsbyte)));
ALTER POLICY "absence_reminder_read" ON public."absence_reminder" USING (((employee_id = ( SELECT current_employee_id() AS current_employee_id)) OR ((visible_to_manager_from <= now()) AND (leads_employee(employee_id) OR ( SELECT has_any_role(ARRAY['sales_manager'::text, 'ceo'::text]) AS has_any_role)))));
ALTER POLICY "absence_request_read" ON public."absence_request" USING (((employee_id = ( SELECT current_employee_id() AS current_employee_id)) OR leads_employee(employee_id) OR ( SELECT has_any_role(ARRAY['sales_manager'::text, 'ceo'::text]) AS has_any_role)));
ALTER POLICY "absence_type_read" ON public."absence_type" USING ((NOT ( SELECT kraver_losenordsbyte() AS kraver_losenordsbyte)));
ALTER POLICY "attendance_incident_read" ON public."attendance_incident" USING ((((employee_id = ( SELECT current_employee_id() AS current_employee_id)) AND (status = ANY (ARRAY['godkand'::text, 'havd'::text]))) OR ( SELECT far_hantera_provision() AS far_hantera_provision) OR far_godkanna_franvaro_for(employee_id)));
ALTER POLICY "audit_log_read" ON public."audit_log" USING (( SELECT has_any_role(ARRAY['sales_manager'::text, 'ceo'::text, 'admin'::text]) AS has_any_role));
ALTER POLICY "break_deviation_read" ON public."break_deviation" USING (((employee_id = ( SELECT current_employee_id() AS current_employee_id)) OR ( SELECT can_read_all_employees() AS can_read_all_employees) OR leads_employee(employee_id)));
ALTER POLICY "break_deviation_month_read" ON public."break_deviation_month" USING (((employee_id = ( SELECT current_employee_id() AS current_employee_id)) OR ( SELECT can_read_all_employees() AS can_read_all_employees) OR leads_employee(employee_id)));
ALTER POLICY "break_schedule_ack_read" ON public."break_schedule_ack" USING (((employee_id = ( SELECT current_employee_id() AS current_employee_id)) OR ( SELECT can_read_all_employees() AS can_read_all_employees) OR leads_employee(employee_id)));
ALTER POLICY "calendar_attendee_read" ON public."calendar_attendee" USING ((((event_id IS NOT NULL) AND lk_ser_handelse(event_id, ( SELECT current_employee_id() AS current_employee_id))) OR ((series_id IS NOT NULL) AND lk_ser_serie(series_id, ( SELECT current_employee_id() AS current_employee_id)))));
ALTER POLICY "calendar_event_read" ON public."calendar_event" USING (lk_ser_handelse(id, ( SELECT current_employee_id() AS current_employee_id)));
ALTER POLICY "calendar_feed_read" ON public."calendar_feed" USING (((employee_id = ( SELECT current_employee_id() AS current_employee_id)) OR ( SELECT has_any_role(ARRAY['sales_manager'::text, 'ceo'::text]) AS has_any_role)));
ALTER POLICY "calendar_series_read" ON public."calendar_series" USING (lk_ser_serie(id, ( SELECT current_employee_id() AS current_employee_id)));
ALTER POLICY "calendar_share_read" ON public."calendar_share" USING (((owner_id = ( SELECT current_employee_id() AS current_employee_id)) OR (viewer_id = ( SELECT current_employee_id() AS current_employee_id))));
ALTER POLICY "candidate_read" ON public."candidate" USING (( SELECT far_rekrytera() AS far_rekrytera));
ALTER POLICY "candidate_booking_read" ON public."candidate_booking" USING (( SELECT far_rekrytera() AS far_rekrytera));
ALTER POLICY "candidate_merit_request_read" ON public."candidate_merit_request" USING (( SELECT far_rekrytera() AS far_rekrytera));
ALTER POLICY "candidate_message_read" ON public."candidate_message" USING (( SELECT far_rekrytera() AS far_rekrytera));
ALTER POLICY "candidate_note_read" ON public."candidate_note" USING (( SELECT far_rekrytera() AS far_rekrytera));
ALTER POLICY "candidate_stage_event_read" ON public."candidate_stage_event" USING (( SELECT far_rekrytera() AS far_rekrytera));
ALTER POLICY "case_category_read" ON public."case_category" USING ((NOT ( SELECT kraver_losenordsbyte() AS kraver_losenordsbyte)));
ALTER POLICY "case_message_read" ON public."case_message" USING ((EXISTS ( SELECT 1
   FROM hr_case c
  WHERE ((c.id = case_message.case_id) AND ((c.employee_id = ( SELECT current_employee_id() AS current_employee_id)) OR ((NOT c.confidential) AND ((c.assigned_to = ( SELECT current_employee_id() AS current_employee_id)) OR ( SELECT has_any_role(ARRAY['sales_manager'::text, 'ceo'::text]) AS has_any_role))) OR (c.confidential AND ( SELECT has_any_role(ARRAY['sales_manager'::text, 'ceo'::text]) AS has_any_role)))))));
ALTER POLICY "case_outcome_andra" ON public."case_outcome" USING (( SELECT has_any_role(ARRAY['sales_manager'::text, 'ceo'::text]) AS has_any_role)) WITH CHECK (( SELECT has_any_role(ARRAY['sales_manager'::text, 'ceo'::text]) AS has_any_role));
ALTER POLICY "case_outcome_las" ON public."case_outcome" USING ((( SELECT current_employee_id() AS current_employee_id) IS NOT NULL));
ALTER POLICY "case_outcome_skriv" ON public."case_outcome" WITH CHECK (((created_by = ( SELECT current_employee_id() AS current_employee_id)) AND ( SELECT has_any_role(ARRAY['sales_manager'::text, 'ceo'::text]) AS has_any_role)));
ALTER POLICY "case_outcome_ta_bort" ON public."case_outcome" USING (( SELECT has_any_role(ARRAY['sales_manager'::text, 'ceo'::text]) AS has_any_role));
ALTER POLICY "certification_read" ON public."certification" USING (((employee_id = ( SELECT current_employee_id() AS current_employee_id)) OR ( SELECT can_read_all_employees() AS can_read_all_employees) OR leads_employee(employee_id)));
ALTER POLICY "coaching_drill_read" ON public."coaching_drill" USING (((employee_id = ( SELECT current_employee_id() AS current_employee_id)) OR (created_by = ( SELECT current_employee_id() AS current_employee_id)) OR ( SELECT can_read_all_employees() AS can_read_all_employees) OR leads_employee(employee_id)));
ALTER POLICY "coaching_meeting_request_read" ON public."coaching_meeting_request" USING (((employee_id = ( SELECT current_employee_id() AS current_employee_id)) OR ( SELECT can_read_all_employees() AS can_read_all_employees) OR leads_employee(employee_id)));
ALTER POLICY "coaching_message_read" ON public."coaching_message" USING (((employee_id = ( SELECT current_employee_id() AS current_employee_id)) OR (from_id = ( SELECT current_employee_id() AS current_employee_id)) OR ( SELECT can_read_all_employees() AS can_read_all_employees) OR leads_employee(employee_id)));
ALTER POLICY "coaching_person_focus_read" ON public."coaching_person_focus" USING (((employee_id = ( SELECT current_employee_id() AS current_employee_id)) OR ( SELECT can_read_all_employees() AS can_read_all_employees) OR leads_employee(employee_id)));
ALTER POLICY "coaching_session_read" ON public."coaching_session" USING (((employee_id = ( SELECT current_employee_id() AS current_employee_id)) OR (coach_id = ( SELECT current_employee_id() AS current_employee_id)) OR ( SELECT can_read_all_employees() AS can_read_all_employees) OR leads_employee(employee_id)));
ALTER POLICY "coaching_task_read" ON public."coaching_task" USING (((assignee_id = ( SELECT current_employee_id() AS current_employee_id)) OR (partner_id = ( SELECT current_employee_id() AS current_employee_id)) OR (created_by = ( SELECT current_employee_id() AS current_employee_id)) OR ( SELECT can_read_all_employees() AS can_read_all_employees) OR leads_employee(assignee_id)));
ALTER POLICY "coaching_template_read" ON public."coaching_template" USING ((( SELECT can_read_all_employees() AS can_read_all_employees) OR ( SELECT has_any_role(ARRAY['team_lead'::text]) AS has_any_role)));
ALTER POLICY "commission_entry_read" ON public."commission_entry" USING (((employee_id = ( SELECT current_employee_id() AS current_employee_id)) OR ( SELECT far_hantera_provision() AS far_hantera_provision)));
ALTER POLICY "commission_history_las" ON public."commission_history" USING (((employee_id = ( SELECT current_employee_id() AS current_employee_id)) OR ( SELECT far_hantera_provision() AS far_hantera_provision)));
ALTER POLICY "company_read" ON public."company" USING ((NOT ( SELECT kraver_losenordsbyte() AS kraver_losenordsbyte)));
ALTER POLICY "compliance_gate_read" ON public."compliance_gate" USING ((NOT ( SELECT kraver_losenordsbyte() AS kraver_losenordsbyte)));
ALTER POLICY "contract_read" ON public."contract" USING ((( SELECT far_hantera_avtal() AS far_hantera_avtal) OR ((status = 'issued'::text) AND (employee_id = ( SELECT current_employee_id() AS current_employee_id)))));
ALTER POLICY "contract_template_read" ON public."contract_template" USING (( SELECT far_hantera_avtal() AS far_hantera_avtal));
ALTER POLICY "cost_calculation_read" ON public."cost_calculation" USING (( SELECT har_lonekostnadsbehorighet() AS har_lonekostnadsbehorighet));
ALTER POLICY "cost_rate_read" ON public."cost_rate" USING (( SELECT har_lonekostnadsbehorighet() AS har_lonekostnadsbehorighet));
ALTER POLICY "course_read" ON public."course" USING ((((status = 'published'::text) AND matches_audience(audience_roles, '{}'::uuid[])) OR (owner_id = ( SELECT current_employee_id() AS current_employee_id)) OR ( SELECT has_any_role(ARRAY['sales_manager'::text, 'admin'::text, 'ceo'::text]) AS has_any_role)));
ALTER POLICY "course_attempt_read" ON public."course_attempt" USING (((employee_id = ( SELECT current_employee_id() AS current_employee_id)) OR ( SELECT can_read_all_employees() AS can_read_all_employees) OR leads_employee(employee_id)));
ALTER POLICY "course_wish_read" ON public."course_wish" USING (((employee_id = ( SELECT current_employee_id() AS current_employee_id)) OR ( SELECT has_any_role(ARRAY['sales_manager'::text, 'admin'::text, 'ceo'::text]) AS has_any_role)));
ALTER POLICY "document_read" ON public."document" USING ((((status = 'published'::text) AND matches_audience(audience_roles, audience_teams, audience_employees)) OR (owner_id = ( SELECT current_employee_id() AS current_employee_id)) OR ( SELECT has_any_role(ARRAY['sales_manager'::text, 'admin'::text, 'ceo'::text]) AS has_any_role)));
ALTER POLICY "document_ack_read" ON public."document_ack" USING (((employee_id = ( SELECT current_employee_id() AS current_employee_id)) OR ( SELECT has_any_role(ARRAY['sales_manager'::text, 'admin'::text, 'ceo'::text]) AS has_any_role) OR (EXISTS ( SELECT 1
   FROM document d
  WHERE ((d.id = document_ack.document_id) AND (d.owner_id = ( SELECT current_employee_id() AS current_employee_id)))))));
ALTER POLICY "document_area_watch_read" ON public."document_area_watch" USING ((employee_id = ( SELECT current_employee_id() AS current_employee_id)));
ALTER POLICY "document_feedback_read" ON public."document_feedback" USING (((employee_id = ( SELECT current_employee_id() AS current_employee_id)) OR (EXISTS ( SELECT 1
   FROM document d
  WHERE ((d.id = document_feedback.document_id) AND (d.owner_id = ( SELECT current_employee_id() AS current_employee_id))))) OR ( SELECT has_any_role(ARRAY['sales_manager'::text, 'admin'::text, 'ceo'::text]) AS has_any_role)));
ALTER POLICY "document_note_read" ON public."document_note" USING ((employee_id = ( SELECT current_employee_id() AS current_employee_id)));
ALTER POLICY "document_run_read" ON public."document_run" USING (((employee_id = ( SELECT current_employee_id() AS current_employee_id)) OR (EXISTS ( SELECT 1
   FROM document d
  WHERE ((d.id = document_run.document_id) AND (d.owner_id = ( SELECT current_employee_id() AS current_employee_id))))) OR ( SELECT has_any_role(ARRAY['sales_manager'::text, 'admin'::text, 'ceo'::text]) AS has_any_role)));
ALTER POLICY "document_saved_read" ON public."document_saved" USING ((employee_id = ( SELECT current_employee_id() AS current_employee_id)));
ALTER POLICY "document_search_miss_read" ON public."document_search_miss" USING (( SELECT has_any_role(ARRAY['sales_manager'::text, 'admin'::text, 'ceo'::text]) AS has_any_role));
ALTER POLICY "document_view_read" ON public."document_view" USING (((employee_id = ( SELECT current_employee_id() AS current_employee_id)) OR ( SELECT has_any_role(ARRAY['sales_manager'::text, 'admin'::text, 'ceo'::text]) AS has_any_role)));
ALTER POLICY "document_view_log_read" ON public."document_view_log" USING (((employee_id = ( SELECT current_employee_id() AS current_employee_id)) OR ( SELECT has_any_role(ARRAY['sales_manager'::text, 'admin'::text, 'ceo'::text]) AS has_any_role)));
ALTER POLICY "employee_read" ON public."employee" USING ((((auth_user_id = ( SELECT auth.uid() AS uid)) AND (status <> 'offboarded'::text) AND (NOT ( SELECT kraver_losenordsbyte() AS kraver_losenordsbyte))) OR ( SELECT can_read_all_employees() AS can_read_all_employees) OR leads_employee(id)));
ALTER POLICY "employee_access_level_read" ON public."employee_access_level" USING (((employee_id = ( SELECT current_employee_id() AS current_employee_id)) OR ( SELECT can_read_all_employees() AS can_read_all_employees)));
ALTER POLICY "employee_onboarding_read" ON public."employee_onboarding" USING (( SELECT can_read_all_employees() AS can_read_all_employees));
ALTER POLICY "employee_permission_read" ON public."employee_permission" USING (((employee_id = ( SELECT current_employee_id() AS current_employee_id)) OR ( SELECT has_any_role(ARRAY['sales_manager'::text, 'ceo'::text]) AS has_any_role)));
ALTER POLICY "employee_role_read" ON public."employee_role" USING (((employee_id = ( SELECT current_employee_id() AS current_employee_id)) OR ( SELECT can_read_all_employees() AS can_read_all_employees) OR leads_employee(employee_id)));
ALTER POLICY "error_occurrence_las" ON public."error_occurrence" USING (( SELECT has_any_role(ARRAY['sales_manager'::text, 'ceo'::text, 'admin'::text]) AS has_any_role));
ALTER POLICY "error_report_read" ON public."error_report" USING ((( SELECT has_any_role(ARRAY['sales_manager'::text, 'ceo'::text, 'admin'::text]) AS has_any_role) OR (reporter_id = ( SELECT current_employee_id() AS current_employee_id))));
ALTER POLICY "error_report_follower_las" ON public."error_report_follower" USING (((employee_id = ( SELECT current_employee_id() AS current_employee_id)) OR ( SELECT has_any_role(ARRAY['sales_manager'::text, 'ceo'::text, 'admin'::text]) AS has_any_role)));
ALTER POLICY "essay_submission_read" ON public."essay_submission" USING (((employee_id = ( SELECT current_employee_id() AS current_employee_id)) OR ( SELECT has_any_role(ARRAY['sales_manager'::text, 'team_lead'::text, 'admin'::text, 'ceo'::text]) AS has_any_role)));
ALTER POLICY "file_object_read" ON public."file_object" USING ((((purpose = 'sick_certificate'::text) AND (EXISTS ( SELECT 1
   FROM sick_report r
  WHERE (r.id = file_object.sick_report_id)))) OR ((purpose = 'document_attachment'::text) AND (EXISTS ( SELECT 1
   FROM document d
  WHERE (d.id = file_object.document_id)))) OR ((purpose = 'roleplay'::text) AND ((subject_employee_id = ( SELECT current_employee_id() AS current_employee_id)) OR leads_employee(subject_employee_id) OR ( SELECT has_any_role(ARRAY['sales_manager'::text, 'ceo'::text]) AS has_any_role))) OR ((purpose = 'sales_order'::text) AND (EXISTS ( SELECT 1
   FROM sales_order o
  WHERE (o.id = file_object.sales_order_id)))) OR ((purpose = 'coaching'::text) AND ((subject_employee_id = ( SELECT current_employee_id() AS current_employee_id)) OR leads_employee(subject_employee_id) OR ( SELECT has_any_role(ARRAY['sales_manager'::text, 'ceo'::text]) AS has_any_role) OR (EXISTS ( SELECT 1
   FROM (coaching_task_event e
     JOIN coaching_task t ON ((t.id = e.task_id)))
  WHERE ((e.file_id = file_object.id) AND ((t.partner_id = ( SELECT current_employee_id() AS current_employee_id)) OR (t.created_by = ( SELECT current_employee_id() AS current_employee_id)))))))) OR ((purpose = 'call_recording'::text) AND ((subject_employee_id = ( SELECT current_employee_id() AS current_employee_id)) OR leads_employee(subject_employee_id) OR ( SELECT has_any_role(ARRAY['sales_manager'::text, 'ceo'::text]) AS has_any_role) OR ((sales_order_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM sales_order o
  WHERE (o.id = file_object.sales_order_id)))))) OR ((purpose = 'employment_contract'::text) AND (EXISTS ( SELECT 1
   FROM contract c
  WHERE (c.id = file_object.contract_id))))));
ALTER POLICY "guide_nudge_read" ON public."guide_nudge" USING (((employee_id = ( SELECT current_employee_id() AS current_employee_id)) OR ( SELECT can_read_all_employees() AS can_read_all_employees) OR leads_employee(employee_id)));
ALTER POLICY "guide_progress_read" ON public."guide_progress" USING (((employee_id = ( SELECT current_employee_id() AS current_employee_id)) OR ( SELECT can_read_all_employees() AS can_read_all_employees) OR leads_employee(employee_id)));
ALTER POLICY "hr_case_read" ON public."hr_case" USING (((employee_id = ( SELECT current_employee_id() AS current_employee_id)) OR ((NOT confidential) AND ((assigned_to = ( SELECT current_employee_id() AS current_employee_id)) OR ( SELECT has_any_role(ARRAY['sales_manager'::text, 'ceo'::text]) AS has_any_role))) OR (confidential AND ( SELECT has_any_role(ARRAY['sales_manager'::text, 'ceo'::text]) AS has_any_role))));
ALTER POLICY "hr_case_attachment_skriv" ON public."hr_case_attachment" WITH CHECK (((uploaded_by = ( SELECT current_employee_id() AS current_employee_id)) AND (EXISTS ( SELECT 1
   FROM hr_case c
  WHERE (c.id = hr_case_attachment.case_id)))));
ALTER POLICY "hr_case_confirmation_skriv" ON public."hr_case_confirmation" WITH CHECK (((confirmed_by = ( SELECT current_employee_id() AS current_employee_id)) AND (EXISTS ( SELECT 1
   FROM hr_case c
  WHERE ((c.id = hr_case_confirmation.case_id) AND (c.employee_id = ( SELECT current_employee_id() AS current_employee_id)) AND (c.resolved_at IS NOT NULL))))));
ALTER POLICY "hr_case_link_skriv" ON public."hr_case_link" WITH CHECK (((created_by = ( SELECT current_employee_id() AS current_employee_id)) AND (EXISTS ( SELECT 1
   FROM hr_case c
  WHERE (c.id = hr_case_link.case_id)))));
ALTER POLICY "hr_case_read_andra" ON public."hr_case_read" USING ((employee_id = ( SELECT current_employee_id() AS current_employee_id))) WITH CHECK ((employee_id = ( SELECT current_employee_id() AS current_employee_id)));
ALTER POLICY "hr_case_read_skriv" ON public."hr_case_read" WITH CHECK (((employee_id = ( SELECT current_employee_id() AS current_employee_id)) AND (EXISTS ( SELECT 1
   FROM hr_case c
  WHERE (c.id = hr_case_read.case_id)))));
ALTER POLICY "hr_case_read_ta_bort" ON public."hr_case_read" USING ((employee_id = ( SELECT current_employee_id() AS current_employee_id)));
ALTER POLICY "hr_case_reminder_skriv" ON public."hr_case_reminder" WITH CHECK (((sent_by = ( SELECT current_employee_id() AS current_employee_id)) AND ( SELECT has_any_role(ARRAY['sales_manager'::text, 'ceo'::text]) AS has_any_role) AND (EXISTS ( SELECT 1
   FROM hr_case c
  WHERE (c.id = hr_case_reminder.case_id)))));
ALTER POLICY "interview_scorecard_read" ON public."interview_scorecard" USING ((( SELECT far_rekrytera() AS far_rekrytera) OR (interviewer_id = ( SELECT current_employee_id() AS current_employee_id))));
ALTER POLICY "interview_slot_read" ON public."interview_slot" USING (( SELECT far_rekrytera() AS far_rekrytera));
ALTER POLICY "kv_assessment_read" ON public."kv_assessment" USING ((EXISTS ( SELECT 1
   FROM kv_call c
  WHERE ((c.id = kv_assessment.call_id) AND ((c.employee_id = ( SELECT current_employee_id() AS current_employee_id)) OR ( SELECT far_hantera_provision() AS far_hantera_provision))))));
ALTER POLICY "kv_call_read" ON public."kv_call" USING (((employee_id = ( SELECT current_employee_id() AS current_employee_id)) OR ( SELECT far_hantera_provision() AS far_hantera_provision)));
ALTER POLICY "kv_score_read" ON public."kv_score" USING ((EXISTS ( SELECT 1
   FROM kv_call c
  WHERE ((c.id = kv_score.call_id) AND ((c.employee_id = ( SELECT current_employee_id() AS current_employee_id)) OR ( SELECT far_hantera_provision() AS far_hantera_provision))))));
ALTER POLICY "late_arrival_read" ON public."late_arrival" USING (((employee_id = ( SELECT current_employee_id() AS current_employee_id)) OR ( SELECT can_read_all_employees() AS can_read_all_employees) OR leads_employee(employee_id)));
ALTER POLICY "late_arrival_month_read" ON public."late_arrival_month" USING (((employee_id = ( SELECT current_employee_id() AS current_employee_id)) OR ( SELECT can_read_all_employees() AS can_read_all_employees) OR leads_employee(employee_id)));
ALTER POLICY "lead_read" ON public."lead" USING ((( SELECT has_any_role(ARRAY['sales_manager'::text, 'ceo'::text, 'team_lead'::text, 'admin'::text]) AS has_any_role) OR (assigned_to = ( SELECT current_employee_id() AS current_employee_id))));
ALTER POLICY "lead_event_read" ON public."lead_event" USING ((( SELECT has_any_role(ARRAY['sales_manager'::text, 'ceo'::text, 'team_lead'::text, 'admin'::text]) AS has_any_role) OR (EXISTS ( SELECT 1
   FROM lead l
  WHERE ((l.id = lead_event.lead_id) AND (l.assigned_to = ( SELECT current_employee_id() AS current_employee_id)))))));
ALTER POLICY "learning_answer_read" ON public."learning_answer" USING (((employee_id = ( SELECT current_employee_id() AS current_employee_id)) OR ( SELECT has_any_role(ARRAY['sales_manager'::text, 'admin'::text, 'ceo'::text]) AS has_any_role) OR leads_employee(employee_id)));
ALTER POLICY "learning_note_mal_chef" ON public."learning_note" USING (((key ~~ 'mal:%'::text) AND (text ~~ '%"coach":true%'::text) AND (leads_employee(employee_id) OR ( SELECT can_read_all_employees() AS can_read_all_employees))));
ALTER POLICY "learning_note_read" ON public."learning_note" USING ((employee_id = ( SELECT current_employee_id() AS current_employee_id)));
ALTER POLICY "learning_rule_read" ON public."learning_rule" USING ((employee_id = ( SELECT current_employee_id() AS current_employee_id)));
ALTER POLICY "lecture_read" ON public."lecture" USING ((( SELECT current_employee_id() AS current_employee_id) IS NOT NULL));
ALTER POLICY "lecture_followup_read" ON public."lecture_followup" USING (((employee_id = ( SELECT current_employee_id() AS current_employee_id)) OR ( SELECT has_any_role(ARRAY['sales_manager'::text, 'admin'::text, 'ceo'::text]) AS has_any_role)));
ALTER POLICY "lecture_question_read" ON public."lecture_question" USING (((employee_id = ( SELECT current_employee_id() AS current_employee_id)) OR (kind = 'insikt'::text) OR ( SELECT has_any_role(ARRAY['sales_manager'::text, 'admin'::text, 'ceo'::text]) AS has_any_role) OR (EXISTS ( SELECT 1
   FROM lecture l
  WHERE ((l.id = lecture_question.lecture_id) AND (l.presenter_id = ( SELECT current_employee_id() AS current_employee_id)))))));
ALTER POLICY "lecture_signup_read" ON public."lecture_signup" USING (((employee_id = ( SELECT current_employee_id() AS current_employee_id)) OR ( SELECT has_any_role(ARRAY['sales_manager'::text, 'admin'::text, 'ceo'::text]) AS has_any_role) OR (EXISTS ( SELECT 1
   FROM lecture l
  WHERE ((l.id = lecture_signup.lecture_id) AND (l.presenter_id = ( SELECT current_employee_id() AS current_employee_id)))))));
ALTER POLICY "manager_commission_rate_read" ON public."manager_commission_rate" USING (( SELECT far_hantera_provision() AS far_hantera_provision));
ALTER POLICY "module_progress_read" ON public."module_progress" USING (((employee_id = ( SELECT current_employee_id() AS current_employee_id)) OR ( SELECT can_read_all_employees() AS can_read_all_employees) OR leads_employee(employee_id)));
ALTER POLICY "module_rating_read" ON public."module_rating" USING (((employee_id = ( SELECT current_employee_id() AS current_employee_id)) OR ( SELECT has_any_role(ARRAY['sales_manager'::text, 'admin'::text, 'ceo'::text]) AS has_any_role)));
ALTER POLICY "nav_preference_read" ON public."nav_preference" USING ((employee_id = ( SELECT current_employee_id() AS current_employee_id)));
ALTER POLICY "news_ack_read" ON public."news_ack" USING (((employee_id = ( SELECT current_employee_id() AS current_employee_id)) OR (EXISTS ( SELECT 1
   FROM news_post p
  WHERE ((p.id = news_ack.post_id) AND (p.author_id = ( SELECT current_employee_id() AS current_employee_id))))) OR ( SELECT has_any_role(ARRAY['sales_manager'::text, 'admin'::text, 'ceo'::text]) AS has_any_role)));
ALTER POLICY "news_post_read" ON public."news_post" USING ((((status = 'published'::text) AND matches_audience(audience_roles, audience_teams)) OR (author_id = ( SELECT current_employee_id() AS current_employee_id)) OR ( SELECT has_any_role(ARRAY['sales_manager'::text, 'admin'::text, 'ceo'::text]) AS has_any_role)));
ALTER POLICY "notification_dismissed_read" ON public."notification_dismissed" USING ((employee_id = ( SELECT current_employee_id() AS current_employee_id)));
ALTER POLICY "notification_event_read" ON public."notification_event" USING ((employee_id = ( SELECT current_employee_id() AS current_employee_id)));
ALTER POLICY "notification_seen_read" ON public."notification_seen" USING ((employee_id = ( SELECT current_employee_id() AS current_employee_id)));
ALTER POLICY "offboarding_task_read" ON public."offboarding_task" USING (( SELECT can_read_all_employees() AS can_read_all_employees));
ALTER POLICY "onboarding_rule_read" ON public."onboarding_rule" USING (( SELECT can_read_all_employees() AS can_read_all_employees));
ALTER POLICY "onboarding_task_read" ON public."onboarding_task" USING (( SELECT can_read_all_employees() AS can_read_all_employees));
ALTER POLICY "onboarding_template_read" ON public."onboarding_template" USING (( SELECT can_read_all_employees() AS can_read_all_employees));
ALTER POLICY "onboarding_template_item_read" ON public."onboarding_template_item" USING (( SELECT can_read_all_employees() AS can_read_all_employees));
ALTER POLICY "one_on_one_point_read" ON public."one_on_one_point" USING (((employee_id = ( SELECT current_employee_id() AS current_employee_id)) OR (added_by = ( SELECT current_employee_id() AS current_employee_id)) OR ( SELECT can_read_all_employees() AS can_read_all_employees) OR leads_employee(employee_id)));
ALTER POLICY "order_grattis_read" ON public."order_grattis" USING ((employee_id = ( SELECT current_employee_id() AS current_employee_id)));
ALTER POLICY "order_list_seen_las" ON public."order_list_seen" USING ((employee_id = ( SELECT current_employee_id() AS current_employee_id)));
ALTER POLICY "order_manager_commission_read" ON public."order_manager_commission" USING (((manager_id = ( SELECT current_employee_id() AS current_employee_id)) OR ( SELECT far_hantera_provision() AS far_hantera_provision)));
ALTER POLICY "payroll_adjustment_read" ON public."payroll_adjustment" USING (((employee_id = ( SELECT current_employee_id() AS current_employee_id)) OR ( SELECT has_any_role(ARRAY['sales_manager'::text, 'ceo'::text, 'finance'::text, 'admin'::text]) AS has_any_role)));
ALTER POLICY "payroll_export_column_read" ON public."payroll_export_column" USING (( SELECT has_any_role(ARRAY['sales_manager'::text, 'ceo'::text, 'finance'::text, 'admin'::text]) AS has_any_role));
ALTER POLICY "payroll_period_read" ON public."payroll_period" USING (( SELECT has_any_role(ARRAY['sales_manager'::text, 'ceo'::text, 'finance'::text, 'admin'::text]) AS has_any_role));
ALTER POLICY "payroll_period_sent_read" ON public."payroll_period_sent" USING (( SELECT has_any_role(ARRAY['sales_manager'::text, 'ceo'::text, 'finance'::text, 'admin'::text]) AS has_any_role));
ALTER POLICY "payroll_row_read" ON public."payroll_row" USING (((employee_id = ( SELECT current_employee_id() AS current_employee_id)) OR ( SELECT has_any_role(ARRAY['sales_manager'::text, 'ceo'::text, 'finance'::text, 'admin'::text]) AS has_any_role)));
ALTER POLICY "phone_call_read" ON public."phone_call" USING (((employee_id = ( SELECT current_employee_id() AS current_employee_id)) OR leads_employee(employee_id) OR ( SELECT has_any_role(ARRAY['sales_manager'::text, 'ceo'::text]) AS has_any_role) OR ((sales_order_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM sales_order o
  WHERE (o.id = phone_call.sales_order_id))))));
ALTER POLICY "phone_identity_read" ON public."phone_identity" USING (((employee_id = ( SELECT current_employee_id() AS current_employee_id)) OR leads_employee(employee_id) OR ( SELECT has_any_role(ARRAY['sales_manager'::text, 'ceo'::text]) AS has_any_role)));
ALTER POLICY "project_read" ON public."project" USING (projekt_synligt(id, ( SELECT current_employee_id() AS current_employee_id)));
ALTER POLICY "project_member_read" ON public."project_member" USING (projekt_synligt(project_id, ( SELECT current_employee_id() AS current_employee_id)));
ALTER POLICY "project_message_read_policy" ON public."project_message" USING (projekt_synligt(project_id, ( SELECT current_employee_id() AS current_employee_id)));
ALTER POLICY "project_message_read_egen" ON public."project_message_read" USING ((employee_id = ( SELECT current_employee_id() AS current_employee_id)));
ALTER POLICY "push_sent_read" ON public."push_sent" USING ((employee_id = ( SELECT current_employee_id() AS current_employee_id)));
ALTER POLICY "push_subscription_read" ON public."push_subscription" USING ((employee_id = ( SELECT current_employee_id() AS current_employee_id)));
ALTER POLICY "recruitment_goal_read" ON public."recruitment_goal" USING (( SELECT far_rekrytera() AS far_rekrytera));
ALTER POLICY "recruitment_policy_read" ON public."recruitment_policy" USING (( SELECT far_rekrytera() AS far_rekrytera));
ALTER POLICY "recruitment_position_read" ON public."recruitment_position" USING (( SELECT far_rekrytera() AS far_rekrytera));
ALTER POLICY "recruitment_source_read" ON public."recruitment_source" USING (( SELECT far_rekrytera() AS far_rekrytera));
ALTER POLICY "recruitment_template_read" ON public."recruitment_template" USING (( SELECT far_rekrytera() AS far_rekrytera));
ALTER POLICY "revenue_entry_read" ON public."revenue_entry" USING (( SELECT har_lonekostnadsbehorighet() AS har_lonekostnadsbehorighet));
ALTER POLICY "roleplay_self_read" ON public."roleplay_self" USING (((employee_id = ( SELECT current_employee_id() AS current_employee_id)) OR ( SELECT has_any_role(ARRAY['sales_manager'::text, 'ceo'::text]) AS has_any_role) OR leads_employee(employee_id)));
ALTER POLICY "roleplay_submission_read" ON public."roleplay_submission" USING (((employee_id = ( SELECT current_employee_id() AS current_employee_id)) OR leads_employee(employee_id) OR ( SELECT has_any_role(ARRAY['sales_manager'::text, 'ceo'::text]) AS has_any_role)));
ALTER POLICY "salary_basis_read" ON public."salary_basis" USING (( SELECT har_lonekostnadsbehorighet() AS har_lonekostnadsbehorighet));
ALTER POLICY "sales_order_read" ON public."sales_order" USING (((salesperson_id = ( SELECT current_employee_id() AS current_employee_id)) OR ( SELECT far_hantera_order() AS far_hantera_order)));
ALTER POLICY "sales_order_service_read" ON public."sales_order_service" USING ((EXISTS ( SELECT 1
   FROM sales_order o
  WHERE ((o.id = sales_order_service.order_id) AND ((o.salesperson_id = ( SELECT current_employee_id() AS current_employee_id)) OR ( SELECT far_hantera_order() AS far_hantera_order))))));
ALTER POLICY "sales_target_read" ON public."sales_target" USING (((employee_id = ( SELECT current_employee_id() AS current_employee_id)) OR ( SELECT far_hantera_provision() AS far_hantera_provision)));
ALTER POLICY "scheduled_break_read" ON public."scheduled_break" USING (((scope = 'company'::text) OR ((scope = 'team'::text) AND (team_id = ( SELECT e.team_id
   FROM employee e
  WHERE (e.id = ( SELECT current_employee_id() AS current_employee_id))))) OR (employee_id = ( SELECT current_employee_id() AS current_employee_id)) OR ( SELECT can_read_all_employees() AS can_read_all_employees) OR leads_employee(employee_id)));
ALTER POLICY "sick_deadline_read" ON public."sick_deadline" USING ((EXISTS ( SELECT 1
   FROM sick_report r
  WHERE ((r.id = sick_deadline.report_id) AND ((r.employee_id = ( SELECT current_employee_id() AS current_employee_id)) OR leads_employee(r.employee_id) OR ( SELECT has_any_role(ARRAY['sales_manager'::text, 'ceo'::text]) AS has_any_role))))));
ALTER POLICY "sick_note_read" ON public."sick_note" USING ((leads_employee(employee_id) OR ( SELECT has_any_role(ARRAY['sales_manager'::text, 'ceo'::text]) AS has_any_role)));
ALTER POLICY "sick_report_read" ON public."sick_report" USING (((employee_id = ( SELECT current_employee_id() AS current_employee_id)) OR leads_employee(employee_id) OR ( SELECT has_any_role(ARRAY['sales_manager'::text, 'ceo'::text]) AS has_any_role)));
ALTER POLICY "sick_signal_ack_las" ON public."sick_signal_ack" USING (( SELECT has_any_role(ARRAY['sales_manager'::text, 'ceo'::text]) AS has_any_role));
ALTER POLICY "staffing_cap_read" ON public."staffing_cap" USING ((NOT ( SELECT kraver_losenordsbyte() AS kraver_losenordsbyte)));
ALTER POLICY "task_read" ON public."task" USING ((uppgift_synlig(id, ( SELECT current_employee_id() AS current_employee_id)) OR ((parent_id IS NOT NULL) AND uppgift_synlig(parent_id, ( SELECT current_employee_id() AS current_employee_id)))));
ALTER POLICY "task_day_las" ON public."task_day" USING ((employee_id = ( SELECT current_employee_id() AS current_employee_id)));
ALTER POLICY "task_event_read" ON public."task_event" USING (uppgift_synlig(task_id, ( SELECT current_employee_id() AS current_employee_id)));
ALTER POLICY "task_focus_las" ON public."task_focus" USING ((employee_id = ( SELECT current_employee_id() AS current_employee_id)));
ALTER POLICY "task_link_read" ON public."task_link" USING (uppgift_synlig(task_id, ( SELECT current_employee_id() AS current_employee_id)));
ALTER POLICY "task_member_read" ON public."task_member" USING (uppgift_synlig(task_id, ( SELECT current_employee_id() AS current_employee_id)));
ALTER POLICY "task_series_read" ON public."task_series" USING (((( SELECT current_employee_id() AS current_employee_id) IS NOT NULL) AND ((assignee_id = ( SELECT current_employee_id() AS current_employee_id)) OR (created_by = ( SELECT current_employee_id() AS current_employee_id)))));
ALTER POLICY "task_template_read" ON public."task_template" USING (((( SELECT current_employee_id() AS current_employee_id) IS NOT NULL) AND (shared OR (created_by = ( SELECT current_employee_id() AS current_employee_id)))));
ALTER POLICY "team_read" ON public."team" USING ((NOT ( SELECT kraver_losenordsbyte() AS kraver_losenordsbyte)));
ALTER POLICY "tid_view_log_read" ON public."tid_view_log" USING (((employee_id = ( SELECT current_employee_id() AS current_employee_id)) OR (viewer_id = ( SELECT current_employee_id() AS current_employee_id)) OR ( SELECT can_read_all_employees() AS can_read_all_employees)));
ALTER POLICY "time_day_ack_read" ON public."time_day_ack" USING (((employee_id = ( SELECT current_employee_id() AS current_employee_id)) OR ( SELECT can_read_all_employees() AS can_read_all_employees) OR leads_employee(employee_id)));
ALTER POLICY "time_event_read" ON public."time_event" USING (((employee_id = ( SELECT current_employee_id() AS current_employee_id)) OR ( SELECT can_read_all_employees() AS can_read_all_employees) OR leads_employee(employee_id)));
ALTER POLICY "time_week_check_read" ON public."time_week_check" USING (((employee_id = ( SELECT current_employee_id() AS current_employee_id)) OR ( SELECT can_read_all_employees() AS can_read_all_employees) OR leads_employee(employee_id)));
ALTER POLICY "vacation_wish_round_las" ON public."vacation_wish_round" USING ((( SELECT current_employee_id() AS current_employee_id) IS NOT NULL));
ALTER POLICY "weekly_review_read" ON public."weekly_review" USING ((employee_id = ( SELECT current_employee_id() AS current_employee_id)));
ALTER POLICY "work_schedule_read" ON public."work_schedule" USING (((scope = 'company'::text) OR ((scope = 'team'::text) AND (team_id = ( SELECT e.team_id
   FROM employee e
  WHERE (e.id = ( SELECT current_employee_id() AS current_employee_id))))) OR (employee_id = ( SELECT current_employee_id() AS current_employee_id)) OR ( SELECT can_read_all_employees() AS can_read_all_employees) OR leads_employee(employee_id)));
ALTER POLICY "work_schedule_seen_read" ON public."work_schedule_seen" USING (((employee_id = ( SELECT current_employee_id() AS current_employee_id)) OR ( SELECT can_read_all_employees() AS can_read_all_employees) OR leads_employee(employee_id)));
ALTER POLICY "work_time_journal_read" ON public."work_time_journal" USING (((employee_id = ( SELECT current_employee_id() AS current_employee_id)) OR ( SELECT has_any_role(ARRAY['sales_manager'::text, 'admin'::text]) AS has_any_role)));
