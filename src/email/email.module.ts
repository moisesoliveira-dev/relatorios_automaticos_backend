import { Module } from '@nestjs/common';
import { EmailService } from './email.service';
import { SettingsModule } from '../settings/settings.module';

@Module({
    imports: [SettingsModule],
    providers: [EmailService],
    exports: [EmailService],
})
export class EmailModule { }
