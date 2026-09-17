import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';

const script = fileURLToPath(
  new URL('./check-agent-instructions.mjs', import.meta.url),
);
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function createRepository(): string {
  const directory = mkdtempSync(join(tmpdir(), 'bande-agent-policy-'));
  temporaryDirectories.push(directory);
  writeFileSync(directory + '/AGENTS.md', '# Project instructions\n');
  writeFileSync(
    directory + '/CLAUDE.md',
    '<!-- Canonical project instructions live in AGENTS.md. Do not add rules here. -->\n@AGENTS.md\n',
  );
  return directory;
}

function runValidator(directory: string) {
  return spawnSync(process.execPath, [script, directory], {
    encoding: 'utf8',
  });
}

it('accepts a canonical AGENTS.md with the approved Claude import shim', () => {
  const result = runValidator(createRepository());

  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
});

it('rejects Claude instructions that duplicate the canonical policy', () => {
  const directory = createRepository();
  writeFileSync(directory + '/CLAUDE.md', '# Duplicated instructions\n');

  const result = runValidator(directory);

  expect(result.status).toBe(1);
  expect(result.stderr).toContain('CLAUDE.md must be the approved import shim');
});

it('rejects an empty canonical instruction file', () => {
  const directory = createRepository();
  writeFileSync(directory + '/AGENTS.md', '');

  const result = runValidator(directory);

  expect(result.status).toBe(1);
  expect(result.stderr).toContain('AGENTS.md must not be empty');
});

it('rejects canonical instructions over 200 lines', () => {
  const directory = createRepository();
  writeFileSync(directory + '/AGENTS.md', '- rule\n'.repeat(201));

  const result = runValidator(directory);

  expect(result.status).toBe(1);
  expect(result.stderr).toContain(
    'AGENTS.md must stay at or below 200 lines',
  );
});

it('rejects canonical instructions over 32 KiB', () => {
  const directory = createRepository();
  writeFileSync(directory + '/AGENTS.md', 'x'.repeat(32 * 1024 + 1));

  const result = runValidator(directory);

  expect(result.status).toBe(1);
  expect(result.stderr).toContain(
    'AGENTS.md must stay at or below 32768 bytes',
  );
});

it('rejects nested instruction files that can shadow the canonical policy', () => {
  const directory = createRepository();
  mkdirSync(directory + '/lib');
  writeFileSync(directory + '/lib/AGENTS.md', '# Shadow policy\n');

  const result = runValidator(directory);

  expect(result.status).toBe(1);
  expect(result.stderr).toContain(
    'Shadow instruction files are not allowed: lib/AGENTS.md',
  );
});

it('rejects nested Claude instructions that can shadow the import shim', () => {
  const directory = createRepository();
  mkdirSync(directory + '/lib');
  writeFileSync(directory + '/lib/CLAUDE.md', '# Shadow policy\n');

  const result = runValidator(directory);

  expect(result.status).toBe(1);
  expect(result.stderr).toContain(
    'Shadow instruction files are not allowed: lib/CLAUDE.md',
  );
});

it('rejects Claude rules that bypass the canonical policy', () => {
  const directory = createRepository();
  mkdirSync(directory + '/.claude/rules', { recursive: true });
  writeFileSync(directory + '/.claude/rules/testing.md', '# Extra policy\n');

  const result = runValidator(directory);

  expect(result.status).toBe(1);
  expect(result.stderr).toContain(
    'Shadow instruction files are not allowed: .claude/rules/testing.md',
  );
});

it('rejects a symlinked Claude rules directory', () => {
  const directory = createRepository();
  const externalRules = mkdtempSync(join(tmpdir(), 'bande-agent-rules-'));
  temporaryDirectories.push(externalRules);
  writeFileSync(externalRules + '/testing.md', '# External policy\n');
  mkdirSync(directory + '/.claude');
  symlinkSync(externalRules, directory + '/.claude/rules');

  const result = runValidator(directory);

  expect(result.status).toBe(1);
  expect(result.stderr).toContain(
    'Shadow instruction files are not allowed: .claude/rules',
  );
});

it('rejects a symlinked Claude configuration directory', () => {
  const directory = createRepository();
  const externalClaude = mkdtempSync(join(tmpdir(), 'bande-agent-claude-'));
  temporaryDirectories.push(externalClaude);
  mkdirSync(externalClaude + '/rules');
  writeFileSync(externalClaude + '/rules/testing.md', '# External policy\n');
  symlinkSync(externalClaude, directory + '/.claude');

  const result = runValidator(directory);

  expect(result.status).toBe(1);
  expect(result.stderr).toContain(
    'Shadow instruction files are not allowed: .claude',
  );
});
