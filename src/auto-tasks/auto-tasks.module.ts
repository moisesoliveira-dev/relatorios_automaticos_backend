import { Module } from '@nestjs/common';
import { PonttaModule } from '../pontta/pontta.module';
import { AutoTasksDatabaseService } from './auto-tasks-database.service';
import { AutoTasksService } from './auto-tasks.service';

@Module({
  imports: [PonttaModule],
  providers: [AutoTasksDatabaseService, AutoTasksService],
  exports: [AutoTasksService],
})
export class AutoTasksModule {}
