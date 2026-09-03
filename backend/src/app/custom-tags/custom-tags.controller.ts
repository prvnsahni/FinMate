import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SuccessResponse } from '../common/response.util';
import { CustomTagsService } from './custom-tags.service';
import {
  CreateGroupCustomTagDto,
  CreatePersonalCustomTagDto,
  RestoreCustomTagDto,
  UpdateCustomTagDto,
} from './dto';

type AuthedRequest = Request & { user: { id: string } };

/** Normalize a raw `status` query value; only `deprecated` opts out of the active default. */
function normalizeStatus(value?: string): 'active' | 'deprecated' {
  return value === 'deprecated' ? 'deprecated' : 'active';
}

/**
 * TAG-BATCH-C2 — personal custom-tag CRUD, plus by-id rename/deprecate for both
 * scopes. The global canonical taxonomy is NOT exposed here (see
 * `GET /taxonomy`); this endpoint only ever serves user/group custom tags and
 * the opaque encrypted name — the server never decrypts it.
 */
@Controller('custom-tags')
@UseGuards(JwtAuthGuard)
export class CustomTagsController {
  constructor(private readonly customTagsService: CustomTagsService) {}

  /** Create a personal custom tag owned by the caller. */
  @Post()
  async createPersonal(
    @Body() dto: CreatePersonalCustomTagDto,
    @Req() req: AuthedRequest,
  ) {
    const tag = await this.customTagsService.createPersonal(req.user.id, dto);
    return new SuccessResponse('Custom tag created successfully', tag);
  }

  /** List the caller's personal custom tags — active by default, or `?status=deprecated`. */
  @Get()
  async listPersonal(
    @Req() req: AuthedRequest,
    @Query('status') status?: string,
  ) {
    const tags = await this.customTagsService.listPersonal(
      req.user.id,
      normalizeStatus(status),
    );
    return new SuccessResponse('Custom tags retrieved successfully', tags);
  }

  /** Rename a custom tag (personal or group) the caller is authorized for. */
  @Patch(':id')
  async rename(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateCustomTagDto,
    @Req() req: AuthedRequest,
  ) {
    const tag = await this.customTagsService.rename(req.user.id, id, dto);
    return new SuccessResponse('Custom tag renamed successfully', tag);
  }

  /** Restore a deprecated custom tag (`deprecated → active`) the caller is authorized for. */
  @Post(':id/restore')
  async restore(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: RestoreCustomTagDto,
    @Req() req: AuthedRequest,
  ) {
    const tag = await this.customTagsService.restore(req.user.id, id, dto);
    return new SuccessResponse('Custom tag restored successfully', tag);
  }

  /** Deprecate a custom tag (safe, non-destructive) the caller is authorized for. */
  @Delete(':id')
  async deprecate(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req: AuthedRequest,
  ) {
    const tag = await this.customTagsService.deprecate(req.user.id, id);
    return new SuccessResponse('Custom tag deprecated successfully', tag);
  }
}

/**
 * TAG-BATCH-C2 — group custom-tag create/list. Access requires ACTIVE group
 * membership (enforced server-side). Update/deprecate of a group tag reuse the
 * by-id routes on `CustomTagsController`.
 */
@Controller('groups/:groupId/custom-tags')
@UseGuards(JwtAuthGuard)
export class GroupCustomTagsController {
  constructor(private readonly customTagsService: CustomTagsService) {}

  /** Create a group custom tag (member-only). */
  @Post()
  async createGroup(
    @Param('groupId', new ParseUUIDPipe({ version: '4' })) groupId: string,
    @Body() dto: CreateGroupCustomTagDto,
    @Req() req: AuthedRequest,
  ) {
    const tag = await this.customTagsService.createGroup(
      req.user.id,
      groupId,
      dto,
    );
    return new SuccessResponse('Custom tag created successfully', tag);
  }

  /** List a group's custom tags (member-only) — active by default, or `?status=deprecated`. */
  @Get()
  async listGroup(
    @Param('groupId', new ParseUUIDPipe({ version: '4' })) groupId: string,
    @Req() req: AuthedRequest,
    @Query('status') status?: string,
  ) {
    const tags = await this.customTagsService.listGroup(
      req.user.id,
      groupId,
      normalizeStatus(status),
    );
    return new SuccessResponse('Custom tags retrieved successfully', tags);
  }
}
