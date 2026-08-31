import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PonttaModule } from '../pontta/pontta.module';
import { AutoTasksDatabaseService } from './auto-tasks-database.service';
import { AutoTasksProcessedOrderService } from './auto-tasks-processed-order.service';
import { AutoTasksService } from './auto-tasks.service';
import { AutoTaskProcessedOrder } from './entities/auto-task-processed-order.entity';

@Module({
  imports: [
    PonttaModule,
    TypeOrmModule.forFeature([AutoTaskProcessedOrder]),
  ],
  providers: [AutoTasksDatabaseService, AutoTasksProcessedOrderService, AutoTasksService],
  exports: [AutoTasksService],
})
export class AutoTasksModule {}
