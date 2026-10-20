-- Återställer policyerna som de var före 0155_rls_initplan. KÖRS BARA FÖR ATT BACKA 0155.
-- Ligger utanför supabase/migrations, så apply-sql.mjs kör den aldrig. Kör för hand:
--   node -e "…client.query(fs.readFileSync('supabase/ner/0155_rls_initplan.sql','utf8'))…"
-- och ta bort raden 0155_rls_initplan ur schema_migrations efteråt.

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $vakt$
DECLARE avviker text;
BEGIN
  SELECT string_agg(v.t || '.' || v.p, ', ') INTO avviker
  FROM (VALUES
    ('public', 'absence_balance', 'absence_balance_read', 'b6d024bda625239d1527cdbe831abf50', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'absence_blackout', 'absence_blackout_read', '387a4b783f33e1a513e0861bcd35bda5', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'absence_call_order', 'absence_call_order_read', '387a4b783f33e1a513e0861bcd35bda5', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'absence_policy', 'absence_policy_read', '387a4b783f33e1a513e0861bcd35bda5', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'absence_reminder', 'absence_reminder_read', '5b093c458ca18bb5499ee3ca124a2c55', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'absence_request', 'absence_request_read', 'b6d024bda625239d1527cdbe831abf50', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'absence_type', 'absence_type_read', '387a4b783f33e1a513e0861bcd35bda5', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'attendance_incident', 'attendance_incident_read', '340f6fb9744daa458b457ac4c8b5300b', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'audit_log', 'audit_log_read', '13956ba262bed60e9dfce028bcc6568a', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'break_deviation', 'break_deviation_read', '934027327e3a17bfbbbe3184d1aa745e', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'break_deviation_month', 'break_deviation_month_read', '934027327e3a17bfbbbe3184d1aa745e', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'break_schedule_ack', 'break_schedule_ack_read', '934027327e3a17bfbbbe3184d1aa745e', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'calendar_attendee', 'calendar_attendee_read', 'd363b9ab70ff8cfa197420b0c334e701', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'calendar_event', 'calendar_event_read', 'f3cd11400ea387c25d988fdd3337aeb2', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'calendar_feed', 'calendar_feed_read', 'f1a9a3210179702453f84d6ad3bfe78c', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'calendar_series', 'calendar_series_read', 'b5a1272625b11763fc614ab8b9179489', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'calendar_share', 'calendar_share_read', 'f4e37b2105f9fe26c4c8270c52fa79b9', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'candidate', 'candidate_read', 'd63b986a10b62a7eebd53d806e76659a', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'candidate_booking', 'candidate_booking_read', 'd63b986a10b62a7eebd53d806e76659a', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'candidate_merit_request', 'candidate_merit_request_read', 'd63b986a10b62a7eebd53d806e76659a', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'candidate_message', 'candidate_message_read', 'd63b986a10b62a7eebd53d806e76659a', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'candidate_note', 'candidate_note_read', 'd63b986a10b62a7eebd53d806e76659a', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'candidate_stage_event', 'candidate_stage_event_read', 'd63b986a10b62a7eebd53d806e76659a', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'case_category', 'case_category_read', '387a4b783f33e1a513e0861bcd35bda5', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'case_message', 'case_message_read', 'f6d6ad5a74c815aa4e6af89b9454e653', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'case_outcome', 'case_outcome_andra', 'd3db7a059bf9f4d7c903c167531ea27f', 'd3db7a059bf9f4d7c903c167531ea27f'),
    ('public', 'case_outcome', 'case_outcome_las', '9d314e679ac37d777161faf1dd2ac925', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'case_outcome', 'case_outcome_skriv', 'd41d8cd98f00b204e9800998ecf8427e', 'e053820153fb953fb9f9e696f09fbb41'),
    ('public', 'case_outcome', 'case_outcome_ta_bort', 'd3db7a059bf9f4d7c903c167531ea27f', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'certification', 'certification_read', '934027327e3a17bfbbbe3184d1aa745e', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'coaching_drill', 'coaching_drill_read', '5a5ab1fe0bb2a0d50c46b14b074cdf70', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'coaching_meeting_request', 'coaching_meeting_request_read', '934027327e3a17bfbbbe3184d1aa745e', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'coaching_message', 'coaching_message_read', 'c3405c97ad677304a73415aa5933f069', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'coaching_person_focus', 'coaching_person_focus_read', '934027327e3a17bfbbbe3184d1aa745e', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'coaching_session', 'coaching_session_read', 'dbbe1d98a4bf43d9acb640559122fb6f', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'coaching_task', 'coaching_task_read', '8db4cee303fc37794c453a8d95a37c3f', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'coaching_template', 'coaching_template_read', 'bd6294fe503fbc139d6f07d43a8b7514', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'commission_entry', 'commission_entry_read', 'acc0a032827649ccd4d99356a2a9b3cf', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'commission_history', 'commission_history_las', 'acc0a032827649ccd4d99356a2a9b3cf', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'company', 'company_read', '387a4b783f33e1a513e0861bcd35bda5', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'compliance_gate', 'compliance_gate_read', '387a4b783f33e1a513e0861bcd35bda5', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'contract', 'contract_read', 'c289da56d818e5b05ceaa86699f06ff2', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'contract_template', 'contract_template_read', '8f2433581851396108ec0f9e65f4b03d', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'cost_calculation', 'cost_calculation_read', '845ae96c40aa4daf15164901131ebae0', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'cost_rate', 'cost_rate_read', '845ae96c40aa4daf15164901131ebae0', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'course', 'course_read', '1aa6c885a45c11625c5d45cbd6c89cc2', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'course_attempt', 'course_attempt_read', '934027327e3a17bfbbbe3184d1aa745e', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'course_wish', 'course_wish_read', '5da1c7e2cdd94e6187529243b231b131', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'document', 'document_read', 'e952e4184b953e5ea059e79aacb0d558', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'document_ack', 'document_ack_read', 'ee5a0feeeb8445f6b8a1abbaae4d99a6', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'document_area_watch', 'document_area_watch_read', '8cbd60d9121088ac91bf10c782684f03', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'document_feedback', 'document_feedback_read', 'db90456a647528fa9f8201a538a91c9a', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'document_note', 'document_note_read', '8cbd60d9121088ac91bf10c782684f03', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'document_run', 'document_run_read', '87862908866667391b3b84338c50b23a', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'document_saved', 'document_saved_read', '8cbd60d9121088ac91bf10c782684f03', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'document_search_miss', 'document_search_miss_read', '8f881866620da5ab2aff309863ecf602', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'document_view', 'document_view_read', '5da1c7e2cdd94e6187529243b231b131', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'document_view_log', 'document_view_log_read', '5da1c7e2cdd94e6187529243b231b131', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'employee', 'employee_read', 'bb99ee21c4ae20ac755d368e98e7b0f8', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'employee_access_level', 'employee_access_level_read', '8809204b98f7f60acc15ca91494a05b4', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'employee_onboarding', 'employee_onboarding_read', 'dcedd3096b54e7566556893fa2d6c33e', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'employee_permission', 'employee_permission_read', 'f1a9a3210179702453f84d6ad3bfe78c', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'employee_role', 'employee_role_read', '934027327e3a17bfbbbe3184d1aa745e', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'error_occurrence', 'error_occurrence_las', '13956ba262bed60e9dfce028bcc6568a', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'error_report', 'error_report_read', '4a173a8fc3faae3daa6ae1e0e506b73c', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'error_report_follower', 'error_report_follower_las', '62097236338966cd1e9328e313287911', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'essay_submission', 'essay_submission_read', 'db3f6c69b3cf7ce11bbb748e2aa8fb74', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'file_object', 'file_object_read', '043f62c7171804f08f54f8fa27994e20', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'guide_nudge', 'guide_nudge_read', '934027327e3a17bfbbbe3184d1aa745e', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'guide_progress', 'guide_progress_read', '934027327e3a17bfbbbe3184d1aa745e', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'hr_case', 'hr_case_read', 'da8b7bfc13c875c9a0677b25fddf1f19', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'hr_case_attachment', 'hr_case_attachment_skriv', 'd41d8cd98f00b204e9800998ecf8427e', '016d4c1378dd432080db4168b37c42c6'),
    ('public', 'hr_case_confirmation', 'hr_case_confirmation_skriv', 'd41d8cd98f00b204e9800998ecf8427e', '627fa7fda67c909a7929dab311e9eb60'),
    ('public', 'hr_case_link', 'hr_case_link_skriv', 'd41d8cd98f00b204e9800998ecf8427e', '949da596e8cfbfcdcebf5f38989a9d88'),
    ('public', 'hr_case_read', 'hr_case_read_andra', '8cbd60d9121088ac91bf10c782684f03', '8cbd60d9121088ac91bf10c782684f03'),
    ('public', 'hr_case_read', 'hr_case_read_skriv', 'd41d8cd98f00b204e9800998ecf8427e', 'dfc6c1927830be0862e1ff54ee190657'),
    ('public', 'hr_case_read', 'hr_case_read_ta_bort', '8cbd60d9121088ac91bf10c782684f03', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'hr_case_reminder', 'hr_case_reminder_skriv', 'd41d8cd98f00b204e9800998ecf8427e', '0c9983f44e5c5bc0b559b4c6737dea4a'),
    ('public', 'interview_scorecard', 'interview_scorecard_read', '5a9c50c333927a3af204d3808f4aea3c', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'interview_slot', 'interview_slot_read', 'd63b986a10b62a7eebd53d806e76659a', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'kv_assessment', 'kv_assessment_read', '21aac1e288a5c19667ba9eddbe842db1', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'kv_call', 'kv_call_read', 'acc0a032827649ccd4d99356a2a9b3cf', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'kv_score', 'kv_score_read', 'a86ebbfd250d80e427b00c8bd91ba5f0', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'late_arrival', 'late_arrival_read', '934027327e3a17bfbbbe3184d1aa745e', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'late_arrival_month', 'late_arrival_month_read', '934027327e3a17bfbbbe3184d1aa745e', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'lead', 'lead_read', '2f13aa7a236bde54aee9e046a6681eb9', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'lead_event', 'lead_event_read', 'f23978cd40d1425fa94923db6d46d84b', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'learning_answer', 'learning_answer_read', 'a9e889a4e8868bef7f35314dc153dd2f', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'learning_note', 'learning_note_mal_chef', '0ce122e38d1cc2c348b22ea3ea82e586', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'learning_note', 'learning_note_read', '8cbd60d9121088ac91bf10c782684f03', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'learning_rule', 'learning_rule_read', '8cbd60d9121088ac91bf10c782684f03', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'lecture', 'lecture_read', '9d314e679ac37d777161faf1dd2ac925', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'lecture_followup', 'lecture_followup_read', '5da1c7e2cdd94e6187529243b231b131', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'lecture_question', 'lecture_question_read', '8bfc2d4be4b60d432a35702681933371', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'lecture_signup', 'lecture_signup_read', '03ac79359de800377faebaba1b3329f0', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'manager_commission_rate', 'manager_commission_rate_read', 'e5fb0b6d6f9d78805e22f9e6cab5585f', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'module_progress', 'module_progress_read', '934027327e3a17bfbbbe3184d1aa745e', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'module_rating', 'module_rating_read', '5da1c7e2cdd94e6187529243b231b131', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'nav_preference', 'nav_preference_read', '8cbd60d9121088ac91bf10c782684f03', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'news_post', 'news_post_read', '66c19cead9ceadf6f7548839884234cf', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'notification_dismissed', 'notification_dismissed_read', '8cbd60d9121088ac91bf10c782684f03', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'notification_event', 'notification_event_read', '8cbd60d9121088ac91bf10c782684f03', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'notification_seen', 'notification_seen_read', '8cbd60d9121088ac91bf10c782684f03', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'offboarding_task', 'offboarding_task_read', 'dcedd3096b54e7566556893fa2d6c33e', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'onboarding_rule', 'onboarding_rule_read', 'dcedd3096b54e7566556893fa2d6c33e', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'onboarding_task', 'onboarding_task_read', 'dcedd3096b54e7566556893fa2d6c33e', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'onboarding_template', 'onboarding_template_read', 'dcedd3096b54e7566556893fa2d6c33e', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'onboarding_template_item', 'onboarding_template_item_read', 'dcedd3096b54e7566556893fa2d6c33e', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'one_on_one_point', 'one_on_one_point_read', 'c3178d8cf9c10ac2c0d222ce9f7929f4', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'order_grattis', 'order_grattis_read', '8cbd60d9121088ac91bf10c782684f03', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'order_list_seen', 'order_list_seen_las', '8cbd60d9121088ac91bf10c782684f03', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'order_manager_commission', 'order_manager_commission_read', 'b8174a84b0f79207f94ea6ee687684a9', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'payroll_adjustment', 'payroll_adjustment_read', 'e8a869e2b86dce854c56937bd8d2f62d', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'payroll_export_column', 'payroll_export_column_read', '777fa9079a246af0cb54b7b88460cc0c', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'payroll_period', 'payroll_period_read', '777fa9079a246af0cb54b7b88460cc0c', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'payroll_period_sent', 'payroll_period_sent_read', '777fa9079a246af0cb54b7b88460cc0c', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'payroll_row', 'payroll_row_read', 'e8a869e2b86dce854c56937bd8d2f62d', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'phone_call', 'phone_call_read', '1558c2861f0fcb5758d3d2811631c4e7', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'phone_identity', 'phone_identity_read', 'b6d024bda625239d1527cdbe831abf50', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'project', 'project_read', 'e49be7f62c3c0d54fb1e5816e8a52ce1', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'project_member', 'project_member_read', 'f6f36f066950690591688c5b56c96526', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'project_message', 'project_message_read_policy', 'f6f36f066950690591688c5b56c96526', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'project_message_read', 'project_message_read_egen', '8cbd60d9121088ac91bf10c782684f03', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'push_sent', 'push_sent_read', '8cbd60d9121088ac91bf10c782684f03', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'push_subscription', 'push_subscription_read', '8cbd60d9121088ac91bf10c782684f03', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'recruitment_goal', 'recruitment_goal_read', 'd63b986a10b62a7eebd53d806e76659a', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'recruitment_policy', 'recruitment_policy_read', 'd63b986a10b62a7eebd53d806e76659a', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'recruitment_position', 'recruitment_position_read', 'd63b986a10b62a7eebd53d806e76659a', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'recruitment_source', 'recruitment_source_read', 'd63b986a10b62a7eebd53d806e76659a', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'recruitment_template', 'recruitment_template_read', 'd63b986a10b62a7eebd53d806e76659a', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'revenue_entry', 'revenue_entry_read', '845ae96c40aa4daf15164901131ebae0', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'roleplay_self', 'roleplay_self_read', 'cf2f199129b5838c4c8dda512e39c7b1', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'roleplay_submission', 'roleplay_submission_read', 'b6d024bda625239d1527cdbe831abf50', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'salary_basis', 'salary_basis_read', '845ae96c40aa4daf15164901131ebae0', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'sales_order', 'sales_order_read', 'bd493932b343741de5f8db83aa4ca32c', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'sales_order_service', 'sales_order_service_read', 'ebcad577897e72f4bbcde05a4b8cfffe', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'sales_target', 'sales_target_read', 'acc0a032827649ccd4d99356a2a9b3cf', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'scheduled_break', 'scheduled_break_read', '59a8cb3e137583df949c881e097080b9', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'sick_deadline', 'sick_deadline_read', 'e562b6d355b18654d3c8e4221b974811', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'sick_note', 'sick_note_read', '30eaea2f6796d62fcf6c5983d45fb13b', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'sick_report', 'sick_report_read', 'b6d024bda625239d1527cdbe831abf50', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'sick_signal_ack', 'sick_signal_ack_las', 'd3db7a059bf9f4d7c903c167531ea27f', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'staffing_cap', 'staffing_cap_read', '387a4b783f33e1a513e0861bcd35bda5', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'task', 'task_read', '46a81d76fbb8a18b8843b3d4df026ce2', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'task_day', 'task_day_las', '8cbd60d9121088ac91bf10c782684f03', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'task_event', 'task_event_read', '13043a7a10af6fabc39b1005aeced5b9', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'task_focus', 'task_focus_las', '8cbd60d9121088ac91bf10c782684f03', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'task_link', 'task_link_read', '13043a7a10af6fabc39b1005aeced5b9', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'task_member', 'task_member_read', '13043a7a10af6fabc39b1005aeced5b9', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'task_series', 'task_series_read', '0c48bd8d3b13f5e67c8413aae7e2c0b6', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'task_template', 'task_template_read', '4aa663ecdacf658046537b63841ced5d', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'team', 'team_read', '387a4b783f33e1a513e0861bcd35bda5', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'tid_view_log', 'tid_view_log_read', 'fd28698a0c4a695fc9919eaf6d594dc5', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'time_day_ack', 'time_day_ack_read', '934027327e3a17bfbbbe3184d1aa745e', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'time_event', 'time_event_read', '934027327e3a17bfbbbe3184d1aa745e', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'time_week_check', 'time_week_check_read', '934027327e3a17bfbbbe3184d1aa745e', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'vacation_wish_round', 'vacation_wish_round_las', '9d314e679ac37d777161faf1dd2ac925', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'weekly_review', 'weekly_review_read', '8cbd60d9121088ac91bf10c782684f03', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'work_schedule', 'work_schedule_read', '59a8cb3e137583df949c881e097080b9', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'work_schedule_seen', 'work_schedule_seen_read', '934027327e3a17bfbbbe3184d1aa745e', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('public', 'work_time_journal', 'work_time_journal_read', '8a061585ef6486c1bc1f3ddd3273e829', 'd41d8cd98f00b204e9800998ecf8427e')
  ) AS v(s, t, p, q, w)
  LEFT JOIN pg_policies x ON x.schemaname = v.s AND x.tablename = v.t AND x.policyname = v.p
  WHERE x.policyname IS NULL OR md5(coalesce(x.qual, '')) <> v.q OR md5(coalesce(x.with_check, '')) <> v.w;
  IF avviker IS NOT NULL THEN
    RAISE EXCEPTION 'Återställningen av 0155: policyer har ändrats sedan filen skrevs (%). Skriv om filen med ~/nav2-utkast/delar/fart/rls/generera.mjs.', avviker;
  END IF;
END $vakt$;

ALTER POLICY "absence_balance_read" ON public."absence_balance" USING (((employee_id = current_employee_id()) OR leads_employee(employee_id) OR has_any_role(ARRAY['sales_manager'::text, 'ceo'::text])));
ALTER POLICY "absence_blackout_read" ON public."absence_blackout" USING ((NOT kraver_losenordsbyte()));
ALTER POLICY "absence_call_order_read" ON public."absence_call_order" USING ((NOT kraver_losenordsbyte()));
ALTER POLICY "absence_policy_read" ON public."absence_policy" USING ((NOT kraver_losenordsbyte()));
ALTER POLICY "absence_reminder_read" ON public."absence_reminder" USING (((employee_id = current_employee_id()) OR ((visible_to_manager_from <= now()) AND (leads_employee(employee_id) OR has_any_role(ARRAY['sales_manager'::text, 'ceo'::text])))));
ALTER POLICY "absence_request_read" ON public."absence_request" USING (((employee_id = current_employee_id()) OR leads_employee(employee_id) OR has_any_role(ARRAY['sales_manager'::text, 'ceo'::text])));
ALTER POLICY "absence_type_read" ON public."absence_type" USING ((NOT kraver_losenordsbyte()));
ALTER POLICY "attendance_incident_read" ON public."attendance_incident" USING ((((employee_id = current_employee_id()) AND (status = ANY (ARRAY['godkand'::text, 'havd'::text]))) OR far_hantera_provision() OR far_godkanna_franvaro_for(employee_id)));
ALTER POLICY "audit_log_read" ON public."audit_log" USING (has_any_role(ARRAY['sales_manager'::text, 'ceo'::text, 'admin'::text]));
ALTER POLICY "break_deviation_read" ON public."break_deviation" USING (((employee_id = current_employee_id()) OR can_read_all_employees() OR leads_employee(employee_id)));
ALTER POLICY "break_deviation_month_read" ON public."break_deviation_month" USING (((employee_id = current_employee_id()) OR can_read_all_employees() OR leads_employee(employee_id)));
ALTER POLICY "break_schedule_ack_read" ON public."break_schedule_ack" USING (((employee_id = current_employee_id()) OR can_read_all_employees() OR leads_employee(employee_id)));
ALTER POLICY "calendar_attendee_read" ON public."calendar_attendee" USING ((((event_id IS NOT NULL) AND lk_ser_handelse(event_id, current_employee_id())) OR ((series_id IS NOT NULL) AND lk_ser_serie(series_id, current_employee_id()))));
ALTER POLICY "calendar_event_read" ON public."calendar_event" USING (lk_ser_handelse(id, current_employee_id()));
ALTER POLICY "calendar_feed_read" ON public."calendar_feed" USING (((employee_id = current_employee_id()) OR has_any_role(ARRAY['sales_manager'::text, 'ceo'::text])));
ALTER POLICY "calendar_series_read" ON public."calendar_series" USING (lk_ser_serie(id, current_employee_id()));
ALTER POLICY "calendar_share_read" ON public."calendar_share" USING (((owner_id = current_employee_id()) OR (viewer_id = current_employee_id())));
ALTER POLICY "candidate_read" ON public."candidate" USING (far_rekrytera());
ALTER POLICY "candidate_booking_read" ON public."candidate_booking" USING (far_rekrytera());
ALTER POLICY "candidate_merit_request_read" ON public."candidate_merit_request" USING (far_rekrytera());
ALTER POLICY "candidate_message_read" ON public."candidate_message" USING (far_rekrytera());
ALTER POLICY "candidate_note_read" ON public."candidate_note" USING (far_rekrytera());
ALTER POLICY "candidate_stage_event_read" ON public."candidate_stage_event" USING (far_rekrytera());
ALTER POLICY "case_category_read" ON public."case_category" USING ((NOT kraver_losenordsbyte()));
ALTER POLICY "case_message_read" ON public."case_message" USING ((EXISTS ( SELECT 1
   FROM hr_case c
  WHERE ((c.id = case_message.case_id) AND ((c.employee_id = current_employee_id()) OR ((NOT c.confidential) AND ((c.assigned_to = current_employee_id()) OR has_any_role(ARRAY['sales_manager'::text, 'ceo'::text]))) OR (c.confidential AND has_any_role(ARRAY['sales_manager'::text, 'ceo'::text])))))));
ALTER POLICY "case_outcome_andra" ON public."case_outcome" USING (has_any_role(ARRAY['sales_manager'::text, 'ceo'::text])) WITH CHECK (has_any_role(ARRAY['sales_manager'::text, 'ceo'::text]));
ALTER POLICY "case_outcome_las" ON public."case_outcome" USING ((current_employee_id() IS NOT NULL));
ALTER POLICY "case_outcome_skriv" ON public."case_outcome" WITH CHECK (((created_by = current_employee_id()) AND has_any_role(ARRAY['sales_manager'::text, 'ceo'::text])));
ALTER POLICY "case_outcome_ta_bort" ON public."case_outcome" USING (has_any_role(ARRAY['sales_manager'::text, 'ceo'::text]));
ALTER POLICY "certification_read" ON public."certification" USING (((employee_id = current_employee_id()) OR can_read_all_employees() OR leads_employee(employee_id)));
ALTER POLICY "coaching_drill_read" ON public."coaching_drill" USING (((employee_id = current_employee_id()) OR (created_by = current_employee_id()) OR can_read_all_employees() OR leads_employee(employee_id)));
ALTER POLICY "coaching_meeting_request_read" ON public."coaching_meeting_request" USING (((employee_id = current_employee_id()) OR can_read_all_employees() OR leads_employee(employee_id)));
ALTER POLICY "coaching_message_read" ON public."coaching_message" USING (((employee_id = current_employee_id()) OR (from_id = current_employee_id()) OR can_read_all_employees() OR leads_employee(employee_id)));
ALTER POLICY "coaching_person_focus_read" ON public."coaching_person_focus" USING (((employee_id = current_employee_id()) OR can_read_all_employees() OR leads_employee(employee_id)));
ALTER POLICY "coaching_session_read" ON public."coaching_session" USING (((employee_id = current_employee_id()) OR (coach_id = current_employee_id()) OR can_read_all_employees() OR leads_employee(employee_id)));
ALTER POLICY "coaching_task_read" ON public."coaching_task" USING (((assignee_id = current_employee_id()) OR (partner_id = current_employee_id()) OR (created_by = current_employee_id()) OR can_read_all_employees() OR leads_employee(assignee_id)));
ALTER POLICY "coaching_template_read" ON public."coaching_template" USING ((can_read_all_employees() OR has_any_role(ARRAY['team_lead'::text])));
ALTER POLICY "commission_entry_read" ON public."commission_entry" USING (((employee_id = current_employee_id()) OR far_hantera_provision()));
ALTER POLICY "commission_history_las" ON public."commission_history" USING (((employee_id = current_employee_id()) OR far_hantera_provision()));
ALTER POLICY "company_read" ON public."company" USING ((NOT kraver_losenordsbyte()));
ALTER POLICY "compliance_gate_read" ON public."compliance_gate" USING ((NOT kraver_losenordsbyte()));
ALTER POLICY "contract_read" ON public."contract" USING ((far_hantera_avtal() OR ((status = 'issued'::text) AND (employee_id = current_employee_id()))));
ALTER POLICY "contract_template_read" ON public."contract_template" USING (far_hantera_avtal());
ALTER POLICY "cost_calculation_read" ON public."cost_calculation" USING (har_lonekostnadsbehorighet());
ALTER POLICY "cost_rate_read" ON public."cost_rate" USING (har_lonekostnadsbehorighet());
ALTER POLICY "course_read" ON public."course" USING ((((status = 'published'::text) AND matches_audience(audience_roles, '{}'::uuid[])) OR (owner_id = current_employee_id()) OR has_any_role(ARRAY['sales_manager'::text, 'admin'::text, 'ceo'::text])));
ALTER POLICY "course_attempt_read" ON public."course_attempt" USING (((employee_id = current_employee_id()) OR can_read_all_employees() OR leads_employee(employee_id)));
ALTER POLICY "course_wish_read" ON public."course_wish" USING (((employee_id = current_employee_id()) OR has_any_role(ARRAY['sales_manager'::text, 'admin'::text, 'ceo'::text])));
ALTER POLICY "document_read" ON public."document" USING ((((status = 'published'::text) AND matches_audience(audience_roles, audience_teams, audience_employees)) OR (owner_id = current_employee_id()) OR has_any_role(ARRAY['sales_manager'::text, 'admin'::text, 'ceo'::text])));
ALTER POLICY "document_ack_read" ON public."document_ack" USING (((employee_id = current_employee_id()) OR has_any_role(ARRAY['sales_manager'::text, 'admin'::text, 'ceo'::text]) OR (EXISTS ( SELECT 1
   FROM document d
  WHERE ((d.id = document_ack.document_id) AND (d.owner_id = current_employee_id()))))));
ALTER POLICY "document_area_watch_read" ON public."document_area_watch" USING ((employee_id = current_employee_id()));
ALTER POLICY "document_feedback_read" ON public."document_feedback" USING (((employee_id = current_employee_id()) OR (EXISTS ( SELECT 1
   FROM document d
  WHERE ((d.id = document_feedback.document_id) AND (d.owner_id = current_employee_id())))) OR has_any_role(ARRAY['sales_manager'::text, 'admin'::text, 'ceo'::text])));
ALTER POLICY "document_note_read" ON public."document_note" USING ((employee_id = current_employee_id()));
ALTER POLICY "document_run_read" ON public."document_run" USING (((employee_id = current_employee_id()) OR (EXISTS ( SELECT 1
   FROM document d
  WHERE ((d.id = document_run.document_id) AND (d.owner_id = current_employee_id())))) OR has_any_role(ARRAY['sales_manager'::text, 'admin'::text, 'ceo'::text])));
ALTER POLICY "document_saved_read" ON public."document_saved" USING ((employee_id = current_employee_id()));
ALTER POLICY "document_search_miss_read" ON public."document_search_miss" USING (has_any_role(ARRAY['sales_manager'::text, 'admin'::text, 'ceo'::text]));
ALTER POLICY "document_view_read" ON public."document_view" USING (((employee_id = current_employee_id()) OR has_any_role(ARRAY['sales_manager'::text, 'admin'::text, 'ceo'::text])));
ALTER POLICY "document_view_log_read" ON public."document_view_log" USING (((employee_id = current_employee_id()) OR has_any_role(ARRAY['sales_manager'::text, 'admin'::text, 'ceo'::text])));
ALTER POLICY "employee_read" ON public."employee" USING ((((auth_user_id = auth.uid()) AND (status <> 'offboarded'::text) AND (NOT kraver_losenordsbyte())) OR can_read_all_employees() OR leads_employee(id)));
ALTER POLICY "employee_access_level_read" ON public."employee_access_level" USING (((employee_id = current_employee_id()) OR can_read_all_employees()));
ALTER POLICY "employee_onboarding_read" ON public."employee_onboarding" USING (can_read_all_employees());
ALTER POLICY "employee_permission_read" ON public."employee_permission" USING (((employee_id = current_employee_id()) OR has_any_role(ARRAY['sales_manager'::text, 'ceo'::text])));
ALTER POLICY "employee_role_read" ON public."employee_role" USING (((employee_id = current_employee_id()) OR can_read_all_employees() OR leads_employee(employee_id)));
ALTER POLICY "error_occurrence_las" ON public."error_occurrence" USING (has_any_role(ARRAY['sales_manager'::text, 'ceo'::text, 'admin'::text]));
ALTER POLICY "error_report_read" ON public."error_report" USING ((has_any_role(ARRAY['sales_manager'::text, 'ceo'::text, 'admin'::text]) OR (reporter_id = current_employee_id())));
ALTER POLICY "error_report_follower_las" ON public."error_report_follower" USING (((employee_id = current_employee_id()) OR has_any_role(ARRAY['sales_manager'::text, 'ceo'::text, 'admin'::text])));
ALTER POLICY "essay_submission_read" ON public."essay_submission" USING (((employee_id = current_employee_id()) OR has_any_role(ARRAY['sales_manager'::text, 'team_lead'::text, 'admin'::text, 'ceo'::text])));
ALTER POLICY "file_object_read" ON public."file_object" USING ((((purpose = 'sick_certificate'::text) AND (EXISTS ( SELECT 1
   FROM sick_report r
  WHERE (r.id = file_object.sick_report_id)))) OR ((purpose = 'document_attachment'::text) AND (EXISTS ( SELECT 1
   FROM document d
  WHERE (d.id = file_object.document_id)))) OR ((purpose = 'roleplay'::text) AND ((subject_employee_id = current_employee_id()) OR leads_employee(subject_employee_id) OR has_any_role(ARRAY['sales_manager'::text, 'ceo'::text]))) OR ((purpose = 'sales_order'::text) AND (EXISTS ( SELECT 1
   FROM sales_order o
  WHERE (o.id = file_object.sales_order_id)))) OR ((purpose = 'coaching'::text) AND ((subject_employee_id = current_employee_id()) OR leads_employee(subject_employee_id) OR has_any_role(ARRAY['sales_manager'::text, 'ceo'::text]) OR (EXISTS ( SELECT 1
   FROM (coaching_task_event e
     JOIN coaching_task t ON ((t.id = e.task_id)))
  WHERE ((e.file_id = file_object.id) AND ((t.partner_id = current_employee_id()) OR (t.created_by = current_employee_id()))))))) OR ((purpose = 'call_recording'::text) AND ((subject_employee_id = current_employee_id()) OR leads_employee(subject_employee_id) OR has_any_role(ARRAY['sales_manager'::text, 'ceo'::text]) OR ((sales_order_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM sales_order o
  WHERE (o.id = file_object.sales_order_id)))))) OR ((purpose = 'employment_contract'::text) AND (EXISTS ( SELECT 1
   FROM contract c
  WHERE (c.id = file_object.contract_id))))));
