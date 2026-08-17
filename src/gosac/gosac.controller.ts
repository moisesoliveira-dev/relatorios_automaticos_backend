import {
    Controller,
    Get,
    Post,
    Patch,
    Delete,
    Query,
    Param,
    Body,
    UseGuards,
    Res,
    UploadedFile,
    UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TabsGuard } from '../auth/guards/tabs.guard';
import { Tabs } from '../auth/decorators/tabs.decorator';
import { GosacService } from './gosac.service';
import { CreateGosacGroupDto, UpdateGosacGroupDto, LinkSalesOrderDto } from './dto/gosac.dto';
import { MontadorPdfService } from './montador-pdf.service';
import { GoogleDriveService } from './google-drive.service';
import { PcpScheduleService } from './pcp-schedule.service';

@Controller('gosac')
@UseGuards(JwtAuthGuard, TabsGuard)
export class GosacController {
    constructor(
        private readonly gosacService: GosacService,
        private readonly montadorPdfService: MontadorPdfService,
        private readonly googleDriveService: GoogleDriveService,
        private readonly pcpScheduleService: PcpScheduleService,
    ) { }

    /**
     * GET /api/gosac/tickets/search?q=Anexo
     * Pesquisa tickets no GOSAC
     */
    @Get('tickets/search')
    @Tabs('gosac-pontta/grupos')
    async searchTickets(@Query('q') q: string) {
        console.log('[GosacGruposAPI] GET /gosac/tickets/search', { q });
        if (!q || q.trim().length === 0) {
            console.log('[GosacGruposAPI] tickets/search -> query vazia');
            return { tickets: [] };
        }
        const tickets = await this.gosacService.searchTickets(q);
        console.log('[GosacGruposAPI] tickets/search -> sucesso', { total: tickets.length });
        return { tickets };
    }

    /**
     * GET /api/gosac/groups
     * Lista todos os grupos cadastrados
     */
    @Get('groups')
    @Tabs('gosac-pontta/grupos')
    async findAllGroups() {
        console.log('[GosacGruposAPI] GET /gosac/groups');
        const groups = await this.gosacService.findAllGroups();
        console.log('[GosacGruposAPI] groups -> sucesso', { total: groups.length });
        return groups;
    }

    /**
     * GET /api/gosac/groups/:id
     * Busca um grupo por ID
     */
    @Get('groups/:id')
    @Tabs('gosac-pontta/grupos')
    async findGroupById(@Param('id') id: string) {
        return this.gosacService.findGroupById(id);
    }

    /**
     * POST /api/gosac/groups
     * Cadastra uma associação grupo GOSAC ↔ Pontta
     */
    @Post('groups')
    @Tabs('gosac-pontta/grupos')
    async createGroup(@Body() dto: CreateGosacGroupDto) {
        console.log('[GosacGruposAPI] POST /gosac/groups', {
            gosacTicketId: dto?.gosacTicketId,
            gosacContactId: dto?.gosacContactId,
            gosacTicketName: dto?.gosacTicketName,
        });
        const group = await this.gosacService.createGroup(dto);
        console.log('[GosacGruposAPI] createGroup -> sucesso', { groupId: group.id });
        return group;
    }

    /**
     * PATCH /api/gosac/groups/:id
     * Atualiza um grupo
     */
    @Patch('groups/:id')
    @Tabs('gosac-pontta/grupos')
    async updateGroup(@Param('id') id: string, @Body() dto: UpdateGosacGroupDto) {
        return this.gosacService.updateGroup(id, dto);
    }

    /**
     * PATCH /api/gosac/groups/:id/toggle
     * Ativa/desativa um grupo
     */
    @Patch('groups/:id/toggle')
    @Tabs('gosac-pontta/grupos')
    async toggleGroup(@Param('id') id: string) {
        console.log('[GosacGruposAPI] PATCH /gosac/groups/:id/toggle', { id });
        const updated = await this.gosacService.toggleGroup(id);
        console.log('[GosacGruposAPI] toggleGroup -> sucesso', { id: updated.id, isActive: updated.isActive });
        return updated;
    }

    /**
     * DELETE /api/gosac/groups/:id
     * Remove um grupo
     */
    @Delete('groups/:id')
    @Tabs('gosac-pontta/grupos')
    async deleteGroup(@Param('id') id: string) {
        console.log('[GosacGruposAPI] DELETE /gosac/groups/:id', { id });
        await this.gosacService.deleteGroup(id);
        console.log('[GosacGruposAPI] deleteGroup -> sucesso', { id });
        return { success: true };
    }

