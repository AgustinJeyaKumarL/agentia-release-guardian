import type { Component, Finding, OrderStep, PolicyConfig, Recommendation, RiskLevel } from './types.js'

const TIER: Record<Component['type'], number> = {
  CustomObject: 10,
  CustomField: 20,
  RemoteSiteSetting: 20,
  NamedCredential: 20,
  CustomMetadata: 30,
  ApexClass: 40,
  ApexTrigger: 45,
  Flow: 50,
  LightningComponentBundle: 50,
  FlexiPage: 60,
  PermissionSet: 70,
  Profile: 80,
  DestructiveChanges: 90,
  Other: 100,
}

const LEVEL_RECOMMENDATION: Record<RiskLevel, Recommendation> = {
  LOW: 'SAFE',
  MEDIUM: 'REVIEW',
  HIGH: 'REMEDIATE',
  CRITICAL: 'BLOCK',
}

const EXIT_CODE: Record<Recommendation, number> = {
  SAFE: 0,
  REVIEW: 10,
  REMEDIATE: 20,
  BLOCK: 30,
}

const RANK: Record<Recommendation, number> = {
  SAFE: 0,
  REVIEW: 1,
  REMEDIATE: 2,
  BLOCK: 3,
}

export function scoreFindings(findings: Finding[], policy: PolicyConfig): { riskScore: number; riskLevel: RiskLevel; recommendation: Recommendation } {
  const riskScore = Math.min(100, findings.reduce((sum, finding) => sum + policy.weights[finding.severity], 0))
  let riskLevel: RiskLevel = 'LOW'
  if (riskScore >= policy.thresholds.medium || findings.some((finding) => finding.severity === 'medium')) riskLevel = 'MEDIUM'
  if (riskScore >= policy.thresholds.high || findings.some((finding) => finding.severity === 'high')) riskLevel = 'HIGH'
  if (riskScore >= policy.thresholds.critical || findings.some((finding) => finding.severity === 'critical')) riskLevel = 'CRITICAL'
  return { riskScore, riskLevel, recommendation: LEVEL_RECOMMENDATION[riskLevel] }
}

export function exitCodeFor(recommendation: Recommendation, failOn: Recommendation): number {
  return RANK[recommendation] >= RANK[failOn] ? EXIT_CODE[recommendation] : 0
}

export function deploymentOrder(changes: Component[], findings: Finding[]): OrderStep[] {
  const steps: OrderStep[] = changes
    .filter((component) => component.status !== 'deleted')
    .map((component) => ({
      position: 0,
      type: component.type,
      fullName: component.fullName,
      inChangeSet: true,
      note: 'In this change set.',
    }))
  for (const finding of findings) {
    if (finding.policy !== 'missing-dependency') continue
    const [type, fullName] = finding.id.split(':').slice(1) as [Component['type'], string]
    if (steps.some((step) => step.fullName === fullName && step.type === type)) continue
    steps.push({
      position: 0,
      type,
      fullName,
      inChangeSet: false,
      note: 'Missing from this change set. Add it before its dependents.',
    })
  }
  steps.sort((left, right) => TIER[left.type] - TIER[right.type] || Number(left.inChangeSet) - Number(right.inChangeSet) || left.fullName.localeCompare(right.fullName))
  return steps.map((step, index) => ({ ...step, position: index + 1 }))
}

export function failureChain(findings: Finding[]): string[] {
  return findings
    .filter((finding) => finding.severity === 'critical' || finding.severity === 'high')
    .slice(0, 6)
    .map((finding) => `${finding.component}: ${finding.whyRisk} ${finding.remediation}`)
}

export function rulesNarrative(source: string, target: string, recommendation: Recommendation, chain: string[]): string {
  if (!chain.length) {
    return `No blocking risk was found between ${source} and ${target}. Recommendation: ${recommendation}.`
  }
  return [
    `Promotion from ${source} to ${target} is ${recommendation}.`,
    ...chain.map((line, index) => `${index + 1}. ${line}`),
  ].join('\n')
}
