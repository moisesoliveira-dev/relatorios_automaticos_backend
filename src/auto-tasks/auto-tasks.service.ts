import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { PonttaService } from '../pontta/pontta.service';
import { AppConfigService } from '../infrastructure/config/app-config.service';
import { AutoTasksDatabaseService, Projetista } from './auto-tasks-database.service';
import {
  adicionarDiasUteis,
  calcularDataAprovacaoExecutivo,
  calcularDataChecagemMedida,
  isDiaValidoChecagem,
  obterDatasConsulta,
} from './utils/date.utils';

const VITOR_LIBORIO_ID = '9ed8829b-7361-4695-a105-e8d3f6e7369a';

export interface AutoTasksLogFn {
  (level: 'info' | 'success' | 'warning' | 'error', message: string, data?: unknown): void;
}

interface SalesOrderSummary {
  id: string;
  code: string;
  saleDate: string;
}

interface SalesOrderDetail {
  id: string;
  code: string;
  saleDate: string;
  items?: Array<{ name?: string }>;
}

interface TaskData {
  title: string;
  deadline: string;
}

@Injectable()
export class AutoTasksService {
  private readonly logger = new Logger(AutoTasksService.name);

  constructor(
    private readonly ponttaService: PonttaService,
    private readonly appConfig: AppConfigService,
    private readonly database: AutoTasksDatabaseService,
  ) {}

  listProcessedOrders(options?: { q?: string; limit?: number; offset?: number }) {
    return this.database.listarOrdensProcessadas(options);
  }

  async removeProcessedOrder(code: string): Promise<boolean> {
    return this.database.removerOrdemProcessada(code);
  }

  async execute(log?: AutoTasksLogFn): Promise<string> {
    const pushLog = log || ((level, message, data) => {
      const extra = data ? ` ${JSON.stringify(data)}` : '';
      if (level === 'error') this.logger.error(message + extra);
      else if (level === 'warning') this.logger.warn(message + extra);
      else this.logger.log(message + extra);
    });

    pushLog('info', 'Testando conexão com banco de tarefas automáticas...');
    await this.database.testarConexaoBanco();
    await this.database.inicializarTabelas();

    const { email, password } = this.appConfig.ponttaCredentials;
    pushLog('info', 'Autenticando no Pontta...');
    const token = await this.ponttaService.authenticate(email, password, true);

    pushLog('info', 'Recuperando ordens de pedido do dia...');
    const ordens = await this.recuperarOrdensPedido(token, pushLog);

    if (ordens.length === 0) {
      return 'Nenhuma ordem nova para processar.';
    }

    pushLog('info', `Processando detalhes de ${ordens.length} ordem(ns)...`);
    const detalhes = await this.processarDetalhesOrdens(token, ordens, pushLog);

    pushLog('info', 'Criando tasks nos ambientes...');
    const resultados = await this.processarAmbientesECriarTasks(token, detalhes, pushLog);

    return `${resultados.length} conjunto(s) de tasks criados para ${ordens.length} ordem(ns).`;
  }

  private getBusinessUnitHeader(): Record<string, string> {
    const businessUnit = this.appConfig.ponttaApi.businessUnitId;
    return businessUnit ? { businessunit: businessUnit } : {};
  }

  private async recuperarOrdensPedido(
    token: string,
    log: AutoTasksLogFn,
  ): Promise<SalesOrderSummary[]> {
    const { start, end } = obterDatasConsulta();
    const url = `${this.appConfig.ponttaApi.apiUrl}/sales-orders/summary`;
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...this.getBusinessUnitHeader(),
    };

    const response = await axios.get(url, { headers, params: { start, end } });
    const ordensCompletas: SalesOrderSummary[] = response.data || [];
    const ordensNovas: SalesOrderSummary[] = [];

    for (const ordem of ordensCompletas) {
      const jaExiste = await this.database.verificarOrdemExiste(ordem.code);
      if (!jaExiste) {
        ordensNovas.push(ordem);
      }
    }

    log('info', `Ordens: ${ordensCompletas.length} total, ${ordensNovas.length} novas`, {
      start,
      end,
    });

