import { writeFile } from 'node:fs/promises'
import { AgentiaCommand, getAgentiaHost } from '@copado/agentia-plugin-sdk'
import { Flags } from '@oclif/core'
import { analyzeRelease, explainWithAgentia } from '../analysis/analyze.js'
import { renderReport } from '../analysis/render.js'
import type { Recommendation } from '../analysis/types.js'

export default class ReleaseCheck extends AgentiaCommand {
  static override description = 'Assess Salesforce release risk before promotion and recommend whether to proceed.'
  static override examples = [
    '<%= config.bin %> <%= command.id %> --source feature/booking --target UAT',
    '<%= config.bin %> <%= command.id %> --source-dir ./feature --target-dir ./uat --json',
  ]

  static override flags = {
    source: Flags.string({ description: 'Git ref or metadata directory to promote' }),
    target: Flags.string({ description: 'Git ref or metadata directory of the destination' }),
    repo: Flags.string({ description: 'Git repository root', default: process.cwd() }),
    'source-dir': Flags.string({ description: 'Metadata directory for the source change set' }),
    'target-dir': Flags.string({ description: 'Metadata directory already present in the target' }),
    policy: Flags.string({ description: 'Governance policy JSON file' }),
    'target-org': Flags.string({ description: 'sf CLI org alias used to confirm missing metadata' }),
    'fail-on': Flags.string({
      description: 'Exit non-zero when the recommendation is this severe or worse',
      default: 'remediate',
      options: ['safe', 'review', 'remediate', 'block'],
    }),
    explain: Flags.string({
      description: 'Use the deterministic explanation, the Agentia release agent, or whichever is available',
      default: 'auto',
      options: ['auto', 'rules', 'ai'],
    }),
    out: Flags.string({ description: 'Also write the JSON report to this file' }),
  }

  public async run(): Promise<unknown> {
    const { flags } = await this.parse(ReleaseCheck)
    let source = flags.source
    let target = flags.target
    try {
      const workspace = await getAgentiaHost({ requires: ['workspace.current'] }).workspace.current()
      source ||= workspace.branch
      target ||= workspace.baseBranch
    } catch {
      // Explicit flags still work when the workspace context is unavailable.
    }

    let report = await this.withSpinner('Analyzing release risk', () => analyzeRelease({
      source,
      target,
      repo: flags.repo,
      sourceDir: flags['source-dir'],
      targetDir: flags['target-dir'],
      policyPath: flags.policy,
      targetOrg: flags['target-org'],
      explain: (flags.explain || 'auto') as 'auto' | 'rules' | 'ai',
      failOn: (flags['fail-on'] || 'remediate').toUpperCase() as Recommendation,
    }))

    if (flags.explain !== 'rules') {
      try {
        const host = getAgentiaHost()
        report = await explainWithAgentia(report, async (prompt) => (await host.ai.ask({ prompt, agent: 'release' })).content)
      } catch (error) {
        if (flags.explain === 'ai') {
          report = { ...report, warnings: [...report.warnings, (error as Error).message] }
        }
      }
    }

    if (flags.out) await writeFile(flags.out, JSON.stringify(report, null, 2))
    this.display(() => {
      this.log(renderReport(report))
      try {
        const host = getAgentiaHost({ requires: ['format.table'] })
        if (report.findings.length) {
          this.log(host.format.table(
            [
              { field: 'severity', header: 'Severity' },
              { field: 'component', header: 'Component' },
              { field: 'title', header: 'Finding', wrap: true },
            ],
            report.findings,
          ))
        }
      } catch {
        // The text report above already stands alone.
      }
    })
    process.exitCode = report.summary.exitCode
    return report
  }
}
