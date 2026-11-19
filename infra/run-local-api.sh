#!/usr/bin/env bash
# Run the ThermoPlan API on this machine against the AWS data store (S3 + DynamoDB + Bedrock)
# and expose it through a Cloudflare quick tunnel so CloudFront can use it as the /api origin.
# Used while Lambda execution roles are unavailable (see infra/admin-setup.sh).
#
#   AWS_PROFILE=hvac ./infra/run-local-api.sh start   # prints the tunnel host
#   ./infra/run-local-api.sh stop
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUN="$ROOT/infra/.run"
PORT="${PORT:-8001}"
export AWS_REGION="${AWS_REGION:-ap-northeast-2}"
mkdir -p "$RUN"

stop() {
  for f in api tunnel refresh caffeinate; do
    [ -f "$RUN/$f.pid" ] && kill "$(cat "$RUN/$f.pid")" 2>/dev/null || true
    rm -f "$RUN/$f.pid"
  done
}

start() {
  stop
  ACC="$(aws sts get-caller-identity --query Account --output text)"
  export DATA_BUCKET="hvac-ai-data-${ACC}" TABLE_NAME="hvac-ai-data"
  export ORIGIN_SECRET="$(aws ssm get-parameter --name /hvac-ai/origin-secret --with-decryption --query Parameter.Value --output text)"
  export KMA_KEY="$(aws ssm get-parameter --name /hvac-ai/kma-key --with-decryption --query Parameter.Value --output text)"
  unset NOW_OVERRIDE LOCAL_STORE

  (cd "$ROOT/backend" && nohup .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port "$PORT" \
      < /dev/null > "$RUN/api.log" 2>&1 & echo $! > "$RUN/api.pid")
  nohup cloudflared tunnel --no-autoupdate --url "http://127.0.0.1:${PORT}" < /dev/null > "$RUN/tunnel.log" 2>&1 &
  echo $! > "$RUN/tunnel.pid"
  # hourly weather refresh + recompute (what EventBridge Scheduler does in Lambda mode)
  nohup bash -c "while true; do sleep 3600; curl -s -X POST -H 'x-origin-secret: ${ORIGIN_SECRET}' http://127.0.0.1:${PORT}/api/weather/refresh >/dev/null; done" \
    < /dev/null > /dev/null 2>&1 &
  echo $! > "$RUN/refresh.pid"
  nohup caffeinate -dims -w "$(cat "$RUN/api.pid")" < /dev/null > /dev/null 2>&1 &
  echo $! > "$RUN/caffeinate.pid"

  HOST=""
  for _ in $(seq 1 30); do
    HOST="$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$RUN/tunnel.log" 2>/dev/null | head -1 | sed 's#https://##' || true)"
    [ -n "$HOST" ] && break
    sleep 1
  done
  echo "${HOST:?tunnel did not start; see $RUN/tunnel.log}" > "$RUN/tunnel.host"
  echo "$HOST"
}

case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  *) echo "usage: $0 start|stop" >&2; exit 1 ;;
esac
