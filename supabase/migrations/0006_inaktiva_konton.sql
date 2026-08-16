-- =============================================================================
-- 0006_inaktiva_konton.sql — AC-1.8, R11
--
-- Utan katalogtjanst finns ingen som stader bort glomda konton at oss. Ett
-- konto som ingen anvant pa 45 dagar ar antingen en person som slutat utan att
-- offboardas, eller ett konto ingen behover. Bada ska granskas.
--
-- Flaggan lagras i stallet for att raknas fram vid varje visning. Skalet ar
-- inte prestanda utan bokforing: `inactive_flagged_at` sager NAR larmet gick,
-- vilket ar det man vill veta vid en granskning. Ett rakneuttryck i en vy kan
-- bara svara "just nu".
-- =============================================================================

alter table employee add column if not exists inactive_flagged_at timestamptz;

create index if not exists employee_inactive_idx
  on employee (inactive_flagged_at) where inactive_flagged_at is not null;

comment on column employee.inactive_flagged_at is
  'AC-1.8: satt av jobbet /api/jobb/konton nar kontot varit oanvant i 45 dagar. Nollstalls vid inloggning.';
