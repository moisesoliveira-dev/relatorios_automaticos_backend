import {
  canonicalNumber,
  isAllowedNumber,
  numberKey,
  parseNumberList,
} from '../domain/test-mode';

describe('modo teste', () => {
  it('reconhece o mesmo telefone em vários formatos', () => {
    const formas = [
      '92 99123-4567',
      '(92) 99123-4567',
      '5592991234567',
      '+55 92 99123-4567',
      '+55 92 9123-4567', // sem o 9º dígito
      '9291234567',
    ];
    const chaves = new Set(formas.map(numberKey));
    expect(chaves.size).toBe(1);
    expect([...chaves][0]).toBe('9291234567');
  });

  it('guarda sempre como 55 + DDD + número', () => {
    expect(canonicalNumber('(92) 99123-4567')).toBe('5592991234567');
    expect(canonicalNumber('5592991234567')).toBe('5592991234567');
  });

  it('recusa o que não parece telefone com DDD', () => {
    for (const ruim of ['', 'abc', '99123-4567', '123', null, undefined])
      expect(canonicalNumber(ruim)).toBeNull();
  });

  it('lê a lista guardada e ignora lixo', () => {
    expect(parseNumberList('5592991234567, 5592988887777;xx')).toEqual([
      '5592991234567',
      '5592988887777',
    ]);
    expect(parseNumberList('')).toEqual([]);
  });

  it('só deixa passar quem está na lista; DDD diferente não conta', () => {
    const lista = ['5592991234567'];
    expect(isAllowedNumber('5592991234567', lista)).toBe(true);
    expect(isAllowedNumber('92 9123-4567', lista)).toBe(true);
    expect(isAllowedNumber('5511991234567', lista)).toBe(false);
    expect(isAllowedNumber('5592988887777', lista)).toBe(false);
    expect(isAllowedNumber(undefined, lista)).toBe(false);
    expect(isAllowedNumber('5592991234567', [])).toBe(false);
  });
});
