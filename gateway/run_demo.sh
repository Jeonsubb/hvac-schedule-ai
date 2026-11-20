#!/usr/bin/env bash
# Start the IT관 virtual central controller (BACnet/IP) and the edge gateway on this machine,
# connected to the ThermoPlan cloud. Stop with: ./run_demo.sh stop
#
#   ./run_demo.sh start [PAIR_CODE]     # default code DEMO-PNU1, writes allowed (virtual controller only)
#   ./run_demo.sh status | logs | stop
set -euo pipefail
cd "$(dirname "$0")"
CLOUD="${CLOUD:-https://d32ggz3cj7s7bx.cloudfront.net}"
CODE="${2:-${PAIR_CODE:-DEMO-PNU1}}"
RUN=.run
mkdir -p "$RUN"
PY="${PYTHON:-.venv/bin/python}"

ensure_venv() {
  if [ ! -x .venv/bin/python ]; then
    echo "==> creating .venv (bacpypes3, httpx)"
    if command -v uv >/dev/null; then uv venv -q --python 3.13 .venv && uv pip install -q --python .venv/bin/python -r requirements.txt
    else python3 -m venv .venv && .venv/bin/pip install -q -r requirements.txt; fi
  fi
}

case "${1:-start}" in
  start)
    ensure_venv
    "$0" stop >/dev/null 2>&1 || true
    nohup "$PY" virtual_controller.py --cloud "$CLOUD" --address 127.0.0.1/32:47808 > "$RUN/controller.log" 2>&1 &
    echo $! > "$RUN/controller.pid"
    sleep 3
    nohup "$PY" edge_gateway.py --cloud "$CLOUD" --pair "$CODE" --controller 127.0.0.1:47808 --local 127.0.0.1/32:47809 --allow-write > "$RUN/gateway.log" 2>&1 &
    echo $! > "$RUN/gateway.pid"
    sleep 6
    echo "virtual controller: $(tail -n 1 "$RUN/controller.log")"
    echo "gateway:            $(tail -n 1 "$RUN/gateway.log")"
    echo "pair code: $CODE  (onboarding step 2: method 게이트웨이, host 127.0.0.1, port 47808, this code)"
    ;;
  stop)
    for p in gateway controller; do
      [ -f "$RUN/$p.pid" ] && kill "$(cat "$RUN/$p.pid")" 2>/dev/null || true
      rm -f "$RUN/$p.pid"
    done
    echo "stopped"
    ;;
  status)
    for p in controller gateway; do
      if [ -f "$RUN/$p.pid" ] && kill -0 "$(cat "$RUN/$p.pid")" 2>/dev/null; then echo "$p: running"; else echo "$p: stopped"; fi
    done
    ;;
  logs) tail -n 20 "$RUN/controller.log" "$RUN/gateway.log" ;;
  *) echo "usage: $0 start [PAIR_CODE] | stop | status | logs" >&2; exit 2 ;;
esac
