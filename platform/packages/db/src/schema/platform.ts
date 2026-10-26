import {
  pgTable,
  text,
  timestamp,
  jsonb,
  uuid,
  boolean,
  bigint,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { user } from './auth.js';
const owner = () =>
  text('owner_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' });
const created = () => timestamp('created_at', { withTimezone: true }).defaultNow().notNull();
export const devices = pgTable(
  'devices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: owner(),
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    revoked: boolean('revoked').default(false).notNull(),
    os: text('os'),
    hostname: text('hostname'),
    version: text('version'),
    lastSeen: timestamp('last_seen', { withTimezone: true }),
    services: jsonb('services')
      .$type<{ id: string; status: string; error?: string }[]>()
      .default([])
      .notNull(),
    createdAt: created(),
  },
  (t) => [index('devices_owner').on(t.ownerId)],
);
export const pairings = pgTable('pairings', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: owner(),
  name: text('name').notNull(),
  codeHash: text('code_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});
export const connections = pgTable(
  'connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: owner(),
    name: text('name').notNull(),
    adapter: text('adapter').$type<'direct' | 'device' | 'pi'>().notNull(),
    deviceId: uuid('device_id').references(() => devices.id),
    config: text('config').notNull(),
    status: text('status').notNull().default('disconnected'),
    error: text('error'),
    createdAt: created(),
  },
  (t) => [index('connections_owner').on(t.ownerId)],
);
export const tools = pgTable(
  'tools',
  {
    id: text('id').primaryKey(),
    ownerId: owner(),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => connections.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    definition: jsonb('definition').$type<Record<string, unknown>>().notNull(),
    available: boolean('available').notNull().default(true),
  },
  (t) => [
    index('tools_owner').on(t.ownerId),
    uniqueIndex('tools_connection_name').on(t.connectionId, t.name),
  ],
);
export const profiles = pgTable('profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: owner(),
  name: text('name').notNull(),
  toolIds: jsonb('tool_ids').$type<string[]>().default([]).notNull(),
  skillVersionIds: jsonb('skill_version_ids').$type<string[]>().default([]).notNull(),
  artifactIds: jsonb('artifact_ids').$type<string[]>().default([]).notNull(),
  createdAt: created(),
});
export const accessKeys = pgTable('access_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: owner(),
  profileId: uuid('profile_id')
    .notNull()
    .references(() => profiles.id, { onDelete: 'cascade' }),
  hash: text('hash').notNull().unique(),
  name: text('name').notNull(),
  revoked: boolean('revoked').default(false).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: created(),
});
export const authorizations = pgTable('authorizations', {
  connectionId: uuid('connection_id')
    .primaryKey()
    .references(() => connections.id, { onDelete: 'cascade' }),
  ownerId: owner(),
  encrypted: text('encrypted').notNull(),
  updatedAt: created(),
});
export const calls = pgTable('calls', {
  id: uuid('id').primaryKey(),
  ownerId: owner(),
  profileId: uuid('profile_id'),
  toolId: text('tool_id').notNull(),
  connectionId: uuid('connection_id').notNull(),
  deviceId: uuid('device_id'),
  adapter: text('adapter').notNull(),
  status: text('status').notNull(),
  error: text('error'),
  startedAt: created(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
});
export const skillVersions = pgTable(
  'skill_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: owner(),
    name: text('name').notNull(),
    digest: text('digest').notNull(),
    files: jsonb('files').$type<Record<string, string>>().notNull(),
    dependencies: jsonb('dependencies').$type<string[]>().notNull(),
    source: text('source').notNull(),
    revision: text('revision'),
    createdAt: created(),
  },
  (t) => [uniqueIndex('skill_content').on(t.ownerId, t.name, t.digest)],
);
export const installations = pgTable('skill_installations', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: owner(),
  deviceId: uuid('device_id').references(() => devices.id),
  profileId: uuid('profile_id')
    .notNull()
    .references(() => profiles.id),
  versionId: uuid('version_id')
    .notNull()
    .references(() => skillVersions.id),
  target: text('target').notNull(),
  status: text('status').notNull(),
  error: text('error'),
  createdAt: created(),
});
export const artifacts = pgTable('artifacts', {
  id: uuid('id').primaryKey(),
  ownerId: owner(),
  name: text('name').notNull(),
  sha256: text('sha256').notNull(),
  size: bigint('size', { mode: 'number' }).notNull(),
  createdAt: created(),
});
export const transfers = pgTable('transfers', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: owner(),
  deviceId: uuid('device_id')
    .notNull()
    .references(() => devices.id),
  artifactId: uuid('artifact_id'),
  tokenHash: text('token_hash').notNull().unique(),
  direction: text('direction').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  status: text('status').notNull(),
  error: text('error'),
  createdAt: created(),
});
export const oauthClients = pgTable('oauth_clients', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  redirects: jsonb('redirects').$type<string[]>().notNull(),
});
export const oauthCodes = pgTable('oauth_codes', {
  hash: text('hash').primaryKey(),
  ownerId: owner(),
  clientId: uuid('client_id').notNull(),
  profileId: uuid('profile_id').notNull(),
  redirect: text('redirect').notNull(),
  challenge: text('challenge').notNull(),
  resource: text('resource').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});
export const oauthGrants = pgTable('oauth_grants', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: owner(),
  clientId: uuid('client_id').notNull(),
  profileId: uuid('profile_id').notNull(),
  accessHash: text('access_hash').notNull().unique(),
  refreshHash: text('refresh_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  refreshExpiresAt: timestamp('refresh_expires_at', { withTimezone: true }).notNull(),
  revoked: boolean('revoked').notNull().default(false),
  createdAt: created(),
});
export const tasks = pgTable('tasks', {
  id: uuid('id').primaryKey(),
  ownerId: owner(),
  profileId: uuid('profile_id').notNull(),
  prompt: text('prompt').notNull(),
  status: text('status').notNull(),
  output: text('output').notNull().default(''),
  error: text('error'),
  createdAt: created(),
});
