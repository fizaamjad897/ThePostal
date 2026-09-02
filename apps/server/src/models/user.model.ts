import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { USER_ROLE } from '@postal/shared';

const userSchema = new Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
    },
    /** Argon2id digest. The plaintext never leaves the auth service. */
    passwordHash: { type: String, required: true, select: false },
    displayName: { type: String, required: true, trim: true, maxlength: 80 },
    role: { type: String, enum: USER_ROLE, default: 'user', index: true },
    /** The local part this user owns, e.g. `fiza` for fiza@postal.local. */
    mailbox: { type: String, required: true, unique: true, lowercase: true, trim: true },
    lastLoginAt: { type: Date, default: null },
    /**
     * Consecutive failed logins. Reset on success; used to throttle an account
     * under attack independently of the per-IP rate limit, which an attacker
     * distributing across addresses would otherwise evade.
     */
    failedLoginAttempts: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_doc, ret: Record<string, unknown>) {
        delete ret.passwordHash;
        delete ret.__v;
        return ret;
      },
    },
  },
);

export type User = InferSchemaType<typeof userSchema>;
export type UserDocument = HydratedDocument<User>;

export const UserModel = model('User', userSchema);
