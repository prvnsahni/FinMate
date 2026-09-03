import { Controller, Get, UseGuards } from '@nestjs/common';
import { CanonicalTag, getActiveCanonicalTaxonomy } from '@finmate/data-models';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SuccessResponse } from '../common/response.util';

/**
 * TAG-BATCH-B — read-only view of the shared DOC-5 canonical taxonomy, so the
 * frontend can render the tag filter facet.
 *
 * Returns ONLY safe, non-sensitive canonical metadata (id/name/hierarchy/status/
 * version) from the single code-seeded `CANONICAL_TAXONOMY`. It exposes NO user
 * data, NO expense content, NO E2EE plaintext/OCR text, NO keys/tokens — the
 * taxonomy is static shared reference data, identical for every user. Only ACTIVE
 * tags are returned, so a deprecated term can never be offered as a new filter
 * selection. There is exactly one taxonomy (no per-user/custom/DB taxonomy).
 */
export interface CanonicalTagDto {
  id: string;
  canonicalName: string;
  normalizedKey: string;
  parentId?: string;
  status: CanonicalTag['status'];
  version: number;
}

@Controller('taxonomy')
@UseGuards(JwtAuthGuard)
export class TaxonomyController {
  /** List the active canonical taxonomy tags (safe metadata only). */
  @Get()
  getTaxonomy(): SuccessResponse<CanonicalTagDto[]> {
    const tags: CanonicalTagDto[] = getActiveCanonicalTaxonomy().map((t) => ({
      id: t.id,
      canonicalName: t.canonicalName,
      normalizedKey: t.normalizedKey,
      ...(t.parentId ? { parentId: t.parentId } : {}),
      status: t.status,
      version: t.version,
    }));
    return new SuccessResponse('Taxonomy retrieved successfully', tags);
  }
}
