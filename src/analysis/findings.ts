import { hardcodedEndpoints, hardcodedIds, isStandardField, isStandardObject, isTestClass, permissionNames } from './parse.js'
import { policySeverity } from './policy.js'
import { componentKey, type Component, type Finding, type PolicyConfig, type Snapshot } from './types.js'

const DRIFT_TYPES = new Set(['RemoteSiteSetting', 'NamedCredential', 'CustomMetadata'])

export function collectFindings(snapshot: Snapshot, policy: PolicyConfig): Finding[] {
  const findings: Finding[] = []
  const known = knownKeys(snapshot)
  findings.push(...missingDependencies(snapshot, policy, known))
  findings.push(...testFindings(snapshot, policy))
  findings.push(...permissionFindings(snapshot, policy))
  findings.push(...endpointFindings(snapshot, policy))
  findings.push(...idFindings(snapshot, policy))
  findings.push(...profileFindings(snapshot, policy))
  findings.push(...destructiveFindings(snapshot, policy))
  findings.push(...seeAllDataFindings(snapshot, policy))
  findings.push(...driftFindings(snapshot, policy))
  findings.push(...namingFindings(snapshot, policy))
  return findings.sort(bySeverity)
}

function knownKeys(snapshot: Snapshot): Set<string> {
  const keys = new Set<string>()
  for (const component of snapshot.targetComponents.values()) keys.add(componentKey(component.type, component.fullName))
  for (const component of snapshot.changes) {
    if (component.status !== 'deleted') keys.add(componentKey(component.type, component.fullName))
  }
  return keys
}

function missingDependencies(snapshot: Snapshot, policy: PolicyConfig, known: Set<string>): Finding[] {
  const severity = policySeverity(policy, 'missing-dependency', 'critical')
  if (!severity) return []
  const grouped = new Map<string, { type: Finding['impacted'][number] extends string ? Component['type'] : never; fullName: string; impacted: string[] }>()
  for (const component of snapshot.changes) {
    if (component.status === 'deleted') continue
    for (const reference of component.references) {
      if (reference.type !== 'CustomField' && reference.type !== 'CustomObject' && reference.type !== 'ApexClass') continue
      if (reference.type === 'CustomObject' && isStandardObject(reference.fullName)) continue
      if (reference.type === 'CustomField') {
        const field = reference.fullName.split('.')[1]
        if (isStandardField(field)) continue
      }
      const key = componentKey(reference.type, reference.fullName)
      if (known.has(key)) continue
      const current = grouped.get(key) || { type: reference.type, fullName: reference.fullName, impacted: [] }
      if (!current.impacted.includes(component.fullName)) current.impacted.push(component.fullName)
      grouped.set(key, current)
    }
  }
  return [...grouped].map(([, missing]) => ({
    id: `missing-dependency:${missing.type}:${missing.fullName}`,
    policy: 'missing-dependency' as const,
    severity,
    category: 'dependency' as const,
    title: `${missing.type} ${missing.fullName} is not in the change set or the target`,
    whatChanged: `${missing.impacted.join(', ')} now ${missing.impacted.length === 1 ? 'depends' : 'depend'} on ${missing.fullName}.`,
    whyRisk: `${missing.fullName} is referenced by the promotion, but that metadata is neither in this change set nor already present in the target. The deployment is likely to fail when Salesforce compiles the dependent component.`,
    component: missing.fullName,
    impacted: missing.impacted,
    deploymentImpact: 'Validation or deploy fails on the missing reference before later components can succeed.',
    remediation: `Add ${missing.type} ${missing.fullName} to the promotion and deploy it before ${missing.impacted.join(', ')}.`,
    evidence: missing.impacted,
  }))
}

function testFindings(snapshot: Snapshot, policy: PolicyConfig): Finding[] {
  const severity = policySeverity(policy, 'apex-tests', 'high')
  if (!severity) return []
  const tests = [...snapshot.sourceComponents.values()].filter((component) => component.type === 'ApexClass' && isTestClass(component.fullName, component.contents))
  return snapshot.changes.flatMap((component) => {
    if (component.status === 'deleted') return []
    if (component.type !== 'ApexClass' && component.type !== 'ApexTrigger') return []
    if (isTestClass(component.fullName, component.contents)) return []
    const covered = tests.some((test) => new RegExp(`\\b${component.fullName}\\b`).test(test.contents))
    if (covered) return []
    return [{
      id: `apex-tests:${component.fullName}`,
      policy: 'apex-tests' as const,
      severity,
      category: 'test' as const,
      title: `${component.fullName} has no matching Apex test`,
      whatChanged: `${component.type} ${component.fullName} is ${component.status}.`,
      whyRisk: 'The source tree has no test class that mentions this component. Coverage can fail in the target org, and the behavior change is unverified.',
      component: component.fullName,
      impacted: [component.fullName],
      deploymentImpact: 'Deployment can stop with insufficient coverage, or the change can promote without a regression check.',
      remediation: `Add or update an Apex test that exercises ${component.fullName}, then run it against the target org before promotion.`,
      evidence: component.paths,
    }]
  })
}

