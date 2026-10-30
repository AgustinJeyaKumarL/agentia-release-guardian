import { collectFindings } from './findings.js'
import { loadPolicy } from './policy.js'
import { deploymentOrder, exitCodeFor, failureChain, rulesNarrative, scoreFindings } from './score.js'
import { commandOutput, resolveSnapshot } from './snapshot.js'
import type { AnalyzeOptions, Finding, ReleaseReport } from './types.js'

export async function analyzeRelease(options: AnalyzeOptions): Promise<ReleaseReport> {
  const policy = await loadPolicy(options.policyPath)
  const snapshot = await resolveSnapshot(options)
  const findings = collectFindings(snapshot, policy)
  const warnings: string[] = []
  if (options.targetOrg) {
    const confirmed = await confirmWithOrg(options.targetOrg, findings, warnings)
    findings.splice(0, findings.length, ...confirmed)
  }
  const summaryScore = scoreFindings(findings, policy)
  const chain = failureChain(findings)
  const exitCode = exitCodeFor(summaryScore.recommendation, options.failOn)
  return {
    product: 'agentia-release-guardian',
    source: snapshot.source,
    target: snapshot.target,
    mode: snapshot.mode,
    generatedAt: new Date().toISOString(),
    summary: {
      componentsChanged: snapshot.changes.length,
      findingCount: findings.length,
      riskScore: summaryScore.riskScore,
      riskLevel: summaryScore.riskLevel,
      recommendation: summaryScore.recommendation,
      exitCode,
    },
    deploymentOrder: deploymentOrder(snapshot.changes, findings),
    failureChain: chain,
    findings,
    narrative: rulesNarrative(snapshot.source, snapshot.target, summaryScore.recommendation, chain),
    explanationSource: 'rules',
    warnings,
  }
}

async function confirmWithOrg(org: string, findings: Finding[], warnings: string[]): Promise<Finding[]> {
  const missing = findings.filter((finding) => finding.policy === 'missing-dependency')
  if (!missing.length) return findings
  try {
    const present = new Set<string>()
    const types = [...new Set(missing.map((finding) => finding.id.split(':')[1]))]
    for (const type of types) {
      const stdout = await commandOutput('sf', ['org', 'list', 'metadata', '--metadata-type', type, '--target-org', org, '--json'])
      const parsed = JSON.parse(stdout) as { result?: Array<{ fullName?: string }> }
      for (const record of parsed.result || []) {
        if (record.fullName) present.add(`${type}:${record.fullName}`)
      }
    }
    return findings.filter((finding) => {
      if (finding.policy !== 'missing-dependency') return true
      const key = finding.id.slice('missing-dependency:'.length)
      if (!present.has(key)) {
        finding.evidence = [...finding.evidence, `Confirmed absent in org ${org}.`]
        return true
      }
      return false
    })
  } catch (error) {
    warnings.push(`Could not query target org ${org}. ${(error as Error).message}`)
    return findings
  }
}

export async function explainWithAgentia(report: ReleaseReport, ask: (prompt: string) => Promise<string>): Promise<ReleaseReport> {
  const prompt = [
    'Explain this Salesforce release risk to a developer. Do not change the recommendation.',
    `Recommendation: ${report.summary.recommendation}. Score: ${report.summary.riskScore}.`,
    ...report.findings.slice(0, 8).map((finding) => `${finding.severity}: ${finding.title}. ${finding.remediation}`),
  ].join('\n')
  try {
    const content = (await ask(prompt)).trim()
    if (!content) return report
    return { ...report, narrative: content, explanationSource: 'agentia' }
  } catch (error) {
    return { ...report, warnings: [...report.warnings, `Agentia explanation was not available. ${(error as Error).message}`] }
  }
}
