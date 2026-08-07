export class CreateRotationDto {
    id: string;
    name: string;
    identificacao: number;
    queueid: number;
}

export class UpdateRotationDto {
    name?: string;
    identificacao?: number;
    queueid?: number;
}
