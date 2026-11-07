import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { accountLinksV2, WithLinks } from '../../../common/http/hateoas';
import { RateLimit } from '../../../common/security/throttler';
import type { AuthUser } from '../../../types/auth-user';
import { AuthService } from '../auth.service';
import { CurrentUser } from '../decorators/current-user.decorator';
import {
  AuthResponseDto,
  ChangePasswordDto,
  RegisterDto,
  UpdateProfileDto,
  UserDto,
} from '../dto/auth.dto';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';

@ApiTags('Users')
@Controller('api/v2/users')
export class UsersV2Controller {
  constructor(private readonly auth: AuthService) {}

  /** Self-registration */
  @Post()
  @WithLinks({ resource: accountLinksV2 })
  @RateLimit('register')
  @ApiCreatedResponse({ type: AuthResponseDto })
  @ApiConflictResponse({ description: 'email already exists' })
  @ApiTooManyRequestsResponse({ description: 'too many requests' })
  register(@Body() dto: RegisterDto): Promise<AuthResponseDto> {
    return this.auth.register(dto);
  }

  @Get('me')
  @WithLinks({ resource: accountLinksV2 })
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOkResponse({ type: UserDto })
  me(@CurrentUser() me: AuthUser): Promise<UserDto> {
    return this.auth.me(me);
  }

  @Patch('me')
  @WithLinks({ resource: accountLinksV2 })
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOkResponse({ type: UserDto })
  updateMe(
    @Body() dto: UpdateProfileDto,
    @CurrentUser() me: AuthUser,
  ): Promise<UserDto> {
    return this.auth.updateProfile(me, dto.display_name);
  }

  @Put('me/password')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @RateLimit('changePassword')
  @ApiNoContentResponse()
  @ApiUnauthorizedResponse({ description: 'old password incorrect' })
  changePassword(
    @Body() dto: ChangePasswordDto,
    @CurrentUser() me: AuthUser,
  ): Promise<void> {
    return this.auth.changePassword(me, dto);
  }
}
