import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { GosacWebhookGuard } from './gosac-webhook.guard';
import { isAllowedMediaUrl, parseAllowedHosts } from './media-url.util';

const ctx = (req: any) => ({ switchToHttp: () => ({ getRequest: () => req }) }) as ExecutionContext;
const guardWith = (secret: string | undefined, isProduction: boolean) =>
    new GosacWebhookGuard({ gosacWebhookSecret: secret, isProduction } as any);

describe('GosacWebhookGuard', () => {
    it('recusa tudo em produção sem segredo configurado', () => {
        expect(() => guardWith(undefined, true).canActivate(ctx({ headers: {}, query: {} }))).toThrow(UnauthorizedException);
    });

    it('recusa segredo errado ou ausente', () => {
        const g = guardWith('abc123', true);
        expect(() => g.canActivate(ctx({ headers: {}, query: {} }))).toThrow(UnauthorizedException);
        expect(() => g.canActivate(ctx({ headers: {}, query: { token: 'errado' } }))).toThrow(UnauthorizedException);
    });

    it('aceita o segredo por header, bearer ou query', () => {
        const g = guardWith('abc123', true);
        expect(g.canActivate(ctx({ headers: { 'x-webhook-secret': 'abc123' }, query: {} }))).toBe(true);
        expect(g.canActivate(ctx({ headers: { authorization: 'Bearer abc123' }, query: {} }))).toBe(true);
        expect(g.canActivate(ctx({ headers: {}, query: { token: 'abc123' } }))).toBe(true);
    });
});

describe('isAllowedMediaUrl (anti-SSRF)', () => {
    const hosts = parseAllowedHosts('https://gosac.exemplo.com.br', 'cdn.exemplo.com');

    it('permite apenas hosts da lista', () => {
        expect(isAllowedMediaUrl('https://gosac.exemplo.com.br/media/a.png', hosts)).toBe(true);
        expect(isAllowedMediaUrl('https://cdn.exemplo.com/a.png', hosts)).toBe(true);
        expect(isAllowedMediaUrl('https://atacante.com/a.png', hosts)).toBe(false);
        expect(isAllowedMediaUrl('http://169.254.169.254/latest/meta-data', hosts)).toBe(false);
        expect(isAllowedMediaUrl('https://gosac.exemplo.com.br.atacante.com/a', hosts)).toBe(false);
    });

    it('rejeita protocolos não-http e URLs inválidas', () => {
        expect(isAllowedMediaUrl('file:///etc/passwd', hosts)).toBe(false);
        expect(isAllowedMediaUrl('não é url', hosts)).toBe(false);
    });
});
