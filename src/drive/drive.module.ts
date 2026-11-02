import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { GoogleDriveService } from '../gosac/google-drive.service';

/** Isola o acesso ao Google Drive para ser usado por Gosac, Relatórios e Chatbot sem dependência circular. */
@Module({
  imports: [SettingsModule],
  providers: [GoogleDriveService],
  exports: [GoogleDriveService],
})
export class DriveModule {}
