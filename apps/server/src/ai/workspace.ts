/** Shared project workspace on disk (sandboxed: paths can never escape the root). */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export class Workspace {
  readonly root: string;

  constructor(dataDir: string) {
    this.root = path.resolve(dataDir, 'workspaces');
  }

  /** Map a virtual path like /projects/ai-tutor/research.md to a real file inside the root. */
  resolve(virtualPath: string): string {
    const rel = virtualPath.replace(/^\/?projects\//, '').replace(/^\/+/, '');
    const full = path.resolve(this.root, rel);
    if (full !== this.root && !full.startsWith(this.root + path.sep)) throw new Error('path escapes workspace');
    return full;
  }

  async write(virtualPath: string, content: string): Promise<string> {
    const file = this.resolve(virtualPath);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content, 'utf8');
    return file;
  }

  async read(virtualPath: string): Promise<string | null> {
    try {
      return await readFile(this.resolve(virtualPath), 'utf8');
    } catch {
      return null;
    }
  }

  async list(virtualDir: string): Promise<string[]> {
    try {
      return (await readdir(this.resolve(virtualDir))).sort();
    } catch {
      return [];
    }
  }
}
