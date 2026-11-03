#!/usr/bin/env bash
# Nattens backup av databasen, med ett aterstallningsprov (2026-10-31).
#
# Supabases gratisplan har ingen backup att aterstalla fran. Det har ar den
# enda, och den raknas forst nar den gatt att aterstalla. Darfor gor varje
# korning tre saker:
#
#   1. DUMP      pg_dump av hela databasen som rollen nav_backup (bara lasning,
#                BYPASSRLS, pg_read_all_data; skapad for hand 2026-10-31).
#   2. PROV      dumpen laggs in i en tom Postgres (PROV_URL), och varje tabell
#                i public, auth och storage raknas. Antalet ska ligga mellan
#                produktionens rakning fore och efter dumpen. En tabell utanfor
#                spannet, eller en som saknas, faller provet. Fel fran pg_restore
#                ar vantade (pg_cron, pg_net och vault finns bara hos Supabase)
#                och raknas men faller inte provet: det som maste ga att
#                aterstalla ar raderna, inte Supabases egna tillagg.
#   3. LAGRING   dumpen krypteras (AES-256, nyckeln BACKUP_NYCKEL) och laggs i
#                R2, bucket nav-backup: databas/dag-<1-7>.dump.enc rullar over en
#                vecka, databas/manad-<AAAA-MM>.dump.enc sparas. Storleken lases
#                tillbaka efterat.
#
# Repot ar publikt, och darmed loggen. Skriptet skriver darfor aldrig ut
# tabellnamn med antal, adresser eller nycklar: bara summor och de tabeller
# som fallit.
#
# Aterstall:
#   curl --aws-sigv4 "aws:amz:auto:s3" --user "$R2_ACCESS_KEY_ID:$R2_SECRET_ACCESS_KEY" \
#     "$R2_ENDPOINT/nav-backup/databas/dag-3.dump.enc" -o db.enc
#   openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_NYCKEL -in db.enc -out db.dump
#   pg_restore --no-owner --no-privileges -d <ny databas> db.dump
#
# Miljo: NAV_BACKUP_URL, PROV_URL, BACKUP_NYCKEL, R2_ENDPOINT, R2_ACCESS_KEY_ID,
# R2_SECRET_ACCESS_KEY. UTAN_UPPLADDNING=1 hoppar over steg 3 (lokalt prov).
set -euo pipefail

ARBETE=$(mktemp -d)
trap 'rm -rf "$ARBETE"' EXIT
SCHEMAN="'public','auth','storage'"

# En rad per tabell: "schema.tabell|antal". Fragan byggs ur katalogen, sa att
# en ny tabell kommer med utan att skriptet andras.
rakna() {
  local url=$1
  local sql
  sql=$(psql "$url" -Atq -c "
    select string_agg(format('select %L, count(*) from %I.%I', n.nspname||'.'||c.relname, n.nspname, c.relname), ' union all ')
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r','p') and n.nspname in ($SCHEMAN)")
  psql "$url" -Atq -F'|' -c "$sql" | sort
}

echo "1. Dump"
rakna "$NAV_BACKUP_URL" > "$ARBETE/fore.txt"
pg_dump -Fc --no-owner --no-privileges -f "$ARBETE/db.dump" "$NAV_BACKUP_URL"
rakna "$NAV_BACKUP_URL" > "$ARBETE/efter.txt"
echo "   $(stat -c %s "$ARBETE/db.dump" 2>/dev/null || stat -f %z "$ARBETE/db.dump") byte, $(wc -l < "$ARBETE/fore.txt" | tr -d ' ') tabeller"

echo "2. Aterstallningsprov"
# Rollerna som policyerna namnger, och tilläggen som Supabase lagger i schemat
# extensions. Det som inte finns i en vanlig Postgres (pg_cron, pg_net, vault)
# hoppas over.
psql "$PROV_URL" -q -v ON_ERROR_STOP=1 <<'SQL'
do $$ declare r text; begin
  foreach r in array array['anon','authenticated','service_role','supabase_admin','supabase_auth_admin','supabase_storage_admin','authenticator','postgres'] loop
    if not exists (select 1 from pg_roles where rolname = r) then execute format('create role %I', r); end if;
  end loop;
end $$;
create schema if not exists extensions;
create schema if not exists auth;
create schema if not exists storage;
create extension if not exists pgcrypto schema extensions;
create extension if not exists "uuid-ossp" schema extensions;
create extension if not exists btree_gist schema extensions;
SQL
set +e
pg_restore --no-owner --no-privileges -n public -n auth -n storage -d "$PROV_URL" "$ARBETE/db.dump" 2> "$ARBETE/restore.txt"
set -e
FEL=$(grep -c '^pg_restore: error' "$ARBETE/restore.txt" || true)
rakna "$PROV_URL" > "$ARBETE/prov.txt"

# Jamfor: varje tabell i produktionen ska finnas i provet, med ett antal
# mellan rakningen fore och efter dumpen.
FALL=$(awk -F'|' '
  FILENAME == ARGV[1] { fore[$1] = $2; next }
  FILENAME == ARGV[2] { efter[$1] = $2; next }
  { prov[$1] = $2 }
  END {
    for (t in fore) {
      lo = fore[t] + 0; hi = (t in efter) ? efter[t] + 0 : lo
      if (lo > hi) { x = lo; lo = hi; hi = x }
      if (!(t in prov)) print t " saknas"
      else if (prov[t] + 0 < lo || prov[t] + 0 > hi) print t " har fel antal"
    }
  }' "$ARBETE/fore.txt" "$ARBETE/efter.txt" "$ARBETE/prov.txt")
RADER=$(awk -F'|' '{s += $2} END {print s + 0}' "$ARBETE/prov.txt")
echo "   $(wc -l < "$ARBETE/prov.txt" | tr -d ' ') tabeller och $RADER rader aterstallda, $FEL vantade fel fran pg_restore"
if [[ -n "$FALL" ]]; then
  echo "PROVET FOLL:"
  echo "$FALL" | sed 's/^/   /'
  exit 1
fi

if [[ "${UTAN_UPPLADDNING:-}" == "1" ]]; then
  echo "3. Uppladdningen hoppas over (UTAN_UPPLADDNING=1)"
  exit 0
fi

echo "3. Lagring"
openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_NYCKEL -in "$ARBETE/db.dump" -out "$ARBETE/db.enc"
STORLEK=$(stat -c %s "$ARBETE/db.enc" 2>/dev/null || stat -f %z "$ARBETE/db.enc")
E=${R2_ENDPOINT%/}
for NAMN in "dag-$(date -u +%u)" "manad-$(date -u +%Y-%m)"; do
  URL="$E/nav-backup/databas/$NAMN.dump.enc"
  curl -sSf --aws-sigv4 "aws:amz:auto:s3" --user "$R2_ACCESS_KEY_ID:$R2_SECRET_ACCESS_KEY" -T "$ARBETE/db.enc" "$URL" -o /dev/null
  ATER=$(curl -sSfI --aws-sigv4 "aws:amz:auto:s3" --user "$R2_ACCESS_KEY_ID:$R2_SECRET_ACCESS_KEY" "$URL" | awk 'tolower($1)=="content-length:"{print $2+0}')
  [[ "$ATER" == "$STORLEK" ]] || { echo "FEL: $NAMN har $ATER byte i R2, vantat $STORLEK"; exit 1; }
  echo "   $NAMN: $STORLEK byte"
done
