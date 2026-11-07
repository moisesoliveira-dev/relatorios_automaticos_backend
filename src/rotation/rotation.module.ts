import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Rotation } from './entities/rotation.entity';
import { RotationService } from './rotation.service';
import { RotationController } from './rotation.controller';
import { GosacModule } from '../gosac/gosac.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
    imports: [TypeOrmModule.forFeature([Rotation]), GosacModule, SettingsModule],
    controllers: [RotationController],
    providers: [RotationService],
})
export class RotationModule { }
