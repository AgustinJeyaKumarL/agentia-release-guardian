# Agentia Release Guardian

Release Guardian is an Agentia CLI plugin that reads a Salesforce change set before promotion and returns a risk score, the likely failure chain, a deployment order, and a recommendation.

| Recommendation | Risk | Meaning | Exit code |
| --- | --- | --- | --- |
| SAFE | LOW | Safe to proceed | 0 |
| REVIEW | MEDIUM | Review recommended | 10 |
| REMEDIATE | HIGH | Remediation required | 20 |
| BLOCK | CRITICAL | Block promotion | 30 |

The process exits with that code when the recommendation is at least as severe as `--fail-on`. The default is `remediate`, so SAFE and REVIEW pass and REMEDIATE and BLOCK fail the pipeline.

## Check a promotion

From a Salesforce project, with the plugin linked into Agentia:

```shell
agentia plugins link .
agentia release-check --source feature/booking --target UAT
agentia release-check --source feature/booking --target UAT --json --out release-report.json
```

`--source` and `--target` are git refs. When the current Agentia workspace has a branch and a base branch, those fill in any flag you omit.

Metadata directories work without git:

```shell
node bin/release-check.js --source-dir examples/booking/feature --target-dir examples/booking/uat
```

`--target-org my-uat` also asks the Salesforce CLI whether a missing component already exists in that org. The check still completes if `sf` is not authenticated.

## What it checks

- Metadata added, modified, or deleted between source and target
- Custom objects, fields, and Apex classes referenced by Apex, Flow, LWC, and permission sets but missing from both the change set and the target
- Apex or triggers with no test class that mentions them, and tests that use `SeeAllData=true`
- Permission sets and profiles that grant `ModifyAllData`, `ViewAllData`, `AuthorApex`, or `ManageUsers`
- Hardcoded endpoints and Salesforce ids
- Profile edits, destructive changes, and edits to remote sites, named credentials, and custom metadata
- Naming rules for Apex and custom objects or fields

Policies live in `policies/default.json`. Point `--policy` at another file to disable a check or change its severity. The recommendation is calculated from those findings. An Agentia release-agent explanation, when the command runs inside `agentia`, is added as narrative and does not change the score.

## Pipeline

```shell
node bin/release-check.js --source "$SOURCE_REF" --target "$TARGET_REF" --repo . --json --out release-report.json
```

Archive `release-report.json`. Fail the job on exit code 20 or 30.
