const test = require('node:test');
const assert = require('node:assert/strict');
const RX = require('../lib.js');

// Respostas fictícias no formato da API de agregados do IBGE
function agregado(unidade, linhas) {
  return [{
    id: '0', variavel: 'teste', unidade: unidade,
    resultados: [{
      classificacoes: [],
      series: Object.entries(linhas).map(([id, serie]) => ({
        localidade: { id: id, nome: 'UF ' + id },
        serie: serie
      }))
    }]
  }];
}

test('parseAgregado lê valores, ano e converte "Mil Reais" para reais', () => {
  const r = RX.parseAgregado(agregado('Mil Reais', {
    '35': { '2022': '2000', '2023': '2500' },
    '33': { '2023': '1000' },
    '99': { '2023': '9999' } // código que não é UF: ignorado
  }));
  assert.equal(r.year, '2023');
  assert.equal(r.values.get('35'), 2500 * 1000);
  assert.equal(r.values.get('33'), 1000 * 1000);
  assert.equal(r.values.has('99'), false);
});

test('parseAgregado ignora valores inibidos e usa o ano anterior', () => {
  const r = RX.parseAgregado(agregado('Pessoas', { '35': { '2021': '100', '2022': '-' } }));
  assert.equal(r.values.get('35'), 100);
});

test('parseAgregado falha com resposta inesperada', () => {
  assert.throws(() => RX.parseAgregado([]), /vazia/);
  assert.throws(() => RX.parseAgregado({}), /vazia/);
  assert.throws(() => RX.parseAgregado(agregado('Pessoas', { '35': { '2022': '-' } })), /nenhum valor/);
});

test('parseSGS devolve o último ponto que não está no futuro', () => {
  const json = [
    { data: '01/08/2026', valor: '4.22' },
    { data: '01/09/2026', valor: '4.58' },
    { data: '01/12/2026', valor: '9.99' } // futuro
  ];
  const r = RX.parseSGS(json, new Date(2026, 9, 12));
  assert.equal(r.value, 4.58);
  assert.equal(RX.fmtRefDate(r.date, true), 'set/2026');
});

test('parseSGS aceita valores negativos', () => {
  const r = RX.parseSGS([{ data: '01/08/2026', valor: '-0.32' }], new Date(2026, 9, 12));
  assert.equal(r.value, -0.32);
});

test('buildIndicators calcula os derivados e o total nacional', () => {
  const pop = RX.parseAgregado(agregado('Pessoas', { '35': { '2022': '40' }, '33': { '2022': '10' } }));
  const dens = RX.parseAgregado(agregado('Habitante por quilômetro quadrado', { '35': { '2022': '4' }, '33': { '2022': '1' } }));
  const pib = RX.parseAgregado(agregado('Mil Reais', { '35': { '2022': '8' }, '33': { '2022': '2' } }));
  const inds = RX.buildIndicators({ pop, dens, pib });
  const by = Object.fromEntries(inds.map((i) => [i.id, i]));

  assert.deepEqual(Object.keys(by), ['pop', 'dens', 'pib', 'pib_pc', 'peso']);
  assert.equal(by.pop.national, 50);
  // áreas: 40/4 = 10 e 10/1 = 10 → 20 km²; 50/20 = 2,5 hab/km²
  assert.equal(by.dens.national, 2.5);
  assert.equal(by.pib.national, 10000);
  // PIB per capita: SP 8000/40 = 200; RJ 2000/10 = 200; Brasil 10000/50 = 200
  assert.equal(by.pib_pc.values.get('35'), 200);
  assert.equal(by.pib_pc.national, 200);
  // participação no PIB (80%) igual à da população (80%): peso 1
  assert.equal(by.peso.values.get('35'), 1);
});

test('buildIndicators funciona só com população', () => {
  const pop = RX.parseAgregado(agregado('Pessoas', { '35': { '2022': '40' } }));
  const inds = RX.buildIndicators({ pop, dens: null, pib: null });
  assert.deepEqual(inds.map((i) => i.id), ['pop']);
});

test('rankOf ordena do maior para o menor', () => {
  const m = new Map([['35', 40], ['33', 10], ['31', 25]]);
  assert.deepEqual(RX.rankOf(m, '35'), { pos: 1, of: 3 });
  assert.deepEqual(RX.rankOf(m, '33'), { pos: 3, of: 3 });
  assert.equal(RX.rankOf(m, '11'), null);
});

test('formatação em pt-BR', () => {
  assert.equal(RX.fmtPop(44420459), '44,4 mi');
  assert.equal(RX.fmtMoney(3.1e12), 'R$ 3,10 tri');
  assert.equal(RX.fmtMoney(450e9), 'R$ 450,0 bi');
  assert.equal(RX.fmtRatio(1.234), '1,23×');
  assert.equal(RX.fmtPct(0.2188), '21,9%');
});

test('compareToNational escreve a comparação com o Brasil', () => {
  const total = { kind: 'total', national: 100, refName: 'do total do país' };
  assert.equal(RX.compareToNational(total, 25), '25,0% do total do país');
  const ratio = { kind: 'ratio', national: 200, refName: 'da média do Brasil' };
  assert.equal(RX.compareToNational(ratio, 300), '50,0% acima da média do Brasil');
  assert.equal(RX.compareToNational(ratio, 100), '50,0% abaixo da média do Brasil');
});
