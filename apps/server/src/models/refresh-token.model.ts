import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

/**
 * Refresh tokens are stored as SHA-256 digests, never in the clear: a dump of
 * this collection must not be replayable as a set of live sessions.
 *
 * Rotation is enforced by `replacedBy` — presenting a token that has already
 * been exchanged means the token leaked, and the whole family is revoked.
 */
const refreshTokenSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    /** Shared id across a rotation chain, so one theft revokes the lineage. */
    family: { type: String, required: true, index: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    replacedBy: { type: String, default: null },
    userAgent: { type: String, default: null },
    ip: { type: String, default: null },
  },
  { timestamps: true },
);

// Mongo evicts expired sessions on its own; no sweeper job to own or monitor.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type RefreshToken = InferSchemaType<typeof refreshTokenSchema>;
export type RefreshTokenDocument = HydratedDocument<RefreshToken>;

export const RefreshTokenModel = model('RefreshToken', refreshTokenSchema);
