import type { ReleaseReport } from './types.js'

export function renderReport(report: ReleaseReport): string {
  const lines = [
    'Agentia Release Guardian',
    `${report.source} -> ${report.target} (${report.mode})`,
    `Risk ${report.summary.riskScore}/100  ${report.summary.riskLevel}  ${report.summary.recommendation}`,
    '',
    report.narrative,
    '',
    'Findings',
  ]
  if (!report.findings.length) lines.push('None.')
  for (const finding of report.findings) {
    lines.push(`[${finding.severity.toUpperCase()}] ${finding.title}`)
    lines.push(`  Changed: ${finding.whatChanged}`)
    lines.push(`  Impact: ${finding.deploymentImpact}`)
    lines.push(`  Fix: ${finding.remediation}`)
  }
  lines.push('', 'Suggested deployment order')
  if (!report.deploymentOrder.length) lines.push('No metadata to deploy.')
  for (const step of report.deploymentOrder) {
    const marker = step.inChangeSet ? '' : ' (add first)'
    lines.push(`${step.position}. ${step.type} ${step.fullName}${marker}`)
  }
  if (report.warnings.length) {
    lines.push('', 'Warnings')
    for (const warning of report.warnings) lines.push(`- ${warning}`)
  }
  return lines.join('\n')
}
