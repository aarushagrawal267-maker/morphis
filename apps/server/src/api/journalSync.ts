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

export function registerJournalSync(app: FastifyInstance, dataDir: string): void {
  const dir = path.resolve(dataDir, 'journals');
  const file = (code: string) => path.join(dir, `${createHash('sha256').update(code).digest('hex')}.json`);

  app.post('/api/journal', { bodyLimit: 64 * 1024 }, async (req, reply) => {
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
