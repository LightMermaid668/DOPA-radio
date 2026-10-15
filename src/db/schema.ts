import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export * from "./auth-schema";

import { user } from "./auth-schema";

export const visibilityEnum = pgEnum("visibility", ["private", "unlisted", "public"]);
export const trackStatusEnum = pgEnum("track_status", ["processing", "ready", "failed"]);
export const playlistItemKindEnum = pgEnum("playlist_item_kind", ["upload", "apple", "spotify"]);
export const pitchVariantStatusEnum = pgEnum("pitch_variant_status", [
  "processing",
  "ready",
  "failed",
]);

export const tracks = pgTable(
  "tracks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    artist: text("artist"),
    album: text("album"),
    genre: text("genre"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    durationSec: integer("duration_sec"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    originalKey: text("original_key"),
    audioKey: text("audio_key"),
    hlsKey: text("hls_key"),
    artworkKey: text("artwork_key"),
    status: trackStatusEnum("status").notNull().default("processing"),
    transcodeError: text("transcode_error"),
    pinnedAt: timestamp("pinned_at", { withTimezone: true }),
    chorusStartSec: integer("chorus_start_sec"),
    chorusEndSec: integer("chorus_end_sec"),
    chorusSource: text("chorus_source"),
    visibility: visibilityEnum("visibility").notNull().default("private"),
    rightsConfirmed: boolean("rights_confirmed").notNull().default(false),
    playCount: integer("play_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("tracks_owner_idx").on(t.ownerId),
    index("tracks_visibility_idx").on(t.visibility),
  ],
);

export const playlists = pgTable(
  "playlists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    visibility: visibilityEnum("visibility").notNull().default("private"),
    coverKey: text("cover_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("playlists_owner_idx").on(t.ownerId)],
);

export const playlistItems = pgTable(
  "playlist_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    playlistId: uuid("playlist_id")
      .notNull()
      .references(() => playlists.id, { onDelete: "cascade" }),
    kind: playlistItemKindEnum("kind").notNull(),
    trackId: uuid("track_id").references(() => tracks.id, { onDelete: "set null" }),
    externalId: text("external_id"),
    externalMeta: jsonb("external_meta").$type<{
      title?: string;
      artist?: string;
      album?: string;
      artworkUrl?: string;
      deepLink?: string;
      previewUrl?: string;
      durationMs?: number;
      uri?: string;
    }>(),
    position: doublePrecision("position").notNull(),
    addedBy: text("added_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("playlist_items_playlist_idx").on(t.playlistId, t.position)],
);

export const trackPitchVariants = pgTable(
  "track_pitch_variants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    trackId: uuid("track_id")
      .notNull()
      .references(() => tracks.id, { onDelete: "cascade" }),
    semitones: integer("semitones").notNull(),
    status: pitchVariantStatusEnum("status").notNull().default("processing"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("track_pitch_variants_unique").on(t.trackId, t.semitones)],
);

export const integrations = pgTable(
  "integrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    providerUserId: text("provider_user_id"),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    scope: text("scope"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("integrations_user_provider_idx").on(t.userId, t.provider)],
);

export const reports = pgTable(
  "reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    reporterId: text("reporter_id").references(() => user.id, { onDelete: "set null" }),
    reason: text("reason").notNull(),
    detail: text("detail"),
    status: text("status").notNull().default("open"),
    handledBy: text("handled_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("reports_status_idx").on(t.status)],
);

export const plays = pgTable(
  "plays",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    kind: playlistItemKindEnum("kind").notNull(),
    trackId: uuid("track_id").references(() => tracks.id, { onDelete: "set null" }),
    externalId: text("external_id"),
    playedAt: timestamp("played_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("plays_played_at_idx").on(t.playedAt), index("plays_track_idx").on(t.trackId)],
);

export const savedTracks = pgTable(
  "saved_tracks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // 元の曲が削除されると保存も自動的に消える（参照方式）
    trackId: uuid("track_id")
      .notNull()
      .references(() => tracks.id, { onDelete: "cascade" }),
    // 保存した曲のピン留め（ユーザーごと。元の曲の pinned_at とは別）
    pinnedAt: timestamp("pinned_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("saved_tracks_unique").on(t.userId, t.trackId),
    index("saved_tracks_user_idx").on(t.userId),
  ],
);

export type Track = typeof tracks.$inferSelect;
export type Playlist = typeof playlists.$inferSelect;
export type PlaylistItem = typeof playlistItems.$inferSelect;
