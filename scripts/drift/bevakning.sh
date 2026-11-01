#!/usr/bin/env bash
# Bevakningen av Nav (2026-10-31): korar varje timme fran GitHub Actions.
#
# Ett fel som ingen ser ar det dyra. Nattjobbet har tyst uteblivit forut (tva
# dygn av oupptackt oppen stampling), och morgonbrevet gick inte ut pa en
# manad utan att nagon markte det. Bevakningen fragar darfor utifran, fran en
# annan leverantor an Vercel och Supabase, och mejlar nar nagot ar fel:
#
#   sidan        inloggningssidan svarar 200 (tva forsok, 30 s mellan)
#   databasen    en fraga gar igenom
#   nattjobbet   kvittot i audit_log (job.night_ok) ar yngre an 27 timmar;
#                job.night_partial ar ett eget larm
#   utkorgen     pg_cron:s minutjobb nav-utkorg har gatt minst 20 ganger den
#                senaste halvtimmen
#   dagtiden     nav-dagtid har gatt den senaste 45 minuterna (vardagar
#                06-19 UTC, da det ska ga)
#   backupen     databasens backup i R2 ar yngre an 30 timmar
#   utkastet     ~/nav2-utkast:s backup i R2 ar yngre an 50 timmar (datorn
#                kan vara avstangd, darfor langre)
#
# MEJLET GAR UT NAR LAGET ANDRAS, INTE VARJE TIMME. Laget sparas i R2
# (nav-backup/bevakning/lage.json). Ett nytt fel ger ett mejl direkt, ett fel
# som star kvar en paminnelse var tolfte timme, och nar allt ar bra igen kommer
# ett sista mejl. Ett larm varje timme vore ett larm man filtrerar bort.
#
# Skriptet avslutar med 0 aven nar nagot ar fel, sa att GitHub inte skickar
# sina egna mejl varje timme. Bara om larmmejlet sjalvt inte gick ivag blir
# korningen rod: da ar GitHubs mejl den enda vagen kvar.
#
# Repot ar publikt, och darmed loggen. Inget skrivs ut utover kontrollens namn.
#
# Miljo: NAV_BACKUP_URL, R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
# RESEND_API_KEY, LARM_TILL. TORRKOR=1 skriver mejlet till loggen i stallet.
set -uo pipefail

