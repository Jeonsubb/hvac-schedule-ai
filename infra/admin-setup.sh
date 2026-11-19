#!/usr/bin/env bash
# One-time setup for an AWS account admin (run in AWS CloudShell, region ap-northeast-2).
# Creates the two execution roles ThermoPlan needs and lets the deployer user attach them
# to Lambda / EventBridge Scheduler. Nothing else in the account is touched.
#
#   curl -sO <raw url of this file>  (or paste it)  &&  bash admin-setup.sh
set -euo pipefail

ACC="$(aws sts get-caller-identity --query Account --output text)"
REGION="ap-northeast-2"
DEPLOYER="${DEPLOYER:-hvac-dev-donghun}"

cat > /tmp/lambda-trust.json <<'EOF'
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}
EOF
cat > /tmp/scheduler-trust.json <<'EOF'
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"scheduler.amazonaws.com"},"Action":"sts:AssumeRole"}]}
EOF
cat > /tmp/api-policy.json <<EOF
{"Version":"2012-10-17","Statement":[
 {"Effect":"Allow","Action":["logs:CreateLogGroup","logs:CreateLogStream","logs:PutLogEvents"],"Resource":"arn:aws:logs:${REGION}:${ACC}:*"},
 {"Effect":"Allow","Action":["s3:GetObject","s3:PutObject"],"Resource":"arn:aws:s3:::hvac-ai-data-${ACC}/*"},
 {"Effect":"Allow","Action":"s3:ListBucket","Resource":"arn:aws:s3:::hvac-ai-data-${ACC}"},
 {"Effect":"Allow","Action":["dynamodb:GetItem","dynamodb:PutItem","dynamodb:DeleteItem","dynamodb:UpdateItem","dynamodb:Query","dynamodb:BatchWriteItem"],"Resource":"arn:aws:dynamodb:${REGION}:${ACC}:table/hvac-ai-data"},
 {"Effect":"Allow","Action":"ssm:GetParameter","Resource":"arn:aws:ssm:${REGION}:${ACC}:parameter/hvac-ai/kma-key"},
 {"Effect":"Allow","Action":["bedrock:InvokeModel","bedrock:InvokeModelWithResponseStream"],"Resource":["arn:aws:bedrock:*::foundation-model/anthropic.*","arn:aws:bedrock:*:${ACC}:inference-profile/*"]},
 {"Effect":"Allow","Action":"lambda:InvokeFunction","Resource":"arn:aws:lambda:${REGION}:${ACC}:function:hvac-ai-api"}
]}
EOF
cat > /tmp/scheduler-policy.json <<EOF
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":"lambda:InvokeFunction","Resource":"arn:aws:lambda:${REGION}:${ACC}:function:hvac-ai-api"}]}
EOF
cat > /tmp/passrole.json <<EOF
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":"iam:PassRole","Resource":[
 "arn:aws:iam::${ACC}:role/hvac-ai-api-role","arn:aws:iam::${ACC}:role/hvac-ai-scheduler-role"]}]}
EOF

aws iam create-role --role-name hvac-ai-api-role --assume-role-policy-document file:///tmp/lambda-trust.json \
  --tags Key=project,Value=hvac-ai >/dev/null 2>&1 || echo "hvac-ai-api-role already exists - updating policy"
aws iam put-role-policy --role-name hvac-ai-api-role --policy-name hvac-ai-api --policy-document file:///tmp/api-policy.json

aws iam create-role --role-name hvac-ai-scheduler-role --assume-role-policy-document file:///tmp/scheduler-trust.json \
  --tags Key=project,Value=hvac-ai >/dev/null 2>&1 || echo "hvac-ai-scheduler-role already exists - updating policy"
aws iam put-role-policy --role-name hvac-ai-scheduler-role --policy-name invoke --policy-document file:///tmp/scheduler-policy.json

aws iam put-user-policy --user-name "$DEPLOYER" --policy-name hvac-ai-passrole --policy-document file:///tmp/passrole.json

echo "done:"
echo "  arn:aws:iam::${ACC}:role/hvac-ai-api-role"
echo "  arn:aws:iam::${ACC}:role/hvac-ai-scheduler-role"
echo "  ${DEPLOYER} may now pass these two roles (iam:PassRole only)."
