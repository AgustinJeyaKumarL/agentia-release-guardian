---
name: agentia-release-guardian
description: Assess Salesforce deployment risk before promotion. Use when the user asks for a release check, promotion readiness, deployment risk, or Agentia Release Guardian.
---

# Release Guardian

Run this before promoting Salesforce metadata. The check compares a source branch or metadata directory with the target and returns a risk score, a failure chain, a deployment order, and one recommendation: SAFE, REVIEW, REMEDIATE, or BLOCK.

```shell
agentia release-check --source feature/booking --target UAT
```

Directory snapshots work without a git branch:

```shell
agentia release-check --source-dir ./feature --target-dir ./uat --json
```

Use the `summary.recommendation` and `summary.exitCode` fields in CI. Exit codes are 0 SAFE, 10 REVIEW, 20 REMEDIATE, and 30 BLOCK. The default `--fail-on remediate` returns 0 for SAFE and REVIEW.

Do not treat the narrative as a substitute for the findings. The score and recommendation come from the policies, not from the prose. A missing custom field, object, or Apex class referenced by the change set is a blocking dependency: add that metadata and deploy it before the components that reference it.
