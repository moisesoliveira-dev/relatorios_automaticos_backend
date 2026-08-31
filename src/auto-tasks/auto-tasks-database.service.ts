import { Injectable, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { AppConfigService } from '../infrastructure/config/app-config.service';
import { calcularProximoDiaValidoChecagem } from './utils/date.utils';

export interface Projetista {
  projetistaid: string;
  name: string;
}

export interface ChecagemAgendamento {
  deadline: string;
  alert: string;
  time: string;
  horarioManausInicio: string;
  horarioManausFim: string;
  dataAgendada: string;
}

@Injectable()
export class AutoTasksDatabaseService {
  private readonly logger = new Logger(AutoTasksDatabaseService.name);
  private pool: Pool | null = null;

  constructor(private readonly appConfig: AppConfigService) {}

  private getPool(): Pool {
    if (!this.pool) {
      const connectionString = this.appConfig.rotationDatabaseUrl;
      if (!connectionString) {
        throw new Error('ROTATION_DATABASE_URL não configurada — necessária para jobs de tarefas automáticas');
      }

      this.pool = new Pool({
        connectionString,
        ssl: this.appConfig.isProduction ? { rejectUnauthorized: false } : false,
      });
    }
    return this.pool;
  }

  async testarConexaoBanco(): Promise<void> {
    const client = await this.getPool().connect();
    try {
      await client.query('SELECT version()');
      await client.query('SELECT NOW() as current_time');
    } finally {
      client.release();
    }
  }

  async inicializarTabelas(): Promise<void> {
    await this.criarTabelaRodizioSeNaoExistir();
    await this.criarTabelaAgendamentosSeNaoExistir();
    await this.criarTabelaChecagemPedidoSeNaoExistir();
    await this.configurarRodizioVitorInicial();
    await this.limparAgendamentosAntigos();
    await this.limparChecagensPedidoAntigas();
  }

  async obterProximoProjetista(): Promise<Projetista> {
    const client = await this.getPool().connect();
    try {
      const result = await client.query(
        'SELECT projetistaid, name FROM tb_pontta_rotation WHERE turn = true LIMIT 1',
      );
      if (result.rows.length === 0) {
        throw new Error('Nenhum projetista encontrado com turn = true');
      }
      return result.rows[0];
    } finally {
      client.release();
    }
  }

  async passarRodizioParaProximo(projetistaAtualId: string): Promise<Projetista> {
    const client = await this.getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query('UPDATE tb_pontta_rotation SET turn = false WHERE projetistaid = $1', [projetistaAtualId]);

      const proximoResult = await client.query(
        `SELECT projetistaid, name FROM tb_pontta_rotation
         WHERE projetistaid > $1 ORDER BY projetistaid ASC LIMIT 1`,
        [projetistaAtualId],
      );

      let proximoProjetista: Projetista;
      if (proximoResult.rows.length > 0) {
        proximoProjetista = proximoResult.rows[0];
      } else {
        const primeiroResult = await client.query(
          'SELECT projetistaid, name FROM tb_pontta_rotation ORDER BY projetistaid ASC LIMIT 1',
        );
        proximoProjetista = primeiroResult.rows[0];
      }

      await client.query('UPDATE tb_pontta_rotation SET turn = true WHERE projetistaid = $1', [
        proximoProjetista.projetistaid,
      ]);
      await client.query('COMMIT');
      return proximoProjetista;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async obterProximoProjetistaVitor(): Promise<Projetista> {
    const client = await this.getPool().connect();
    try {
      const result = await client.query(
        'SELECT projetistaid, name FROM tb_pontta_rotation WHERE turn_v = true AND turn_v IS NOT NULL LIMIT 1',
      );
      if (result.rows.length === 0) {
        throw new Error('Nenhum projetista encontrado com turn_v = true');
      }
      return result.rows[0];
    } finally {
      client.release();
    }
  }

  async passarRodizioVitorParaProximo(projetistaAtualId: string): Promise<Projetista> {
    const client = await this.getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query('UPDATE tb_pontta_rotation SET turn_v = false WHERE projetistaid = $1', [projetistaAtualId]);

      const proximoResult = await client.query(
        `SELECT projetistaid, name FROM tb_pontta_rotation
         WHERE projetistaid > $1 AND turn_v IS NOT NULL ORDER BY projetistaid ASC LIMIT 1`,
        [projetistaAtualId],
      );

      let proximoProjetista: Projetista;
      if (proximoResult.rows.length > 0) {
        proximoProjetista = proximoResult.rows[0];
      } else {
        const primeiroResult = await client.query(
          'SELECT projetistaid, name FROM tb_pontta_rotation WHERE turn_v IS NOT NULL ORDER BY projetistaid ASC LIMIT 1',
        );
        proximoProjetista = primeiroResult.rows[0];
      }

      await client.query('UPDATE tb_pontta_rotation SET turn_v = true WHERE projetistaid = $1', [
        proximoProjetista.projetistaid,
      ]);
      await client.query('COMMIT');
      return proximoProjetista;
    } finally {
      client.release();
    }
  }

  private async criarTabelaRodizioSeNaoExistir(): Promise<void> {
    const client = await this.getPool().connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS tb_pontta_rotation (
          id SERIAL PRIMARY KEY,
          projetistaid VARCHAR(255) NOT NULL UNIQUE,
          turn BOOLEAN NOT NULL DEFAULT false,
          name VARCHAR(255) NOT NULL,
          turn_v BOOLEAN DEFAULT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      const columnResult = await client.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name='tb_pontta_rotation' AND column_name='turn_v'`,
      );

      if (columnResult.rows.length === 0) {
        await client.query('ALTER TABLE tb_pontta_rotation ADD COLUMN turn_v BOOLEAN DEFAULT NULL');
      }
    } finally {
      client.release();
    }
  }

  private async criarTabelaAgendamentosSeNaoExistir(): Promise<void> {
    const client = await this.getPool().connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS tb_pontta_checagem_schedule (
          id SERIAL PRIMARY KEY,
          projetistaid VARCHAR(255) NOT NULL,
          data_agendamento DATE NOT NULL,
          proximo_horario_disponivel TIME NOT NULL DEFAULT '09:00:00',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(projetistaid, data_agendamento)
        );
      `);
    } finally {
      client.release();
    }
  }

  async obterProximoHorarioChecagem(projetistaId: string, dataChecagem: Date): Promise<ChecagemAgendamento> {
    const client = await this.getPool().connect();
    try {
      let dataAgendamento = new Date(dataChecagem);
      const diaSemana = dataAgendamento.getDay();
      let foiReagendado = false;

      if (diaSemana !== 3 && diaSemana !== 5) {
        dataAgendamento = calcularProximoDiaValidoChecagem(dataAgendamento);
        foiReagendado = true;
      }

      const dataFormatada = dataAgendamento.toISOString().split('T')[0];
      const scheduleResult = await client.query(
        'SELECT proximo_horario_disponivel FROM tb_pontta_checagem_schedule WHERE projetistaid = $1 AND data_agendamento = $2',
        [projetistaId, dataFormatada],
      );

      let proximoHorario: string;
      if (scheduleResult.rows.length === 0 || foiReagendado) {
        proximoHorario = '07:30:00';
      } else {
        proximoHorario = scheduleResult.rows[0].proximo_horario_disponivel;
      }

      const [hora, minuto] = proximoHorario.split(':').map(Number);
      const horarioFim = new Date();
      horarioFim.setHours(hora, minuto, 0, 0);
      horarioFim.setMinutes(horarioFim.getMinutes() + 90);

      const limiteHorario = new Date();
      limiteHorario.setHours(17, 0, 0, 0);

      if (horarioFim > limiteHorario) {
        const proximoDiaChecagem = calcularProximoDiaValidoChecagem(dataAgendamento);
        return this.obterProximoHorarioChecagem(projetistaId, proximoDiaChecagem);
      }

      const dataInicioManaus = new Date(dataAgendamento);
      dataInicioManaus.setHours(hora, minuto, 0, 0);

      const dataFimManaus = new Date(dataInicioManaus);
      dataFimManaus.setMinutes(dataFimManaus.getMinutes() + 90);

      const dataInicioUTC = new Date(dataInicioManaus.getTime() + 4 * 60 * 60 * 1000);
      const dataFimUTC = new Date(dataFimManaus.getTime() + 4 * 60 * 60 * 1000);
      const dataAlertUTC = new Date(dataFimUTC.getTime() - 60 * 60 * 1000);

      const proximoSlot = `${String(dataFimManaus.getHours()).padStart(2, '0')}:${String(dataFimManaus.getMinutes()).padStart(2, '0')}:00`;

      if (scheduleResult.rows.length === 0) {
        await client.query(
          'INSERT INTO tb_pontta_checagem_schedule (projetistaid, data_agendamento, proximo_horario_disponivel) VALUES ($1, $2, $3)',
          [projetistaId, dataFormatada, proximoSlot],
        );
      } else {
        await client.query(
          'UPDATE tb_pontta_checagem_schedule SET proximo_horario_disponivel = $1, updated_at = CURRENT_TIMESTAMP WHERE projetistaid = $2 AND data_agendamento = $3',
          [proximoSlot, projetistaId, dataFormatada],
        );
      }

      return {
        deadline: dataFimUTC.toISOString(),
        alert: dataAlertUTC.toISOString(),
        time: '90',
        horarioManausInicio: `${hora.toString().padStart(2, '0')}:${minuto.toString().padStart(2, '0')}`,
        horarioManausFim: `${dataFimManaus.getHours().toString().padStart(2, '0')}:${dataFimManaus.getMinutes().toString().padStart(2, '0')}`,
        dataAgendada: dataFormatada,
      };
    } finally {
      client.release();
    }
  }

  private async configurarRodizioVitorInicial(): Promise<void> {
    const client = await this.getPool().connect();
    try {
      const verificarResult = await client.query(
        'SELECT COUNT(*) as count FROM tb_pontta_rotation WHERE turn_v = true',
      );

      if (parseInt(verificarResult.rows[0].count, 10) === 0) {
        const annaAliceId = 'c70c4e46-459a-4c60-b500-77b59b156d49';
        await client.query('UPDATE tb_pontta_rotation SET turn_v = true WHERE projetistaid = $1', [annaAliceId]);
      }
    } finally {
      client.release();
    }
  }

  private async limparAgendamentosAntigos(): Promise<void> {
    const client = await this.getPool().connect();
    try {
      const hoje = new Date().toISOString().split('T')[0];
      await client.query('DELETE FROM tb_pontta_checagem_schedule WHERE data_agendamento < $1', [hoje]);
    } finally {
      client.release();
    }
  }

  private async criarTabelaChecagemPedidoSeNaoExistir(): Promise<void> {
    const client = await this.getPool().connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS tb_pontta_checagem_pedido (
          id SERIAL PRIMARY KEY,
          projetistaid VARCHAR(255) NOT NULL,
          sales_order_id VARCHAR(255) NOT NULL,
          data_checagem DATE NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_checagem_projetista_data
          ON tb_pontta_checagem_pedido (projetistaid, data_checagem);
        CREATE INDEX IF NOT EXISTS idx_checagem_pedido
          ON tb_pontta_checagem_pedido (sales_order_id);
      `);
    } finally {
      client.release();
    }
  }

  async verificarConflitoChecagemPorPedido(
    projetistaId: string,
    dataChecagem: Date,
    salesOrderId: string,
  ): Promise<boolean> {
    const client = await this.getPool().connect();
    try {
      const dataFormatada = new Date(dataChecagem).toISOString().split('T')[0];
      const result = await client.query(
        `SELECT sales_order_id FROM tb_pontta_checagem_pedido
         WHERE projetistaid = $1 AND data_checagem = $2 AND sales_order_id != $3 LIMIT 1`,
        [projetistaId, dataFormatada, salesOrderId],
      );
      return result.rows.length > 0;
    } finally {
      client.release();
    }
  }

  async registrarChecagemPedido(projetistaId: string, salesOrderId: string, dataChecagem: Date): Promise<void> {
    const client = await this.getPool().connect();
    try {
      const dataFormatada = new Date(dataChecagem).toISOString().split('T')[0];
      await client.query(
        `INSERT INTO tb_pontta_checagem_pedido (projetistaid, sales_order_id, data_checagem)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [projetistaId, salesOrderId, dataFormatada],
      );
    } finally {
      client.release();
    }
  }

  private async limparChecagensPedidoAntigas(): Promise<void> {
    const client = await this.getPool().connect();
    try {
      await client.query(
        `DELETE FROM tb_pontta_checagem_pedido WHERE data_checagem < CURRENT_DATE - INTERVAL '90 days'`,
      );
    } finally {
      client.release();
    }
  }
}
