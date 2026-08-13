import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Rotation } from './entities/rotation.entity';
import { PonttaRotation } from './entities/pontta-rotation.entity';
import { RotationService } from './rotation.service';
import { RotationController } from './rotation.controller';
import { PonttaRotationService } from './pontta-rotation.service';
import { PonttaRotationController } from './pontta-rotation.controller';
import { GosacModule } from '../gosac/gosac.module';
import { PonttaModule } from '../pontta/pontta.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
    imports: [
        TypeOrmModule.forFeature([Rotation, PonttaRotation], 'rotation'),
        GosacModule,
        PonttaModule,
        SettingsModule,
    ],
    controllers: [RotationController, PonttaRotationController],
    providers: [RotationService, PonttaRotationService],
})
export class RotationModule { }
