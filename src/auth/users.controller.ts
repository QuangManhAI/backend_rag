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
import { accountLinks, WithLinks } from '../common/hateoas';
import { RateLimit } from '../common/throttler';
import type { AuthUser } from '../types/auth-user';
import { AuthService } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import {
  AuthResponseDto,
  ChangePasswordDto,
  RegisterDto,
  UpdateProfileDto,
  UserDto,
} from './dto/auth.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

/** The caller's own account. Other accounts are only reachable through `/admin/users`. */
@ApiTags('Users')
@Controller('users')
export class UsersController {
  constructor(private readonly auth: AuthService) {}

  /** Self-registration; always a plain `user` (the first admin comes from `npm run create:admin`). */
  @Post()
  @WithLinks({ resource: accountLinks })
  @RateLimit('register')
  @ApiCreatedResponse({ type: AuthResponseDto })
  @ApiConflictResponse({ description: 'email already exists' })
  @ApiTooManyRequestsResponse({ description: 'too many requests' })
  register(@Body() dto: RegisterDto): Promise<AuthResponseDto> {
    return this.auth.register(dto);
  }

  @Get('me')
  @WithLinks({ resource: accountLinks })
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOkResponse({ type: UserDto })
  me(@CurrentUser() me: AuthUser): Promise<UserDto> {
    return this.auth.me(me);
  }

  @Patch('me')
  @WithLinks({ resource: accountLinks })
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
