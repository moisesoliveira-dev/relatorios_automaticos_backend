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
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';
import { GosacService } from './gosac.service';
import { CreateGosacGroupDto, UpdateGosacGroupDto, LinkSalesOrderDto } from './dto/gosac.dto';
import { MontadorPdfService } from './montador-pdf.service';
import { GoogleDriveService } from './google-drive.service';

@Controller('gosac')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.MASTER, UserRole.ADMIN)
export class GosacController {
    constructor(
        private readonly gosacService: GosacService,
        private readonly montadorPdfService: MontadorPdfService,
        private readonly googleDriveService: GoogleDriveService,
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
    async searchSalesOrders(@Query('q') q?: string) {
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
     * POST /api/gosac/logo
     * Atualiza o logotipo da empresa usado nos PDFs
     */
    @Post('logo')
    @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
    async uploadLogo(@UploadedFile() file: Express.Multer.File) {
        if (!file) throw new Error('Nenhum arquivo enviado');
        const allowed = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
        if (!allowed.includes(file.mimetype)) throw new Error('Formato inválido. Use PNG, JPG ou WebP.');
        await this.montadorPdfService.updateLogo(file.buffer, file.mimetype);
        return { message: 'Logo atualizado com sucesso' };
    }

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
     * GET /api/gosac/sales-orders/:id/items
     * Busca os ambientes (itens) de um pedido de venda
     */
    @Get('sales-orders/:id/items')
    async getSalesOrderItems(@Param('id') id: string) {
        return this.gosacService.getSalesOrderItems(id);
    }

    /**
     * POST /api/gosac/proposals/montador-pdf
     * Gera PDF de pagamento do montador para um ambiente.
     * Se sendToDrive=true e o Drive estiver configurado, também faz upload.
     */
    @Post('proposals/montador-pdf')
    async generateMontadorPdfFromProposal(
        @Body() body: {
            proposalCode: string;
            customerName: string;
            environmentName: string;
            environmentValue: number;
            ponttaDiscount?: number;
            additionalDiscount?: number;
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
    async generateMontadorPdfFromSalesOrder(
        @Body() body: {
            proposalCode: string;
            customerName: string;
            environmentName: string;
            environmentValue: number;
            ponttaDiscount?: number;
            additionalDiscount?: number;
            deliveryDate?: string;
            assemblyStartDate?: string;
            assemblyEndDate?: string;
            sendToDrive?: boolean;
        },
        @Res() res: Response,
    ) {
        return this.generateMontadorPdf(body, res);
    }

    private async generateMontadorPdf(
        body: {
            proposalCode: string;
            customerName: string;
            environmentName: string;
            environmentValue: number;
            ponttaDiscount?: number;
            additionalDiscount?: number;
            deliveryDate?: string;
            assemblyStartDate?: string;
            assemblyEndDate?: string;
            sendToDrive?: boolean;
        },
        res: Response,
    ) {
        const ponttaDiscount = body.ponttaDiscount || 0;
        const additionalDiscount = body.additionalDiscount ?? 6;
        const montadorRate = 0.07;
        // Valor original no PDF já considera o desconto vindo do Pontta
        const originalValue = body.environmentValue * (1 - ponttaDiscount / 100);
        // Desconto aplicado na empresa (fixo) sobre o valor já descontado do Pontta
        const discountedValue = originalValue * (1 - additionalDiscount / 100);
        const montadorPayment = discountedValue * montadorRate;

        const pdfBuffer = await this.montadorPdfService.generatePdf({
            proposalCode: body.proposalCode,
            customerName: body.customerName,
            environmentName: body.environmentName,
            environmentValue: originalValue,
            discount: additionalDiscount,
            discountedValue,
            montadorRate,
            montadorPayment,
            deliveryDate: body.deliveryDate || '',
            assemblyStartDate: body.assemblyStartDate || '',
            assemblyEndDate: body.assemblyEndDate || '',
        });

        const filename = this.googleDriveService.sanitizePdfFilename(
            body.customerName,
            body.environmentName,
        );

        // Upload to Google Drive if requested and enabled
        if (body.sendToDrive) {
            try {
                const driveEnabled = await this.googleDriveService.isEnabled();
                if (!driveEnabled) {
                    res.set('X-Drive-Error', 'Google Drive desabilitado. Ative em Configurações > GOOGLE_DRIVE_ENABLED.');
                } else {
                    const monthFolderId = await this.googleDriveService.ensureMonthFolderFromSettings();
                    if (!monthFolderId) {
                        res.set('X-Drive-Error', 'ID da pasta raiz não configurado. Preencha GOOGLE_DRIVE_FOLDER_ID nas Configurações.');
                    } else {
                        await this.googleDriveService.uploadPdf(pdfBuffer, filename, monthFolderId);
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
        res.end(pdfBuffer);
    }
}
