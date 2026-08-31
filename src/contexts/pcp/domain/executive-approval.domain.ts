const EXECUTIVE_APPROVAL_REGEX = /aprova[cç][aã]o do projeto executivo/i;

const FINISHED_STAGES = new Set(['FINISHED', 'DONE', 'COMPLETED', 'FINALIZED', 'CLOSED', 'RESOLVED']);

export function resolveTaskCompletionDate(task: Record<string, unknown>): Date | null {
  const candidates = [task?.moment, task?.schedule, task?.deadline, task?.alert, task?.createdDate];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const raw = typeof candidate === 'object' && candidate !== null && 'end' in candidate
      ? (candidate as { end?: unknown }).end
      : candidate;
    if (!raw) continue;
    const parsed = new Date(String(raw));
    if (!Number.isNaN(parsed.getTime())) {
      parsed.setHours(0, 0, 0, 0);
      return parsed;
    }
  }
  return null;
}

export function isExecutiveApprovalTask(title: string): boolean {
  return EXECUTIVE_APPROVAL_REGEX.test(title.trim());
}

export function isTaskFinished(stage: unknown): boolean {
  return FINISHED_STAGES.has(String(stage || '').toUpperCase());
}

/** Data base PCP = maior data de conclusão entre tarefas "Aprovação do Projeto Executivo" finalizadas. */
export function resolveExecutiveApprovalDate(tasks: Array<Record<string, unknown>>): Date | null {
  let latest: Date | null = null;

  for (const task of tasks) {
    const title = String(task?.title || '').trim();
    if (!isExecutiveApprovalTask(title)) continue;
    if (!isTaskFinished(task?.stage)) continue;

    const completion = resolveTaskCompletionDate(task);
    if (!completion) continue;

    if (!latest || completion > latest) {
      latest = completion;
    }
  }

  return latest;
}
