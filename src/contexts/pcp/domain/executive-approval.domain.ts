const EXECUTIVE_APPROVAL_REGEX = /aprova[cç][aã]o do projeto executivo/i;

const FINISHED_STAGES = new Set(['FINISHED', 'DONE', 'COMPLETED', 'FINALIZED', 'CLOSED', 'RESOLVED']);

function parseTaskDate(raw: unknown): Date | null {
  if (!raw) return null;
  const value = typeof raw === 'object' && raw !== null && 'end' in raw
    ? (raw as { end?: unknown }).end
    : raw;
  if (!value) return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return null;
  parsed.setHours(0, 0, 0, 0);
  return parsed;
}

export function resolveTaskCompletionDate(task: Record<string, unknown>): Date | null {
  const candidates = [task?.moment, task?.schedule, task?.deadline, task?.alert, task?.createdDate];

  for (const candidate of candidates) {
    const parsed = parseTaskDate(candidate);
    if (parsed) return parsed;
  }
  return null;
}

/** Prazo calculado/agendado da tarefa (prioriza deadline). */
export function resolveTaskScheduledDate(task: Record<string, unknown>): Date | null {
  const candidates = [task?.deadline, task?.schedule, task?.moment, task?.alert];

  for (const candidate of candidates) {
    const parsed = parseTaskDate(candidate);
    if (parsed) return parsed;
  }
  return null;
}

export function isExecutiveApprovalTask(title: string): boolean {
  return EXECUTIVE_APPROVAL_REGEX.test(title.trim());
}

export function isTaskFinished(stage: unknown): boolean {
  return FINISHED_STAGES.has(String(stage || '').toUpperCase());
}

/**
 * Data base PCP = maior prazo calculado entre tarefas "Aprovação do Projeto Executivo"
 * (usa deadline, independente de estar concluída).
 */
export function resolveExecutiveApprovalDate(tasks: Array<Record<string, unknown>>): Date | null {
  let latest: Date | null = null;

  for (const task of tasks) {
    const title = String(task?.title || '').trim();
    if (!isExecutiveApprovalTask(title)) continue;

    const scheduled = resolveTaskScheduledDate(task);
    if (!scheduled) continue;

    if (!latest || scheduled > latest) {
      latest = scheduled;
    }
  }

  return latest;
}
