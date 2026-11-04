import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Ip,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { AuthUser } from '../types/auth-user';
import { accountLinks, WithLinks } from '../common/hateoas';
import { RateLimit } from '../common/throttler';
import { AuthService } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import { AuthResponseDto, LoginDto, RefreshDto } from './dto/auth.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

/** Token lifecycle: tokens are issued, rotated and revoked. Accounts live in `UsersController`. */
@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Login: exchanges credentials for a new token pair. */
  @Post('tokens')
  @WithLinks({ resource: accountLinks })
  @RateLimit('login')
  @ApiCreatedResponse({ type: AuthResponseDto })
  @ApiUnauthorizedResponse({ description: 'invalid credentials' })
  @ApiTooManyRequestsResponse({ description: 'too many login attempts' })
  login(@Body() dto: LoginDto, @Ip() ip: string): Promise<AuthResponseDto> {
    return this.auth.login(dto, ip);
  }

  /** Refresh: single-use, so it is deliberately not idempotent (reuse revokes the family). */
  @Post('token-rotations')
  @WithLinks({ resource: accountLinks })
  @RateLimit('refresh')
  @ApiCreatedResponse({ type: AuthResponseDto })
  @ApiUnauthorizedResponse({ description: 'refresh token invalid or expired' })
  refresh(@Body() dto: RefreshDto): Promise<AuthResponseDto> {
    return this.auth.refresh(dto.refresh_token);
  }

  /** Logout. The token travels in a body, which a `DELETE` should not carry. */
  @Post('token-revocations')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  logout(@Body() dto: RefreshDto, @CurrentUser() me: AuthUser): Promise<void> {
    return this.auth.logout(dto.refresh_token, me);
  }
}
