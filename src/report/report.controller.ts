import { Controller, Post, Body, Get, Query, Res, HttpStatus, UseGuards, BadRequestException, Req } from '@nestjs/common';
import type { Response, Request } from 'express';
import { ReportService } from './report.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { IsEmail, IsNotEmpty, IsOptional, IsString, IsBoolean } from 'class-validator';

export class SendReportDto {
    @IsOptional()
    @IsEmail({}, { message: 'Email inválido' })
    email?: string;

    @IsOptional()
    @IsString()
    status?: string;

    @IsOptional()
    limit?: number;

    @IsOptional()
    @IsString()
    startDate?: string;

    @IsOptional()
    @IsString()
    endDate?: string;

    @IsOptional()
    @IsBoolean()
    useFixedEmails?: boolean;

    @IsOptional()
    @IsBoolean()
    sendToFixed?: boolean;
}

@Controller('report')
@UseGuards(JwtAuthGuard)
export class ReportController {
    constructor(private readonly reportService: ReportService) { }

    @Post('generate-and-send')
    async generateAndSendReport(
        @Body() dto: SendReportDto,
        @CurrentUser() user: any,
    ) {
        console.log('📥 Body recebido:', JSON.stringify(dto));
        console.log('📥 Usuário:', user?.id);

        // Valida se pelo menos um destino foi fornecido
        const hasEmail = dto.email && dto.email.trim() !== '';
        const usesFixed = dto.sendToFixed === true || dto.useFixedEmails === true;

        if (!hasEmail && !usesFixed) {
            console.error('❌ Nenhum destino fornecido');
            throw new BadRequestException('Informe um email ou ative o envio para emails fixos');
        }

        // Valida formato do email se fornecido
        if (hasEmail) {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(dto.email!)) {
                console.error('❌ Email com formato inválido:', dto.email);
                throw new BadRequestException('Email inválido');
            }
        }

        console.log('✅ Processando envio...');

        const result = await this.reportService.generateAndSendReport(
            hasEmail ? dto.email!.trim() : null,
            dto.status,
            dto.limit,
            dto.startDate,
            dto.endDate,
            user?.id,
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
            limit ? parseInt(limit) : 20,
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
            limit ? parseInt(limit) : undefined,
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
            limit ? parseInt(limit) : undefined,
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
            page ? parseInt(page) : 0,
            size ? parseInt(size) : 10,
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
