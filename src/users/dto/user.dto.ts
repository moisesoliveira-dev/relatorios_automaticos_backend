import { IsEmail, IsString, MinLength, MaxLength, IsOptional, IsEnum, IsArray, IsBoolean, ArrayMinSize, Matches } from 'class-validator';
import { UserRole, UserStatus } from '../entities/user.entity';

export class CreateUserDto {
    @IsEmail()
    email: string;

    @IsString()
    @MinLength(8, { message: 'A senha deve ter no mínimo 8 caracteres' })
    @MaxLength(72)
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
    @MinLength(8, { message: 'A senha deve ter no mínimo 8 caracteres' })
    @MaxLength(72)
    password: string;

    @IsString()
    @MinLength(2)
    name: string;
}

export class CreateMasterDto {
    @IsOptional()
    @IsString()
    setupToken?: string;

    @IsEmail()
    email: string;

    @IsString()
    @MinLength(8, { message: 'A senha deve ter no mínimo 8 caracteres' })
    @MaxLength(72)
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
    @Matches(/^\d{6}$/, { message: 'Código de convite inválido' })
    code: string;

    @IsString()
    @MinLength(2)
    name: string;

    @IsString()
    @MinLength(8, { message: 'A senha deve ter no mínimo 8 caracteres' })
    @MaxLength(72)
    password: string;
}

export class UpdateUserDto {
    @IsOptional()
    @IsString()
    @MinLength(2)
    name?: string;

    @IsOptional()
    @IsString()
    @MinLength(8, { message: 'A senha deve ter no mínimo 8 caracteres' })
    @MaxLength(72)
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

export class ValidateInviteCodeDto {
    @IsString()
    @Matches(/^\d{6}$/, { message: 'Código de convite inválido' })
    code: string;
}

export class UpdateProfileNameDto {
    @IsString()
    @MinLength(2)
    @MaxLength(120)
    name: string;
}

export class UpdateProfilePasswordDto {
    @IsString()
    currentPassword: string;

    @IsString()
    @MinLength(8, { message: 'A senha deve ter no mínimo 8 caracteres' })
    @MaxLength(72)
    newPassword: string;
}
