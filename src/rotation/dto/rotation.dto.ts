export class CreateRotationDto {
    id: string;
    name: string;
    identificacao: number;
    queueid: number;
    turn?: boolean;
}

export class UpdateRotationDto {
    name?: string;
    identificacao?: number;
    queueid?: number;
    turn?: boolean;
}
