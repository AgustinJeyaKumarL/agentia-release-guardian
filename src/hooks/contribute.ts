import { defineContributions, SUPPORTED_CONTRIBUTION_API_VERSION } from '@copado/agentia-plugin-sdk'

export default function contribute(): ReturnType<typeof defineContributions> {
  return defineContributions({
    apiVersion: SUPPORTED_CONTRIBUTION_API_VERSION,
    skills: [
      {
        id: 'release-guardian',
        files: [{ path: 'skills/agentia-release-guardian/SKILL.md' }],
      },
    ],
  })
}
