import {
  CANONICAL_TAXONOMY,
  CanonicalTag,
  ClassificationSource,
  TagAuthority,
} from './canonical-taxonomy';

/**
 * DOC-5 deterministic, rule-based classifier over the shared canonical taxonomy.
 * Pure and side-effect-free — same input ⇒ same output. No ML, no external calls, no
 * persistence, no fabrication. It suggests only ACTIVE seed tags (bounded growth) and
 * returns [] when nothing matches. Output is ADVISORY metadata: `confidence` is match
 * certainty, NEVER financial correctness, and a suggestion never mutates finance data.
 */

/** A suggested tag. Advisory candidate — not persisted, not global truth. */
export interface CandidateTag {
  tagId: string;
  canonicalName: string;
  normalizedKey: string;
  authority: TagAuthority;
  source: ClassificationSource;
  /** Match certainty 0..1 — NOT financial correctness. */
  confidence: number;
}

/** Normalize a label to a match key: lowercase, alphanumerics, single-spaced. */
export function normalizeTagKey(input: string): string {
  return (input ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

const activeById = new Map(CANONICAL_TAXONOMY.filter((t) => t.status === 'active').map((t) => [t.id, t]));

/** Look up an ACTIVE canonical tag by its stable id ('deprecated'/unknown → undefined). */
export function getActiveCanonicalTag(tagId: string): CanonicalTag | undefined {
  return activeById.get(tagId);
}

/**
 * Expand an ACTIVE tag id into itself followed by its ACTIVE ancestors, closest
 * first (milk → dairy → grocery → food). Returns [] when the id is unknown or
 * not active (a deprecated tag is never expanded/suggested). The walk stops at
 * the first inactive parent, so only active ancestors are included. Pure and
 * bounded — no recursion into the database.
 */
export function expandActiveWithAncestors(tagId: string): CanonicalTag[] {
  const ordered: CanonicalTag[] = [];
  let cur = activeById.get(tagId);
  while (cur) {
    ordered.push(cur);
    cur = cur.parentId ? activeById.get(cur.parentId) : undefined;
  }
  return ordered;
}

/** Collect a tag and all its active ancestors (milk → dairy → grocery → food). */
function withAncestors(tag: CanonicalTag, acc: Map<string, CanonicalTag>): void {
  if (acc.has(tag.id) || tag.status !== 'active') return;
  acc.set(tag.id, tag);
  if (tag.parentId) {
    const parent = activeById.get(tag.parentId);
    if (parent) withAncestors(parent, acc);
  }
}

/** Does a normalized label contain the given key as a whole word? */
function labelMatchesKey(words: Set<string>, key: string): boolean {
  const nk = normalizeTagKey(key);
  if (nk.length === 0) return false;
  // Multi-word keys: require the full phrase; single-word: word membership.
  return nk.includes(' ') ? false : words.has(nk);
}

/**
 * Classify a label (and optionally the coarse user category) into candidate tags.
 * @param label   e.g. an extracted line-item name ("Milk", "Petrol"). May be empty.
 * @param category the user-chosen coarse category (e.g. "Grocery"), server-readable.
 * @returns advisory INFERRED candidate tags (with ancestors), deduped, or [].
 */
export function classifyLabel(label?: string, category?: string): CandidateTag[] {
  const words = new Set([...normalizeTagKey(label ?? '').split(' '), ...normalizeTagKey(category ?? '').split(' ')].filter(Boolean));
  if (words.size === 0) return [];

  const matched = new Map<string, CanonicalTag>();
  for (const tag of CANONICAL_TAXONOMY) {
    if (tag.status !== 'active') continue;
    const hit = labelMatchesKey(words, tag.normalizedKey) || tag.aliases.some((a) => labelMatchesKey(words, a));
    if (hit) withAncestors(tag, matched);
  }

  return [...matched.values()].map((tag) => ({
    tagId: tag.id,
    canonicalName: tag.canonicalName,
    normalizedKey: tag.normalizedKey,
    authority: 'INFERRED' as const,
    source: 'rule_based' as const,
    confidence: 0.6,
  }));
}