ALTER POLICY "guide_nudge_read" ON public."guide_nudge" USING (((employee_id = current_employee_id()) OR can_read_all_employees() OR leads_employee(employee_id)));
ALTER POLICY "guide_progress_read" ON public."guide_progress" USING (((employee_id = current_employee_id()) OR can_read_all_employees() OR leads_employee(employee_id)));
ALTER POLICY "hr_case_read" ON public."hr_case" USING (((employee_id = current_employee_id()) OR ((NOT confidential) AND ((assigned_to = current_employee_id()) OR has_any_role(ARRAY['sales_manager'::text, 'ceo'::text]))) OR (confidential AND has_any_role(ARRAY['sales_manager'::text, 'ceo'::text]))));
ALTER POLICY "hr_case_attachment_skriv" ON public."hr_case_attachment" WITH CHECK (((uploaded_by = current_employee_id()) AND (EXISTS ( SELECT 1
   FROM hr_case c
  WHERE (c.id = hr_case_attachment.case_id)))));
ALTER POLICY "hr_case_confirmation_skriv" ON public."hr_case_confirmation" WITH CHECK (((confirmed_by = current_employee_id()) AND (EXISTS ( SELECT 1
   FROM hr_case c
  WHERE ((c.id = hr_case_confirmation.case_id) AND (c.employee_id = current_employee_id()) AND (c.resolved_at IS NOT NULL))))));
