import { sep } from 'node:path'

/**
 * The read-only rules, pure: which files hold secrets, and masking secrets in text the model will see.
 * The one place that touches the learner's files is adapters/fs-readonly.ts.
 */

const SECRET_FILES: RegExp[] = [
  /(^|\/)\.env(\.[\w.-]+)?$/i,
  /(^|\/)\.npmrc$/i,
  /(^|\/)\.pypirc$/i,
  /(^|\/)\.netrc$/i,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
  /\.(pem|key|p12|pfx|keystore|jks|kdbx)$/i,
  /(^|\/)(secrets?|credentials?)(\.[\w-]+)?\.(json|ya?ml|toml|xml|txt)$/i,
  /(^|\/)\.aws\//i,
  /(^|\/)\.ssh\//i
]

export function isSecretPath(relPath: string): boolean {
  const p = relPath.split(sep).join('/')
  return SECRET_FILES.some((re) => re.test(p))
}

export class SandboxError extends Error {}

/** Mask values that look like credentials in text the model will see. */
export function redactSecrets(text: string): string {
  return text
    .replace(/\b(AKIA|ASIA)[A-Z0-9]{16}\b/g, '[redacted key]')
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, '[redacted key]')
    .replace(/\bxai-[A-Za-z0-9_-]{16,}\b/g, '[redacted key]')
    .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, '[redacted token]')
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[redacted private key]')
    .replace(
      /((?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token|client[_-]?secret)\s*["']?\s*[:=]\s*["']?)([^"'\s;,]{4,})/gi,
      '$1[redacted]'
    )
}

/** Dependency, build and tool folders: never listed, searched, mapped or copied. */
export const SKIP_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn', '.venv', 'venv', 'env', '__pycache__', '.mypy_cache',
  '.pytest_cache', '.tox', 'bin', 'obj', 'build', 'dist', 'out', 'target', '.next', '.idea',
  '.vscode', '.vs', 'Pods', 'DerivedData', '.gradle', 'vendor', 'coverage'
])
