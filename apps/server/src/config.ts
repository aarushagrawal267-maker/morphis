/** Server configuration from environment variables (validated). Secrets never leave the server. */
import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().int().default(8787),
  HOST: z.string().default('0.0.0.0'),
  CORS_ORIGIN: z.string().default('*'),
  DATABASE_URL: z.string().optional(),
  DATA_DIR: z.string().default('./data'),
  CITY_SEED: z.coerce.number().int().default(2126),
  CITY_POPULATION: z.coerce.number().int().min(25).max(5000).default(400),
  AUTOSAVE_MINUTES: z.coerce.number().min(0).default(0),
  AI_PROVIDER: z.enum(['openai-compatible', 'anthropic', 'none']).default('openai-compatible'),
  AI_BASE_URL: z.string().default('https://integrate.api.nvidia.com/v1'),
  AI_MODEL: z.string().default('nvidia/nemotron-3-ultra-550b-a55b'),
  AI_API_KEY: z.string().optional(),
  AI_REQUESTS_PER_MINUTE: z.coerce.number().min(1).default(30),
  AI_MAX_TOKENS: z.coerce.number().int().min(256).default(1800),
  AI_DAILY_REQUEST_CAP: z.coerce.number().int().min(1).default(400),
  AI_TIMEOUT_MS: z.coerce.number().int().default(180_000),
});

export type ServerConfig = z.infer<typeof schema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): ServerConfig {
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== ''));
  // also accept the common provider-specific key names
  if (!cleaned.AI_API_KEY) cleaned.AI_API_KEY = env.NVIDIA_API_KEY || env.OPENAI_API_KEY || env.ANTHROPIC_API_KEY || undefined;
  if (!cleaned.AI_API_KEY) delete cleaned.AI_API_KEY;
  return schema.parse(cleaned);
}
