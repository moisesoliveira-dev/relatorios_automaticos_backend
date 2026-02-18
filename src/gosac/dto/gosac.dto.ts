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
}

export class UpdateGosacGroupDto {
    @IsOptional()
    @IsBoolean()
    isActive?: boolean;
}

export class LinkSalesOrderDto {
    @IsString()
    ponttaId: string;

    @IsString()
    code: string;

    @IsString()
    customerName: string;
}
