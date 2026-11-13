-- Möten (2026-11-13): fler hos kunden med namn och telefon, och agendan som kunden får i inbjudan.
--
-- `personer`: de som är med från kundens bolag utöver kontakten, [{namn, telefon, epost}] med telefonen i E.164
-- och e-posten normaliserad (`personerIndata` i motenforma.ts). Inbjudningarna går som förut till adresserna som
-- gäster i kalendern (`calendar_attendee.external_email`); kolumnen bär namnet och numret, och en person utan
-- e-post (som då inte bjuds in) står bara här. Högst tio, som gästerna.
--
-- `agenda`: det kunden ser i inbjudan, i mejlet och i kalenderfilen. Den ersätter `mal` i formuläret. `mal` står
-- kvar och skrivs inte längre av Möten: de gamla texterna är säljarens egna anteckningar och läses aldrig in i
-- något som går till kunden. Bara `agenda` gör det (utkorg-server.ts, `ics`).
--
-- Bara tillägg: koden på main före den här ändringen läser och skriver inte kolumnerna.

alter table public.mote add column if not exists personer jsonb not null default '[]'::jsonb;
alter table public.mote add column if not exists agenda text;

alter table public.mote drop constraint if exists mote_personer_lista;
alter table public.mote add constraint mote_personer_lista
  check (case when jsonb_typeof(personer) = 'array' then jsonb_array_length(personer) <= 10 else false end);

alter table public.mote drop constraint if exists mote_agenda_langd;
alter table public.mote add constraint mote_agenda_langd
  check (agenda is null or char_length(agenda) <= 2000);
