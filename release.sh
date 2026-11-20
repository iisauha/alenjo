#!/bin/sh
# Stamp a new version so installed copies of Alenjo update themselves.
# Run this before committing a change: ./release.sh
set -e
V=$(date -u +%Y%m%d%H%M%S)
OLD=$(sed -n "s/.*var _v = '\([^']*\)'.*/\1/p" index.html)
sed -i.bak "s/$OLD/$V/g" index.html && rm -f index.html.bak
printf '{ "version": "%s" }\n' "$V" > version.json
echo "Version $OLD -> $V"