ALTER POLICY "hr_case_link_skriv" ON public."hr_case_link" WITH CHECK (((created_by = current_employee_id()) AND (EXISTS ( SELECT 1
   FROM hr_case c
  WHERE (c.id = hr_case_link.case_id)))));
ALTER POLICY "hr_case_read_andra" ON public."hr_case_read" USING ((employee_id = current_employee_id())) WITH CHECK ((employee_id = current_employee_id()));
ALTER POLICY "hr_case_read_skriv" ON public."hr_case_read" WITH CHECK (((employee_id = current_employee_id()) AND (EXISTS ( SELECT 1
   FROM hr_case c
  WHERE (c.id = hr_case_read.case_id)))));
ALTER POLICY "hr_case_read_ta_bort" ON public."hr_case_read" USING ((employee_id = current_employee_id()));
ALTER POLICY "hr_case_reminder_skriv" ON public."hr_case_reminder" WITH CHECK (((sent_by = current_employee_id()) AND has_any_role(ARRAY['sales_manager'::text, 'ceo'::text]) AND (EXISTS ( SELECT 1
   FROM hr_case c
  WHERE (c.id = hr_case_reminder.case_id)))));
ALTER POLICY "interview_scorecard_read" ON public."interview_scorecard" USING ((far_rekrytera() OR (interviewer_id = current_employee_id())));
ALTER POLICY "interview_slot_read" ON public."interview_slot" USING (far_rekrytera());
ALTER POLICY "kv_assessment_read" ON public."kv_assessment" USING ((EXISTS ( SELECT 1
   FROM kv_call c
  WHERE ((c.id = kv_assessment.call_id) AND ((c.employee_id = current_employee_id()) OR far_hantera_provision())))));
