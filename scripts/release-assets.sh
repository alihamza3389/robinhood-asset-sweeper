#!/usr/bin/env bash
# Upload the downloadable files to a GitHub release (run after `gh release create <tag>`):
#   robinhood-asset-sweeper.zip            for people (the README links to the latest one)
#   robinhood-asset-sweeper-<tag>.tar.gz   for the in-app updater
# Both are built from the tag with `git archive`, so they hold exactly the committed files and
# nothing from this folder (keys, .env, custom tokens). GitHub counts downloads of both.
set -euo pipefail

TAG="${1:?usage: scripts/release-assets.sh <tag, e.g. v4.1.0>}"
cd "$(dirname "$0")/.."
git rev-parse -q --verify "refs/tags/$TAG" >/dev/null || { echo "No tag $TAG"; exit 1; }

OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT
ZIP="$OUT/robinhood-asset-sweeper.zip"
TGZ="$OUT/robinhood-asset-sweeper-$TAG.tar.gz"
git archive --format=zip --prefix="robinhood-asset-sweeper-$TAG/" -o "$ZIP" "$TAG"
git archive --format=tar.gz --prefix="robinhood-asset-sweeper-$TAG/" -o "$TGZ" "$TAG"

# Belt and braces: refuse if anything that looks like a secret file ever got committed.
if tar -tzf "$TGZ" | grep -E '/(\.env|\.env\.local|wallet\.keystore[^/]*\.json|custom-tokens\.json|[^/]*\.pem|[^/]*\.key)$'; then
  echo "Refusing to upload: the files above look sensitive."
  exit 1
fi

# The package must be the version the tag says.
VERSION="$(tar -xzOf "$TGZ" "robinhood-asset-sweeper-$TAG/package.json" | node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(0)).version)')"
[ "v$VERSION" = "$TAG" ] || { echo "package.json says $VERSION, tag is $TAG"; exit 1; }

gh release upload "$TAG" "$ZIP" "$TGZ" --clobber
echo "Uploaded $(basename "$ZIP") and $(basename "$TGZ") to $TAG"
