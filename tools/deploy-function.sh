#!/bin/sh
# Deploy one edge function with the shared files it imports (./plaid.js, ./notify.js, ...).
# Functions import shared code from their own folder, so the files in supabase/functions/_shared
# are copied next to index.ts in a temporary folder and deployed from there.
#   ./tools/deploy-function.sh sync-transactions
# Needs the Supabase CLI, logged in (supabase login). Every function does its own sign-in
# check, so all deploy with --no-verify-jwt.
set -e
NAME="$1"
[ -n "$NAME" ] && [ -f "supabase/functions/$NAME/index.ts" ] || { echo "usage: $0 <function-name>"; exit 1; }
PROJECT=itkufrockebnlzcroigc
TMP=$(mktemp -d)
mkdir -p "$TMP/supabase/functions/$NAME"
cp "supabase/functions/$NAME/index.ts" "$TMP/supabase/functions/$NAME/"
# Copy shared files the function (and those files) import, until nothing new is needed
changed=1
while [ "$changed" = 1 ]; do
  changed=0
  for dep in $(grep -ho "\./[a-z]*\.js" "$TMP/supabase/functions/$NAME"/* | sort -u); do
    f=$(basename "$dep")
    if [ ! -f "$TMP/supabase/functions/$NAME/$f" ]; then cp "supabase/functions/_shared/$f" "$TMP/supabase/functions/$NAME/"; changed=1; fi
  done
done
(cd "$TMP" && supabase functions deploy "$NAME" --project-ref "$PROJECT" --no-verify-jwt)
rm -rf "$TMP"
