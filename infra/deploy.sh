#!/usr/bin/env bash
# Build and deploy ThermoPlan (HVAC Schedule AI) to AWS.
#   AWS_PROFILE=hvac ./infra/deploy.sh            # full deploy (backend + frontend)
#   AWS_PROFILE=hvac ./infra/deploy.sh backend    # backend only
#   AWS_PROFILE=hvac ./infra/deploy.sh frontend   # frontend only
# First run needs the KMA service key: KMA_KEY=... ./infra/deploy.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REGION="${AWS_REGION:-ap-northeast-2}"
STACK="hvac-ai"
PART="${1:-all}"
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
ART_BUCKET="hvac-ai-artifacts-${ACCOUNT}"
BUILD="$ROOT/infra/.build"

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

ensure_artifacts_bucket() {
  if ! aws s3api head-bucket --bucket "$ART_BUCKET" 2>/dev/null; then
    log "creating artifact bucket $ART_BUCKET"
    aws s3api create-bucket --bucket "$ART_BUCKET" --region "$REGION" \
      --create-bucket-configuration LocationConstraint="$REGION" >/dev/null
    aws s3api put-public-access-block --bucket "$ART_BUCKET" --public-access-block-configuration \
      BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
    aws s3api put-bucket-tagging --bucket "$ART_BUCKET" --tagging 'TagSet=[{Key=project,Value=hvac-ai}]'
  fi
}

ensure_params() {
  if ! aws ssm get-parameter --name /hvac-ai/kma-key --region "$REGION" >/dev/null 2>&1; then
    if [ -z "${KMA_KEY:-}" ]; then echo "KMA_KEY env var required on first deploy" >&2; exit 1; fi
    log "storing KMA key in SSM (SecureString)"
    aws ssm put-parameter --name /hvac-ai/kma-key --type SecureString --value "$KMA_KEY" --region "$REGION" \
      --tags Key=project,Value=hvac-ai >/dev/null
  fi
  if ! aws ssm get-parameter --name /hvac-ai/origin-secret --with-decryption --region "$REGION" >/dev/null 2>&1; then
    log "generating CloudFront origin secret"
    aws ssm put-parameter --name /hvac-ai/origin-secret --type SecureString \
      --value "$(openssl rand -hex 24)" --region "$REGION" --tags Key=project,Value=hvac-ai >/dev/null
  fi
  ORIGIN_SECRET="$(aws ssm get-parameter --name /hvac-ai/origin-secret --with-decryption --region "$REGION" \
    --query Parameter.Value --output text)"
}

build_backend() {
  log "building backend package (python3.13 arm64)"
  rm -rf "$BUILD" && mkdir -p "$BUILD/pkg"
  uv pip install --quiet --target "$BUILD/pkg" \
    --python-platform aarch64-manylinux2014 --python-version 3.13 --only-binary :all: \
    fastapi mangum "anthropic>=2.10" openpyxl python-multipart
  # boto3/botocore come from the Lambda runtime
  rm -rf "$BUILD/pkg"/boto3* "$BUILD/pkg"/botocore* "$BUILD/pkg"/s3transfer* 2>/dev/null || true
  cp -R "$ROOT/backend/app" "$ROOT/backend/hvac" "$ROOT/backend/seed" "$BUILD/pkg/"
  find "$BUILD/pkg" -name '__pycache__' -type d -prune -exec rm -rf {} +
  (cd "$BUILD/pkg" && zip -qr9 "$BUILD/backend.zip" .)
  HASH="$(shasum -a 256 "$BUILD/backend.zip" | cut -c1-16)"
  CODE_KEY="backend/backend-${HASH}.zip"
  aws s3 cp --quiet "$BUILD/backend.zip" "s3://${ART_BUCKET}/${CODE_KEY}"
  echo "uploaded s3://${ART_BUCKET}/${CODE_KEY} ($(du -h "$BUILD/backend.zip" | cut -f1))"
}

deploy_stack() {
  log "deploying CloudFormation stack $STACK"
  aws cloudformation deploy --region "$REGION" --stack-name "$STACK" \
    --template-file "$ROOT/infra/template.yaml" --capabilities CAPABILITY_NAMED_IAM \
    --parameter-overrides CodeBucket="$ART_BUCKET" CodeKey="$CODE_KEY" OriginSecret="$ORIGIN_SECRET" \
    --tags project=hvac-ai --no-fail-on-empty-changeset
}

output() {
  aws cloudformation describe-stacks --region "$REGION" --stack-name "$STACK" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}

deploy_frontend() {
  log "building frontend"
  (cd "$ROOT/frontend" && npm ci --silent && npm run build --silent)
  WEB_BUCKET="$(output WebBucketName)"
  DIST_ID="$(output DistributionId)"
  aws s3 sync "$ROOT/frontend/dist/assets" "s3://${WEB_BUCKET}/assets" --delete \
    --cache-control "public,max-age=31536000,immutable" --quiet
  aws s3 sync "$ROOT/frontend/dist" "s3://${WEB_BUCKET}" --delete --exclude "assets/*" \
    --cache-control "no-cache" --quiet
  aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "/*" --query Invalidation.Id --output text
}

ensure_artifacts_bucket
ensure_params
if [ "$PART" = "all" ] || [ "$PART" = "backend" ]; then
  build_backend
  deploy_stack
  log "warming: weather fetch + semester precompute (async)"
  aws lambda invoke --region "$REGION" --function-name hvac-ai-api --invocation-type Event \
    --cli-binary-format raw-in-base64-out --payload '{"task":"hourly"}' /dev/null >/dev/null
fi
if [ "$PART" = "all" ] || [ "$PART" = "frontend" ]; then
  deploy_frontend
fi
log "site: $(output SiteUrl)"
