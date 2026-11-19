#!/usr/bin/env bash
# Deploy the ThermoPlan API to the EC2 host (used while Lambda execution roles are unavailable).
#
#   AWS_PROFILE=hvac ./infra/ec2-deploy.sh deploy       # code + deps + services + caddy
#   AWS_PROFILE=hvac ./infra/ec2-deploy.sh sync-login   # after `aws login --profile hvac` on this Mac
#   ./infra/ec2-deploy.sh status
#   ./infra/ec2-deploy.sh demo-reset                    # remove all events, restore default rules
#
# The EC2 host has no IAM role (the deployer cannot create roles), so it uses the operator's
# `aws login` session (max 12 h). When the session expires the API keeps serving from its local
# mirror (ResilientStore); Bedrock features need a fresh session (sync-login).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUN="$ROOT/infra/.run"
export AWS_REGION="${AWS_REGION:-ap-northeast-2}"
IP="$(awk '{print $2}' "$RUN/eip")"
DOMAIN="$(echo "$IP" | tr . -).sslip.io"
KEY="$HOME/.ssh/hvac-ai-ec2.pem"  # path without spaces (rsync -e splits on spaces)
[ -f "$KEY" ] || install -m 600 "$RUN/hvac-ai-ec2.pem" "$KEY"
SSH=(ssh -i "$KEY" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 "ec2-user@$IP")

sync_login() {
  # hvac profile + login cache only (no other profiles or credentials leave this machine)
  local prof
  prof="$(sed -n '/^\[profile hvac\]/,/^\[/p' ~/.aws/config | sed '$ { /^\[/d; }')"
  "${SSH[@]}" "mkdir -p ~/.aws/login/cache && chmod 700 ~/.aws ~/.aws/login ~/.aws/login/cache && rm -f ~/.aws/login/cache/*.json"
  printf '%s\n' "$prof" | "${SSH[@]}" "cat > ~/.aws/config && chmod 600 ~/.aws/config"
  scp -q -i "$KEY" ~/.aws/login/cache/*.json "ec2-user@$IP:.aws/login/cache/"
  "${SSH[@]}" "chmod 600 ~/.aws/login/cache/*.json && /opt/hvac/.venv/bin/python -c \"import boto3; print(boto3.Session(profile_name='hvac').client('sts').get_caller_identity()['Arn'])\" && sudo systemctl restart hvac-api"
}

deploy() {
  local secret kma acc
  acc="$(aws sts get-caller-identity --query Account --output text)"
  secret="$(aws ssm get-parameter --name /hvac-ai/origin-secret --with-decryption --query Parameter.Value --output text)"
  kma="$(aws ssm get-parameter --name /hvac-ai/kma-key --with-decryption --query Parameter.Value --output text)"
  aws ssm get-parameter --name /hvac-ai/operator-key >/dev/null 2>&1 || aws ssm put-parameter --name /hvac-ai/operator-key \
    --type SecureString --value "$(openssl rand -hex 16)" --tags Key=project,Value=hvac-ai >/dev/null
  local opkey
  opkey="$(aws ssm get-parameter --name /hvac-ai/operator-key --with-decryption --query Parameter.Value --output text)"

  rsync -az --delete -e "ssh -i $KEY -o StrictHostKeyChecking=accept-new" \
    --exclude '__pycache__' --exclude '.venv' --exclude 'tests' \
    "$ROOT/backend/" "ec2-user@$IP:/opt/hvac/backend/"

  "${SSH[@]}" "cd /opt/hvac && ( [ -d .venv ] || uv venv -q --python 3.13 .venv ) && \
    uv pip install -q --python .venv/bin/python fastapi mangum 'anthropic[bedrock]>=2.10' 'botocore[crt]' boto3 openpyxl python-multipart uvicorn"

  "${SSH[@]}" "umask 077 && cat > /opt/hvac/env" <<EOF
DATA_BUCKET=hvac-ai-data-${acc}
TABLE_NAME=hvac-ai-data
LOCAL_MIRROR=/var/lib/hvac/mirror
ORIGIN_SECRET=${secret}
KMA_KEY=${kma}
OPERATOR_KEY=${opkey}
AWS_PROFILE=hvac
AWS_REGION=${AWS_REGION}
BEDROCK_REGION=${AWS_REGION}
EOF

  "${SSH[@]}" "sudo tee /etc/systemd/system/hvac-api.service >/dev/null" <<'EOF'
[Unit]
Description=ThermoPlan API (FastAPI)
After=network-online.target
[Service]
User=ec2-user
WorkingDirectory=/opt/hvac/backend
EnvironmentFile=/opt/hvac/env
ExecStart=/opt/hvac/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1 --timeout-keep-alive 30
Restart=always
RestartSec=3
[Install]
WantedBy=multi-user.target
EOF
  "${SSH[@]}" "sudo tee /etc/systemd/system/hvac-refresh.service >/dev/null" <<'EOF'
[Unit]
Description=ThermoPlan hourly weather refresh + recompute
[Service]
Type=oneshot
EnvironmentFile=/opt/hvac/env
ExecStart=/bin/bash -c 'curl -s -m 30 -X POST -H "x-origin-secret: $ORIGIN_SECRET" http://127.0.0.1:8000/api/weather/refresh'
EOF
  "${SSH[@]}" "sudo tee /etc/systemd/system/hvac-refresh.timer >/dev/null" <<'EOF'
[Unit]
Description=Run ThermoPlan refresh every hour at :20
[Timer]
OnCalendar=*-*-* *:20:00
Persistent=true
[Install]
WantedBy=timers.target
EOF
  "${SSH[@]}" "sudo tee /etc/caddy/Caddyfile >/dev/null" <<EOF
${DOMAIN} {
  encode gzip
  reverse_proxy 127.0.0.1:8000 {
    transport http {
      read_timeout 120s
    }
  }
}
EOF
  "${SSH[@]}" "sudo tee /etc/systemd/system/caddy.service >/dev/null" <<'EOF'
[Unit]
Description=Caddy (HTTPS reverse proxy)
After=network-online.target
[Service]
ExecStart=/usr/local/bin/caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
Restart=always
Environment=HOME=/var/lib/caddy XDG_DATA_HOME=/var/lib/caddy
[Install]
WantedBy=multi-user.target
EOF
  "${SSH[@]}" "sudo mkdir -p /var/lib/caddy /var/lib/hvac/mirror && sudo chown ec2-user /var/lib/hvac/mirror && \
    sudo systemctl daemon-reload && sudo systemctl enable --now hvac-api caddy hvac-refresh.timer && \
    sudo systemctl restart hvac-api caddy"
  echo "api host: $DOMAIN"
}

demo_reset() {
  "${SSH[@]}" 'set -a; . /opt/hvac/env; set +a; curl -s -X POST -H "x-origin-secret: $ORIGIN_SECRET" -H "x-operator-key: $OPERATOR_KEY" http://127.0.0.1:8000/api/admin/reset; echo'
}

status() {
  "${SSH[@]}" "systemctl is-active hvac-api caddy hvac-refresh.timer; curl -s -m 5 http://127.0.0.1:8000/api/health; echo; tail -n 5 /var/log/messages 2>/dev/null | cut -c1-160 || true"
}

case "${1:-deploy}" in
  deploy) deploy ;;
  sync-login) sync_login ;;
  status) status ;;
  demo-reset) demo_reset ;;
  *) echo "usage: $0 deploy|sync-login|status|demo-reset" >&2; exit 1 ;;
esac
