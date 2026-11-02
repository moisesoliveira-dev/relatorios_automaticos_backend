import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { AppConfigService } from '../infrastructure/config/app-config.service';

/**
 * Protege o webhook do GOSAC com um segredo compartilhado (GOSAC_WEBHOOK_SECRET).
 * Aceita o segredo em `x-webhook-secret`, `Authorization: Bearer <segredo>` ou `?token=<segredo>`
 * (a query existe porque nem todo painel de webhook permite headers customizados).
 * Em produção, sem segredo configurado, TODAS as chamadas são recusadas.
 */
@Injectable()
export class GosacWebhookGuard implements CanActivate {
    private readonly logger = new Logger(GosacWebhookGuard.name);

    constructor(private readonly appConfig: AppConfigService) { }

    canActivate(context: ExecutionContext): boolean {
        const expected = this.appConfig.gosacWebhookSecret;

        if (!expected) {
            if (this.appConfig.isProduction) {
                this.logger.error('GOSAC_WEBHOOK_SECRET não configurado — webhook recusado');
                throw new UnauthorizedException();
            }
            this.logger.warn('GOSAC_WEBHOOK_SECRET ausente — webhook liberado apenas por ser ambiente não-produtivo');
            return true;
        }

        const req = context.switchToHttp().getRequest();
        const header = req.headers['x-webhook-secret'];
        const bearer = String(req.headers['authorization'] ?? '').replace(/^Bearer\s+/i, '');
        const provided = String(
            (Array.isArray(header) ? header[0] : header) || bearer || req.query?.token || '',
        );

        const a = Buffer.from(provided);
        const b = Buffer.from(expected);
        if (a.length !== b.length || !timingSafeEqual(a, b)) {
            throw new UnauthorizedException();
        }
        return true;
    }
}
