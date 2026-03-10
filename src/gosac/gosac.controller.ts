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
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';
import { GosacService } from './gosac.service';
import { CreateGosacGroupDto, UpdateGosacGroupDto, LinkSalesOrderDto } from './dto/gosac.dto';
import { MontadorPdfService } from './montador-pdf.service';

@Controller('gosac')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.MASTER, UserRole.ADMIN)
export class GosacController {
    constructor(
        private readonly gosacService: GosacService,
        private readonly montadorPdfService: MontadorPdfService,
    ) { }

    /**
     * GET /api/gosac/tickets/search?q=Anexo
     * Pesquisa tickets no GOSAC
     */
    @Get('tickets/search')
    async searchTickets(@Query('q') q: string) {
        if (!q || q.trim().length === 0) {
            return { tickets: [] };
        }
        const tickets = await this.gosacService.searchTickets(q);
        return { tickets };
    }

    /**
     * GET /api/gosac/groups
     * Lista todos os grupos cadastrados
     */
    @Get('groups')
    async findAllGroups() {
        return this.gosacService.findAllGroups();
    }

    /**
     * GET /api/gosac/groups/:id
     * Busca um grupo por ID
     */
    @Get('groups/:id')
    async findGroupById(@Param('id') id: string) {
        return this.gosacService.findGroupById(id);
    }

    /**
     * POST /api/gosac/groups
     * Cadastra uma associação grupo GOSAC ↔ Pontta
     */
    @Post('groups')
    async createGroup(@Body() dto: CreateGosacGroupDto) {
        return this.gosacService.createGroup(dto);
    }

    /**
     * PATCH /api/gosac/groups/:id
     * Atualiza um grupo
     */
    @Patch('groups/:id')
    async updateGroup(@Param('id') id: string, @Body() dto: UpdateGosacGroupDto) {
        return this.gosacService.updateGroup(id, dto);
    }

    /**
     * PATCH /api/gosac/groups/:id/toggle
     * Ativa/desativa um grupo
     */
    @Patch('groups/:id/toggle')
    async toggleGroup(@Param('id') id: string) {
        return this.gosacService.toggleGroup(id);
    }

    /**
     * DELETE /api/gosac/groups/:id
     * Remove um grupo
     */
    @Delete('groups/:id')
    async deleteGroup(@Param('id') id: string) {
        return this.gosacService.deleteGroup(id);
    }

    // ===== Pedidos de Venda Pontta =====

    /**
     * GET /api/gosac/sales-orders/search?q=IGOR
     * Pesquisa pedidos de venda no Pontta
     */
    @Get('sales-orders/search')
    async searchSalesOrders(@Query('q') q: string) {
        if (!q || q.trim().length === 0) {
            return [];
        }
        return this.gosacService.searchSalesOrders(q);
    }

    /**
     * POST /api/gosac/groups/:id/sales-orders
     * Associa um pedido de venda a um grupo
     */
    @Post('groups/:id/sales-orders')
    async linkSalesOrder(@Param('id') id: string, @Body() dto: LinkSalesOrderDto) {
        return this.gosacService.linkSalesOrder(id, dto.ponttaId, dto.code, dto.customerName, dto.occurrenceTitle);
    }

    /**
     * DELETE /api/gosac/groups/:groupId/sales-orders/:salesOrderId
     * Remove associação entre pedido de venda e grupo
     */
    @Delete('groups/:groupId/sales-orders/:salesOrderId')
    async unlinkSalesOrder(
        @Param('groupId') groupId: string,
        @Param('salesOrderId') salesOrderId: string,
    ) {
        await this.gosacService.unlinkSalesOrder(groupId, salesOrderId);
        return { success: true };
    }

    // ===== Orçamentos (Proposals) Pontta =====

    /**
     * GET /api/gosac/proposals
     * Lista orçamentos ativos no Pontta (primeiros 10)
     */
    @Get('proposals')
    async getProposals(@Query('q') q?: string) {
        return this.gosacService.getProposals(q);
    }

    /**
     * GET /api/gosac/proposals/:id/items
     * Busca os ambientes (itens) de um orçamento
     */
    @Get('proposals/:id/items')
    async getProposalItems(@Param('id') id: string) {
        return this.gosacService.getProposalItems(id);
    }

    /**
     * POST /api/gosac/proposals/montador-pdf
     * Gera PDF de pagamento do montador para um ambiente
     */
    @Post('proposals/montador-pdf')
    async generateMontadorPdf(
        @Body() body: {
            proposalCode: string;
            customerName: string;
            environmentName: string;
            environmentValue: number;
            discount: number;
            deliveryDate?: string;
            assemblyStartDate?: string;
            assemblyEndDate?: string;
        },
        @Res() res: Response,
    ) {
        const montadorRate = 0.07;
        const discountedValue = body.environmentValue * (1 - (body.discount || 0) / 100);
        const montadorPayment = discountedValue * montadorRate;

        const pdfBuffer = await this.montadorPdfService.generatePdf({
            proposalCode: body.proposalCode,
            customerName: body.customerName,
            environmentName: body.environmentName,
            environmentValue: body.environmentValue,
            discount: body.discount || 0,
            discountedValue,
            montadorRate,
            montadorPayment,
            deliveryDate: body.deliveryDate || '',
            assemblyStartDate: body.assemblyStartDate || '',
            assemblyEndDate: body.assemblyEndDate || '',
        });

        const sanitizedEnv = body.environmentName.replace(/[^a-zA-Z0-9À-ú\s_-]/g, '').trim();
        const filename = `Pagamento_Montador_${body.proposalCode}_${sanitizedEnv}.pdf`;

        res.set({
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="${filename}"`,
            'Content-Length': pdfBuffer.length,
        });
        res.end(pdfBuffer);
    }
}