ALTER POLICY "kv_call_read" ON public."kv_call" USING (((employee_id = current_employee_id()) OR far_hantera_provision()));
ALTER POLICY "kv_score_read" ON public."kv_score" USING ((EXISTS ( SELECT 1
   FROM kv_call c
  WHERE ((c.id = kv_score.call_id) AND ((c.employee_id = current_employee_id()) OR far_hantera_provision())))));
ALTER POLICY "late_arrival_read" ON public."late_arrival" USING (((employee_id = current_employee_id()) OR can_read_all_employees() OR leads_employee(employee_id)));
ALTER POLICY "late_arrival_month_read" ON public."late_arrival_month" USING (((employee_id = current_employee_id()) OR can_read_all_employees() OR leads_employee(employee_id)));
ALTER POLICY "lead_read" ON public."lead" USING ((has_any_role(ARRAY['sales_manager'::text, 'ceo'::text, 'team_lead'::text, 'admin'::text]) OR (assigned_to = current_employee_id())));
ALTER POLICY "lead_event_read" ON public."lead_event" USING ((has_any_role(ARRAY['sales_manager'::text, 'ceo'::text, 'team_lead'::text, 'admin'::text]) OR (EXISTS ( SELECT 1
   FROM lead l
  WHERE ((l.id = lead_event.lead_id) AND (l.assigned_to = current_employee_id()))))));
