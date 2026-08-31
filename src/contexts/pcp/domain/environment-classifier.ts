import { PcpAreaKey } from './pcp.types';

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatEnvironmentDisplayName(rawName: string): string {
  const normalized = normalizeText(rawName);

  if (/^wc\b/.test(normalized) || /^dormitorio\b/.test(normalized) || /^dorm\b/.test(normalized)) {
    const parts = rawName.trim().split(/\s+/);
    if (parts.length >= 2) {
      const personFirst = parts[1];
      const type = /^wc\b/.test(normalized)
        ? 'WC'
        : /^dorm\s*master\b/.test(normalized) || /^dormitorio\s*master\b/.test(normalized)
          ? 'Dorm Master'
          : 'Dorm';
      if (type === 'Dorm Master') return 'Dorm Master';
      return `${type} ${personFirst}`;
    }
  }

  return rawName.trim();
}

function matchArea(rawName: string): PcpAreaKey | null {
  const n = normalizeText(rawName);

  // --- Áreas molhadas ---
  if (n.includes('despensa')) return 'molhada';
  if (n.includes('cozinha')) return 'molhada';
  if (n.includes('area de servico') || n.includes('area servico') || n.includes('lavanderia')) return 'molhada';
  if (n.includes('gourmet')) return 'molhada';
  if (n.includes('lavabo')) return 'molhada';
  if (n.includes('varanda')) return 'molhada';
  if (/^wc\b/.test(n) || n.startsWith('wc ') || n === 'wc') return 'molhada';

  // --- Áreas íntimas (mais específicas primeiro) ---
  if (n.includes('circulacao intima')) return 'intima';
  if (n.includes('escritorio privativo')) return 'intima';
  if (n.includes('sala intima')) return 'intima';
  if (n.includes('home intimo')) return 'intima';
  if (n.includes('hall dos dormitorios') || n.includes('hall dormitorios')) return 'intima';
  if (n.includes('closet')) return 'intima';
  if (n.includes('rouparia')) return 'intima';
  if (n.includes('dorm master') || n.includes('dormitorio master') || n.includes('suite master')) return 'intima';
  if (n.includes('hall intimo')) return 'intima';
  if (n.includes('circulacao') && !n.includes('social')) return 'intima';
  if (/^dorm\b/.test(n) || /^dormitorio\b/.test(n) || n.startsWith('dorm ') || n.startsWith('dormitorio ')) {
    return 'intima';
  }

  // --- Áreas sociais (mais específicas primeiro) ---
  if (n.includes('circulacao social')) return 'social';
  if (n.includes('sala de jantar') || n === 'sala jantar') return 'social';
  if (n.includes('sala de estar') || n === 'sala estar') return 'social';
  if (n.includes('sala de jogos')) return 'social';
  if (n.includes('sala de tv')) return 'social';
  if (n.includes('home theater') || n.includes('home theatre') || n.includes('cinema')) return 'social';
  if (n.includes('hall de entrada') || n.includes('hall entrada')) return 'social';
  if (n.includes('adega')) return 'social';
  if (n === 'bar' || n.startsWith('bar ') || /\bbar\b/.test(n)) return 'social';
  if (n.includes('living')) return 'social';
  if (n.includes('biblioteca')) return 'social';
  if (n.includes('brinquedoteca')) return 'social';
  if (n.includes('escritorio')) return 'social';

  return null;
}

/** Domain service: classifica ambientes em áreas PCP (regra de negócio pura). */
export class EnvironmentClassifier {
  classify(items: Array<{ name?: string; description?: string; title?: string }>): Record<PcpAreaKey, string[]> & { unclassified: string[] } {
    const result: Record<PcpAreaKey, string[]> & { unclassified: string[] } = {
      molhada: [],
      intima: [],
      social: [],
      unclassified: [],
    };

    for (const item of items) {
      const rawName = String(item?.name || item?.description || item?.title || '').trim();
      if (!rawName) continue;

      const displayName = formatEnvironmentDisplayName(rawName);
      const area = matchArea(rawName);
      if (area) {
        result[area].push(displayName);
      } else {
        result.unclassified.push(displayName);
      }
    }

    return result;
  }
}
