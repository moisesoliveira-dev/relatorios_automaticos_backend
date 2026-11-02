/**
 * Defesa contra SSRF no download de mídia do webhook:
 * só aceita http(s) e hosts explicitamente permitidos (host do GOSAC + extras configurados).
 */
export function parseAllowedHosts(baseUrl: string | undefined, extraHosts: string | undefined): string[] {
    const hosts = new Set<string>();
    if (baseUrl) {
        try {
            hosts.add(new URL(baseUrl).hostname.toLowerCase());
        } catch {
            /* baseUrl inválida: ignora */
        }
    }
    (extraHosts ?? '')
        .split(',')
        .map((h) => h.trim().toLowerCase())
        .filter(Boolean)
        .forEach((h) => hosts.add(h));
    return [...hosts];
}

export function isAllowedMediaUrl(rawUrl: string, allowedHosts: string[]): boolean {
    try {
        const url = new URL(rawUrl);
        if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
        return allowedHosts.includes(url.hostname.toLowerCase());
    } catch {
        return false;
    }
}
