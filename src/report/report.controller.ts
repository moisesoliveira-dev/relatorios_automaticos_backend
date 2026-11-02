import { Controller, Post, Body, Get, Query, Res, HttpStatus, UseGuards, BadRequestException, Req } from '@nestjs/common';
import type { Response, Request } from 'express';
import { ReportService } from './report.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TabsGuard } from '../auth/guards/tabs.guard';
import { Tabs } from '../auth/decorators/tabs.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { IsEmail, IsInt, IsOptional, IsString, IsBoolean, Min, Max, Matches } from 'class-validator';
import { Type } from 'class-transformer';

export class SendReportDto {
    @IsOptional()
    @IsEmail({}, { message: 'Email inválido' })
    email?: string;

    @IsOptional()
    @IsString()
    status?: string;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(5000)
    limit?: number;

    @IsOptional()
    @IsString()
    @Matches(/^\d{4}-\d{2}-\d{2}/, { message: 'startDate inválida' })
    startDate?: string;

    @IsOptional()
    @IsString()
    @Matches(/^\d{4}-\d{2}-\d{2}/, { message: 'endDate inválida' })
    endDate?: string;

    @IsOptional()
    @IsBoolean()
    useFixedEmails?: boolean;

    @IsOptional()
    @IsBoolean()
    sendToFixed?: boolean;
}

@Controller('report')
@UseGuards(JwtAuthGuard, TabsGuard)
@Tabs('reports')
export class ReportController {
    constructor(private readonly reportService: ReportService) { }

    @Post('generate-and-send')
    async generateAndSendReport(
        @Body() dto: SendReportDto,
        @CurrentUser() user: any,
    ) {
        // Valida se pelo menos um destino foi fornecido
        const hasEmail = dto.email && dto.email.trim() !== '';
        const usesFixed = dto.sendToFixed === true || dto.useFixedEmails === true;

        if (!hasEmail && !usesFixed) {
                throw new BadRequestException('Informe um email ou ative o envio para emails fixos');
        }

        // Valida formato do email se fornecido
        if (hasEmail) {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(dto.email!)) {
                throw new BadRequestException('Email inválido');
            }
        }

        const result = await this.reportService.generateAndSendReport(
            hasEmail ? dto.email!.trim() : null,
            dto.status,
            dto.limit,
            dto.startDate,
            dto.endDate,
            user?.sub,
            usesFixed,
        );

        return {
            success: true,
            message: 'Relatório gerado e enviado com sucesso!',
            ...result,
        };
    }

    @Get('executions')
    async getExecutions(
        @Query('reportId') reportId: string,
        @Query('limit') limit: string,
    ) {
        return this.reportService.getReportExecutions(
            reportId,
            limit ? Math.min(Math.max(parseInt(limit) || 20, 1), 200) : 20,
        );
    }

    @Get('download')
    async downloadReport(
        @Query('status') status: string,
        @Query('limit') limit: string,
        @Query('startDate') startDate: string,
        @Query('endDate') endDate: string,
        @Res() res: Response
    ) {
        const csvContent = await this.reportService.generateReportCsv(
            status,
            limit ? Math.min(Math.max(parseInt(limit) || 1, 1), 5000) : undefined,
            startDate,
            endDate
        );

        const now = new Date();
        const filename = `relatorio_ocorrencias_${now.toISOString().split('T')[0]}.csv`;

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.status(HttpStatus.OK).send(csvContent);
    }

    @Get('download-excel')
    async downloadExcel(
        @Query('status') status: string,
        @Query('limit') limit: string,
        @Query('startDate') startDate: string,
        @Query('endDate') endDate: string,
        @Res() res: Response
    ) {
        const excelBuffer = await this.reportService.generateReportExcel(
            status,
            limit ? Math.min(Math.max(parseInt(limit) || 1, 1), 5000) : undefined,
            startDate,
            endDate
        );

        const now = new Date();
        const filename = `relatorio_ocorrencias_${now.toISOString().split('T')[0]}.xlsx`;

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.status(HttpStatus.OK).send(excelBuffer);
    }

    @Get('preview')
    async previewReport(
        @Query('status') status: string,
        @Query('page') page: string,
        @Query('size') size: string,
        @Query('startDate') startDate: string,
        @Query('endDate') endDate: string,
    ) {
        const result = await this.reportService.previewReport(
            status,
            page ? Math.max(parseInt(page) || 0, 0) : 0,
            size ? Math.min(Math.max(parseInt(size) || 10, 1), 100) : 10,
            startDate,
            endDate
        );

        return {
            success: true,
            ...result,
        };
    }

    @Get('health')
    healthCheck() {
        return {
            status: 'ok',
            timestamp: new Date().toISOString(),
        };
    }
}
