/**
 * DOC-5 shared canonical taxonomy (single source of truth).
 *
 * This is the COMMON, bounded taxonomy referenced by ALL users — not a per-user copy.
 * It is a curated CODE seed (no database in DOC-5), which by construction avoids
 * taxonomy explosion, uncontrolled auto-creation, destructive renames, and per-user
 * duplication. Both the backend rule-based classifier and the frontend review flow
 * consume this exact module, so there is exactly one taxonomy.
 *
 * SENSITIVE-TAG BOUNDARY (surfaced decision): this seed intentionally contains NO
 * medical / pharmacy / health / financial-hardship / religion / other sensitive
 * categories. Deriving such tags could reveal sensitive information (readiness §A7,
 * DOC-5 sensitive-tag consideration). Adding any sensitive category is a
 * `[PRODUCT DECISION REQUIRED]` / `[COUNSEL]`, not something the classifier does.
 *
 * Dynamic growth: new terms are modelled as CANDIDATES (see taxonomy.types) with a
 * lifecycle candidate → reviewed → active → deprecated. DOC-5 persists none of that
 * (it is migration-free); only `active` seed tags are suggested.
 */

/** Lifecycle of a taxonomy term. Only `active` terms are suggested to users. */
export type TagLifecycleStatus =
  | 'candidate'
  | 'reviewed'
  | 'active'
  | 'deprecated';

/** Where a tag/classification came from / how much authority it carries. */
export type TagAuthority =
  | 'EXTRACTED'
  | 'INFERRED'
  | 'USER_CORRECTED'
  | 'USER_CONFIRMED';

/** Which classifier produced a suggestion (contract stays stable as engines improve). */
export type ClassificationSource = 'rule_based' | 'model' | 'population';

/** A canonical, shared taxonomy term with a STABLE id (never renamed destructively). */
export interface CanonicalTag {
  /** Stable identifier — reports/links reference this, never the display name. */
  id: string;
  /** Human-readable canonical name. */
  canonicalName: string;
  /** Normalized match key (lowercase, alphanumeric). */
  normalizedKey: string;
  /** Synonyms/aliases that also map to this tag. */
  aliases: string[];
  /** Parent tag id (hierarchy) — omitted for roots. */
  parentId?: string;
  status: TagLifecycleStatus;
  /** Taxonomy version this term belongs to (bumped when the seed changes). */
  version: number;
}

/**
 * The bounded canonical seed. Hierarchies:
 *   food > grocery > dairy > milk / bread / rice / vegetables / snacks
 *   household > cleaning > detergent
 *   transport > vehicle > fuel
 *   dining > restaurant
 *   utilities
 */
export const CANONICAL_TAXONOMY: readonly CanonicalTag[] = [
  // Food / grocery
  {
    id: 'food',
    canonicalName: 'Food',
    normalizedKey: 'food',
    aliases: [],
    status: 'active',
    version: 1,
  },
  {
    id: 'grocery',
    canonicalName: 'Grocery',
    normalizedKey: 'grocery',
    aliases: ['groceries', 'supermarket'],
    parentId: 'food',
    status: 'active',
    version: 1,
  },
  {
    id: 'dairy',
    canonicalName: 'Dairy',
    normalizedKey: 'dairy',
    aliases: [],
    parentId: 'grocery',
    status: 'active',
    version: 1,
  },
  {
    id: 'milk',
    canonicalName: 'Milk',
    normalizedKey: 'milk',
    aliases: ['toned milk', 'whole milk'],
    parentId: 'dairy',
    status: 'active',
    version: 1,
  },
  {
    id: 'bread',
    canonicalName: 'Bread',
    normalizedKey: 'bread',
    aliases: ['bakery'],
    parentId: 'grocery',
    status: 'active',
    version: 1,
  },
  {
    id: 'rice',
    canonicalName: 'Rice',
    normalizedKey: 'rice',
    aliases: [],
    parentId: 'grocery',
    status: 'active',
    version: 1,
  },
  {
    id: 'vegetables',
    canonicalName: 'Vegetables',
    normalizedKey: 'vegetables',
    aliases: ['veggies', 'produce', 'vegetable'],
    parentId: 'grocery',
    status: 'active',
    version: 1,
  },
  {
    id: 'snacks',
    canonicalName: 'Snacks',
    normalizedKey: 'snacks',
    aliases: ['snack'],
    parentId: 'grocery',
    status: 'active',
    version: 1,
  },
  // Household
  {
    id: 'household',
    canonicalName: 'Household',
    normalizedKey: 'household',
    aliases: [],
    status: 'active',
    version: 1,
  },
  {
    id: 'cleaning',
    canonicalName: 'Cleaning',
    normalizedKey: 'cleaning',
    aliases: [],
    parentId: 'household',
    status: 'active',
    version: 1,
  },
  {
    id: 'detergent',
    canonicalName: 'Detergent',
    normalizedKey: 'detergent',
    aliases: ['washing powder'],
    parentId: 'cleaning',
    status: 'active',
    version: 1,
  },
  // Transport
  {
    id: 'transport',
    canonicalName: 'Transport',
    normalizedKey: 'transport',
    aliases: ['travel'],
    status: 'active',
    version: 1,
  },
  {
    id: 'vehicle',
    canonicalName: 'Vehicle',
    normalizedKey: 'vehicle',
    aliases: ['car', 'bike'],
    parentId: 'transport',
    status: 'active',
    version: 1,
  },
  {
    id: 'fuel',
    canonicalName: 'Fuel',
    normalizedKey: 'fuel',
    aliases: ['petrol', 'diesel', 'gas'],
    parentId: 'vehicle',
    status: 'active',
    version: 1,
  },
  // Dining
  {
    id: 'dining',
    canonicalName: 'Dining',
    normalizedKey: 'dining',
    aliases: ['eating out'],
    status: 'active',
    version: 1,
  },
  {
    id: 'restaurant',
    canonicalName: 'Restaurant',
    normalizedKey: 'restaurant',
    aliases: ['cafe', 'diner'],
    parentId: 'dining',
    status: 'active',
    version: 1,
  },
  // Utilities
  {
    id: 'utilities',
    canonicalName: 'Utilities',
    normalizedKey: 'utilities',
    aliases: ['utility'],
    status: 'active',
    version: 1,
  },
  // A deprecated example so consumers exercise lifecycle filtering (never suggested).
  {
    id: 'misc',
    canonicalName: 'Miscellaneous',
    normalizedKey: 'misc',
    aliases: ['miscellaneous'],
    status: 'deprecated',
    version: 1,
  },
];

/** The version of the seed as a whole (bump on any curated change). */
export const CANONICAL_TAXONOMY_VERSION = 1;
