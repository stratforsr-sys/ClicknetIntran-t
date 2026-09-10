-- =============================================================================
-- 0053_samtalssommen.sql — sommen far bli ett vanligt unikt villkor
--
-- 0052 la sommen som ett PARTIELLT unikt index:
--
--   create unique index phone_call_somm_idx
--     on phone_call (source, external_ref) where external_ref is not null;
--
-- Motiveringen var `kv_call_somm_idx`, som ser likadan ut. Den holl inte, och
-- det upptacktes forsta gangen nagot postades till rutten i produktion:
--
--   there is no unique or exclusion constraint matching the ON CONFLICT
--   specification
--
-- POSTGRES KAN ANVANDA ETT PARTIELLT INDEX FOR `on conflict`, men bara om
-- inferensen bar med sig predikatet — `on conflict (source, external_ref)
-- where external_ref is not null`. Supabase-klientens `onConflict` tar en
-- kolumnlista och kan inte uttrycka ett where. `kv_call` marker aldrig
-- skillnaden: dar skrivs raderna av en server action med ett vanligt insert.
--
-- Och partialiteten gav ingenting har. Den fanns for att ett samtal utan
-- vaxel-id inte skulle blockera nasta — men NULL ar redan distinkt fran NULL i
-- ett unikt index, sa ett fullstandigt villkor tillater precis lika manga
-- rader utan referens. Dessutom satter `taEmotSamtal()` alltid ett varde:
-- saknas vaxelns id anvands ett avtryck av kroppen.
--
-- Alltsa ett vanligt unikt villkor. Ett CONSTRAINT och inte bara ett index, sa
-- att det syns i `\d phone_call` och i `pg_constraint` dar nasta person letar.
-- =============================================================================

drop index if exists phone_call_somm_idx;

alter table phone_call drop constraint if exists phone_call_somm;
alter table phone_call add constraint phone_call_somm unique (source, external_ref);

comment on constraint phone_call_somm on phone_call is
  'Sommen mot vaxeln. Vanligt unikt villkor och inte partiellt — `on conflict` '
  'kan inte peka pa ett partiellt index utan att bara predikatet med sig.';

-- -----------------------------------------------------------------------------
-- Sjalvkontroll
-- -----------------------------------------------------------------------------

-- Villkoret ska finnas OCH inte vara partiellt. Bada halvorna behovs: ett
-- partiellt index med ratt namn hade sett riktigt ut i en `\d` och fallit igen
-- forsta gangen ett samtal kom in.
do $$
declare
  predikat text;
begin
  select pg_get_expr(i.indpred, i.indrelid)
    into predikat
  from pg_constraint c
  join pg_index i on i.indexrelid = c.conindid
  where c.conname = 'phone_call_somm';

  if not found then
    raise exception 'phone_call_somm saknas';
  end if;

  if predikat is not null then
    raise exception 'phone_call_somm ar partiellt (%) — on conflict kan inte anvanda det', predikat;
  end if;
end;
$$;
