import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface PolicyChunk {
  document: string;
  documentTitle: string;
  section: string;
  chunkId: string;
  text: string;
}

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DOCUMENTS_DIRECTORY = resolve(PROJECT_ROOT, 'documents');
const DEFAULT_MAX_CHARACTERS = 1800;

function splitLongBlock(block: string, maxCharacters: number): string[] {
  const parts: string[] = [];
  let current = '';
  for (const line of block.split('\n')) {
    if (line.length > maxCharacters) {
      if (current.trim()) parts.push(current.trim());
      current = '';
      let remainder = line;
      while (remainder.length > maxCharacters) {
        let cut = remainder.lastIndexOf(' ', maxCharacters);
        if (cut < Math.floor(maxCharacters * 0.55)) cut = maxCharacters;
        parts.push(remainder.slice(0, cut).trim());
        remainder = remainder.slice(cut).trim();
      }
      current = remainder;
      continue;
    }
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length > maxCharacters && current.trim()) {
      parts.push(current.trim());
      current = line;
    } else current = candidate;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function splitSection(text: string, maxCharacters: number): string[] {
  const blocks = text.split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = '';
  for (const block of blocks) {
    const parts = block.length > maxCharacters ? splitLongBlock(block, maxCharacters) : [block];
    for (const part of parts) {
      const candidate = current ? `${current}\n\n${part}` : part;
      if (candidate.length > maxCharacters && current) {
        chunks.push(current);
        current = part;
      } else current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export function chunkMarkdownDocument(
  document: string,
  markdown: string,
  maxCharacters = DEFAULT_MAX_CHARACTERS,
): PolicyChunk[] {
  if (!Number.isInteger(maxCharacters) || maxCharacters < 200) {
    throw new Error('maxCharacters must be an integer of at least 200.');
  }
  const headingStack: string[] = [];
  const sections: Array<{ heading: string; lines: string[] }> = [];
  let current: { heading: string; lines: string[] } | undefined;
  let title = document.replace(/\.md$/i, '').replaceAll('_', ' ');

  const flush = () => {
    if (current && current.lines.join('\n').trim()) sections.push(current);
    current = undefined;
  };

  for (const line of markdown.split(/\r?\n/)) {
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (match) {
      flush();
      const level = match[1]!.length;
      const heading = match[2]!.trim();
      if (level === 1) {
        title = heading;
        headingStack.length = 0;
        current = { heading: 'Overview', lines: [] };
      } else {
        headingStack.length = level - 2;
        headingStack.push(heading);
        current = { heading: headingStack.join(' > '), lines: [] };
      }
    } else {
      if (!current) current = { heading: 'Overview', lines: [] };
      current.lines.push(line);
    }
  }
  flush();

  let sequence = 0;
  return sections.flatMap(({ heading, lines }) => splitSection(lines.join('\n').trim(), maxCharacters)
    .map((text) => {
      sequence += 1;
      return {
        document,
        documentTitle: title,
        section: heading,
        chunkId: `${document}#${String(sequence).padStart(4, '0')}`,
        text,
      };
    }));
}

export async function loadPolicyChunks(): Promise<{ documentCount: number; chunks: PolicyChunk[] }> {
  const entries = await readdir(DOCUMENTS_DIRECTORY, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
  if (!files.length) throw new Error('No Markdown policy documents found in the approved documents directory.');

  const documents = await Promise.all(files.map(async (document) => ({
    document,
    markdown: await readFile(join(DOCUMENTS_DIRECTORY, document), 'utf8'),
  })));
  const chunks = documents.flatMap(({ document, markdown }) => chunkMarkdownDocument(document, markdown));
  if (!chunks.length) throw new Error('Policy documents did not contain any chunkable text.');
  return { documentCount: files.length, chunks };
}
