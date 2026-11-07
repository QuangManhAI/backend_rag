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
import type { AuthUser } from '../../../types/auth-user';
import { accountLinksV2, WithLinks } from '../../../common/http/hateoas';
import { RateLimit } from '../../../common/security/throttler';
import { AuthService } from '../auth.service';
import { CurrentUser } from '../decorators/current-user.decorator';
import { AuthResponseDto, LoginDto, RefreshDto } from '../dto/auth.dto';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';

/** Token lifecycle in v2: tokens are issued, refreshed and revoked (RFC 6749 / RFC 7009). */
@ApiTags('Auth')
@Controller('api/v2/auth')
export class AuthV2Controller {
  constructor(private readonly auth: AuthService) {}

  /** Login: exchanges credentials for a new token pair. */
  @Post('tokens')
  @WithLinks({ resource: accountLinksV2 })
  @RateLimit('login')
  @ApiCreatedResponse({ type: AuthResponseDto })
  @ApiUnauthorizedResponse({ description: 'invalid credentials' })
  @ApiTooManyRequestsResponse({ description: 'too many login attempts' })
  login(@Body() dto: LoginDto, @Ip() ip: string): Promise<AuthResponseDto> {
    return this.auth.login(dto, ip);
  }

  /** Refresh: exchange refresh token for a new token pair (RFC 6749). */
  @Post('tokens/refresh')
  @WithLinks({ resource: accountLinksV2 })
  @RateLimit('refresh')
  @ApiCreatedResponse({ type: AuthResponseDto })
  @ApiUnauthorizedResponse({ description: 'refresh token invalid or expired' })
  refresh(@Body() dto: RefreshDto): Promise<AuthResponseDto> {
    return this.auth.refresh(dto.refresh_token);
  }

  /** Revoke: revokes refresh token / logout (RFC 7009). */
  @Post('tokens/revoke')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'token revoked' })
  logout(@Body() dto: RefreshDto, @CurrentUser() me: AuthUser): Promise<void> {
    return this.auth.logout(dto.refresh_token, me);
  }
}

