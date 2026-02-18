import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GosacService } from './gosac.service';
import { GosacController } from './gosac.controller';
import { GosacGroup } from './entities/gosac-group.entity';

@Module({
    imports: [TypeOrmModule.forFeature([GosacGroup])],
    controllers: [GosacController],
    providers: [GosacService],
    exports: [GosacService],
})
export class GosacModule { }
