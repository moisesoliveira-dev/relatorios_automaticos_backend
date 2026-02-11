import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JobService } from './job.service';
import { CreateJobDto, UpdateJobDto } from './dto/job.dto';

@Controller('jobs')
@UseGuards(JwtAuthGuard)
export class JobController {
    constructor(private readonly jobService: JobService) { }

    @Post()
    create(@Body() createJobDto: CreateJobDto) {
        return this.jobService.createJob(createJobDto);
    }

    @Get()
    findAll() {
        return this.jobService.findAll();
    }

    @Get(':id')
    findOne(@Param('id') id: string) {
        return this.jobService.findOne(id);
    }

    @Put(':id')
    update(@Param('id') id: string, @Body() updateJobDto: UpdateJobDto) {
        return this.jobService.update(id, updateJobDto);
    }

    @Put(':id/toggle')
    toggle(@Param('id') id: string) {
        return this.jobService.toggleActive(id);
    }

    @Delete(':id')
    delete(@Param('id') id: string) {
        return this.jobService.delete(id);
    }
}