    // ===== Pedidos de Venda Pontta =====

    /**
     * GET /api/gosac/sales-orders/search?q=IGOR
     * Pesquisa pedidos de venda no Pontta
     */
    @Get('sales-orders/search')
    @Tabs('gosac-pontta/grupos', 'gosac-pontta/pagamento-montador', 'gosac-pontta/pcp-operacional')
    async searchSalesOrders(@Query('q') q?: string) {
        // console.log('[MontadorAPI] GET /gosac/sales-orders/search', { q });
        const results = await this.gosacService.searchSalesOrders(q);
        // console.log('[MontadorAPI] sales-orders/search -> sucesso', { total: results.length });
        return results;
    }

    /**
     * POST /api/gosac/groups/:id/sales-orders
     * Associa um pedido de venda a um grupo
     */
    @Post('groups/:id/sales-orders')
    @Tabs('gosac-pontta/grupos')
    async linkSalesOrder(@Param('id') id: string, @Body() dto: LinkSalesOrderDto) {
        console.log('[GosacGruposAPI] POST /gosac/groups/:id/sales-orders', {
            groupId: id,
            ponttaId: dto?.ponttaId,
            code: dto?.code,
            customerName: dto?.customerName,
        });
        const result = await this.gosacService.linkSalesOrder(id, dto.ponttaId, dto.code, dto.customerName, dto.occurrenceTitle);
        console.log('[GosacGruposAPI] linkSalesOrder -> sucesso', {
            groupId: id,
            salesOrderId: result?.salesOrder?.id,
            occurrenceStatus: result?.salesOrder?.ponttaOccurrenceStatus,
        });
        return result;
    }

    /**
     * DELETE /api/gosac/groups/:groupId/sales-orders/:salesOrderId
     * Remove associação entre pedido de venda e grupo
     */
    @Delete('groups/:groupId/sales-orders/:salesOrderId')
    @Tabs('gosac-pontta/grupos')
    async unlinkSalesOrder(
        @Param('groupId') groupId: string,
        @Param('salesOrderId') salesOrderId: string,
    ) {
        console.log('[GosacGruposAPI] DELETE /gosac/groups/:groupId/sales-orders/:salesOrderId', { groupId, salesOrderId });
        await this.gosacService.unlinkSalesOrder(groupId, salesOrderId);
        console.log('[GosacGruposAPI] unlinkSalesOrder -> sucesso', { groupId, salesOrderId });
        return { success: true };
    }

    // ===== Orçamentos (Proposals) Pontta =====

    /**
     * POST /api/gosac/logo
     * Atualiza o logotipo da empresa usado nos PDFs
     */
    @Post('logo')
    @Tabs('gosac-pontta/pagamento-montador')
    @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
    async uploadLogo(@UploadedFile() file: Express.Multer.File) {
        console.log('[MontadorAPI] POST /gosac/logo', {
            fileName: file?.originalname,
            mimeType: file?.mimetype,
            size: file?.size,
        });
        if (!file) throw new Error('Nenhum arquivo enviado');
        const allowed = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
        if (!allowed.includes(file.mimetype)) throw new Error('Formato inválido. Use PNG, JPG ou WebP.');
        await this.montadorPdfService.updateLogo(file.buffer, file.mimetype);
        console.log('[MontadorAPI] uploadLogo -> sucesso');
        return { message: 'Logo atualizado com sucesso' };
    }

    /**
     * GET /api/gosac/proposals
     * Lista orçamentos ativos no Pontta (primeiros 10)
     */
    @Get('proposals')
    @Tabs('gosac-pontta/pagamento-montador')
    async getProposals(@Query('q') q?: string) {
        return this.gosacService.getProposals(q);
    }

    /**
     * GET /api/gosac/proposals/:id/items
     * Busca os ambientes (itens) de um orçamento
     */
    @Get('proposals/:id/items')
    @Tabs('gosac-pontta/pagamento-montador')
    async getProposalItems(@Param('id') id: string) {
        return this.gosacService.getProposalItems(id);
    }

    /**
     * GET /api/gosac/sales-orders/:id/items
     * Busca os ambientes (itens) de um pedido de venda
     */
    @Get('sales-orders/:id/items')
    @Tabs('gosac-pontta/pagamento-montador', 'gosac-pontta/pcp-operacional')
    async getSalesOrderItems(@Param('id') id: string) {
        console.log('[MontadorAPI] GET /gosac/sales-orders/:id/items', { id });
        const items = await this.gosacService.getSalesOrderItems(id);
        console.log('[MontadorAPI] sales-orders/:id/items -> sucesso', { id, total: items.length });
        return items;
    }

