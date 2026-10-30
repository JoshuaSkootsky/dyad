// src/envelope.ts
// Version envelope: wraps a Database IR with version metadata at the top level.
// This allows v1 readers to read the version of a payload they can't otherwise
// parse, then refuse with a useful message.
//
// Serialized form:
//   { "irVersion": "1", "data": { "dialect": "postgres", "tables": [...] } }
//
// The Database.irVersion field is retained for backward compat but the
// canonical serialized form uses the envelope.

import { z } from 'zod';
import { Database } from './schema.js';

// The envelope's data field is intentionally permissive (z.unknown()) so that
// a v1 reader can read irVersion even when the data payload uses a newer schema.
// Use parseDatabaseEnvelope() for full validation when the version is known.
export const DyadEnvelope = z.object({
  irVersion: z.string(),
  data: z.unknown(),
}).passthrough();

export function parseDatabaseEnvelope(raw: unknown): { irVersion: string; data: Database } {
  const env = DyadEnvelope.parse(raw);
  const db = Database.parse(env.data);
  return { irVersion: env.irVersion, data: db };
}

export type DyadEnvelope = z.infer<typeof DyadEnvelope>;

export function wrapEnvelope(db: Database): DyadEnvelope {
  return { irVersion: db.irVersion, data: db };
}

export function unwrapEnvelope(env: DyadEnvelope): Database {
  return Database.parse(env.data);
}

export function parseEnvelope(raw: unknown): DyadEnvelope {
  return DyadEnvelope.parse(raw);
}

// Type guard
export function isEnvelope(raw: unknown): raw is DyadEnvelope {
  return typeof raw === 'object' && raw !== null && 'irVersion' in raw && 'data' in raw;
}
