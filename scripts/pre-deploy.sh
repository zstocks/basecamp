#!/usr/bin/env bash
#
# Pre-deploy hook: snapshot the database before new code touches it.
#
# db.js applies any pending migrations automatically at startup, so
# `docker compose up` is the moment a schema change actually runs against real
# data. That is the most realistic way this project loses data -- and unlike a
# disk failure, it happens at a moment you control. So take a snapshot first.
#
# Off-site is skipped deliberately: this runs interactively while you wait, and
# a slow or unreachable storage box should not block a deploy. The local copy is
# what you would roll back from, and the daily timer handles off-site.
#
# Called by ~/deploy.sh if present and executable. Safe to run by hand.

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

echo "Pre-deploy: snapshotting the database before migrations run..."
"$SCRIPT_DIR/backup.sh" --skip-offsite --reason pre-deploy