SIDA=${SIDA:-https://clicknet-nav.vercel.app/logga-in}
E=${R2_ENDPOINT%/}
LAGE_URL="$E/nav-backup/bevakning/lage.json"
export PGCONNECT_TIMEOUT=15
NU=$(date -u +%s)

r2() { curl -sS --aws-sigv4 "aws:amz:auto:s3" --user "$R2_ACCESS_KEY_ID:$R2_SECRET_ACCESS_KEY" "$@"; }
sql() { psql "$NAV_BACKUP_URL" -Atq -c "$1" 2>/dev/null; }
epok() { python3 -c 'import sys,email.utils;print(int(email.utils.parsedate_to_datetime(sys.argv[1]).timestamp()))' "$1"; }

# Den nyaste av objekten i R2, i timmar. 9999 om inget finns.
alder_r2() {
  local basta=0 lm t
  for nyckel in "$@"; do
    lm=$(r2 -I "$E/nav-backup/$nyckel" 2>/dev/null | awk 'tolower($1)=="last-modified:"{sub(/^[^:]*: /,""); sub(/\r$/,""); print}')
    [[ -n "$lm" ]] || continue
    t=$(epok "$lm")
    (( t > basta )) && basta=$t
  done
  (( basta == 0 )) && echo 9999 || echo $(( (NU - basta) / 3600 ))
}

declare -a FEL=() OK=()
fel() { FEL+=("$1|$2"); echo "   fel  $1"; }
ok() { OK+=("$1"); echo "   ok   $1"; }

echo "Kontrollerna"

kod=""
for forsok in 1 2; do
  kod=$(curl -s -o /dev/null -m 20 -w '%{http_code}' "$SIDA")
  [[ "$kod" == 200 ]] && break
  [[ $forsok == 1 ]] && sleep 30
done
[[ "$kod" == 200 ]] && ok sidan || fel sidan "Inloggningssidan svarar $kod, två försök med 30 sekunders mellanrum."

if [[ "$(sql 'select 1')" == 1 ]]; then
  ok databasen

  timmar=$(sql "select coalesce(floor(extract(epoch from now() - max(ts)) / 3600)::int, 9999) from audit_log where object_type = 'job' and object_id = 'natt' and action in ('job.night_ok', 'job.night_partial')")
  senaste=$(sql "select action from audit_log where object_type = 'job' and object_id = 'natt' order by ts desc limit 1")
  if (( ${timmar:-9999} > 27 )); then
    fel nattjobbet "Nattjobbets senaste kvitto är ${timmar} timmar gammalt. Det ska vara yngre än 27 timmar, alltså har nattjobbet inte gått."
  elif [[ "$senaste" == job.night_partial ]]; then
    fel nattjobbet-delvis "Nattjobbet gick i natt, men några steg fick fel. Kvittot står i Händelseloggen (job.night_partial)."
  else
    ok nattjobbet
  fi

  utkorg=$(sql "select count(*) filter (where d.status = 'succeeded') from cron.job_run_details d join cron.job j using (jobid) where j.jobname = 'nav-utkorg' and d.start_time > now() - interval '30 minutes'")
  (( ${utkorg:-0} >= 20 )) && ok utkorgen || fel utkorgen "Utkorgens minutjobb (pg_cron) har gått ${utkorg:-0} gånger av 30 den senaste halvtimmen. Mejl och push fastnar."

  veckodag=$(date -u +%u); timme=$(date -u +%H)
  if (( veckodag <= 5 && 10#$timme >= 6 && 10#$timme <= 19 )); then
    dagtid=$(sql "select count(*) filter (where d.status = 'succeeded') from cron.job_run_details d join cron.job j using (jobid) where j.jobname = 'nav-dagtid' and d.start_time > now() - interval '45 minutes'")
    (( ${dagtid:-0} >= 1 )) && ok dagtiden || fel dagtiden "Dagtidsjobbet (pg_cron, var kvart på vardagar) har inte gått den senaste 45 minuterna."
  fi
else
  fel databasen "Databasen svarar inte på en enkel fråga inom 15 sekunder."
fi

idag=$(date -u +%u); igar=$(( (idag + 5) % 7 + 1 ))
a=$(alder_r2 "databas/dag-$idag.dump.enc" "databas/dag-$igar.dump.enc")
(( a <= 30 )) && ok backupen || fel backupen "Databasens senaste backup i R2 är $a timmar gammal. Den ska komma varje natt; se körningen Backup av databasen i GitHub Actions."
a=$(alder_r2 nav2-utkast/dag-{1..7}.tar.gz.enc)
(( a <= 50 )) && ok utkastet || fel utkastet "Backupen av ~/nav2-utkast är $a timmar gammal. Den körs från datorn varje natt 03.15; är datorn avstängd uteblir den."

# Laget och mejlet.
forra=$(r2 -f "$LAGE_URL" 2>/dev/null || echo '{"fel":[],"mejlat":0}')
forra_fel=$(jq -r '.fel[]' <<<"$forra" | sort)
mejlat=$(jq -r '.mejlat // 0' <<<"$forra")
nu_fel=$(for f in "${FEL[@]+"${FEL[@]}"}"; do echo "${f%%|*}"; done | sort)
nya=$(comm -13 <(echo "$forra_fel") <(echo "$nu_fel") | grep -v '^$' || true)

amne=""
if [[ -n "$nya" ]]; then
  amne="Nav: $(echo "$nya" | paste -sd, - | sed 's/,/, /g') fungerar inte"
elif [[ -z "$nu_fel" && -n "$forra_fel" ]]; then
  amne="Nav: allt fungerar igen"
elif [[ -n "$nu_fel" ]] && (( NU - mejlat > 12 * 3600 )); then
  amne="Nav: fortfarande fel ($(echo "$nu_fel" | paste -sd, - | sed 's/,/, /g'))"
fi
# Provmejlet (workflow_dispatch med provmejl): visar att larmet når fram.
[[ "${PROVMEJL:-}" == 1 ]] && amne="Nav-bevakningen: provmejl"

status=0
if [[ -n "$amne" ]]; then
  kropp=$( { if [[ -n "$nu_fel" ]]; then
      echo "Det här är fel just nu:"; echo
      for f in "${FEL[@]}"; do echo "- ${f%%|*}: ${f#*|}"; done
    elif [[ -n "$forra_fel" ]]; then
      echo "Allt som bevakningen kontrollerar fungerar igen: $(echo "$forra_fel" | paste -sd, - | sed 's/,/, /g')."
    else
      echo "Det här är ett provmejl. Allt fungerar: ${OK[*]}."
    fi
    echo; echo "Bevakningen körs varje timme från GitHub Actions: ${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY:-}/actions/runs/${GITHUB_RUN_ID:-}"
    echo "Du får ett nytt mejl när läget ändras, och en påminnelse var tolfte timme så länge något är fel."; } )
  if [[ "${TORRKOR:-}" == 1 ]]; then
    echo "--- mejlet (torrkörning) ---"; echo "Ämne: $amne"; echo "$kropp"
  else
    svar=$(jq -n --arg till "$LARM_TILL" --arg amne "$amne" --arg text "$kropp" \
      '{from: "Nav-bevakningen <nav@clicknet.se>", to: [$till], subject: $amne, text: $text}' \
      | curl -sS -o /dev/null -w '%{http_code}' -X POST https://api.resend.com/emails \
          -H "Authorization: Bearer $RESEND_API_KEY" -H 'Content-Type: application/json' --data-binary @-)
    if [[ "$svar" == 200 ]]; then echo "Mejl skickat: $amne"; mejlat=$NU; else echo "LARMMEJLET GICK INTE IVÄG ($svar)"; status=1; fi
  fi
fi

if [[ "${TORRKOR:-}" != 1 ]]; then
  lage=$(mktemp)
  jq -n --argjson fel "$(echo "$nu_fel" | jq -R . | jq -s 'map(select(. != ""))')" --argjson mejlat "$mejlat" '{fel: $fel, mejlat: $mejlat}' > "$lage"
  r2 -f -T "$lage" "$LAGE_URL" -o /dev/null || { echo "Läget kunde inte sparas i R2"; status=1; }
  rm -f "$lage"
fi
exit $status