ALTER POLICY "learning_answer_read" ON public."learning_answer" USING (((employee_id = current_employee_id()) OR has_any_role(ARRAY['sales_manager'::text, 'admin'::text, 'ceo'::text]) OR leads_employee(employee_id)));
ALTER POLICY "learning_note_mal_chef" ON public."learning_note" USING (((key ~~ 'mal:%'::text) AND (text ~~ '%"coach":true%'::text) AND (leads_employee(employee_id) OR can_read_all_employees())));
ALTER POLICY "learning_note_read" ON public."learning_note" USING ((employee_id = current_employee_id()));
ALTER POLICY "learning_rule_read" ON public."learning_rule" USING ((employee_id = current_employee_id()));
ALTER POLICY "lecture_read" ON public."lecture" USING ((current_employee_id() IS NOT NULL));
ALTER POLICY "lecture_followup_read" ON public."lecture_followup" USING (((employee_id = current_employee_id()) OR has_any_role(ARRAY['sales_manager'::text, 'admin'::text, 'ceo'::text])));
ALTER POLICY "lecture_question_read" ON public."lecture_question" USING (((employee_id = current_employee_id()) OR (kind = 'insikt'::text) OR has_any_role(ARRAY['sales_manager'::text, 'admin'::text, 'ceo'::text]) OR (EXISTS ( SELECT 1
   FROM lecture l
  WHERE ((l.id = lecture_question.lecture_id) AND (l.presenter_id = current_employee_id()))))));
