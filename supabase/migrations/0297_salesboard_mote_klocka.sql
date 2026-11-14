-- 0297: säljtavlan väcks när ett möte bokas, tas bort eller räknas om.
--
-- Hårdtestet 2026-11-14 hittade att public.mote saknade ringklocka. Tavlan såg
-- ett bokat möte först vid nästa vanliga hämtning (var 60:e sekund med kanalen
-- uppe), medan en order syns direkt. Firandet kom ändå, men upp till en minut
-- sent. Klockan är samma som för order (salesboard_ringklocka, 0250).
--
-- En uppdatering ringer bara när något tavlan räknar på ändras: vem som bokade,
-- när, mötets art (0296:s mote_art_ratta kan göra ett nytt möte till en
-- uppföljning) och kedjan. Utfall, bekräftelser och försök ringer inte. Ändrade
-- bolagsuppgifter (namn, telefon, domän) når tavlan vid nästa vanliga hämtning.
--
-- 0294 hålls av grenen moten-inbjudan. Omkörbar: klockan tas bort och sätts på igen.

drop trigger if exists salesboard_mote_ping on public.mote;

create trigger salesboard_mote_ping
  after insert or delete or update of bokat_av, bokat_nar, art, kedja_id on public.mote
  for each statement execute function public.salesboard_ringklocka();
