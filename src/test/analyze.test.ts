import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import { analyzeRelease } from '../analysis/analyze.js'
import { exitCodeFor } from '../analysis/score.js'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

describe('release decision', () => {
  it('keeps review below the default CI gate and blocks a critical release', () => {
    assert.equal(exitCodeFor('REVIEW', 'REMEDIATE'), 0)
    assert.equal(exitCodeFor('SAFE', 'REMEDIATE'), 0)
    assert.equal(exitCodeFor('REMEDIATE', 'REMEDIATE'), 20)
    assert.equal(exitCodeFor('BLOCK', 'REMEDIATE'), 30)
    assert.equal(exitCodeFor('REMEDIATE', 'BLOCK'), 0)
  })

  it('blocks the booking promotion because the field is missing', async () => {
    const report = await analyzeRelease({
      repo: root,
      sourceDir: path.join(root, 'examples', 'booking', 'feature'),
      targetDir: path.join(root, 'examples', 'booking', 'uat'),
      explain: 'rules',
      failOn: 'REMEDIATE',
    })
    assert.equal(report.summary.recommendation, 'BLOCK')
    assert.equal(report.summary.riskLevel, 'CRITICAL')
    assert.equal(report.summary.exitCode, 30)
    const missing = report.findings.find((finding) => finding.id === 'missing-dependency:CustomField:Booking__c.GuestEmail__c')
    assert.ok(missing)
    assert.equal(missing.severity, 'critical')
    assert.ok(missing.impacted.includes('BookingService'))
    assert.ok(missing.impacted.includes('Book_Room'))
    assert.match(missing.remediation, /before/)
    assert.equal(report.deploymentOrder[0]?.fullName, 'Booking__c.GuestEmail__c')
    assert.equal(report.deploymentOrder[0]?.inChangeSet, false)
    assert.ok(report.findings.some((finding) => finding.policy === 'apex-tests'))
    assert.ok(report.findings.some((finding) => finding.policy === 'excessive-permission'))
    assert.ok(report.findings.some((finding) => finding.policy === 'hardcoded-endpoint'))
    assert.match(report.narrative, /BLOCK/)
  })

  it('accepts a change set that already contains its field and test', async () => {
    const report = await analyzeRelease({
      repo: root,
      sourceDir: path.join(root, 'examples', 'clean', 'source'),
      targetDir: path.join(root, 'examples', 'clean', 'target'),
      explain: 'rules',
      failOn: 'REMEDIATE',
    })
    assert.equal(report.summary.recommendation, 'SAFE')
    assert.equal(report.summary.exitCode, 0)
    assert.equal(report.findings.some((finding) => finding.severity === 'critical' || finding.severity === 'high'), false)
    const field = report.deploymentOrder.find((step) => step.fullName === 'Booking__c.Note__c')
    const apex = report.deploymentOrder.find((step) => step.fullName === 'NoteService')
    assert.ok(field && apex && field.position < apex.position)
  })

  it('reads the same risk from git refs', async () => {
    let git = true
    try {
      execFileSync('git', ['--version'], { stdio: 'ignore' })
    } catch {
      git = false
    }
    if (!git) return

    const repo = mkdtempSync(path.join(tmpdir(), 'release-guardian-'))
    try {
      const run = (args: string[]) => execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe' })
      run(['init'])
      run(['checkout', '-b', 'UAT'])
      run(['config', 'user.email', 'dev@example.com'])
      run(['config', 'user.name', 'Release Guardian'])
      const base = path.join(repo, 'force-app', 'main', 'default')
      mkdirSync(path.join(base, 'classes'), { recursive: true })
      writeFileSync(path.join(base, 'classes', 'BookingService.cls'), 'public class BookingService { public static void confirm() {} }\n')
      run(['add', '.'])
      run(['commit', '-m', 'uat'])
      run(['checkout', '-b', 'feature/booking'])
      writeFileSync(
        path.join(base, 'classes', 'BookingService.cls'),
        'public class BookingService { public static void confirm() { Booking__c row = [SELECT GuestEmail__c FROM Booking__c]; } }\n',
      )
      run(['add', '.'])
      run(['commit', '-m', 'feature'])
      const report = await analyzeRelease({
        repo,
        source: 'feature/booking',
        target: 'UAT',
        explain: 'rules',
        failOn: 'REMEDIATE',
      })
      assert.equal(report.mode, 'git')
      assert.equal(report.summary.recommendation, 'BLOCK')
      assert.ok(report.findings.some((finding) => finding.id === 'missing-dependency:CustomField:Booking__c.GuestEmail__c'))
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  it('returns exit code 30 from the standalone CLI', () => {
    const result = spawnSync(process.execPath, [
      path.join(root, 'bin', 'release-check.js'),
      '--source-dir', path.join(root, 'examples', 'booking', 'feature'),
      '--target-dir', path.join(root, 'examples', 'booking', 'uat'),
      '--json',
    ], { encoding: 'utf8' })
    assert.equal(result.status, 30, result.stderr)
    const report = JSON.parse(result.stdout)
    assert.equal(report.summary.recommendation, 'BLOCK')
  })
})
