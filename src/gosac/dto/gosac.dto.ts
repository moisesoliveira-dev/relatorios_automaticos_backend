export class SearchGosacTicketsDto {
    searchParam: string;
}

export class CreateGosacGroupDto {
    gosacTicketId: number;
    gosacTicketName: string;
    ponttaOccurrenceId?: number;
    ponttaOccurrenceName?: string;
}

export class UpdateGosacGroupDto {
    ponttaOccurrenceId?: number;
    ponttaOccurrenceName?: string;
    isActive?: boolean;
}
