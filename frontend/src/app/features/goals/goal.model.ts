/** Goals-v2 client models. `title` is E2EE ciphertext; the server never sees plaintext. */

export type GoalStatus = 'active' | 'achieved' | 'paused' | 'cancelled';

/** As returned by the API — `title` is ciphertext. */
export interface Goal {
  id: string;
  title: string; // ciphertext
  encryptedContentKey: string | null;
  targetAmount: number;
  savedAmount: number;
  currency: string;
  targetDate: string | null;
  status: GoalStatus;
  priority: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** A goal whose title has been decrypted locally for display only. */
export interface DecryptedGoal extends Goal {
  decryptedTitle: string;
}

/** Create payload — ciphertext title + wrapped key + numeric fields only. */
export interface CreateGoalPayload {
  title: string; // ciphertext
  encryptedContentKey: string;
  targetAmount: number;
  savedAmount?: number;
  currency: string;
  targetDate?: string;
  priority?: number;
}

/** Update payload — optimistic version + optional (re-encrypted) fields. */
export interface UpdateGoalPayload {
  version: number;
  title?: string; // ciphertext
  encryptedContentKey?: string;
  targetAmount?: number;
  savedAmount?: number;
  currency?: string;
  targetDate?: string;
  priority?: number;
  status?: GoalStatus;
}

/** Deterministic Goal Engine output (numeric/enum only — mirrors the backend contract). */
export interface GoalProjection {
  engine: { name: string; version: string; kind: string };
  status:
    | 'ok'
    | 'insufficient_data'
    | 'invalid_goal'
    | 'unsupported_goal_type'
    | 'low_confidence';
  projection?: {
    projectedCompletionDate?: string;
    onTrack?: boolean;
    requiredMonthlyContribution?: number;
    projectedShortfall?: number;
  };
  confidence?: {
    score: number;
    band: 'low' | 'medium' | 'high';
    basis: string;
  };
  explanation: {
    method: string;
    summary: string;
    inputsUsed: string[];
    assumptionsUsed: string[];
    disclaimers: string[];
  };
  generatedAt: string;
}
