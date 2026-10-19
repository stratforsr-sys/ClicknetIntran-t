-- 0106 · Anställda: checklistmallarna exakt som utkastet (2026-10-19)
--
-- =============================================================================
-- VARFÖR
--
-- 0105 lade in utkastets tre rollistor och avslutslistan med navets egna
-- punkter inlagda (Inkio-behörighet, Dialer-kö, e-postkonto, dator, telefon,
-- passerkort, lönen, slutlönen). Beställaren 2026-10-19: mallarna ska vara
-- utkastets, ingenting efter navets. I utkastet är det som ska sättas upp av
-- någon annan utskicksregler (fliken Utskick), som beställaren bygger själv.
--
-- Bara mallarna ändras. Pågående listor (Michaels och Vlados) rörs inte, och
-- inga kopplingar (Inkio, Dialer, e-post) påverkas: det här är punkter i en
-- checklista, inget annat.
-- =============================================================================

delete from public.onboarding_template_item i
 using public.onboarding_template t
 where t.id = i.template_id
   and i.key in ('epost', 'dator', 'telefon', 'inkio', 'dialer', 'pass', 'lon', 'slutlon');

-- Utkastets egna texter där 0105 skrev om dem.
update public.onboarding_template_item set label = 'Kurser: Kom igång med Nav och GDPR i telefonförsäljning' where key = 'kurser';
update public.onboarding_template_item set law_ref = 'Krävs för chefsroller' where key = 'mfa';

-- Utkastets ordning (AEMALLSEED).
with ordning (mall, key, sort) as (values
  ('Säljare', 'konto', 1), ('Säljare', 'avtal', 2), ('Säljare', 'avtalsign', 3), ('Säljare', 'tillstand', 4), ('Säljare', 'valkomst', 5),
  ('Säljare', 'intro', 6), ('Säljare', 'fadder', 7), ('Säljare', 'sakerhet', 8), ('Säljare', 'losen', 9), ('Säljare', 'saljprocess', 10),
  ('Säljare', 'coach', 11), ('Säljare', 'invand', 12), ('Säljare', 'las7', 13), ('Säljare', 'rutiner', 14), ('Säljare', 'kurser', 15),
  ('Säljare', 'avslut1', 16), ('Säljare', 'las30', 17), ('Säljare', 'samtal30', 18), ('Säljare', 'skv', 19), ('Säljare', 'traff', 20),
  ('Säljare', 'samtal90', 21), ('Säljare', 'prov', 22),
  ('Teamledare och chefer', 'konto', 1), ('Teamledare och chefer', 'avtal', 2), ('Teamledare och chefer', 'avtalsign', 3), ('Teamledare och chefer', 'valkomst', 4),
  ('Teamledare och chefer', 'intro', 5), ('Teamledare och chefer', 'sakerhet', 6), ('Teamledare och chefer', 'losen', 7), ('Teamledare och chefer', 'mfa', 8),
  ('Teamledare och chefer', 'attest', 9), ('Teamledare och chefer', 'las7', 10), ('Teamledare och chefer', 'rutiner', 11), ('Teamledare och chefer', 'las30', 12),
  ('Teamledare och chefer', 'samtal30', 13), ('Teamledare och chefer', 'prov', 14),
  ('Leverans och övriga', 'konto', 1), ('Leverans och övriga', 'avtal', 2), ('Leverans och övriga', 'avtalsign', 3), ('Leverans och övriga', 'valkomst', 4),
  ('Leverans och övriga', 'intro', 5), ('Leverans och övriga', 'fadder', 6), ('Leverans och övriga', 'sakerhet', 7), ('Leverans och övriga', 'losen', 8),
  ('Leverans och övriga', 'leverans', 9), ('Leverans och övriga', 'las7', 10), ('Leverans och övriga', 'rutiner', 11), ('Leverans och övriga', 'las30', 12),
  ('Leverans och övriga', 'samtal30', 13), ('Leverans och övriga', 'prov', 14),
  ('Avslut', 'nav', 1), ('Avslut', 'slutsamtal', 2), ('Avslut', 'intyg', 3), ('Avslut', 'arenden', 4)
)
update public.onboarding_template_item i
   set sort = o.sort
  from ordning o, public.onboarding_template t
 where t.id = i.template_id and t.name = o.mall and i.key = o.key;
