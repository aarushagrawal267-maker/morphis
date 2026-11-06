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
  z.object({ type: z.literal('jarvis.command'), text: z.string().trim().min(3).max(500), urgent: z.boolean().optional() }),
  z.object({ type: z.literal('jarvis.approve'), id: z.string().min(1).max(64), approve: z.boolean() }),
  z.object({
    type: z.literal('guest.wave'),
    x: z.number().finite().min(-2000).max(2000),
    z: z.number().finite().min(-2000).max(2000),
    citizens: z.array(z.string().min(1).max(40)).max(30),
    /** Waving inside a building: the people in that building can wave back. */
    buildingId: z.string().min(1).max(40).optional(),
  }),
  z.object({
    type: z.literal('guest.talk'),
    citizenId: z.string().min(1).max(40),
    topic: z.enum(['upto', 'where', 'chat']),
    /** What the visitor said (free text, chat topic only). */
    text: z.string().trim().max(240).optional(),
  }),
]);

export type SimCommand = z.infer<typeof commandSchema>;

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/** A visitor's position, sent a few times a second while walking (server mode). */
export const guestPoseSchema = z.object({
  name: z.string().trim().min(1).max(24),
  x: z.number().finite().min(-600).max(600),
  y: z.number().finite().min(-5).max(60),
  z: z.number().finite().min(-600).max(600),
  yaw: z.number().finite(),
  moving: z.boolean(),
  waving: z.boolean(),
  inside: z.string().max(40).nullable(),
  look: z.object({ coat: color, trousers: color, hair: color, skin: color, build: z.number().min(0.8).max(1.3), height: z.number().min(0.8).max(1.2) }),
});

/** Commands any visitor may send to a hosted town. Everything else needs the host's admin key when one is set. */
export const PUBLIC_COMMANDS: readonly string[] = ['guest.wave', 'guest.talk', 'city.list'];
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