function permissionFindings(snapshot: Snapshot, policy: PolicyConfig): Finding[] {
  const blockSeverity = policySeverity(policy, 'excessive-permission', 'high')
  const reviewSeverity = policySeverity(policy, 'record-permission', 'medium')
  const findings: Finding[] = []
  for (const component of snapshot.changes) {
    if (component.status === 'deleted') continue
    if (component.type !== 'PermissionSet' && component.type !== 'Profile') continue
    const permissions = permissionNames(component.contents)
    if (blockSeverity) {
      const hit = permissions.user.filter((name) => policy.permissions.block.includes(name))
      if (hit.length) {
        findings.push(permissionFinding(component, hit, 'excessive-permission', blockSeverity, 'security', 'grants org-wide permissions'))
      }
    }
    if (reviewSeverity) {
      const hit = permissions.records.filter((name) => policy.permissions.review.some((item) => name.endsWith(item)))
      if (hit.length) {
        findings.push(permissionFinding(component, hit, 'record-permission', reviewSeverity, 'security', 'grants broad record access'))
      }
    }
  }
  return findings
}

function permissionFinding(
  component: Component,
  hit: string[],
  policyName: 'excessive-permission' | 'record-permission',
  severity: Finding['severity'],
  category: Finding['category'],
  action: string,
): Finding {
  return {
    id: `${policyName}:${component.fullName}:${hit.join(',')}`,
    policy: policyName,
    severity,
    category,
    title: `${component.fullName} ${action}`,
    whatChanged: `${component.type} ${component.fullName} enables ${hit.join(', ')}.`,
    whyRisk: 'Broad permissions travel with the metadata and apply to every user who receives them in the next environment.',
    component: component.fullName,
    impacted: [component.fullName],
    deploymentImpact: 'The permission change deploys with the component and is easy to miss in a metadata diff.',
    remediation: `Remove ${hit.join(', ')} unless this promotion is explicitly approved to widen access.`,
    evidence: component.paths,
  }
}

function endpointFindings(snapshot: Snapshot, policy: PolicyConfig): Finding[] {
  const severity = policySeverity(policy, 'hardcoded-endpoint', 'high')
  if (!severity) return []
  return snapshot.changes.flatMap((component) => {
    if (component.status === 'deleted') return []
    const endpoints = hardcodedEndpoints(component.contents).filter((value) => !value.includes('soap.sforce.com'))
    if (!endpoints.length) return []
    const insecure = endpoints.some((value) => value.startsWith('http://'))
    return [{
      id: `hardcoded-endpoint:${component.fullName}`,
      policy: 'hardcoded-endpoint' as const,
      severity: insecure ? severity : 'medium',
      category: 'configuration' as const,
      title: `${component.fullName} contains a hardcoded endpoint`,
      whatChanged: `${component.fullName} includes ${endpoints.join(', ')}.`,
      whyRisk: insecure
        ? 'An http:// endpoint is environment-specific, unencrypted, and will not follow the target org’s named credential or remote site setup.'
        : 'A hardcoded URL bypasses the target org’s named credential and will keep calling the embedded environment.',
      component: component.fullName,
      impacted: [component.fullName],
      deploymentImpact: 'The component can deploy and then call the wrong system, or fail the remote site check.',
      remediation: 'Move the URL to a named credential or custom metadata that differs by environment, and register the remote site.',
      evidence: endpoints,
    }]
  })
}

function idFindings(snapshot: Snapshot, policy: PolicyConfig): Finding[] {
  const severity = policySeverity(policy, 'hardcoded-id', 'medium')
  if (!severity) return []
  return snapshot.changes.flatMap((component) => {
    if (component.type !== 'ApexClass' && component.type !== 'ApexTrigger') return []
    const ids = hardcodedIds(component.contents)
    if (!ids.length) return []
    return [{
      id: `hardcoded-id:${component.fullName}`,
      policy: 'hardcoded-id' as const,
      severity,
      category: 'configuration' as const,
      title: `${component.fullName} contains a hardcoded Salesforce id`,
      whatChanged: `${component.fullName} references ${ids.join(', ')}.`,
      whyRisk: 'Record ids differ between sandboxes and production, so this reference points at the wrong record or at nothing after promotion.',
      component: component.fullName,
      impacted: [component.fullName],
      deploymentImpact: 'The deploy succeeds and the code fails later, or it updates an unintended record.',
      remediation: 'Resolve the record by a stable external id or custom metadata instead of a literal id.',
      evidence: ids,
    }]
  })
}

function profileFindings(snapshot: Snapshot, policy: PolicyConfig): Finding[] {
  const severity = policySeverity(policy, 'profile-change', 'high')
  if (!severity) return []
  return snapshot.changes.filter((component) => component.type === 'Profile').map((component) => ({
    id: `profile-change:${component.fullName}`,
    policy: 'profile-change' as const,
    severity,
    category: 'governance' as const,
    title: `Profile ${component.fullName} is included in the promotion`,
    whatChanged: `Profile ${component.fullName} is ${component.status}.`,
    whyRisk: 'Profiles overwrite a wide permission surface in the target org, including access that was not part of the intended story.',
    component: component.fullName,
    impacted: [component.fullName],
    deploymentImpact: 'Users in the target org can gain or lose access outside the reviewed change.',
    remediation: 'Prefer a permission set for the story, and remove the profile from the promotion unless a release manager approved it.',
    evidence: component.paths,
  }))
}

