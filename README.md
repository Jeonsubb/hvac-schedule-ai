# AWS backup (2026-11-21)

Snapshot of the deployed ON:D (hvac-ai) cloud data, taken before the hackathon AWS resources were deleted.

`hvac-ai-aws-backup.tgz` (23 MB, 190 MB unpacked) contains:

| Path | Source |
|---|---|
| `s3-data/` | every object in `s3://hvac-ai-data-<account>` (days, daysum, summary, analysis, weather, negotiation, jobs, gateway, lab) |
| `dynamodb/hvac-ai-data.json` | full scan of the `hvac-ai-data` table (1,050 items, DynamoDB JSON) |
| `dynamodb/table-schema.json` | table definition |
| `deployed-template.json`, `stack-params-outputs.json` | the CloudFormation template and parameters as deployed (secrets show as `****`) |

Not included: the web bucket and Lambda code artifacts (rebuilt from `main` with `infra/deploy.sh`) and the SSM secrets (KMA key, operator key, origin secret).

Restore the data into a local run: unpack, then point `LOCAL_STORE` at `s3-data/`.
