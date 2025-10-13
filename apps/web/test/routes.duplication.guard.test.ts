import { describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function walk(dir: string): string[] {
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...walk(fullPath));
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
    return files;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

function stripExtension(file: string): string {
  const lastDot = file.lastIndexOf('.');
  return lastDot === -1 ? file : file.slice(0, lastDot);
}

const testDir = fileURLToPath(new URL('.', import.meta.url));
const srcDir = resolve(testDir, '../src');
const pagesApiDir = resolve(srcDir, 'pages/api');
const appApiDir = resolve(srcDir, 'app/api');

describe('api route duplication guard', () => {
  it('does not define the same API route in both Pages and App routers', () => {
    const pageFiles = walk(pagesApiDir);
    const pageRoutes = new Set(
      pageFiles
        .filter((file) => file.endsWith('.ts') || file.endsWith('.tsx'))
        .map((file) => stripExtension(relative(pagesApiDir, file)).replace(/\\/g, '/')),
    );

    const appFiles = walk(appApiDir)
      .filter((file) => /route\.(ts|tsx)$/.test(file))
      .map((file) => {
        const rel = relative(appApiDir, file).replace(/\\/g, '/');
        const segments = rel.split('/');
        segments.pop();
        return segments.join('/');
      });

    const duplicates = appFiles.filter((route) => pageRoutes.has(route));

    expect(duplicates.sort()).toEqual([]);
  });
});

