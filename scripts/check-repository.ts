import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);
const forbiddenPaths = files.filter((file) =>
  /(^|\/)(\.env($|\.)|node_modules\/)|\.(pem|p12|pfx|key)$/i.test(file),
);
assert.deepEqual(
  forbiddenPaths,
  [],
  'Unexpected credential or generated dependency paths are tracked.',
);
const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{60,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/,
];
const findings: string[] = [];
for (const file of files) {
  if (/\.(png|jpg|woff2)$/.test(file)) continue;
  const content = readFileSync(file, 'utf8');
  if (secretPatterns.some((pattern) => pattern.test(content))) findings.push(file);
}
assert.deepEqual(findings, [], 'Potential credential patterns found; only paths are reported.');
const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};
const prohibited = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter((name) =>
  /openai|mediapipe/i.test(name),
);
assert.deepEqual(prohibited, [], 'This milestone must not depend on OpenAI or MediaPipe.');
// Also inspect resolved packages: helper libraries must not reintroduce excluded features.
const lockfile = readFileSync('pnpm-lock.yaml', 'utf8');
assert(
  !/^ {2}['"]?(?:@mediapipe\/[^\s]+|openai@[^\s]+):/m.test(lockfile),
  'A prohibited transitive package is present in the lockfile.',
);
console.log(
  `Repository scan passed: ${files.length} tracked files; no matched credential patterns, prohibited dependency, or credential paths.`,
);
console.log(
  'This targeted scan is a review aid, not a guarantee against every possible secret format.',
);
