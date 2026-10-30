export type Severity = 'info' | 'low' | 'medium' | 'high' | 'critical'

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

export type Recommendation = 'SAFE' | 'REVIEW' | 'REMEDIATE' | 'BLOCK'

export type ChangeStatus = 'added' | 'modified' | 'deleted'

export type ComponentType =
  | 'ApexClass'
  | 'ApexTrigger'
  | 'CustomObject'
  | 'CustomField'
  | 'Flow'
  | 'PermissionSet'
  | 'Profile'
  | 'LightningComponentBundle'
  | 'RemoteSiteSetting'
  | 'NamedCredential'
  | 'FlexiPage'
  | 'DestructiveChanges'
  | 'CustomMetadata'
  | 'Other'

export type PolicyName =
  | 'missing-dependency'
  | 'apex-tests'
  | 'excessive-permission'
  | 'record-permission'
  | 'hardcoded-endpoint'
  | 'hardcoded-id'
  | 'profile-change'
  | 'destructive-change'
  | 'see-all-data'
  | 'configuration-drift'
  | 'naming'

export type PolicyConfig = {
  thresholds: { medium: number; high: number; critical: number }
  weights: Record<Severity, number>
  permissions: { block: string[]; review: string[] }
  policies: Record<PolicyName, { enabled: boolean; severity: Severity }>
}

export type Reference = {
  type: ComponentType
  fullName: string
  evidence: string
}

export type MetadataFile = {
  path: string
  contents: string
}

export type Component = {
  type: ComponentType
  fullName: string
  status: ChangeStatus
  paths: string[]
  contents: string
  references: Reference[]
}

export type Snapshot = {
  mode: 'git' | 'directory'
  source: string
  target: string
  changes: Component[]
  sourceComponents: Map<string, Component>
  targetComponents: Map<string, Component>
}

export type Finding = {
  id: string
  policy: PolicyName
  severity: Severity
  category: 'dependency' | 'readiness' | 'security' | 'governance' | 'configuration' | 'test'
  title: string
  whatChanged: string
  whyRisk: string
  component: string
  impacted: string[]
  deploymentImpact: string
  remediation: string
  evidence: string[]
}

export type OrderStep = {
  position: number
  type: ComponentType
  fullName: string
  inChangeSet: boolean
  note: string
}

export type ReleaseReport = {
  product: 'agentia-release-guardian'
  source: string
  target: string
  mode: 'git' | 'directory'
  generatedAt: string
  summary: {
    componentsChanged: number
    findingCount: number
    riskScore: number
    riskLevel: RiskLevel
    recommendation: Recommendation
    exitCode: number
  }
  deploymentOrder: OrderStep[]
  failureChain: string[]
  findings: Finding[]
  narrative: string
  explanationSource: 'rules' | 'agentia'
  warnings: string[]
}

export type AnalyzeOptions = {
  source?: string
  target?: string
  repo: string
  sourceDir?: string
  targetDir?: string
  policyPath?: string
  targetOrg?: string
  explain: 'auto' | 'rules' | 'ai'
  failOn: Recommendation
}

export function componentKey(type: string, fullName: string): string {
  return `${type}:${fullName}`
}
