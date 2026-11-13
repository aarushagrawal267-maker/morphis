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
  /** On start, continue the most recent save instead of a fresh town (keeps the town across restarts). */
  RESUME_LATEST_SAVE: z.enum(['true', 'false']).default('false'),
  AI_PROVIDER: z.enum(['openai-compatible', 'anthropic', 'none']).default('openai-compatible'),
  AI_BASE_URL: z.string().default('https://integrate.api.nvidia.com/v1'),
  AI_MODEL: z.string().default('nvidia/nemotron-3-ultra-550b-a55b'),
  AI_API_KEY: z.string().optional(),
  /** Optional cheaper model for routine calls (day turns, agent conversations, visitor talk). Same endpoint and key. */
  AI_MODEL_LIGHT: z.string().optional(),
  AI_REQUESTS_PER_MINUTE: z.coerce.number().min(1).default(30),
  AI_MAX_TOKENS: z.coerce.number().int().min(256).default(4096),
  AI_DAILY_REQUEST_CAP: z.coerce.number().int().min(1).default(400),
  AI_TIMEOUT_MS: z.coerce.number().int().default(180_000),
  /** NVIDIA NIM reasoning mode (chat_template_kwargs.enable_thinking). Slower, sometimes better. */
  AI_THINKING: z.enum(['true', 'false']).default('false'),
  /** Max tool-use steps per agent task. */
  AI_AGENT_MAX_STEPS: z.coerce.number().int().min(1).max(12).default(6),
  /** web.fetch is available to agents but every call still needs human approval. */
  AI_WEB_FETCH: z.enum(['true', 'false']).default('true'),
  AI_APPROVAL_TIMEOUT_MS: z.coerce.number().int().min(10_000).default(600_000),
  /** Agents' daily life decisions made by the model (per real hour; 0 = always simulated). */
  AI_LIFE_DECISIONS_PER_HOUR: z.coerce.number().int().min(0).max(600).default(20),
  /** Agents' lunch and evening plans (day turns) made by the model, per real hour (0 = always simulated). */
  AI_DAY_TURNS_PER_HOUR: z.coerce.number().int().min(0).max(600).default(20),
  /** Conversations between agents voiced by the model, per real hour (0 = always written by the simulation). */
  AI_AGENT_CHATS_PER_HOUR: z.coerce.number().int().min(0).max(600).default(12),
  /** Visitor conversations voiced by the model, per minute (0 = always simulated). */
  AI_TALK_PER_MINUTE: z.coerce.number().int().min(0).max(120).default(12),
  /** Folder with The Agency's persona files (default: vendor/agency-agents found from the server). */
  AGENCY_DIR: z.string().optional(),
  /** Built web client to serve from this server ('' to serve the API only). */
  WEB_DIST: z.string().default('../web/dist'),
  /** When set, only connections with this key can change the town (speed, weather, saves, JARVIS). Visitors can still walk, wave and talk. */
  ADMIN_TOKEN: z.string().min(8).optional(),
});

export type ServerConfig = z.infer<typeof schema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): ServerConfig {
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== ''));
  // also accept the common provider-specific key names
  if (!cleaned.AI_API_KEY) cleaned.AI_API_KEY = env.NVIDIA_API_KEY || env.OPENAI_API_KEY || env.ANTHROPIC_API_KEY || undefined;
  if (!cleaned.AI_API_KEY) delete cleaned.AI_API_KEY;
  return schema.parse(cleaned);
}
