#!/bin/zsh
# Run jobslop entirely on this machine: ./scripts/local.sh scrape|serve
cd "${0:a:h}/.."
export JOBSLOP_SQLITE="$PWD/data/jobs.db"
case "$1" in
  scrape)
    [ -d .venv ] || { python3 -m venv .venv && .venv/bin/pip -q install -r requirements.txt; }
    exec .venv/bin/python scripts/aggregate.py ;;
  serve)
    cd web
    [ -f .next/BUILD_ID ] || { npm ci && npm run build; }
    exec npx next start -H "${JOBSLOP_HOST:-127.0.0.1}" -p 3000 ;;
  *) echo "usage: $0 scrape|serve"; exit 1 ;;
esac
