import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SettingsService } from './settings.service';
import { SettingsController } from './settings.controller';
import { Setting } from './entities/setting.entity';
import { User } from '../users/entities/user.entity';
import { TabsGuard } from '../auth/guards/tabs.guard';

@Module({
    imports: [TypeOrmModule.forFeature([Setting, User])],
    controllers: [SettingsController],
    providers: [SettingsService, TabsGuard],
    exports: [SettingsService, TabsGuard],
})
export class SettingsModule { }