    /**
     * GET /api/gosac/pcp/schedule?from=YYYY-MM-DD&to=YYYY-MM-DD&q=
     * Agenda PCP Operacional: datas de entrega por área com resolução de conflitos.
     */
    @Get('pcp/schedule')
    @Tabs('gosac-pontta/pcp-operacional')
    async getPcpSchedule(
        @Query('from') from?: string,
        @Query('to') to?: string,
        @Query('q') q?: string,
    ) {
        return this.pcpScheduleService.getSchedule(from || '', to || '', q);
    }

    /**
     * POST /api/gosac/proposals/montador-pdf
     * Gera PDF de pagamento do montador para um ambiente.
     * Se sendToDrive=true e o Drive estiver configurado, também faz upload.
     */
    @Post('proposals/montador-pdf')
    @Tabs('gosac-pontta/pagamento-montador')
    async generateMontadorPdfFromProposal(
        @Body() body: {
            proposalCode: string;
            customerName: string;
            environmentName: string;
            environmentValue: number;
            environments?: Array<{ environmentName: string; environmentValue: number }>;
            ponttaDiscount?: number;
            additionalDiscount?: number;
            montadorPercent?: number;
            deliveryDate?: string;
            assemblyStartDate?: string;
            assemblyEndDate?: string;
            sendToDrive?: boolean;
        },
        @Res() res: Response,
    ) {
        return this.generateMontadorPdf(body, res);
    }

    /**
     * POST /api/gosac/sales-orders/montador-pdf
     * Gera PDF de pagamento do montador para um ambiente usando pedido de venda.
     */
    @Post('sales-orders/montador-pdf')
    @Tabs('gosac-pontta/pagamento-montador')
    async generateMontadorPdfFromSalesOrder(
        @Body() body: {
            proposalCode: string;
            customerName: string;
            environmentName: string;
            environmentValue: number;
            environments?: Array<{ environmentName: string; environmentValue: number }>;
            ponttaDiscount?: number;
            additionalDiscount?: number;
            montadorPercent?: number;
            deliveryDate?: string;
            assemblyStartDate?: string;
            assemblyEndDate?: string;
            sendToDrive?: boolean;
        },
        @Res() res: Response,
    ) {
        console.log('[MontadorAPI] POST /gosac/sales-orders/montador-pdf', {
            proposalCode: body?.proposalCode,
            customerName: body?.customerName,
            environmentName: body?.environmentName,
            environmentValue: body?.environmentValue,
            environmentsCount: body?.environments?.length || 0,
            sendToDrive: body?.sendToDrive,
        });
        return this.generateMontadorPdf(body, res);
    }

    private clampPercent(value: unknown, fallback: number): number {
        const n = Number(value);
        if (!Number.isFinite(n)) return fallback;
        if (n < 0) return 0;
        if (n > 100) return 100;
        return n;
    }

