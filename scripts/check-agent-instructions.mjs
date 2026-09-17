#!/usr/bin/env node

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const root = resolve(process.argv[2] ?? process.cwd());
const expectedClaudeInstructions =
  '<!-- Canonical project instructions live in AGENTS.md. Do not add rules here. -->\n@AGENTS.md\n';

if (readFileSync(join(root, 'CLAUDE.md'), 'utf8') !== expectedClaudeInstructions) {
  console.error('CLAUDE.md must be the approved import shim');
  process.exitCode = 1;
}

const agentInstructions = readFileSync(join(root, 'AGENTS.md'), 'utf8');

if (agentInstructions.trim() === '') {
  console.error('AGENTS.md must not be empty');
  process.exitCode = 1;
}

const lineCount =
  agentInstructions.split('\n').length - Number(agentInstructions.endsWith('\n'));

if (lineCount > 200) {
  console.error('AGENTS.md must stay at or below 200 lines');
  process.exitCode = 1;
}

if (Buffer.byteLength(agentInstructions) > 32 * 1024) {
  console.error('AGENTS.md must stay at or below 32768 bytes');
  process.exitCode = 1;
}

const ignoredDirectories = new Set(['.git', '.next', 'coverage', 'node_modules']);
const instructionFileNames = new Set([
  'AGENTS.md',
  'AGENTS.override.md',
  'CLAUDE.local.md',
  'CLAUDE.md',
]);
const shadowInstructions = [];

function findShadowInstructions(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const repositoryPath = relative(root, path).split(sep).join('/');

    const isNestedInstruction =
      instructionFileNames.has(entry.name) &&
      repositoryPath !== 'AGENTS.md' &&
      repositoryPath !== 'CLAUDE.md';
    const isClaudeRule =
      !entry.isDirectory() &&
      repositoryPath.startsWith('.claude/rules/') &&
      repositoryPath.endsWith('.md');
    const isClaudeRulesDirectory = repositoryPath === '.claude/rules';
    const isSymlinkedClaudeDirectory =
      repositoryPath === '.claude' && entry.isSymbolicLink();

    if (
      isNestedInstruction ||
      isClaudeRule ||
      isClaudeRulesDirectory ||
      isSymlinkedClaudeDirectory
    ) {
      shadowInstructions.push(repositoryPath);
    }

    if (entry.isDirectory() && !ignoredDirectories.has(entry.name)) {
      findShadowInstructions(path);
    }
  }
}

findShadowInstructions(root);

for (const path of shadowInstructions.sort()) {
  console.error(`Shadow instruction files are not allowed: ${path}`);
  process.exitCode = 1;
}
