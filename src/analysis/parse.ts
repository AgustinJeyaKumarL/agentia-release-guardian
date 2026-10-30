import type { ComponentType, Reference } from './types.js'

const STANDARD_FIELDS = new Set([
  'Id', 'Name', 'OwnerId', 'CreatedById', 'CreatedDate', 'LastModifiedById', 'LastModifiedDate',
  'SystemModstamp', 'IsDeleted', 'RecordTypeId',
])

const STANDARD_OBJECTS = new Set([
  'Account', 'Contact', 'Lead', 'Opportunity', 'Case', 'User', 'Task', 'Event', 'Campaign',
  'Product2', 'Order', 'Contract', 'Asset', 'Quote',
])

const APEX_TYPES = new Set([
  'String', 'Integer', 'Long', 'Decimal', 'Double', 'Boolean', 'List', 'Map', 'Set', 'Date',
  'Datetime', 'Time', 'Id', 'Blob', 'Object', 'System', 'Test', 'Assert', 'Math', 'JSON',
  'Http', 'HttpRequest', 'HttpResponse', 'Database', 'Schema', 'UserInfo', 'Limits', 'Pattern',
  'Matcher', 'Exception', 'Type', 'Request', 'Select', 'From',
])

export function isStandardObject(name: string): boolean {
  return STANDARD_OBJECTS.has(name)
}

export function isStandardField(name: string): boolean {
  return STANDARD_FIELDS.has(name) || !name.endsWith('__c')
}

type ParsedComponent = {
  type: ComponentType
  fullName: string
}

export function identify(path: string): ParsedComponent | undefined {
  const normalized = path.replaceAll('\\', '/')
  const rules: Array<[RegExp, ComponentType]> = [
    [/(?:^|\/)classes\/([^/]+)\.cls$/, 'ApexClass'],
    [/(?:^|\/)triggers\/([^/]+)\.trigger$/, 'ApexTrigger'],
    [/(?:^|\/)objects\/([^/]+)\/fields\/([^/]+)\.field-meta\.xml$/, 'CustomField'],
    [/(?:^|\/)objects\/([^/]+)\/[^/]+\.object-meta\.xml$/, 'CustomObject'],
    [/(?:^|\/)flows\/([^/]+)\.flow-meta\.xml$/, 'Flow'],
    [/(?:^|\/)permissionsets\/([^/]+)\.permissionset-meta\.xml$/, 'PermissionSet'],
    [/(?:^|\/)profiles\/([^/]+)\.profile-meta\.xml$/, 'Profile'],
    [/(?:^|\/)lwc\/([^/]+)\/[^/]+\.(?:js|html|css|js-meta\.xml)$/, 'LightningComponentBundle'],
    [/(?:^|\/)remoteSiteSettings\/([^/]+)\.remoteSite-meta\.xml$/, 'RemoteSiteSetting'],
    [/(?:^|\/)namedCredentials\/([^/]+)\.namedCredential-meta\.xml$/, 'NamedCredential'],
    [/(?:^|\/)flexipages\/([^/]+)\.flexipage-meta\.xml$/, 'FlexiPage'],
    [/(?:^|\/)customMetadata\/([^/]+)\.md-meta\.xml$/, 'CustomMetadata'],
    [/(?:^|\/)destructiveChanges(?:Pre|Post)?\.xml$/, 'DestructiveChanges'],
  ]
  for (const [expression, type] of rules) {
    const match = normalized.match(expression)
    if (!match) continue
    if (type === 'CustomField') return { type, fullName: `${match[1]}.${match[2]}` }
    if (type === 'DestructiveChanges') return { type, fullName: normalized.split('/').pop() || 'destructiveChanges.xml' }
    return { type, fullName: match[1] }
  }
  return undefined
}

export function referencesIn(path: string, contents: string): Reference[] {
  const identified = identify(path)
  if (!identified) return []
  if (identified.type === 'ApexClass' || identified.type === 'ApexTrigger') return apexReferences(path, contents)
  if (identified.type === 'Flow') return flowReferences(path, contents)
  if (identified.type === 'PermissionSet' || identified.type === 'Profile') return permissionReferences(path, contents)
  if (identified.type === 'LightningComponentBundle' && path.endsWith('.js')) return lwcReferences(path, contents)
  return []
}

