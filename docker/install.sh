#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
cd "$PROJECT_DIR"

docker compose up -d --build
printf '\nXYZW Web Helper is starting. Open http://localhost:%s/tokens\n' "${PORT:-8080}"
docker compose ps
