import { IsEmail, IsString, MinLength, IsOptional, IsEnum } from 'class-validator';
import { UserRole } from '../entities/user.entity';

export class CreateUserDto {
    @IsEmail()
    email: string;

    @IsString()
    @MinLength(6)
    password: string;

    @IsString()
    @MinLength(2)
    name: string;

    @IsOptional()
    @IsEnum(UserRole)
    role?: UserRole;
}

export class CreateMasterDto {
    @IsEmail()
    email: string;

    @IsString()
    @MinLength(6)
    password: string;

    @IsString()
    @MinLength(2)
    name: string;
}

export class InviteUserDto {
    @IsEmail()
    email: string;

    @IsOptional()
    @IsEnum(UserRole)
    role?: UserRole;
}

export class CompleteRegistrationDto {
    @IsString()
    @MinLength(6)
    code: string;

    @IsString()
    @MinLength(2)
    name: string;

    @IsString()
    @MinLength(6)
    password: string;
}

export class UpdateUserDto {
    @IsOptional()
    @IsString()
    @MinLength(2)
    name?: string;

    @IsOptional()
    @IsString()
    @MinLength(6)
    password?: string;

    @IsOptional()
    @IsEnum(UserRole)
    role?: UserRole;

    @IsOptional()
    isActive?: boolean;

    @IsOptional()
    @IsString()
    avatarUrl?: string;
}

export class LoginDto {
    @IsEmail()
    email: string;

    @IsString()
    password: string;
}
