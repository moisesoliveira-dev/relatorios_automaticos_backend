import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosError } from 'axios';
import { AppConfigService } from '../../infrastructure/config/app-config.service';

/** Fluxos do funil do CMSYS: 1 = já tem projeto; 2.1 = sem projeto, imóvel na planta; 2.2 = sem projeto, com as chaves. */
export type CrmFluxo = '1' | '2.1' | '2.2';
export const CRM_FLUXOS: CrmFluxo[] = ['1', '2.1', '2.2'];

export interface CrmLeadEntrada {
  /** Identificador do contato no GOSAC (chave para não duplicar). */
  contato: string;
  nome: string;
  telefone?: string | null;
  fluxo?: CrmFluxo;
  fluxoProvisorio?: boolean;
  origem?: string;
  /** Nome do atendente no GOSAC: vira o consultor do lead. */
  atendente?: string | null;
  fila?: string | null;
  atendimento?: string;
  conversa?: string;
}

export interface CrmLeadEdicao {
  nome?: string;
  telefone?: string;
  email?: string;
  origem?: string;
  ambientes?: string;
  valorEstimado?: number;
  faseObra?: string;
  previsaoLiberacao?: string;
  fluxo?: CrmFluxo;
}

export interface CrmLeadResultado {
  acao: 'criado' | 'atualizado' | 'igual' | 'perdido' | 'criado-perdido';
  id: string;
  consultor: string;
  status: 'ativo' | 'perdido';
  etapa: string;
}

/** Erro da API do funil, já com a mensagem pronta para log e o código HTTP/da API. */
export class CrmError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly code?: string,
  ) {
    super(message);
  }

  /** O lead já passou da pré-venda: a integração só pode registrar notas. */
  get foraDaPreVenda(): boolean {
    return this.status === 409 && this.code === 'fora-da-pre-venda';
  }
}

/** Só caracteres de identificador: o id vai no caminho da URL. */
const ID_OK = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Cliente da API de integração do CMSYS (funil comercial). Substitui o negócio que o chatbot
 * criava no Pontta. Autenticação: cabeçalho X-Integracao-Chave (uma chave por ambiente).
 */
@Injectable()
export class CrmFunilService {
  private readonly logger = new Logger(CrmFunilService.name);

  constructor(private readonly appConfig: AppConfigService) {}

  /** Ligado e com endereço e chave configurados. */
  get enabled(): boolean {
    const c = this.appConfig.crm;
    return c.enabled && !!c.baseUrl && !!c.apiKey;
  }

  /** O que falta configurar (para a tela e as ferramentas explicarem). */
  get indisponivelPorque(): string {
    const c = this.appConfig.crm;
    if (!c.baseUrl || !c.apiKey)
      return 'Informe o endereço e a chave da API do funil (CMSYS) em Ajustes → Integrações.';
    return 'Ligue a integração com o funil comercial (CMSYS) em Ajustes → Integrações.';
  }

  private async call<T>(
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    body?: unknown,
    params?: Record<string, string>,
  ): Promise<T> {
    const c = this.appConfig.crm;
    if (!c.baseUrl || !c.apiKey)
      throw new CrmError('API do funil não configurada.', null);
    try {
      const res = await axios.request<T>({
        method,
        url: `${c.baseUrl}/api/integracao${path}`,
        data: body,
        params,
        timeout: 10_000,
        headers: {
          'X-Integracao-Chave': c.apiKey,
          'Content-Type': 'application/json',
        },
      });
      return res.data;
    } catch (error) {
      const e = error as AxiosError<{ message?: string; code?: string }>;
      const status = e.response?.status ?? null;
      const msg = e.response?.data?.message || e.message;
      // A chave nunca entra no log; só método, caminho e o que a API respondeu.
      this.logger.warn(
        `CRM ${method} ${path} → ${status ?? 'sem resposta'}: ${msg}`,
      );
      throw new CrmError(msg, status, e.response?.data?.code);
    }
  }

  private lead(id: string): string {
    if (!ID_OK.test(id)) throw new CrmError('ID de lead inválido.', null);
    return `/funil/leads/${id}`;
  }

  /** Cria o lead ou atualiza o que já existe (sem duplicar). */
  registrar(lead: CrmLeadEntrada): Promise<CrmLeadResultado> {
    return this.call('POST', '/leads', lead);
  }

  editar(id: string, dados: CrmLeadEdicao): Promise<void> {
    return this.call('PATCH', this.lead(id), dados);
  }

  nota(id: string, obs: string): Promise<void> {
    return this.call('POST', `${this.lead(id)}/nota`, {
      obs: obs.slice(0, 2000),
    });
  }

  /** Marca (ou desmarca) um item do checklist da etapa atual, pelo texto do item. */
  checklist(id: string, item: string, ok = true): Promise<void> {
    return this.call('POST', `${this.lead(id)}/checklist`, { item, ok });
  }

  /** Novo lead → Qualificação. Exige o checklist da etapa completo. */
  avancar(id: string, obs?: string): Promise<void> {
    return this.call(
      'POST',
      `${this.lead(id)}/avancar`,
      obs ? { obs: obs.slice(0, 500) } : {},
    );
  }

  perder(id: string, motivo: string, obs?: string): Promise<void> {
    return this.call('POST', `${this.lead(id)}/perder`, {
      motivo,
      ...(obs ? { obs: obs.slice(0, 1000) } : {}),
    });
  }
}

/** Telefone/contato do GOSAC no formato do detector de leads: "5592991234567@c.us". */
export function contatoGosac(numero: string | null, contactId: number): string {
  const digitos = (numero ?? '').replace(/\D/g, '');
  return digitos ? `${digitos}@c.us` : `gosac-${contactId}`;
}

/** Fluxo do funil a partir do caminho que o cliente escolheu no menu (variável "trilha"). */
export function fluxoDaTrilha(
  trilha: string | undefined,
  padrao: CrmFluxo,
): { fluxo: CrmFluxo; provisorio: boolean } {
  if (trilha === 'projeto') return { fluxo: '1', provisorio: false };
  // planta baixa / sem nada: o consultor confirma na Qualificação se é 2.1 ou 2.2
  return { fluxo: padrao, provisorio: true };
}

/** Respostas da triagem em linhas "Rótulo: valor", sem os campos técnicos (ids, rótulos internos). */
export function linhasDaTriagem(
  vars: Record<string, string>,
  rotulos: Record<string, string> = {},
): string[] {
  return Object.entries(vars)
    .filter(
      ([k, v]) =>
        v?.trim() &&
        !k.endsWith('_ids') &&
        !k.endsWith('_rotulo') &&
        k !== 'trilha',
    )
    .map(([k, v]) => `${rotulos[k] ?? k}: ${v.trim()}`);
}
