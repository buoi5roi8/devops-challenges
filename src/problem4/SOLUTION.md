# Production-ready CI/CD: EC2 API + S3 SPA

## Scope

Two independently deployable applications live in this repository:

- `backend/`: Node HTTP API deployed to EC2 instances.
- `frontend/`: static SPA deployed to S3, optionally fronted by CloudFront.

The sample applications exist only to make the submitted pipelines executable locally. Replace their commands with the real applications' install, lint, test, and build commands.

## Definition of production ready

A production deployment must be repeatable, least-privileged, auditable, serialized, approved by an authorised human, and fail before releasing when validation fails. These workflows provide:

- Pull-request validation without cloud credentials or deployment permissions.
- Locked Node major version, `npm ci`, linting, tests, and a real frontend build.
- Path filtering, so independent applications do not release each other.
- GitHub Environment `production`: configure required reviewers in repository settings. A protected environment gates deployment and keeps production secrets unavailable to PRs.
- GitHub OIDC federation to AWS. No long-lived AWS keys in GitHub.
- Minimal workflow permissions: read-only by default, `id-token: write` only in deployment jobs.
- Immutable backend release objects named with the commit SHA, checksum verification on EC2, deployment summary, and concurrency locks which never cancel an in-progress production deploy.
- Deployment through AWS Systems Manager rather than inbound SSH. SSM rolls instances one at a time and fails on the first error.
- SPA build promotion through a GitHub artifact: deploy uploads the CI-tested artifact, never rebuilds a potentially different output.
- S3 cache policy: `index.html` and runtime config never cache; other assets receive a short cache. CloudFront invalidation is optional.

## Triggers and flow

Both workflows run verification for pull requests to `main`. A merged push to `main`, or an explicit `workflow_dispatch`, runs the deployment only after `verify` succeeds and the production environment approval is granted.

### Backend

`.github/workflows/backend.yml` creates `backend-release-<SHA>.tgz`, uploads it to the private release bucket, then invokes `/opt/product/bin/deploy-backend.sh` with AWS SSM. The host script downloads and verifies the checksum, expands into `/opt/product/releases/<SHA>`, atomically updates `/opt/product/current`, restarts `product-backend`, and probes `http://127.0.0.1:3000/healthz`.

The EC2 instances need the SSM agent, an instance profile permitted only to read `s3://<release-bucket>/backend/*`, a `product-backend.service`, `curl`, and the host script installed as root-owned executable code. They must carry tag `<EC2_INSTANCE_TAG>=true`.

Rollback: manually dispatch the backend workflow selecting a known-good commit. This deploys the immutable prior bundle. A failed host health check makes SSM report failure; the script intentionally does not auto-rollback because it cannot prove the prior service is safe to restore.

### Frontend

`.github/workflows/frontend.yml` tests and builds once, saves `frontend/dist` as an artifact, then uploads that artifact to S3. `config.js` embeds `API_BASE_URL` at build time. If `CLOUDFRONT_DISTRIBUTION_ID` is configured, the workflow invalidates the distribution.

Rollback: manually dispatch at a known-good commit. S3 bucket versioning is recommended for object-level recovery.

## Required GitHub configuration

Repository variables:

| Variable | Use |
| --- | --- |
| `AWS_REGION` | AWS deployment region |
| `RELEASE_BUCKET` | private backend release S3 bucket |
| `EC2_INSTANCE_TAG` | EC2 tag key used by SSM, e.g. `ProductBackend` |
| `FRONTEND_BUCKET` | S3 SPA bucket name |
| `API_BASE_URL` | public backend base URL, e.g. `https://api.example.com` |
| `FRONTEND_URL` | optional production URL shown by GitHub Environment |
| `CLOUDFRONT_DISTRIBUTION_ID` | optional CloudFront distribution ID |

Repository environment secret:

| Secret | Use |
| --- | --- |
| `AWS_DEPLOY_ROLE_ARN` | AWS IAM role assumed by GitHub OIDC |

Create a GitHub Environment named `production` with required reviewers. Scope the IAM trust policy to this repository, the `main` branch, and ideally the `production` environment subject. Its policy should allow only the S3 release/deployment paths, SSM command invocation on the tagged EC2 instances, and optional CloudFront invalidation. Do not grant administrator access.

Enable branch protection on `main`: require both workflows' `verify` checks, pull request review, and linear history as appropriate. Enable S3 bucket versioning, default encryption, public-access block, CloudTrail, and CloudFront Origin Access Control. Use an ALB or CloudFront in front of the API for TLS and health-based routing.

## Deliberately excluded

- AWS account/IAM/VPC/EC2/S3/CloudFront provisioning. This should be separate, reviewed IaC; no AWS account exists for the exercise.
- Database migrations. They need application-specific backwards-compatible migration and rollback policy.
- Secrets pushed to hosts or baked into artifacts. Retrieve runtime secrets from Parameter Store or Secrets Manager using the EC2 instance role.
- Automated rollback, blue/green traffic shifting, canary analysis, load tests, image/container supply-chain scanning, and external uptime smoke tests. Add them when the product's availability objective and architecture justify them.
- Notification integrations. GitHub Environment history, deployment summaries, CloudTrail, and SSM command output provide auditability; connect Slack/PagerDuty according to the team standard.

## Local verification

```bash
cd backend && npm ci && npm run lint && npm test
cd ../frontend && npm ci && npm run lint && npm test && API_BASE_URL=https://api.example.test npm run build
```

GitHub performs the same validation. AWS-dependent deployment steps are intentionally not runnable without the described AWS setup.
