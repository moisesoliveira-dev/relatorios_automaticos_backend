function formatarData(data: Date): string {
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const dia = String(data.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

function calcularPascoa(ano: number): Date {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(ano, mes - 1, dia);
}

function calcularFeriadosMoveis(ano: number): string[] {
  const pascoa = calcularPascoa(ano);
  const feriadosMoveis: string[] = [];

  feriadosMoveis.push(formatarData(pascoa));

  const carnaval = new Date(pascoa);
  carnaval.setDate(carnaval.getDate() - 47);
  feriadosMoveis.push(formatarData(carnaval));

  const segundaCarnaval = new Date(pascoa);
  segundaCarnaval.setDate(segundaCarnaval.getDate() - 48);
  feriadosMoveis.push(formatarData(segundaCarnaval));

  const sextaSanta = new Date(pascoa);
  sextaSanta.setDate(sextaSanta.getDate() - 2);
  feriadosMoveis.push(formatarData(sextaSanta));

  const corpusChristi = new Date(pascoa);
  corpusChristi.setDate(corpusChristi.getDate() + 60);
  feriadosMoveis.push(formatarData(corpusChristi));

  return feriadosMoveis;
}

export function isFeriadoManaus(data: Date): boolean {
  const dia = data.getDate();
  const mes = data.getMonth() + 1;
  const ano = data.getFullYear();

  const feriadosFixos = [
    { dia: 1, mes: 1 },
    { dia: 21, mes: 4 },
    { dia: 1, mes: 5 },
    { dia: 7, mes: 9 },
    { dia: 12, mes: 10 },
    { dia: 2, mes: 11 },
    { dia: 15, mes: 11 },
    { dia: 20, mes: 11 },
    { dia: 24, mes: 12 },
    { dia: 25, mes: 12 },
    { dia: 31, mes: 12 },
    { dia: 5, mes: 9 },
    { dia: 8, mes: 12 },
    { dia: 24, mes: 10 },
  ];

  for (const feriado of feriadosFixos) {
    if (dia === feriado.dia && mes === feriado.mes) {
      return true;
    }
  }

  const feriadosMoveis = calcularFeriadosMoveis(ano);
  const dataStr = `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
  return feriadosMoveis.includes(dataStr);
}

function isPeriodoRecesso(data: Date): boolean {
  const dia = data.getDate();
  const mes = data.getMonth() + 1;
  if (mes === 12 && dia >= 20) return true;
  if (mes === 1 && dia <= 21) return true;
  return false;
}

export function isDiaUtil(data: Date): boolean {
  const diaSemana = data.getDay();
  if (diaSemana === 0 || diaSemana === 6) return false;
  if (isFeriadoManaus(data)) return false;
  if (isPeriodoRecesso(data)) return false;
  return true;
}

export function isDiaValidoChecagem(data: Date): boolean {
  const diaSemana = data.getDay();
  if (diaSemana !== 3 && diaSemana !== 5) return false;
  if (isFeriadoManaus(data)) return false;
  if (isPeriodoRecesso(data)) return false;
  return true;
}

export function adicionarDiasUteis(dataInicial: Date, diasUteis: number): Date {
  const resultado = new Date(dataInicial);
  let diasAdicionados = 0;

  while (diasAdicionados < diasUteis) {
    resultado.setDate(resultado.getDate() + 1);
    if (isDiaUtil(resultado)) {
      diasAdicionados++;
    }
  }

  return new Date(resultado.getFullYear(), resultado.getMonth(), resultado.getDate(), 23, 59, 59, 999);
}

export function calcularDataChecagemMedida(dataVenda: string | Date, diasMinimos: number): Date {
  const dataVendaObj = new Date(dataVenda);
  const diasComExtraChecagem = diasMinimos + 1;
  const dataMinima = adicionarDiasUteis(dataVendaObj, diasComExtraChecagem);
  const dataFinal = new Date(dataMinima);

  while (!isDiaValidoChecagem(dataFinal)) {
    dataFinal.setDate(dataFinal.getDate() + 1);
  }

  return new Date(dataFinal.getFullYear(), dataFinal.getMonth(), dataFinal.getDate(), 23, 59, 59, 999);
}

export function calcularDataAprovacaoExecutivo(dataProjetoExecutivo: Date, diasUteis: number): Date {
  const dataComDias = adicionarDiasUteis(dataProjetoExecutivo, diasUteis);
  const dataFinal = new Date(dataComDias);

  while (dataFinal.getDay() !== 6) {
    dataFinal.setDate(dataFinal.getDate() + 1);
  }

  return new Date(dataFinal.getFullYear(), dataFinal.getMonth(), dataFinal.getDate(), 23, 59, 59, 999);
}

export function obterDatasConsulta(): { start: string; end: string } {
  const hoje = new Date();
  const dataManaus = new Date(hoje.toLocaleString('en-US', { timeZone: 'America/Manaus' }));
  const ano = dataManaus.getFullYear();
  const mes = String(dataManaus.getMonth() + 1).padStart(2, '0');
  const dia = String(dataManaus.getDate()).padStart(2, '0');
  const dataString = `${ano}-${mes}-${dia}T04:00:00.000Z`;

  return { start: dataString, end: dataString };
}

export function obterDataHojeManaus(): string {
  const hoje = new Date();
  const dataManaus = new Date(hoje.toLocaleString('en-US', { timeZone: 'America/Manaus' }));
  const ano = dataManaus.getFullYear();
  const mes = String(dataManaus.getMonth() + 1).padStart(2, '0');
  const dia = String(dataManaus.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

export function isDataVendaHojeOuFutura(saleDate: string | Date): boolean {
  const hoje = obterDataHojeManaus();
  const parsed = new Date(saleDate);
  if (Number.isNaN(parsed.getTime())) return false;

  const dataVenda = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Manaus',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(parsed);

  return dataVenda >= hoje;
}

export function calcularProximoDiaValidoChecagem(dataAtual: Date): Date {
  const proximoDia = new Date(dataAtual);
  proximoDia.setDate(proximoDia.getDate() + 1);

  while (true) {
    const diaSemana = proximoDia.getDay();
    if (diaSemana === 3 || diaSemana === 5) {
      break;
    }
    proximoDia.setDate(proximoDia.getDate() + 1);
  }

  return proximoDia;
}
