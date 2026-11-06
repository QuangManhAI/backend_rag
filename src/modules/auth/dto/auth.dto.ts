import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsString,
  Length,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../common-passwords';
import type { Role } from '../../../types/auth-user';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class RegisterDto {
  @ApiProperty({ example: 'a@example.com' })
  @Transform(trim)
  @MaxLength(254, { message: 'invalid email' })
  @IsEmail({}, { message: 'invalid email' })
  email: string;

  @ApiProperty({ minLength: 10, example: 'correct horse battery' })
  @MaxLength(PASSWORD_MAX_LENGTH, { message: 'password too long' })
  @MinLength(PASSWORD_MIN_LENGTH, { message: 'password too short' })
  @IsString({ message: 'password too short' })
  password: string;

  @ApiProperty({ minLength: 1, maxLength: 60, example: 'Manh' })
  @Transform(trim)
  @IsString({ message: 'invalid display_name' })
  @Length(1, 60, { message: 'invalid display_name' })
  display_name: string;
}

export class LoginDto {
  @ApiProperty({ example: 'a@example.com' })
  @Transform(trim)
  @IsString({ message: 'invalid email' })
  @MaxLength(254, { message: 'invalid email' })
  email: string;

  @ApiProperty()
  @IsString({ message: 'invalid credentials' })
  @MaxLength(PASSWORD_MAX_LENGTH, { message: 'invalid credentials' })
  password: string;
}

export class RefreshDto {
  @ApiProperty()
  @IsString({ message: 'refresh_token must be a string' })
  @Length(1, 200, { message: 'refresh token invalid or expired' })
  refresh_token: string;
}

export class UpdateProfileDto {
  @ApiProperty({ minLength: 1, maxLength: 60 })
  @Transform(trim)
  @IsString({ message: 'invalid display_name' })
  @Length(1, 60, { message: 'invalid display_name' })
  display_name: string;
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString({ message: 'old password incorrect' })
  @MaxLength(PASSWORD_MAX_LENGTH, { message: 'old password incorrect' })
  old_password: string;

  @ApiProperty({ minLength: 10 })
  @MaxLength(PASSWORD_MAX_LENGTH, { message: 'password too long' })
  @MinLength(PASSWORD_MIN_LENGTH, { message: 'password too short' })
  @IsString({ message: 'password too short' })
  new_password: string;
}

export class UserDto {
  @ApiProperty() id: string;
  @ApiProperty() email: string;
  @ApiProperty() display_name: string;
  @ApiProperty({ type: [String], example: ['user'] }) roles: Role[];
  @ApiProperty() created_at: string;
}

export class AuthResponseDto {
  @ApiProperty() access_token: string;
  @ApiProperty({ example: 'Bearer' }) token_type: 'Bearer';
  @ApiProperty({ example: 900 }) expires_in: number;
  @ApiProperty() refresh_token: string;
  @ApiProperty({ type: UserDto }) user: UserDto;
}
