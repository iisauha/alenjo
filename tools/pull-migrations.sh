#!/bin/sh
# Download every database migration the live project has run into supabase/migrations,
# keeping the commented files already here. Run once on a computer with the Supabase CLI
# (logged in with: supabase login), then commit the new files.
#   ./tools/pull-migrations.sh
set -e
PROJECT=itkufrockebnlzcroigc
TMP=$(mktemp -d)
mkdir -p "$TMP/supabase"
(cd "$TMP" && supabase link --project-ref "$PROJECT" >/dev/null && supabase migration fetch)
added=0
for f in "$TMP"/supabase/migrations/*.sql; do
  v=$(basename "$f" | cut -d_ -f1)
  if ! ls supabase/migrations/"$v"_*.sql >/dev/null 2>&1; then cp "$f" supabase/migrations/; added=$((added+1)); fi
done
rm -rf "$TMP"
echo "Added $added migration(s) to supabase/migrations"
