#!/usr/bin/env bash
# Run the demo script's AI prompts once on presentation day so that, if Bedrock becomes
# unavailable during the demo, the same questions are answered from the same-day cache.
#   ./scripts/warm_demo.sh [https://d32ggz3cj7s7bx.cloudfront.net]
set -euo pipefail
API="${1:-https://d32ggz3cj7s7bx.cloudfront.net}"

parse() {
  printf '  parse: %s ... ' "$1"
  curl -s -m 60 -X POST "$API/api/events/parse" -H 'content-type: application/json' \
    -d "{\"text\": \"$1\"}" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('type'), d.get('date'), d.get('room'), 'check ok' if (d.get('check') or {}).get('ok') else 'check: issues')"
}

chat() {
  printf '  chat: %s\n' "$1"
  job=$(curl -s -m 30 -X POST "$API/api/chat" -H 'content-type: application/json' \
    -d "{\"messages\": [{\"role\": \"user\", \"content\": \"$1\"}]}" | python3 -c "import json,sys; print(json.load(sys.stdin)['job'])")
  for _ in $(seq 1 60); do
    st=$(curl -s "$API/api/jobs/$job" | python3 -c "import json,sys; print(json.load(sys.stdin)['status'])")
    [ "$st" = done ] || [ "$st" = error ] && break
    sleep 3
  done
  echo "    -> $st"
}

echo "AI warm-up against $API"
parse "다음 주 수요일 405호 18~21시 캡스톤 특강 50명"
parse "11월 27일 금요일 307호 지능형IoT플랫폼 휴강"
chat "선행 가동을 10분에서 5분으로 줄이면 이번 주 에너지와 쾌적도가 어떻게 바뀌는지 시뮬레이션해줘"
chat "이번 주 에너지 낭비가 가장 큰 강의실과 이유는?"
chat "금요일 강의실 재배치로 얼마나 절감돼?"
curl -s "$API/api/meta" | python3 -c "import json,sys; d=json.load(sys.stdin); print('AI status:', d.get('ai'), '| storage:', d.get('storage', {}).get('mode'))"