ALTER POLICY "lecture_signup_read" ON public."lecture_signup" USING (((employee_id = current_employee_id()) OR has_any_role(ARRAY['sales_manager'::text, 'admin'::text, 'ceo'::text]) OR (EXISTS ( SELECT 1
   FROM lecture l
  WHERE ((l.id = lecture_signup.lecture_id) AND (l.presenter_id = current_employee_id()))))));
ALTER POLICY "manager_commission_rate_read" ON public."manager_commission_rate" USING (far_hantera_provision());
ALTER POLICY "module_progress_read" ON public."module_progress" USING (((employee_id = current_employee_id()) OR can_read_all_employees() OR leads_employee(employee_id)));
ALTER POLICY "module_rating_read" ON public."module_rating" USING (((employee_id = current_employee_id()) OR has_any_role(ARRAY['sales_manager'::text, 'admin'::text, 'ceo'::text])));
ALTER POLICY "nav_preference_read" ON public."nav_preference" USING ((employee_id = current_employee_id()));
ALTER POLICY "news_post_read" ON public."news_post" USING ((((status = 'published'::text) AND matches_audience(audience_roles, audience_teams)) OR (author_id = current_employee_id()) OR has_any_role(ARRAY['sales_manager'::text, 'admin'::text, 'ceo'::text])));
ALTER POLICY "notification_dismissed_read" ON public."notification_dismissed" USING ((employee_id = current_employee_id()));
ALTER POLICY "notification_event_read" ON public."notification_event" USING ((employee_id = current_employee_id()));
ALTER POLICY "notification_seen_read" ON public."notification_seen" USING ((employee_id = current_employee_id()));
ALTER POLICY "offboarding_task_read" ON public."offboarding_task" USING (can_read_all_employees());
ALTER POLICY "onboarding_rule_read" ON public."onboarding_rule" USING (can_read_all_employees());
ALTER POLICY "onboarding_task_read" ON public."onboarding_task" USING (can_read_all_employees());
ALTER POLICY "onboarding_template_read" ON public."onboarding_template" USING (can_read_all_employees());
ALTER POLICY "onboarding_template_item_read" ON public."onboarding_template_item" USING (can_read_all_employees());
ALTER POLICY "one_on_one_point_read" ON public."one_on_one_point" USING (((employee_id = current_employee_id()) OR (added_by = current_employee_id()) OR can_read_all_employees() OR leads_employee(employee_id)));
ALTER POLICY "order_grattis_read" ON public."order_grattis" USING ((employee_id = current_employee_id()));
ALTER POLICY "order_list_seen_las" ON public."order_list_seen" USING ((employee_id = current_employee_id()));
ALTER POLICY "order_manager_commission_read" ON public."order_manager_commission" USING (((manager_id = current_employee_id()) OR far_hantera_provision()));
ALTER POLICY "payroll_adjustment_read" ON public."payroll_adjustment" USING (((employee_id = current_employee_id()) OR has_any_role(ARRAY['sales_manager'::text, 'ceo'::text, 'finance'::text, 'admin'::text])));
ALTER POLICY "payroll_export_column_read" ON public."payroll_export_column" USING (has_any_role(ARRAY['sales_manager'::text, 'ceo'::text, 'finance'::text, 'admin'::text]));
ALTER POLICY "payroll_period_read" ON public."payroll_period" USING (has_any_role(ARRAY['sales_manager'::text, 'ceo'::text, 'finance'::text, 'admin'::text]));
ALTER POLICY "payroll_period_sent_read" ON public."payroll_period_sent" USING (has_any_role(ARRAY['sales_manager'::text, 'ceo'::text, 'finance'::text, 'admin'::text]));
ALTER POLICY "payroll_row_read" ON public."payroll_row" USING (((employee_id = current_employee_id()) OR has_any_role(ARRAY['sales_manager'::text, 'ceo'::text, 'finance'::text, 'admin'::text])));
ALTER POLICY "phone_call_read" ON public."phone_call" USING (((employee_id = current_employee_id()) OR leads_employee(employee_id) OR has_any_role(ARRAY['sales_manager'::text, 'ceo'::text]) OR ((sales_order_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM sales_order o
  WHERE (o.id = phone_call.sales_order_id))))));
