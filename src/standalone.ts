import { parseArgs } from 'node:util'
import { writeFile } from 'node:fs/promises'
import { analyzeRelease } from './analysis/analyze.js'
import { renderReport } from './analysis/render.js'
import type { Recommendation } from './analysis/types.js'

const HELP = `Agentia Release Guardian

Usage
  release-check --source feature/booking --target UAT
  release-check --source-dir <feature-metadata> --target-dir <target-metadata> [--json]

Options
  --source <ref>         Git ref or metadata directory to promote
  --target <ref>         Git ref or metadata directory of the destination
  --repo <path>          Git repository root (default: current directory)
  --source-dir <path>    Metadata directory for the source
  --target-dir <path>    Metadata directory for the target
  --policy <file>        Governance policy JSON
  --target-org <alias>   sf CLI org used to confirm missing metadata
  --fail-on <level>      safe, review, remediate (default), or block
  --explain <mode>       rules (default here) or auto
  --out <file>           Write the JSON report
  --json                 Print the report as JSON
  --help                 Show this help

Exit codes
  0 SAFE    10 REVIEW    20 REMEDIATE    30 BLOCK
  A code is returned when the recommendation is at least as severe as --fail-on.
`

export async function runStandalone(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      source: { type: 'string' },
      target: { type: 'string' },
      repo: { type: 'string', default: process.cwd() },
      'source-dir': { type: 'string' },
      'target-dir': { type: 'string' },
      policy: { type: 'string' },
      'target-org': { type: 'string' },
      'fail-on': { type: 'string', default: 'remediate' },
      explain: { type: 'string', default: 'rules' },
      out: { type: 'string' },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
    strict: true,
  })
  if (values.help) {
    process.stdout.write(HELP)
    return 0
  }
  const failOn = String(values['fail-on']).toUpperCase()
  if (!['SAFE', 'REVIEW', 'REMEDIATE', 'BLOCK'].includes(failOn)) {
    throw new Error('--fail-on must be safe, review, remediate, or block.')
  }
  const report = await analyzeRelease({
    source: values.source,
    target: values.target,
    repo: values.repo || process.cwd(),
    sourceDir: values['source-dir'],
    targetDir: values['target-dir'],
    policyPath: values.policy,
    targetOrg: values['target-org'],
    explain: values.explain === 'ai' ? 'ai' : 'rules',
    failOn: failOn as Recommendation,
  })
  if (values.out) await writeFile(values.out, JSON.stringify(report, null, 2))
  process.stdout.write(values.json ? `${JSON.stringify(report, null, 2)}\n` : `${renderReport(report)}\n`)
  return report.summary.exitCode
}
