export interface SlotOption {
  /** Início em UTC (ISO). */
  startUtc: string;
  endUtc: string;
  /** Texto exibido ao cliente, ex.: "04/07/2025 07:00 - 09:00" (horário de Manaus). */
  label: string;
}

/** Manaus não tem horário de verão: UTC-4 fixo. */
export const MANAUS_OFFSET_MS = 4 * 60 * 60 * 1000;

export interface BusyInterval {
  /** Instantes reais (UTC). */
  start: Date;
  end: Date;
}

export interface SlotRules {
  /** Quantos dias úteis (segunda a sexta) percorrer. */
  weekdays: number;
  maxOptions: number;
  /** Hora (Manaus) a partir da qual "hoje" não é mais oferecido. */
  lastHourToday: number;
  /** Antecedência mínima para um horário de hoje ser oferecido. */
  minLeadMinutes: number;
}

export const DEFAULT_SLOT_RULES: SlotRules = {
  weekdays: 5,
  maxOptions: 8,
  lastHourToday: 17,
  minLeadMinutes: 60,
};

const MORNING = { start: 7, end: 12 };
const AFTERNOON = { start: 13, end: 17 };

const pad = (n: number) => String(n).padStart(2, '0');

/** Converte um instante real para um Date cujos campos UTC representam a hora local de Manaus. */
const toManaus = (d: Date) => new Date(d.getTime() - MANAUS_OFFSET_MS);
const fromManaus = (d: Date) => new Date(d.getTime() + MANAUS_OFFSET_MS);

const overlaps = (aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) =>
  aStart < bEnd && bStart < aEnd;

function wall(day: Date, hour: number): Date {
  return new Date(
    Date.UTC(
      day.getUTCFullYear(),
      day.getUTCMonth(),
      day.getUTCDate(),
      hour,
      0,
      0,
      0,
    ),
  );
}

function formatLabel(startWall: Date, endWall: Date): string {
  const d = `${pad(startWall.getUTCDate())}/${pad(startWall.getUTCMonth() + 1)}/${startWall.getUTCFullYear()}`;
  return `${d} ${pad(startWall.getUTCHours())}:00 - ${pad(endWall.getUTCHours())}:00`;
}

/**
 * Regras de oferta de horários de medição (herdadas do fluxo n8n, com correções):
 *  - segunda a sexta, 5 dias úteis; dia sem vaga também conta como um dos 5;
 *  - manhã = 07–12 e tarde = 13–17; se qualquer compromisso tocar o período, ele inteiro fica indisponível;
 *  - período livre gera 2 horários de 2 h (07–09, 09–11 / 13–15, 15–17);
 *  - hoje só é oferecido antes das 17h e horários já passados (ou com menos de `minLeadMinutes`) são descartados;
 *  - atravessa a virada de mês normalmente (o n8n só olhava até o fim do mês corrente).
 */
export function computeSlots(
  now: Date,
  busy: BusyInterval[],
  rules: SlotRules = DEFAULT_SLOT_RULES,
): SlotOption[] {
  const nowWall = toManaus(now);
  const busyWall = busy.map((b) => ({
    start: toManaus(b.start),
    end: toManaus(b.end),
  }));
  const earliest = new Date(now.getTime() + rules.minLeadMinutes * 60_000);

  const options: SlotOption[] = [];
  const cursor = new Date(
    Date.UTC(
      nowWall.getUTCFullYear(),
      nowWall.getUTCMonth(),
      nowWall.getUTCDate(),
    ),
  );
  let countedWeekdays = 0;
  let safety = 0;

  while (countedWeekdays < rules.weekdays && safety++ < 60) {
    const dow = cursor.getUTCDay();
    const isToday =
      cursor.getTime() ===
      Date.UTC(
        nowWall.getUTCFullYear(),
        nowWall.getUTCMonth(),
        nowWall.getUTCDate(),
      );

    if (isToday && nowWall.getUTCHours() >= rules.lastHourToday) {
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      continue;
    }

    if (dow >= 1 && dow <= 5) {
      const dayEnd = new Date(cursor);
      dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
      const today = busyWall.filter((e) =>
        overlaps(e.start, e.end, cursor, dayEnd),
      );

      const periodBusy = (p: { start: number; end: number }) =>
        today.some((e) =>
          overlaps(e.start, e.end, wall(cursor, p.start), wall(cursor, p.end)),
        );

      const ranges: Array<[number, number]> = [];
      if (!periodBusy(MORNING)) ranges.push([7, 9], [9, 11]);
      if (!periodBusy(AFTERNOON)) ranges.push([13, 15], [15, 17]);

      for (const [h1, h2] of ranges) {
        const startWall = wall(cursor, h1);
        const endWall = wall(cursor, h2);
        const startUtc = fromManaus(startWall);
        if (startUtc < earliest) continue;
        options.push({
          startUtc: startUtc.toISOString(),
          endUtc: fromManaus(endWall).toISOString(),
          label: formatLabel(startWall, endWall),
        });
      }
      countedWeekdays++;
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return options.slice(0, rules.maxOptions);
}

/** Texto da lista de horários: linhas ímpares em negrito (igual ao n8n) + opção 9. */
export function renderSlotList(template: string, slots: SlotOption[]): string {
  const lines = slots
    .slice(0, 8)
    .map((s, i) =>
      i % 2 === 0 ? `*${i + 1} - ${s.label}*` : `${i + 1} - ${s.label}`,
    );
  const block = [...lines, '*9 - Nenhum desses horários.*'].join('\n');
  // O modelo original lista 1..8 fixos + a linha do 9; trocamos o bloco inteiro pelo dinâmico.
  return template.replace(
    /\*1 - \{horario1\}\*[\s\S]*?\*9 - Nenhum desses horários\.\*/,
    block,
  );
}
