import { normalizeTagKey } from '@finmate/data-models';

/**
 * TAG-BATCH-C4 — a custom tag the current user is ALREADY authorized to see, with
 * its name decrypted CLIENT-SIDE (reusing the C3 crypto path). The suggestion
 * engine only ever operates on this in-memory, scope-filtered input — it never
 * fetches, decrypts, stores, logs, or transmits anything itself.
 */
export interface AuthorizedCustomTag {
  id: string;
  /** Decrypted name — in-memory only. Never persisted/logged/sent by the engine. */
  name: string;
  scope: 'personal' | 'group';
  groupId?: string;
}

/**
 * A deterministic, explainable custom-tag suggestion. `confidence` is match
 * certainty (NOT financial correctness) and never mutates any finance value.
 */
export interface CustomTagSuggestion {
  tagId: string;
  name: string;
  /** Human-readable why, e.g. "Matched a previous correction". */
  reason: string;
  confidence: number;
}

// Fixed, explainable confidences for the three deterministic signals. A prior
// user correction on THIS client outranks a name/keyword match.
const CONFIDENCE_CORRECTION = 0.95;
const CONFIDENCE_EXACT_NAME = 0.8;
const CONFIDENCE_KEYWORDS = 0.6;

/**
 * TAG-BATCH-C4 — PURE, client-side custom-tag suggester. Same input ⇒ same
 * output; no I/O, no network, no ML, no external/LLM inference, no persistence,
 * no logging. It only ranks tags the caller already authorized + decrypted.
 *
 * Deterministic signals (highest wins per tag):
 *  1. Correction memory — a `rememberedTagId` still present in `authorizedTags`
 *     (device-local, per-user/per-group; the caller supplies the recalled ids).
 *  2. Exact normalized name match — the tag name equals the label.
 *  3. Keyword match — every word of the tag name appears in the label.
 *
 * @param label the expense/line-item label (e.g. "Amul Taaza Milk").
 * @param authorizedTags tags the user may see, ALREADY scope-filtered + decrypted.
 * @param rememberedTagIds custom-tag ids recalled from device-local correction memory.
 * @returns INFERRED custom-tag suggestions, de-duped, sorted by confidence desc.
 */
export function suggestCustomTags(
  label: string | null | undefined,
  authorizedTags: readonly AuthorizedCustomTag[],
  rememberedTagIds: readonly string[] = [],
): CustomTagSuggestion[] {
  const key = normalizeTagKey(label ?? '');
  if (!key || authorizedTags.length === 0) return [];

  const authById = new Map(authorizedTags.map((t) => [t.id, t]));
  const labelWords = new Set(key.split(' ').filter(Boolean));
  const byId = new Map<string, CustomTagSuggestion>();

  const consider = (
    tag: AuthorizedCustomTag,
    confidence: number,
    reason: string,
  ): void => {
    const existing = byId.get(tag.id);
    if (existing && existing.confidence >= confidence) return;
    byId.set(tag.id, { tagId: tag.id, name: tag.name, reason, confidence });
  };

  // 1) Correction memory — only ids still authorized (drops deprecated/unknown).
  for (const id of rememberedTagIds) {
    const tag = authById.get(id);
    if (tag)
      consider(tag, CONFIDENCE_CORRECTION, 'Matched a previous correction');
  }

  for (const tag of authorizedTags) {
    const nameKey = normalizeTagKey(tag.name);
    if (!nameKey) continue;
    // 2) Exact normalized name match.
    if (nameKey === key) {
      consider(tag, CONFIDENCE_EXACT_NAME, 'Matched tag name');
      continue;
    }
    // 3) Keyword match — every word of the tag name is present in the label.
    const nameWords = nameKey.split(' ').filter(Boolean);
    if (nameWords.length && nameWords.every((w) => labelWords.has(w))) {
      consider(tag, CONFIDENCE_KEYWORDS, 'Matched label keywords');
    }
  }

  return [...byId.values()].sort(
    (a, b) => b.confidence - a.confidence || a.name.localeCompare(b.name),
  );
}
