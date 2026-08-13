import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TabsGuard } from '../auth/guards/tabs.guard';
import { Tabs } from '../auth/decorators/tabs.decorator';
import { JobService } from './job.service';
import { CreateJobDto, RunCodeJobNowDto, UpdateJobDto } from './dto/job.dto';

@Controller('jobs')
@UseGuards(JwtAuthGuard, TabsGuard)
@Tabs('jobs')
export class JobController {
    constructor(private readonly jobService: JobService) { }

    @Get('code')
    getCodeJobs() {
        return this.jobService.getCodeJobs();
    }

    @Get('code/:id/logs')
    getCodeJobLogs(
        @Param('id') id: string,
        @Query('limit') limit?: string,
    ) {
        const parsedLimit = Number(limit || '200');
        return this.jobService.getCodeJobLogs(id, Number.isFinite(parsedLimit) ? parsedLimit : 200);
    }

    @Delete('code/:id/logs')
    clearCodeJobLogs(@Param('id') id: string) {
        return this.jobService.clearCodeJobLogs(id);
    }

    @Post('code/:id/start')
    startCodeJob(@Param('id') id: string) {
        return this.jobService.startCodeJob(id);
    }

    @Post('code/:id/stop')
    stopCodeJob(@Param('id') id: string) {
        return this.jobService.stopCodeJob(id);
    }

    @Post('code/:id/run')
    runCodeJobNow(
        @Param('id') id: string,
        @Body() runCodeJobNowDto: RunCodeJobNowDto,
    ) {
        return this.jobService.runCodeJobNow(id, runCodeJobNowDto);
    }

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
