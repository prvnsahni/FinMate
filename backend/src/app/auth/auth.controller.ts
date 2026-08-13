import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  UseGuards,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import {
  RegisterDto,
  LoginDto,
  RefreshTokenDto,
  Verify2FaDto,
  ChangePasswordDto,
  ForgotPasswordDto,
  ResetPasswordDto,
} from '@finmate/data-models';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RequestWithUser } from '../common/interfaces/request-with-user.interface';
import { Request, Response } from 'express';
import { SuccessResponse } from '../common/response.util';
import { ThrottleAs } from '../throttler/throttle-policy.decorator';
import { THROTTLE_PROFILES } from '../throttler/throttle.constants';
import { FeatureFlagsService } from '../platform/feature-flags.service';
import {
  REFRESH_COOKIE,
  CSRF_COOKIE,
  CSRF_HEADER,
  REFRESH_COOKIE_PATH,
  CSRF_COOKIE_PATH,
  refreshCookieOptions,
  csrfCookieOptions,
  clearCookieOptions,
  parseCookies,
  generateCsrfToken,
  csrfMatches,
} from './auth-transport.util';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly flags: FeatureFlagsService,
  ) {}

  @Post('register')
  @ThrottleAs(THROTTLE_PROFILES.REGISTER)
  async register(@Body() registerDto: RegisterDto) {
    const result = await this.authService.register(
      registerDto.email,
      registerDto.password,
      registerDto.displayName,
    );
    return new SuccessResponse('User registered successfully', result);
  }

  @Get('verify-email')
  @ThrottleAs(THROTTLE_PROFILES.OTP)
  async verifyEmail(@Query('token') token: string) {
    const result = await this.authService.verifyEmail(token);
    return new SuccessResponse('Email verified successfully', result);
  }

  @Post('forgot-password')
  @ThrottleAs(THROTTLE_PROFILES.FORGOT_PASSWORD)
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.authService.requestPasswordReset(dto.email);
    // Always generic — never reveals whether the address is registered.
    return new SuccessResponse(
      'If an account exists for that address, a password reset link has been sent.',
      {},
    );
  }

  @Get('reset-password')
  @ThrottleAs(THROTTLE_PROFILES.RESET_PASSWORD)
  async getResetContext(@Query('token') token: string) {
    const result = await this.authService.getPasswordResetContext(token);
    return new SuccessResponse('Reset context retrieved successfully', result);
  }

  @Post('reset-password')
  @ThrottleAs(THROTTLE_PROFILES.RESET_PASSWORD)
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() dto: ResetPasswordDto, @Req() req: Request) {
    const context = {
      ip:
        req.ip ||
        (req.headers['x-forwarded-for'] as string) ||
        req.socket.remoteAddress,
      userAgent: req.headers['user-agent'] as string,
    };
    await this.authService.resetPassword(
      dto.token,
      dto.newPassword,
      dto.encryptedPrivateWrappingKey,
      context,
    );
    return new SuccessResponse(
      'Password reset successfully. Please sign in with your new password.',
      {},
    );
  }

  @Post('login')
  @ThrottleAs(THROTTLE_PROFILES.LOGIN)
  async login(
    @Body() loginDto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const mfaCode = req.headers['x-mfa-code'] as string | undefined;
    const context = {
      ip:
        req.ip ||
        (req.headers['x-forwarded-for'] as string) ||
        req.socket.remoteAddress,
      userAgent: req.headers['user-agent'] as string,
    };
    const result = await this.authService.login(
      loginDto.email,
      loginDto.password,
      mfaCode,
      context,
    );

    // BATCH-06 (W-AUTH): when the dual-transport flag is ON, additionally set the
    // host-only HttpOnly refresh cookie + CSRF cookie and expose the CSRF token in
    // the body so the new web client can echo it. This is a TRANSITION response —
    // the refresh token is STILL dual-emitted in the body for legacy clients.
    // When the flag is OFF (default), behaviour is exactly the legacy body-token
    // response — no cookies, no change.
    if (this.flags.isEnabled('auth.dualTransport')) {
      const csrfToken = generateCsrfToken();
      res.cookie(REFRESH_COOKIE, result.refreshToken, refreshCookieOptions());
      res.cookie(CSRF_COOKIE, csrfToken, csrfCookieOptions());
      return new SuccessResponse('Login successful', { ...result, csrfToken });
    }
    return new SuccessResponse('Login successful', result);
  }

  @Post('refresh')
  @ThrottleAs(THROTTLE_PROFILES.REFRESH)
  async refresh(
    @Body() refreshTokenDto: RefreshTokenDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const bodyToken = refreshTokenDto?.refreshToken;

    if (this.flags.isEnabled('auth.dualTransport')) {
      const cookies = parseCookies(req.headers.cookie);
      const cookieToken = cookies[REFRESH_COOKIE];
      if (cookieToken) {
        // Cookie transport → CSRF double-submit is mandatory (SameSite=Lax alone
        // is not sufficient against same-site sibling origins).
        const headerCsrf = req.headers[CSRF_HEADER] as string | undefined;
        if (!csrfMatches(headerCsrf, cookies[CSRF_COOKIE])) {
          throw new ForbiddenException({
            errorCode: 'AUTH_CSRF_INVALID',
            message: 'CSRF validation failed',
          });
        }
        // Never let two different refresh tokens silently succeed.
        if (bodyToken && bodyToken !== cookieToken) {
          throw new BadRequestException({
            errorCode: 'AUTH_TOKEN_AMBIGUOUS',
            message: 'Conflicting refresh tokens in cookie and body',
          });
        }
        const rotated = await this.authService.refresh(cookieToken);
        const csrfToken = generateCsrfToken();
        res.cookie(REFRESH_COOKIE, rotated.refreshToken, refreshCookieOptions());
        res.cookie(CSRF_COOKIE, csrfToken, csrfCookieOptions());
        // TARGET web: do NOT return the refresh token in the body.
        return new SuccessResponse('Token refreshed successfully', {
          accessToken: rotated.accessToken,
          csrfToken,
        });
      }
      // No refresh cookie present → fall through to the legacy body path.
    }

    if (!bodyToken) {
      throw new BadRequestException({
        errorCode: 'VAL_INVALID_INPUT',
        message: 'Refresh token is required',
      });
    }
    const result = await this.authService.refresh(bodyToken);
    return new SuccessResponse('Token refreshed successfully', result);
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Body() refreshTokenDto: RefreshTokenDto,
    @Req() req: RequestWithUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    let refreshToken = refreshTokenDto?.refreshToken;
    if (this.flags.isEnabled('auth.dualTransport')) {
      const cookies = parseCookies(req.headers.cookie);
      refreshToken = cookies[REFRESH_COOKIE] || refreshToken;
      // Always clear the transport cookies on logout (harmless if absent).
      res.clearCookie(REFRESH_COOKIE, clearCookieOptions(REFRESH_COOKIE_PATH));
      res.clearCookie(CSRF_COOKIE, clearCookieOptions(CSRF_COOKIE_PATH));
    }
    if (!refreshToken) {
      throw new BadRequestException({
        errorCode: 'VAL_INVALID_INPUT',
        message: 'Refresh token is required',
      });
    }
    await this.authService.logout(refreshToken, req.user.id);
    return new SuccessResponse('Logged out successfully', {});
  }

  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  @ThrottleAs(THROTTLE_PROFILES.RESET_PASSWORD)
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @Req() req: RequestWithUser,
  ) {
    const context = {
      ip:
        req.ip ||
        (req.headers['x-forwarded-for'] as string) ||
        req.socket.remoteAddress,
      userAgent: req.headers['user-agent'] as string,
    };
    await this.authService.changePassword(
      req.user.id,
      dto.currentPassword,
      dto.newPassword,
      dto.encryptedPrivateWrappingKey,
      dto.recoveryWrappedKey,
      context,
    );
    return new SuccessResponse(
      'Password changed successfully. Please sign in again.',
      {},
    );
  }

  @UseGuards(JwtAuthGuard)
  @Post('2fa/enable')
  async enable2Fa(@Req() req: RequestWithUser) {
    const context = {
      ip:
        req.ip ||
        (req.headers['x-forwarded-for'] as string) ||
        req.socket.remoteAddress,
      userAgent: req.headers['user-agent'] as string,
    };
    const result = await this.authService.enable2Fa(req.user, context);
    return new SuccessResponse('2FA setup initiated', result);
  }

  @UseGuards(JwtAuthGuard)
  @Post('2fa/verify')
  @ThrottleAs(THROTTLE_PROFILES.OTP)
  async verify2Fa(
    @Body() verify2FaDto: Verify2FaDto,
    @Req() req: RequestWithUser,
  ) {
    const context = {
      ip:
        req.ip ||
        (req.headers['x-forwarded-for'] as string) ||
        req.socket.remoteAddress,
      userAgent: req.headers['user-agent'] as string,
    };
    const result = await this.authService.verify2Fa(
      req.user,
      verify2FaDto.code,
      context,
    );
    return new SuccessResponse('2FA verified and enabled successfully', result);
  }

  @UseGuards(JwtAuthGuard)
  @Post('2fa/disable')
  @ThrottleAs(THROTTLE_PROFILES.OTP)
  @HttpCode(HttpStatus.OK)
  async disable2Fa(
    @Body() verify2FaDto: Verify2FaDto,
    @Req() req: RequestWithUser,
  ) {
    const context = {
      ip:
        req.ip ||
        (req.headers['x-forwarded-for'] as string) ||
        req.socket.remoteAddress,
      userAgent: req.headers['user-agent'] as string,
    };
    await this.authService.disable2Fa(req.user, verify2FaDto.code, context);
    return new SuccessResponse('2FA disabled successfully', {});
  }
}
