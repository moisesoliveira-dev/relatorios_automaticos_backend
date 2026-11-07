import {
  canonicalNumber,
  isAllowedNumber,
  numberKey,
  parseNumberList,
} from '../domain/test-mode';

describe('modo teste', () => {
  it('reconhece o mesmo telefone em qualquer formato, pelos 8 últimos dígitos', () => {
    const formas = [
      '92 99123-4567',
      '(92) 99123-4567',
      '5592991234567',
      '+55 92 99123-4567',
      '+55 92 9123-4567', // sem o 9º dígito
      '5592991234567@c.us', // formato do WhatsApp
      '99123-4567',
      '9123 4567',
    ];
    const chaves = new Set(formas.map(numberKey));
    expect(chaves.size).toBe(1);
    expect([...chaves][0]).toBe('91234567');
  });

  it('guarda só os dígitos', () => {
    expect(canonicalNumber('(92) 99123-4567')).toBe('92991234567');
    expect(canonicalNumber('+55 92 99123-4567')).toBe('5592991234567');
  });

  it('recusa o que tem menos de 8 dígitos', () => {
    for (const ruim of ['', 'abc', '123', '1234-567', null, undefined])
      expect(canonicalNumber(ruim)).toBeNull();
  });

  it('lê a lista guardada e ignora lixo', () => {
    expect(parseNumberList('5592991234567, 92988887777;xx')).toEqual([
      '5592991234567',
      '92988887777',
    ]);
    expect(parseNumberList('')).toEqual([]);
  });

  it('só deixa passar quem está na lista', () => {
    const lista = ['92991234567'];
    expect(isAllowedNumber('5592991234567', lista)).toBe(true);
    expect(isAllowedNumber('+55 (92) 9123-4567', lista)).toBe(true);
    expect(isAllowedNumber('5592991234567@c.us', lista)).toBe(true);
    expect(isAllowedNumber('5592988887777', lista)).toBe(false);
    expect(isAllowedNumber('123', lista)).toBe(false);
    expect(isAllowedNumber(undefined, lista)).toBe(false);
    expect(isAllowedNumber('5592991234567', [])).toBe(false);
  });
});