    private async generateMontadorPdf(
        body: {
            proposalCode: string;
            customerName: string;
            environmentName: string;
            environmentValue: number;
            environments?: Array<{ environmentName: string; environmentValue: number }>;
            ponttaDiscount?: number;
            additionalDiscount?: number;
            montadorPercent?: number;
            deliveryDate?: string;
            assemblyStartDate?: string;
            assemblyEndDate?: string;
            sendToDrive?: boolean;
        },
        res: Response,
    ) {
        console.log('[MontadorCalc] Payload bruto recebido', {
            proposalCode: body?.proposalCode,
            customerName: body?.customerName,
            environmentName: body?.environmentName,
            environmentValue: body?.environmentValue,
            environmentsCount: body?.environments?.length || 0,
            ponttaDiscount: body?.ponttaDiscount,
            additionalDiscount: body?.additionalDiscount,
            montadorPercent: body?.montadorPercent,
            deliveryDate: body?.deliveryDate,
            assemblyStartDate: body?.assemblyStartDate,
            assemblyEndDate: body?.assemblyEndDate,
            sendToDrive: body?.sendToDrive,
        });

        console.log('[MontadorAPI] generateMontadorPdf -> início', {
            proposalCode: body.proposalCode,
            customerName: body.customerName,
            environmentName: body.environmentName,
            environmentValue: body.environmentValue,
            environmentsCount: body?.environments?.length || 0,
            sendToDrive: body.sendToDrive,
        });
        const additionalDiscount = this.clampPercent(body.additionalDiscount, 15);
        const montadorPercent = this.clampPercent(body.montadorPercent, 7);
        const montadorRate = montadorPercent / 100;

        const sourceEnvironments =
            body.environments && body.environments.length > 0
                ? body.environments
                : [{ environmentName: body.environmentName, environmentValue: body.environmentValue }];

        const calculatedEnvironments = sourceEnvironments.map((env, index) => {
            const originalValue = Number(env.environmentValue) || 0;
            const discountedValue = originalValue * (1 - additionalDiscount / 100);
            const montadorPayment = discountedValue * montadorRate;
            return {
                environmentName: env.environmentName || `Ambiente ${index + 1}`,
                environmentValue: originalValue,
                discountedValue,
                montadorPayment,
            };
        });

        const totalEnvironmentValue = calculatedEnvironments.reduce((sum, env) => sum + env.environmentValue, 0);
        const totalDiscountedValue = calculatedEnvironments.reduce((sum, env) => sum + env.discountedValue, 0);
        const totalMontadorPayment = calculatedEnvironments.reduce((sum, env) => sum + env.montadorPayment, 0);

        console.log('[MontadorCalc] Cálculo detalhado', {
            environmentsCount: calculatedEnvironments.length,
            totalEnvironmentValue,
            additionalDiscountPercent: additionalDiscount,
            additionalDiscountFactor: 1 - additionalDiscount / 100,
            totalDiscountedValue,
            montadorRatePercent: montadorRate * 100,
            totalMontadorPayment,
        });

        const pdfInput = {
            proposalCode: body.proposalCode,
            customerName: body.customerName,
            environments: calculatedEnvironments,
            discount: additionalDiscount,
            montadorRate,
            totalEnvironmentValue,
            totalDiscountedValue,
            totalMontadorPayment,
            deliveryDate: body.deliveryDate || '',
            assemblyStartDate: body.assemblyStartDate || '',
            assemblyEndDate: body.assemblyEndDate || '',
        };

        console.log('[MontadorCalc] Objeto enviado para geração do PDF', pdfInput);

        const pdfBuffer = await this.montadorPdfService.generatePdf(pdfInput);

        const filenameEnvironment = calculatedEnvironments.length > 1
            ? 'Ambientes'
            : calculatedEnvironments[0]?.environmentName || body.environmentName;

        const filename = this.googleDriveService.sanitizePdfFilename(
            body.customerName,
            filenameEnvironment,
            body.proposalCode,
        );

        console.log('[MontadorAPI] generateMontadorPdf -> cálculo', {
            filename,
            environmentsCount: calculatedEnvironments.length,
            additionalDiscount,
            totalDiscountedValue,
            totalMontadorPayment,
        });

        // Upload to Google Drive if requested and enabled
        if (body.sendToDrive) {
            try {
                const driveEnabled = await this.googleDriveService.isEnabled();
                if (!driveEnabled) {
                    console.log('[MontadorAPI] Drive desabilitado');
                    res.set('X-Drive-Error', 'Google Drive desabilitado. Ative em Configurações > GOOGLE_DRIVE_ENABLED.');
                } else {
                    const monthFolderId = await this.googleDriveService.ensureMonthFolderFromSettings();
                    if (!monthFolderId) {
                        console.log('[MontadorAPI] Drive sem pasta raiz configurada');
                        res.set('X-Drive-Error', 'ID da pasta raiz não configurado. Preencha GOOGLE_DRIVE_FOLDER_ID nas Configurações.');
                    } else {
                        await this.googleDriveService.uploadPdf(pdfBuffer, filename, monthFolderId);
                        console.log('[MontadorAPI] Drive upload sucesso', { filename, monthFolderId });
                        res.set('X-Drive-Success', 'true');
                    }
                }
            } catch (driveError) {
                const msg = driveError?.message || 'Erro desconhecido';
                console.error('Erro ao enviar PDF para o Drive:', msg);
                res.set('X-Drive-Error', msg.length > 200 ? msg.slice(0, 200) + '...' : msg);
            }
        }

        res.set({
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="${filename}"`,
            'Content-Length': pdfBuffer.length,
        });
        console.log('[MontadorAPI] generateMontadorPdf -> resposta PDF', { filename, bytes: pdfBuffer.length });
        res.end(pdfBuffer);
    }
}
