/**
 * Serves the built web client (apps/web/dist) from the simulation server, so
 * a single process hosts the city: the page, the REST API and the WebSocket
 * all share one origin. Unknown paths fall back to index.html.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

export function serveWebClient(app: FastifyInstance, dir: string, log: (m: string) => void): boolean {
  const root = path.resolve(dir);
  const index = path.join(root, 'index.html');
  if (!existsSync(index)) {
    log(`web client not found at ${root}; serving the API only (run "npm run build" to include the site)`);
    return false;
  }
  app.get('/*', async (req, reply) => {
    const url = decodeURIComponent((req.url.split('?')[0] ?? '/').split('#')[0]);
    if (url.startsWith('/api/')) return reply.code(404).send({ error: 'not found' });
    // resolve inside the dist folder only (no path traversal)
    const file = path.resolve(root, `.${path.posix.normalize(url)}`);
    const inside = file === root || file.startsWith(root + path.sep);
    const target = inside && existsSync(file) && statSync(file).isFile() ? file : index;
    const ext = path.extname(target).toLowerCase();
    reply.header('content-type', TYPES[ext] ?? 'application/octet-stream');
    // hashed build assets never change; the page itself is always revalidated
    reply.header('cache-control', target.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
    return reply.send(createReadStream(target));
  });
  log(`serving the web client from ${root}`);
  return true;
}
