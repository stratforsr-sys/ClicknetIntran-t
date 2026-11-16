-- =============================================================================
-- 0311_mote_anteckning_utan_agenda.sql — agendan hör inte hemma i tråden
--
-- 0310 lade varje gammalt `mote.mal` som bokarens första inlägg i kortets
-- tråd, i tron att det var ett internt mål (panelen kallade det "Mål, bara för
-- er"). Det var det inte. Före 2026-11-13 var `mal` fältet som blev
-- kalenderinbjudans agenda (moten/route.ts: `kalAgenda = v.agenda ?? v.mal`),
-- och alla 25 texterna stod ordagrant i inbjudan till kunden ("Hej Khaled.
-- Agendan för mötet är …").
--
-- Beställaren 2026-11-16: "en agenda ska gå ut i kalenderinbjudan sen ska det
-- finnas anteckningar utöver agendan."
--
-- Den här migrationen tar bort just de inläggen och inget annat: id:t är
-- startlägets (md5 ur mötets id, se 0310), texten är fortfarande mötets mål,
-- och ingen har ändrat eller tagit bort inlägget. Ett inlägg som någon skrivit
-- själv rörs aldrig. Sett-raderna står kvar: de säger hur långt var och en
-- läst, och betyder ingenting utan inlägg.
--
-- `mote.mal` och `mote.agenda` rörs inte. Panelen visar agendan som Agenda
-- under Inför mötet igen (utkast.html), oavsett om kortet har en tråd.
--
-- Omkörbar.
-- =============================================================================

delete from public.mote_anteckning a
 using public.mote m
 where a.mote_id = m.id
   and a.id = md5('mote_anteckning:mal:' || m.id::text)::uuid
   and a.andrad is null
   and a.borttagen is null
   and a.text = left(btrim(m.mal), 4000);
