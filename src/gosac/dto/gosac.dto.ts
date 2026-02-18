import { IsNumber, IsString, IsOptional, IsBoolean } from 'class-validator';

export class SearchGosacTicketsDto {
    @IsString()
    searchParam: string;
}

export class CreateGosacGroupDto {
    @IsNumber()
    gosacTicketId: number;

    @IsNumber()
    gosacContactId: number;

    @IsString()
    gosacTicketName: string;

    @IsOptional()
    @IsNumber()
    ponttaOccurrenceId?: number;

    @IsOptional()
    @IsString()
    ponttaOccurrenceName?: string;
}

export class UpdateGosacGroupDto {
    @IsOptional()
    @IsNumber()
    ponttaOccurrenceId?: number;

    @IsOptional()
    @IsString()
    ponttaOccurrenceName?: string;

    @IsOptional()
    @IsBoolean()
    isActive?: boolean;
}
