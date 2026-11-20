#!/usr/bin/env bash
# Build and deploy ThermoPlan (HVAC Schedule AI) to AWS.
#
#   AWS_PROFILE=hvac ./infra/deploy.sh lambda                 # full serverless (needs infra/admin-setup.sh done once)
#   AWS_PROFILE=hvac ./infra/deploy.sh external <api-host>    # web + data on AWS, /api/* -> external host (e.g. tunnel)
#   AWS_PROFILE=hvac ./infra/deploy.sh frontend               # rebuild and upload the web app only
#   AWS_PROFILE=hvac ./infra/deploy.sh demo-reset             # remove all events, restore default rules
# First run needs the KMA service key: KMA_KEY=... ./infra/deploy.sh ...
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REGION="${AWS_REGION:-ap-northeast-2}"
export AWS_REGION="$REGION"
STACK="hvac-ai"
MODE="${1:-lambda}"
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
ART_BUCKET="hvac-ai-artifacts-${ACCOUNT}"
BUILD="$ROOT/infra/.build"

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

ensure_artifacts_bucket() {
  if ! aws s3api head-bucket --bucket "$ART_BUCKET" 2>/dev/null; then
    log "creating artifact bucket $ART_BUCKET"
    aws s3api create-bucket --bucket "$ART_BUCKET" --create-bucket-configuration LocationConstraint="$REGION" >/dev/null
    aws s3api put-public-access-block --bucket "$ART_BUCKET" --public-access-block-configuration \
      BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
  fi
}

ensure_params() {
  if ! aws ssm get-parameter --name /hvac-ai/kma-key >/dev/null 2>&1; then
    if [ -z "${KMA_KEY:-}" ]; then echo "KMA_KEY env var required on first deploy" >&2; exit 1; fi
    aws ssm put-parameter --name /hvac-ai/kma-key --type SecureString --value "$KMA_KEY" \
      --tags Key=project,Value=hvac-ai >/dev/null
  fi
  if ! aws ssm get-parameter --name /hvac-ai/origin-secret --with-decryption >/dev/null 2>&1; then
    aws ssm put-parameter --name /hvac-ai/origin-secret --type SecureString --value "$(openssl rand -hex 24)" \
      --tags Key=project,Value=hvac-ai >/dev/null
  fi
  ORIGIN_SECRET="$(aws ssm get-parameter --name /hvac-ai/origin-secret --with-decryption --query Parameter.Value --output text)"
  if ! aws ssm get-parameter --name /hvac-ai/operator-key >/dev/null 2>&1; then
    aws ssm put-parameter --name /hvac-ai/operator-key --type SecureString --value "$(openssl rand -hex 16)" \
      --tags Key=project,Value=hvac-ai >/dev/null
  fi
  OPERATOR_KEY="$(aws ssm get-parameter --name /hvac-ai/operator-key --with-decryption --query Parameter.Value --output text)"
}

build_backend() {
  log "building backend package (python3.13 arm64)"
  rm -rf "$BUILD" && mkdir -p "$BUILD/pkg"
  uv pip install --quiet --target "$BUILD/pkg" \
    --python-platform aarch64-manylinux2014 --python-version 3.13 --only-binary :all: \
    fastapi mangum "anthropic>=2.10" openpyxl python-multipart
  rm -rf "$BUILD/pkg"/boto3* "$BUILD/pkg"/botocore* "$BUILD/pkg"/s3transfer* 2>/dev/null || true
  cp -R "$ROOT/backend/app" "$ROOT/backend/hvac" "$ROOT/backend/seed" "$BUILD/pkg/"
  find "$BUILD/pkg" -name '__pycache__' -type d -prune -exec rm -rf {} +
  (cd "$BUILD/pkg" && zip -qr9 "$BUILD/backend.zip" .)
  CODE_KEY="backend/backend-$(shasum -a 256 "$BUILD/backend.zip" | cut -c1-16).zip"
  aws s3 cp --quiet "$BUILD/backend.zip" "s3://${ART_BUCKET}/${CODE_KEY}"
  echo "uploaded s3://${ART_BUCKET}/${CODE_KEY} ($(du -h "$BUILD/backend.zip" | cut -f1))"
}

deploy_stack() {
  log "deploying CloudFormation stack $STACK ($MODE)"
  aws cloudformation deploy --stack-name "$STACK" --template-file "$ROOT/infra/template.yaml" \
    --parameter-overrides "$@" OriginSecret="$ORIGIN_SECRET" --tags project=hvac-ai --no-fail-on-empty-changeset
}

output() {
  aws cloudformation describe-stacks --stack-name "$STACK" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}

deploy_frontend() {
  log "building and uploading frontend"
  (cd "$ROOT/frontend" && npm ci --silent && npm run build --silent)
  WEB_BUCKET="$(output WebBucketName)"
  aws s3 sync "$ROOT/frontend/dist/assets" "s3://${WEB_BUCKET}/assets" \
    --cache-control "public,max-age=31536000,immutable" --quiet
  aws s3 sync "$ROOT/frontend/dist" "s3://${WEB_BUCKET}" --delete --exclude "assets/*" \
    --cache-control "no-cache" --quiet
  aws cloudfront create-invalidation --distribution-id "$(output DistributionId)" --paths "/*" \
    --query Invalidation.Id --output text
}

ensure_params
case "$MODE" in
  lambda)
    ensure_artifacts_bucket
    build_backend
    deploy_stack ApiMode=lambda CodeBucket="$ART_BUCKET" CodeKey="$CODE_KEY" OperatorKey="$OPERATOR_KEY" \
      FunctionRoleArn="arn:aws:iam::${ACCOUNT}:role/hvac-ai-api-role" \
      SchedulerRoleArn="arn:aws:iam::${ACCOUNT}:role/hvac-ai-scheduler-role"
    aws lambda invoke --function-name hvac-ai-api --invocation-type Event \
      --cli-binary-format raw-in-base64-out --payload '{"task":"hourly"}' /dev/null >/dev/null
    deploy_frontend
    ;;
  external)
    API_HOST="${2:?usage: deploy.sh external <api-host>}"
    deploy_stack ApiMode=external ExternalApiDomain="$API_HOST"
    deploy_frontend
    ;;
  frontend)
    deploy_frontend
    ;;
  demo-reset)
    curl -s -m 60 -X POST -H "x-operator-key: $OPERATOR_KEY" "$(output SiteUrl)/api/admin/reset"; echo
    ;;
  *) echo "unknown mode $MODE" >&2; exit 1 ;;
esac
log "site: $(output SiteUrl)"
