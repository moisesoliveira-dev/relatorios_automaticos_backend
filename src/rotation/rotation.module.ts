import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Rotation } from './entities/rotation.entity';
import { RotationService } from './rotation.service';
import { RotationController } from './rotation.controller';
import { GosacModule } from '../gosac/gosac.module';
import { PonttaModule } from '../pontta/pontta.module';

@Module({
    imports: [
        TypeOrmModule.forFeature([Rotation], 'rotation'),
        GosacModule,
        PonttaModule,
    ],
    controllers: [RotationController],
    providers: [RotationService],
})
export class RotationModule { }
