import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { PolicyConfig, PolicyName, Severity } from './types.js'

const NAMES: PolicyName[] = [
  'missing-dependency',
  'apex-tests',
  'excessive-permission',
  'record-permission',
  'hardcoded-endpoint',
  'hardcoded-id',
  'profile-change',
  'destructive-change',
  'see-all-data',
  'configuration-drift',
  'naming',
]

export function defaultPolicyPath(): string {
  return fileURLToPath(new URL('../../policies/default.json', import.meta.url))
}

export async function loadPolicy(policyPath?: string): Promise<PolicyConfig> {
  const path = policyPath || defaultPolicyPath()
  const parsed = JSON.parse(await readFile(path, 'utf8')) as PolicyConfig
  for (const name of NAMES) {
    if (!parsed.policies?.[name]) {
      throw new Error(`Policy file ${path} is missing "${name}".`)
    }
  }
  return parsed
}

export function policySeverity(policy: PolicyConfig, name: PolicyName, fallback: Severity): Severity | undefined {
  const setting = policy.policies[name]
  if (!setting.enabled) return undefined
  return setting.severity || fallback
}