    return ordensNovas;
  }

  private async processarDetalhesOrdens(
    token: string,
    ordens: SalesOrderSummary[],
    log: AutoTasksLogFn,
  ): Promise<SalesOrderDetail[]> {
    const detalhesCompletos: SalesOrderDetail[] = [];

    for (let i = 0; i < ordens.length; i++) {
      const ordem = ordens[i];
      try {
        const url = `${this.appConfig.ponttaApi.apiUrl}/sales-orders?code=${ordem.code}`;
        const headers = {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          ...this.getBusinessUnitHeader(),
        };

        const response = await axios.get(url, { headers });
        const detalhes = response.data;

        if (Array.isArray(detalhes)) {
          detalhesCompletos.push(...detalhes);
        } else if (detalhes) {
          detalhesCompletos.push(detalhes);
        }

        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch (error) {
        log('warning', `Erro ao processar ordem ${ordem.code}, continuando...`, {
          message: (error as Error).message,
        });
      }
    }

    log('info', `Detalhes coletados: ${detalhesCompletos.length}`);
    return detalhesCompletos;
  }

  private async criarTask(
    token: string,
    ordemId: string,
    taskData: TaskData,
    numeroAmbiente: number,
    projetista: Projetista,
    isChecagemMedida = false,
  ): Promise<unknown> {
    const url = `${this.appConfig.ponttaApi.apiUrl}/tasks/SALES_ORDER/${ordemId}`;
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...this.getBusinessUnitHeader(),
    };

    let taskPayload: Record<string, unknown>;

    if (isChecagemMedida) {
      const agendamento = await this.database.obterProximoHorarioChecagem(
        projetista.projetistaid,
        new Date(taskData.deadline),
      );

      taskPayload = {
        id: null,
        title: `${numeroAmbiente.toString().padStart(2, '0')} - ${taskData.title}`,
        responsible: projetista.projetistaid,
        comment: null,
        alert: agendamento.alert,
        deadline: agendamento.deadline,
        time: agendamento.time,
        type: 'OTHER',
        workflowPositionId: null,
        note: null,
      };
    } else {
      taskPayload = {
        id: null,
        title: `${numeroAmbiente.toString().padStart(2, '0')} - ${taskData.title}`,
        responsible: projetista.projetistaid,
        comment: null,
        alert: null,
        deadline: taskData.deadline,
        time: null,
        type: 'OTHER',
        workflowPositionId: null,
        note: null,
      };
    }

    const response = await axios.post(url, taskPayload, { headers });
    return { ...response.data, numeroAmbiente };
  }

  private async processarAmbientesECriarTasks(
    token: string,
    detalhesOrdens: SalesOrderDetail[],
    log: AutoTasksLogFn,
  ): Promise<unknown[]> {
    const resultadosTasks: unknown[] = [];
    const diasChecagem = this.appConfig.autoTasks.diasChecagemMedida;
    const diasRevisao = this.appConfig.autoTasks.diasRevisaoProjeto;
    const diasProjetoExecutivo = this.appConfig.autoTasks.diasProjetoExecutivo;
    const diasAprovacao = this.appConfig.autoTasks.diasAprovacaoExecutivo;

    for (const ordem of detalhesOrdens) {
      const ambientes: string[] = [];
      if (ordem.items && Array.isArray(ordem.items)) {
        for (const item of ordem.items) {
          if (item.name) ambientes.push(item.name);
        }
      }

      let numeroAmbiente = 1;

      for (const ambiente of ambientes) {
        try {
          const projetistaDoAmbiente = await this.database.obterProximoProjetista();
          let projetistaChecagem = projetistaDoAmbiente;

          if (projetistaDoAmbiente.projetistaid === VITOR_LIBORIO_ID) {
            projetistaChecagem = await this.database.obterProximoProjetistaVitor();
          }

          let dataChecagem = calcularDataChecagemMedida(ordem.saleDate, diasChecagem);

          let temConflito = await this.database.verificarConflitoChecagemPorPedido(
            projetistaChecagem.projetistaid,
            dataChecagem,
            ordem.id,
          );

          while (temConflito) {
            dataChecagem.setDate(dataChecagem.getDate() + 1);
            while (!isDiaValidoChecagem(dataChecagem)) {
              dataChecagem.setDate(dataChecagem.getDate() + 1);
            }
            dataChecagem = new Date(
              dataChecagem.getFullYear(),
              dataChecagem.getMonth(),
              dataChecagem.getDate(),
              23,
              59,
              59,
              999,
            );
            temConflito = await this.database.verificarConflitoChecagemPorPedido(
              projetistaChecagem.projetistaid,
              dataChecagem,
              ordem.id,
            );
          }

          await this.database.registrarChecagemPedido(projetistaChecagem.projetistaid, ordem.id, dataChecagem);

          await this.criarTask(
            token,
            ordem.id,
            { title: `${ambiente} Checagem de medida`, deadline: dataChecagem.toISOString() },
            numeroAmbiente,
            projetistaChecagem,
            true,
          );

          const dataRevisao = adicionarDiasUteis(dataChecagem, diasRevisao);
          await this.criarTask(
            token,
            ordem.id,
            { title: `${ambiente} Revisão do Projeto`, deadline: dataRevisao.toISOString() },
            numeroAmbiente,
            projetistaDoAmbiente,
          );

          const dataProjetoExecutivo = adicionarDiasUteis(dataRevisao, diasProjetoExecutivo);
          await this.criarTask(
            token,
            ordem.id,
            { title: `${ambiente} Projeto Executivo`, deadline: dataProjetoExecutivo.toISOString() },
            numeroAmbiente,
            projetistaDoAmbiente,
          );

          const dataEnvio = new Date(dataProjetoExecutivo);
          await this.criarTask(
            token,
            ordem.id,
            { title: `${ambiente} Envio para o Cliente`, deadline: dataEnvio.toISOString() },
            numeroAmbiente,
            projetistaDoAmbiente,
          );

          const dataAprovacao = calcularDataAprovacaoExecutivo(dataProjetoExecutivo, diasAprovacao);
          await this.criarTask(
            token,
            ordem.id,
            { title: `${ambiente} Aprovação do Projeto Executivo`, deadline: dataAprovacao.toISOString() },
            numeroAmbiente,
            projetistaDoAmbiente,
          );

          resultadosTasks.push({ ordem: ordem.code, ambiente, numeroAmbiente });
          await this.database.passarRodizioParaProximo(projetistaDoAmbiente.projetistaid);

          if (projetistaDoAmbiente.projetistaid === VITOR_LIBORIO_ID) {
            await this.database.passarRodizioVitorParaProximo(projetistaChecagem.projetistaid);
          }

          numeroAmbiente++;
          await new Promise((resolve) => setTimeout(resolve, 300));
        } catch (error) {
          log('warning', `Erro ao criar tasks para ambiente "${ambiente}" na ordem ${ordem.code}`, {
            message: (error as Error).message,
          });
          numeroAmbiente++;
        }
      }

      try {
        await this.database.salvarOrdemNoBanco(ordem.id, ordem.code);
        log('info', `Ordem ${ordem.code} salva no banco após criação das tasks`);
      } catch (error) {
        log('warning', `Erro ao salvar ordem ${ordem.code} no banco`, {
          message: (error as Error).message,
        });
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    return resultadosTasks;
  }
}
