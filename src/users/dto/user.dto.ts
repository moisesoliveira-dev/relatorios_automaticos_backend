import { IsEmail, IsString, MinLength, IsOptional, IsEnum, IsArray, IsBoolean, ArrayMinSize } from 'class-validator';
import { UserRole, UserStatus } from '../entities/user.entity';

export class CreateUserDto {
    @IsEmail()
    email: string;

    @IsString()
    @MinLength(6)
    password: string;

    @IsString()
    @MinLength(2)
    name: string;

    @IsArray()
    @ArrayMinSize(1, { message: 'Selecione ao menos uma aba' })
    @IsString({ each: true })
    tabs: string[];

    @IsOptional()
    @IsEnum(UserRole)
    role?: UserRole;
}

export class SelfRegisterDto {
    @IsEmail()
    email: string;

    @IsString()
    @MinLength(6)
    password: string;

    @IsString()
    @MinLength(2)
    name: string;
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

    @IsArray()
    @ArrayMinSize(1, { message: 'Selecione ao menos uma aba' })
    @IsString({ each: true })
    tabs: string[];

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
    @IsArray()
    @IsString({ each: true })
    tabs?: string[];

    @IsOptional()
    @IsBoolean()
    isActive?: boolean;

    @IsOptional()
    @IsEnum(UserStatus)
    status?: UserStatus;

    @IsOptional()
    @IsString()
    avatarUrl?: string;
}

export class ApproveRegistrationDto {
    @IsArray()
    @ArrayMinSize(1, { message: 'Selecione ao menos uma aba' })
    @IsString({ each: true })
    tabs: string[];
}

export class LoginDto {
    @IsEmail()
    email: string;

    @IsString()
    password: string;
}