ALTER POLICY "phone_identity_read" ON public."phone_identity" USING (((employee_id = current_employee_id()) OR leads_employee(employee_id) OR has_any_role(ARRAY['sales_manager'::text, 'ceo'::text])));
ALTER POLICY "project_read" ON public."project" USING (projekt_synligt(id, current_employee_id()));
ALTER POLICY "project_member_read" ON public."project_member" USING (projekt_synligt(project_id, current_employee_id()));
ALTER POLICY "project_message_read_policy" ON public."project_message" USING (projekt_synligt(project_id, current_employee_id()));
ALTER POLICY "project_message_read_egen" ON public."project_message_read" USING ((employee_id = current_employee_id()));
ALTER POLICY "push_sent_read" ON public."push_sent" USING ((employee_id = current_employee_id()));
ALTER POLICY "push_subscription_read" ON public."push_subscription" USING ((employee_id = current_employee_id()));
ALTER POLICY "recruitment_goal_read" ON public."recruitment_goal" USING (far_rekrytera());
ALTER POLICY "recruitment_policy_read" ON public."recruitment_policy" USING (far_rekrytera());
ALTER POLICY "recruitment_position_read" ON public."recruitment_position" USING (far_rekrytera());
ALTER POLICY "recruitment_source_read" ON public."recruitment_source" USING (far_rekrytera());
ALTER POLICY "recruitment_template_read" ON public."recruitment_template" USING (far_rekrytera());
ALTER POLICY "revenue_entry_read" ON public."revenue_entry" USING (har_lonekostnadsbehorighet());
ALTER POLICY "roleplay_self_read" ON public."roleplay_self" USING (((employee_id = current_employee_id()) OR has_any_role(ARRAY['sales_manager'::text, 'ceo'::text]) OR leads_employee(employee_id)));
ALTER POLICY "roleplay_submission_read" ON public."roleplay_submission" USING (((employee_id = current_employee_id()) OR leads_employee(employee_id) OR has_any_role(ARRAY['sales_manager'::text, 'ceo'::text])));
ALTER POLICY "salary_basis_read" ON public."salary_basis" USING (har_lonekostnadsbehorighet());
ALTER POLICY "sales_order_read" ON public."sales_order" USING (((salesperson_id = current_employee_id()) OR far_hantera_order()));
ALTER POLICY "sales_order_service_read" ON public."sales_order_service" USING ((EXISTS ( SELECT 1
   FROM sales_order o
  WHERE ((o.id = sales_order_service.order_id) AND ((o.salesperson_id = current_employee_id()) OR far_hantera_order())))));
