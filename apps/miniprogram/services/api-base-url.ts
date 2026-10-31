export const LOCAL_API_BASE_URL = 'http://127.0.0.1:3210'
export const PRODUCTION_API_BASE_URL = 'https://egg.zzlulu.cloud'

export function resolveApiBaseUrl(envVersion: string, platform: string): string {
  return envVersion === 'develop' && platform === 'devtools'
    ? LOCAL_API_BASE_URL
    : PRODUCTION_API_BASE_URL
}
