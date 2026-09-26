// AUTHENTICODE STATE OF A FILE (2026-09-23, code signing) — read through Windows' own verifier.
//
//   node scripts/signature.mjs <file> [<file> …]       prints one line per file
//   import { signatureOf } from './signature.mjs'       { status, subject, issuer }
//
// status is PowerShell's Get-AuthenticodeSignature status: Valid | NotSigned | UnknownError
// (signed, but the chain is not trusted — a self-signed test certificate looks like this) |
// HashMismatch | … ; 'unavailable' where PowerShell is not present (macOS/Linux). The go-live check
// and the publish script use it to refuse an installer whose signature is not the one the app
// verifies updates against (build.win.publisherName).
import { spawnSync } from 'node:child_process';
import path from 'node:path';

export function signatureOf(file) {
  if (process.platform !== 'win32') return { status: 'unavailable', subject: '', issuer: '' };
  const ps = `$s = Get-AuthenticodeSignature -LiteralPath ${JSON.stringify(path.resolve(file))}; ` +
    `$o = @{ status = [string]$s.Status; subject = ''; issuer = '' }; ` +
    `if ($s.SignerCertificate) { $o.subject = $s.SignerCertificate.Subject; $o.issuer = $s.SignerCertificate.Issuer }; ` +
    `$o | ConvertTo-Json -Compress`;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8' });
  try { return JSON.parse(r.stdout.trim()); } catch { return { status: 'unavailable', subject: '', issuer: r.stderr?.slice(0, 200) ?? '' }; }
}

/** the CN of a certificate subject ("CN=Foo, O=Bar" → "Foo") */
export const commonName = (subject) => /CN=([^,]+)/.exec(String(subject || ''))?.[1]?.trim() ?? '';

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  for (const f of process.argv.slice(2)) {
    const s = signatureOf(f);
    console.log(`${path.basename(f)}: ${s.status}${s.subject ? ` — ${commonName(s.subject)}` : ''}`);
  }
}
