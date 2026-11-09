import { Equals, IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { UserRole } from '../roles';

export class LoginDto {
  @IsString()
  @IsNotEmpty()
  username: string;

  @IsString()
  @IsNotEmpty()
  password: string;
}

export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  username: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/, {
    message: 'Password must include uppercase, lowercase, and a digit',
  })
  password: string;

  @IsEnum(UserRole)
  role: UserRole = UserRole.MEMBER;
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  username?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @IsOptional()
  isActive?: boolean;
}

export class AccountStatusDto {
  @IsOptional()
  @Equals('yes', { message: 'Confirmation must be yes' })
  confirmed?: string;
}

// Deliberately independent of CreateUserDto: role/status are never public fields.
export class RegistrationDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9_.-]{2,63}$/)
  username: string;

  @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  @IsEmail()
  @MaxLength(254)
  email: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/)
  password: string;
}

export class PortalSettingsDto {
  @IsString()
  @MaxLength(64)
  maxActiveUsers: string;

  @IsString()
  @MaxLength(64)
  defaultUserQuotaGb: string;

  @IsString()
  @MaxLength(64)
  globalStorageGb: string;
}

export class UserQuotaDto {
  @IsString()
  @MaxLength(64)
  quotaGb: string;
}
