import { Module } from '@nestjs/common';
import { PonttaService } from './pontta.service';

@Module({
    providers: [PonttaService],
    exports: [PonttaService],
})
export class PonttaModule { }