ALTER POLICY "sales_target_read" ON public."sales_target" USING (((employee_id = current_employee_id()) OR far_hantera_provision()));
ALTER POLICY "scheduled_break_read" ON public."scheduled_break" USING (((scope = 'company'::text) OR ((scope = 'team'::text) AND (team_id = ( SELECT e.team_id
   FROM employee e
  WHERE (e.id = current_employee_id())))) OR (employee_id = current_employee_id()) OR can_read_all_employees() OR leads_employee(employee_id)));
ALTER POLICY "sick_deadline_read" ON public."sick_deadline" USING ((EXISTS ( SELECT 1
   FROM sick_report r
  WHERE ((r.id = sick_deadline.report_id) AND ((r.employee_id = current_employee_id()) OR leads_employee(r.employee_id) OR has_any_role(ARRAY['sales_manager'::text, 'ceo'::text]))))));
ALTER POLICY "sick_note_read" ON public."sick_note" USING ((leads_employee(employee_id) OR has_any_role(ARRAY['sales_manager'::text, 'ceo'::text])));
ALTER POLICY "sick_report_read" ON public."sick_report" USING (((employee_id = current_employee_id()) OR leads_employee(employee_id) OR has_any_role(ARRAY['sales_manager'::text, 'ceo'::text])));
ALTER POLICY "sick_signal_ack_las" ON public."sick_signal_ack" USING (has_any_role(ARRAY['sales_manager'::text, 'ceo'::text]));
ALTER POLICY "staffing_cap_read" ON public."staffing_cap" USING ((NOT kraver_losenordsbyte()));
ALTER POLICY "task_read" ON public."task" USING ((uppgift_synlig(id, current_employee_id()) OR ((parent_id IS NOT NULL) AND uppgift_synlig(parent_id, current_employee_id()))));
ALTER POLICY "task_day_las" ON public."task_day" USING ((employee_id = current_employee_id()));
ALTER POLICY "task_event_read" ON public."task_event" USING (uppgift_synlig(task_id, current_employee_id()));
ALTER POLICY "task_focus_las" ON public."task_focus" USING ((employee_id = current_employee_id()));
ALTER POLICY "task_link_read" ON public."task_link" USING (uppgift_synlig(task_id, current_employee_id()));
ALTER POLICY "task_member_read" ON public."task_member" USING (uppgift_synlig(task_id, current_employee_id()));
ALTER POLICY "task_series_read" ON public."task_series" USING (((current_employee_id() IS NOT NULL) AND ((assignee_id = current_employee_id()) OR (created_by = current_employee_id()))));
ALTER POLICY "task_template_read" ON public."task_template" USING (((current_employee_id() IS NOT NULL) AND (shared OR (created_by = current_employee_id()))));
ALTER POLICY "team_read" ON public."team" USING ((NOT kraver_losenordsbyte()));
ALTER POLICY "tid_view_log_read" ON public."tid_view_log" USING (((employee_id = current_employee_id()) OR (viewer_id = current_employee_id()) OR can_read_all_employees()));
ALTER POLICY "time_day_ack_read" ON public."time_day_ack" USING (((employee_id = current_employee_id()) OR can_read_all_employees() OR leads_employee(employee_id)));
ALTER POLICY "time_event_read" ON public."time_event" USING (((employee_id = current_employee_id()) OR can_read_all_employees() OR leads_employee(employee_id)));
ALTER POLICY "time_week_check_read" ON public."time_week_check" USING (((employee_id = current_employee_id()) OR can_read_all_employees() OR leads_employee(employee_id)));
ALTER POLICY "vacation_wish_round_las" ON public."vacation_wish_round" USING ((current_employee_id() IS NOT NULL));
ALTER POLICY "weekly_review_read" ON public."weekly_review" USING ((employee_id = current_employee_id()));
ALTER POLICY "work_schedule_read" ON public."work_schedule" USING (((scope = 'company'::text) OR ((scope = 'team'::text) AND (team_id = ( SELECT e.team_id
   FROM employee e
  WHERE (e.id = current_employee_id())))) OR (employee_id = current_employee_id()) OR can_read_all_employees() OR leads_employee(employee_id)));
ALTER POLICY "work_schedule_seen_read" ON public."work_schedule_seen" USING (((employee_id = current_employee_id()) OR can_read_all_employees() OR leads_employee(employee_id)));
ALTER POLICY "work_time_journal_read" ON public."work_time_journal" USING (((employee_id = current_employee_id()) OR has_any_role(ARRAY['sales_manager'::text, 'admin'::text])));
COMMIT;