function destructiveFindings(snapshot: Snapshot, policy: PolicyConfig): Finding[] {
  const severity = policySeverity(policy, 'destructive-change', 'critical')
  if (!severity) return []
  return snapshot.changes.filter((component) => component.type === 'DestructiveChanges' || component.status === 'deleted').map((component) => ({
    id: `destructive-change:${component.type}:${component.fullName}`,
    policy: 'destructive-change' as const,
    severity,
    category: 'governance' as const,
    title: `${component.fullName} is a destructive change`,
    whatChanged: `${component.type} ${component.fullName} is ${component.status}.`,
    whyRisk: 'Removing metadata can delete configuration or block components that still exist in the target.',
    component: component.fullName,
    impacted: [component.fullName],
    deploymentImpact: 'A later component, or an existing org customization, can fail because this dependency disappeared.',
    remediation: 'Confirm every remaining reference, then sequence the deletion after the dependents have been updated.',
    evidence: component.paths,
  }))
}

function seeAllDataFindings(snapshot: Snapshot, policy: PolicyConfig): Finding[] {
  const severity = policySeverity(policy, 'see-all-data', 'high')
  if (!severity) return []
  return snapshot.changes.filter((component) => /seealldata\s*=\s*true/i.test(component.contents)).map((component) => ({
    id: `see-all-data:${component.fullName}`,
    policy: 'see-all-data' as const,
    severity,
    category: 'test' as const,
    title: `${component.fullName} uses SeeAllData`,
    whatChanged: `${component.fullName} sets SeeAllData=true.`,
    whyRisk: 'The test depends on records that exist in one org and not another, so the same deployment can pass in source and fail in the target.',
    component: component.fullName,
    impacted: [component.fullName],
    deploymentImpact: 'Target validation fails for a reason that is not visible in the metadata diff.',
    remediation: 'Create the test data inside the test and remove SeeAllData.',
    evidence: component.paths,
  }))
}

function driftFindings(snapshot: Snapshot, policy: PolicyConfig): Finding[] {
  const severity = policySeverity(policy, 'configuration-drift', 'medium')
  if (!severity) return []
  return snapshot.changes.flatMap((component) => {
    if (component.status !== 'modified' || !DRIFT_TYPES.has(component.type)) return []
    const previous = snapshot.targetComponents.get(componentKey(component.type, component.fullName))
    if (!previous || previous.contents === component.contents) return []
    return [{
      id: `configuration-drift:${component.fullName}`,
      policy: 'configuration-drift' as const,
      severity,
      category: 'configuration' as const,
      title: `${component.fullName} changes environment configuration`,
      whatChanged: `${component.type} ${component.fullName} differs from the target.`,
      whyRisk: 'This metadata usually stores an endpoint, credential, or value that is correct in one environment and wrong in the next.',
      component: component.fullName,
      impacted: [component.fullName],
      deploymentImpact: 'Promotion overwrites the target value with the source value.',
      remediation: 'Keep environment-specific values out of the promotion, or confirm the source value is the one the target should use.',
      evidence: component.paths,
    }]
  })
}

function namingFindings(snapshot: Snapshot, policy: PolicyConfig): Finding[] {
  const severity = policySeverity(policy, 'naming', 'low')
  if (!severity) return []
  return snapshot.changes.flatMap((component) => {
    if (component.status === 'deleted') return []
    const valid = component.type === 'ApexClass' || component.type === 'ApexTrigger'
      ? /^[A-Z][A-Za-z0-9_]*$/.test(component.fullName)
      : component.type !== 'CustomObject' && component.type !== 'CustomField' || /^(?:[A-Za-z][A-Za-z0-9_]*\.)?[A-Z][A-Za-z0-9_]*__c$/.test(component.fullName)
    if (valid) return []
    return [{
      id: `naming:${component.fullName}`,
      policy: 'naming' as const,
      severity,
      category: 'governance' as const,
      title: `${component.fullName} does not follow the naming rule`,
      whatChanged: `${component.type} ${component.fullName} is ${component.status}.`,
      whyRisk: 'Names that fall outside the team rule are harder to review and easier to deploy into the wrong layer of the org.',
      component: component.fullName,
      impacted: [component.fullName],
      deploymentImpact: 'The component can still deploy, and the violation becomes permanent API surface.',
      remediation: 'Rename it to the team convention before promotion, or record an approved exception in the policy file.',
      evidence: component.paths,
    }]
  })
}

const SEVERITY_RANK: Record<Finding['severity'], number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 }

function bySeverity(left: Finding, right: Finding): number {
  return SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity] || left.id.localeCompare(right.id)
}
