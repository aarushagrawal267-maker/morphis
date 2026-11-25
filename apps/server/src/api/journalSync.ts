/**
 * Journal sync without accounts: a visitor saves their journal under a
 * private code and restores it on another device with the same code. Only a
 * hash of the code is used as the storage key.
 */
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const codeSchema = z.string().trim().toUpperCase().regex(/^MORPH-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);

function newCode(): string {
  const b = randomBytes(12);
  const part = (o: number) => Array.from({ length: 4 }, (_, i) => ALPHABET[b[o + i] % ALPHABET.length]).join('');
  return `MORPH-${part(0)}-${part(4)}-${part(8)}`;
}

/** Saves per address per hour: plenty for a visitor, but stops one address filling the disk. */
export const JOURNAL_SAVES_PER_HOUR = 60;

export function registerJournalSync(app: FastifyInstance, dataDir: string): void {
  const dir = path.resolve(dataDir, 'journals');
  const file = (code: string) => path.join(dir, `${createHash('sha256').update(code).digest('hex')}.json`);
  const recent = new Map<string, number[]>();
  const throttled = (ip: string): boolean => {
    const now = Date.now();
    if (recent.size > 10_000) for (const [k, v] of recent) if (!v.some((t) => now - t < 3_600_000)) recent.delete(k);
    const list = (recent.get(ip) ?? []).filter((t) => now - t < 3_600_000);
    if (list.length >= JOURNAL_SAVES_PER_HOUR) return true;
    list.push(now);
    recent.set(ip, list);
    return false;
  };

  app.post('/api/journal', { bodyLimit: 64 * 1024 }, async (req, reply) => {
    if (throttled(req.ip)) return reply.code(429).send({ error: 'too many journal saves from this address; try again later' });
    const body = z.object({ code: codeSchema.optional(), journal: z.record(z.string(), z.unknown()) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'journal object required' });
    const code = body.data.code ?? newCode();
    await mkdir(dir, { recursive: true });
    await writeFile(file(code), JSON.stringify({ savedAt: new Date().toISOString(), journal: body.data.journal }));
    return { code };
  });

  app.get('/api/journal/:code', async (req, reply) => {
    const code = codeSchema.safeParse((req.params as { code: string }).code);
    if (!code.success) return reply.code(400).send({ error: 'invalid code' });
    try {
      return JSON.parse(await readFile(file(code.data), 'utf8'));
    } catch {
      return reply.code(404).send({ error: 'no journal saved under this code' });
    }
  });
}