function apexReferences(path: string, contents: string): Reference[] {
  const found = new Map<string, Reference>()
  const add = (reference: Reference) => found.set(`${reference.type}:${reference.fullName}`, reference)
  const withoutComments = contents
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')

  for (const match of withoutComments.matchAll(/\b([A-Za-z][A-Za-z0-9_]*)\.([A-Za-z][A-Za-z0-9_]*__c)\b/g)) {
    if (!/^[A-Z]/.test(match[1])) continue
    add({ type: 'CustomField', fullName: `${match[1]}.${match[2]}`, evidence: path })
    if (match[1].endsWith('__c')) add({ type: 'CustomObject', fullName: match[1], evidence: path })
  }

  for (const match of withoutComments.matchAll(/Schema\.SObjectType\.([A-Za-z0-9_]+)\.fields\.([A-Za-z0-9_]+)/g)) {
    add({ type: 'CustomField', fullName: `${match[1]}.${match[2]}`, evidence: path })
    if (match[1].endsWith('__c')) add({ type: 'CustomObject', fullName: match[1], evidence: path })
  }

  for (const match of withoutComments.matchAll(/select\s+([\s\S]+?)\s+from\s+([A-Za-z0-9_]+)/gi)) {
    const objectName = match[2]
    if (objectName.endsWith('__c')) add({ type: 'CustomObject', fullName: objectName, evidence: path })
    for (const rawField of match[1].split(',')) {
      const field = rawField.trim().split(/\s+/).pop()?.split('.').pop() || ''
      if (field.endsWith('__c')) add({ type: 'CustomField', fullName: `${objectName}.${field}`, evidence: path })
    }
  }

  for (const match of withoutComments.matchAll(/\bnew\s+([A-Z][A-Za-z0-9_]*)\s*\(/g)) {
    if (!APEX_TYPES.has(match[1])) add({ type: 'ApexClass', fullName: match[1], evidence: path })
  }

  for (const match of withoutComments.matchAll(/https?:\/\/[^'")\s]+/g)) {
    add({ type: 'Other', fullName: match[0], evidence: path })
  }
  for (const match of withoutComments.matchAll(/'([a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?)'/g)) {
    if (/\d/.test(match[1])) add({ type: 'Other', fullName: `id:${match[1]}`, evidence: path })
  }
  return [...found.values()]
}

function flowReferences(path: string, contents: string): Reference[] {
  const objects = [...contents.matchAll(/<object>([^<]+)<\/object>/g)].map((match) => match[1])
  const found = new Map<string, Reference>()
  const add = (reference: Reference) => found.set(`${reference.type}:${reference.fullName}`, reference)
  for (const objectName of objects) {
    if (objectName.endsWith('__c')) add({ type: 'CustomObject', fullName: objectName, evidence: path })
  }
  for (const match of contents.matchAll(/<field>([^<]+)<\/field>/g)) {
    const field = match[1]
    if (field.includes('.')) {
      const [objectName, fieldName] = field.split('.')
      if (fieldName.endsWith('__c')) add({ type: 'CustomField', fullName: field, evidence: path })
      if (objectName.endsWith('__c')) add({ type: 'CustomObject', fullName: objectName, evidence: path })
    } else if (field.endsWith('__c') && objects.length === 1) {
      add({ type: 'CustomField', fullName: `${objects[0]}.${field}`, evidence: path })
    }
  }
  return [...found.values()]
}

function permissionReferences(path: string, contents: string): Reference[] {
  const found = new Map<string, Reference>()
  const add = (reference: Reference) => found.set(`${reference.type}:${reference.fullName}`, reference)
  for (const match of contents.matchAll(/<field>([^<]+)<\/field>/g)) {
    if (match[1].includes('.') && match[1].split('.')[1].endsWith('__c')) {
      add({ type: 'CustomField', fullName: match[1], evidence: path })
    }
  }
  for (const match of contents.matchAll(/<object>([^<]+)<\/object>/g)) {
    if (match[1].endsWith('__c')) add({ type: 'CustomObject', fullName: match[1], evidence: path })
  }
  return [...found.values()]
}

function lwcReferences(path: string, contents: string): Reference[] {
  const found = new Map<string, Reference>()
  const add = (reference: Reference) => found.set(`${reference.type}:${reference.fullName}`, reference)
  for (const match of contents.matchAll(/@salesforce\/schema\/([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)/g)) {
    if (match[2].endsWith('__c')) add({ type: 'CustomField', fullName: `${match[1]}.${match[2]}`, evidence: path })
    if (match[1].endsWith('__c')) add({ type: 'CustomObject', fullName: match[1], evidence: path })
  }
  for (const match of contents.matchAll(/@salesforce\/apex\/([A-Za-z0-9_]+)/g)) {
    add({ type: 'ApexClass', fullName: match[1], evidence: path })
  }
  return [...found.values()]
}

export function permissionNames(contents: string): { user: string[]; records: string[] } {
  const user: string[] = []
  const records: string[] = []
  for (const block of contents.split(/<userPermissions>/).slice(1)) {
    const name = block.match(/<name>([^<]+)<\/name>/)?.[1]
    const enabled = block.match(/<enabled>([^<]+)<\/enabled>/)?.[1]
    if (name && enabled === 'true') user.push(name)
  }
  for (const block of contents.split(/<objectPermissions>/).slice(1)) {
    const objectName = block.match(/<object>([^<]+)<\/object>/)?.[1] || 'records'
    if (block.match(/<modifyAllRecords>\s*true\s*<\/modifyAllRecords>/)) records.push(`${objectName}.ModifyAllRecords`)
    if (block.match(/<viewAllRecords>\s*true\s*<\/viewAllRecords>/)) records.push(`${objectName}.ViewAllRecords`)
  }
  return { user, records }
}

export function isTestClass(fullName: string, contents: string): boolean {
  return /@isTest\b/i.test(contents) || /(?:^|_)[A-Za-z0-9]*Test$/.test(fullName)
}

export function hardcodedEndpoints(contents: string): string[] {
  return [...contents.matchAll(/https?:\/\/[^'")\s<]+/g)].map((match) => match[0])
}

export function hardcodedIds(contents: string): string[] {
  return [...contents.matchAll(/'([a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?)'/g)]
    .map((match) => match[1])
    .filter((value) => /\d/.test(value))
}
