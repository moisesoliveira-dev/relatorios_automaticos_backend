import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../../infrastructure/config/app-config.service';
import {
  describeTool,
  ToolCatalog,
  ToolDefinition,
  ToolInfo,
} from '../engine/tool.types';
import { ChatbotDriveService } from '../services/chatbot-drive.service';
import { ChatbotSchedulingService } from '../services/chatbot-scheduling.service';
import { agendaTools } from './agenda.tools';
import { conversaTools } from './conversa.tools';
import { driveTools } from './drive.tools';

/**
 * Catálogo de ferramentas que os fluxos podem usar.
 * Para adicionar uma ferramenta nova: crie `tools/<nome>.tools.ts` devolvendo ToolDefinition[]
 * e registre aqui (ou chame `register` de outro módulo). Nada mais precisa mudar.
 */
@Injectable()
export class ToolRegistry implements ToolCatalog {
  private readonly logger = new Logger(ToolRegistry.name);
  private readonly tools = new Map<string, ToolDefinition>();

  constructor(
    drive: ChatbotDriveService,
    scheduling: ChatbotSchedulingService,
    config: AppConfigService,
  ) {
    for (const t of [
      ...driveTools(drive),
      ...agendaTools(scheduling, config),
      ...conversaTools(),
    ])
      this.register(t);
  }

  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.key))
      this.logger.warn(
        `Ferramenta ${tool.key} registrada duas vezes; a última vence.`,
      );
    this.tools.set(tool.key, tool);
  }

  get(key: string): ToolDefinition | undefined {
    return this.tools.get(key);
  }

  list(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  describe(): ToolInfo[] {
    return this.list().map(describeTool);
  }
}
