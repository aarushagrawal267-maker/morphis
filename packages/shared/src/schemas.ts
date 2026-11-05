/**
 * Zod schemas validating every command that crosses a trust boundary
 * (browser -> server, browser -> worker).
 */
import { z } from 'zod';
import { SIM_SPEEDS } from './constants';

export const weatherKindSchema = z.enum(['clear', 'rain', 'fog', 'storm']);

export const commandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('sim.setPaused'), paused: z.boolean() }),
  z.object({
    type: z.literal('sim.setSpeed'),
    speed: z.number().refine((v) => (SIM_SPEEDS as readonly number[]).includes(v), 'unsupported speed'),
  }),
  z.object({ type: z.literal('sim.setWeather'), weather: z.union([weatherKindSchema, z.literal('auto')]) }),
  z.object({ type: z.literal('sim.skip'), hours: z.number().min(0.25).max(24) }),
  z.object({ type: z.literal('city.save'), name: z.string().trim().min(1).max(80).optional() }),
  z.object({ type: z.literal('city.load'), id: z.string().min(1).max(120) }),
  z.object({ type: z.literal('city.list') }),
  z.object({ type: z.literal('city.delete'), id: z.string().min(1).max(120) }),
  z.object({
    type: z.literal('city.new'),
    seed: z.number().int().min(0).max(2 ** 31 - 1),
    population: z.number().int().min(25).max(5000).optional(),
  }),
  z.object({ type: z.literal('jarvis.command'), text: z.string().trim().min(3).max(500) }),
]);

export type SimCommand = z.infer<typeof commandSchema>;
export type SimCommandType = SimCommand['type'];

export const cityConfigSchema = z.object({
  seed: z.number().int(),
  size: z.number().int().min(128).max(1024),
  population: z.number().int().min(25).max(5000),
  coreCitizens: z.number().int().min(0).max(25),
  buildingDensity: z.number().min(0.2).max(1.5),
  roadDensity: z.number().min(0.2).max(1.5),
  trafficDensity: z.number().min(0).max(3),
  parkFrequency: z.number().min(0).max(1),
  heightScale: z.number().min(0.3).max(2),
});
