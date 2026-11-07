import { RotationService } from './rotation.service';

/** Repositório em memória com o mínimo que a importação usa. */
function fakeRepo(initial: Array<Record<string, unknown>> = []) {
  const rows = [...initial];
  return {
    rows,
    count: async () => rows.length,
    insert: async (r: Record<string, unknown>) => void rows.push(r),
  };
}

const source = (rows: any[]) => {
  const calls = { ended: 0 };
  return {
    calls,
    src: {
      query: async () => ({ rows }),
      end: async () => void (calls.ended += 1),
    },
  };
};

const service = (repo: ReturnType<typeof fakeRepo>, url?: string) =>
  new RotationService(
    repo as never,
    {} as never,
    { rotationDatabaseUrl: url, dbSslRejectUnauthorized: false } as never,
  );

describe('rodízio: importação do banco antigo', () => {
  const antigos = [
    { id: 'p1', name: 'Ana', turn: true, identificacao: 5, queueid: 6 },
    { id: 'p2', name: 'Bia', turn: false, identificacao: 7, queueid: 6 },
  ];

  it('copia as pessoas quando a tabela daqui está vazia', async () => {
    const repo = fakeRepo();
    const { src, calls } = source(antigos);
    const n = await service(repo, 'postgres://x/y').importLegacy(
      async () => src,
    );
    expect(n).toBe(2);
    expect(repo.rows).toEqual(antigos);
    expect(calls.ended).toBe(1);
  });

  it('não faz nada sem a variável do banco antigo', async () => {
    const repo = fakeRepo();
    const open = jest.fn();
    expect(await service(repo, undefined).importLegacy(open)).toBe(0);
    expect(open).not.toHaveBeenCalled();
  });

  it('não sobrescreve quando já existem pessoas aqui', async () => {
    const repo = fakeRepo([{ id: 'x' }]);
    const open = jest.fn();
    expect(await service(repo, 'postgres://x/y').importLegacy(open)).toBe(0);
    expect(open).not.toHaveBeenCalled();
    expect(repo.rows).toHaveLength(1);
  });
});
