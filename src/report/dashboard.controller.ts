import {
    Controller,
    Get,
    Post,
    Put,
    Delete,
    Body,
    Param,
    Query,
    UseGuards,
    ParseUUIDPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { DashboardService } from './dashboard.service';
import { ReportService } from './report.service';
import { CreateReportEmailDto, UpdateReportEmailDto } from './dto/report.dto';

@Controller('dashboard')
@UseGuards(JwtAuthGuard)
export class DashboardController {
    constructor(
        private readonly dashboardService: DashboardService,
        private readonly reportService: ReportService,
    ) { }

    // ===== ESTATÍSTICAS DO DASHBOARD =====

    @Get('stats')
    async getStats() {
        return this.dashboardService.getDashboardStats();
    }

    @Get('status')
    async getSystemStatus() {
        return this.dashboardService.getSystemStatus();
    }

    @Get('recent-reports')
    async getRecentReports() {
        return this.reportService.getRecentExecutions(5);
    }

    // ===== EMAILS FIXOS =====

    @Get('emails')
    async getAllEmails() {
        return this.dashboardService.findAllReportEmails();
    }

    @Get('emails/active')
    async getActiveEmails(@Query('type') type: string = 'occurrences') {
        return this.dashboardService.findActiveReportEmails(type);
    }

    @Get('emails/:id')
    async getEmailById(@Param('id', ParseUUIDPipe) id: string) {
        return this.dashboardService.findReportEmailById(id);
    }

    @Post('emails')
    async createEmail(@Body() dto: CreateReportEmailDto) {
        return this.dashboardService.createReportEmail(dto);
    }

    @Put('emails/:id')
    async updateEmail(
        @Param('id', ParseUUIDPipe) id: string,
        @Body() dto: UpdateReportEmailDto,
    ) {
        return this.dashboardService.updateReportEmail(id, dto);
    }

    @Delete('emails/:id')
    async deleteEmail(@Param('id', ParseUUIDPipe) id: string) {
        await this.dashboardService.deleteReportEmail(id);
        return { success: true, message: 'Email removido com sucesso' };
    }

    @Put('emails/:id/toggle')
    async toggleEmail(@Param('id', ParseUUIDPipe) id: string) {
        return this.dashboardService.toggleReportEmail(id);
    }
}
