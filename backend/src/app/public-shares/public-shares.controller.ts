import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SuccessResponse } from '../common/response.util';
import { PublicSharesService } from './public-shares.service';
import { CreatePublicShareDto } from './dto';

type AuthedRequest = Request & { user: { id: string } };

/**
 * PUBLIC-1B — AUTHENTICATED owner/admin management of a group's public share.
 *
 * This controller is fully guarded (`JwtAuthGuard`) and owner/admin-gated in the
 * service. It NEVER exposes public/anonymous data and NEVER returns the token
 * hash. The raw capability token is returned ONLY by create/regenerate, exactly
 * once. The anonymous public projection is a separate later batch (PUBLIC-1C).
 */
@Controller('groups/:groupId/public-share')
@UseGuards(JwtAuthGuard)
export class PublicSharesController {
  constructor(private readonly publicSharesService: PublicSharesService) {}

  /** Create the group's public share (owner/admin). Returns the raw token ONCE. */
  @Post()
  async create(
    @Param('groupId', new ParseUUIDPipe({ version: '4' })) groupId: string,
    @Body() dto: CreatePublicShareDto,
    @Req() req: AuthedRequest,
  ) {
    const result = await this.publicSharesService.create(
      req.user.id,
      groupId,
      dto,
    );
    return new SuccessResponse('Public share created successfully', result);
  }

  /** Sharing status (owner/admin). Never returns the token or its hash. */
  @Get()
  async status(
    @Param('groupId', new ParseUUIDPipe({ version: '4' })) groupId: string,
    @Req() req: AuthedRequest,
  ) {
    const result = await this.publicSharesService.getStatus(
      req.user.id,
      groupId,
    );
    return new SuccessResponse('Public share status retrieved', result);
  }

  /** Regenerate the link (owner/admin): revoke the old token + issue a new one atomically. */
  @Post('regenerate')
  async regenerate(
    @Param('groupId', new ParseUUIDPipe({ version: '4' })) groupId: string,
    @Body() dto: CreatePublicShareDto,
    @Req() req: AuthedRequest,
  ) {
    const result = await this.publicSharesService.regenerate(
      req.user.id,
      groupId,
      dto,
    );
    return new SuccessResponse('Public share regenerated successfully', result);
  }

  /** Revoke the active share (owner/admin). Immediate; idempotent. */
  @Delete()
  async revoke(
    @Param('groupId', new ParseUUIDPipe({ version: '4' })) groupId: string,
    @Req() req: AuthedRequest,
  ) {
    const result = await this.publicSharesService.revoke(req.user.id, groupId);
    return new SuccessResponse('Public share revoked', result);
  }
}
