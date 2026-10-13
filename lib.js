/*
 * Raio-X do Brasil — funções puras (sem DOM), testáveis em Node.
 * No navegador, tudo fica disponível em window.RX.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RX = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- Unidades da Federação ---------- */
  const UFS = [
    ['11', 'RO', 'Rondônia', 'Norte'], ['12', 'AC', 'Acre', 'Norte'], ['13', 'AM', 'Amazonas', 'Norte'],
    ['14', 'RR', 'Roraima', 'Norte'], ['15', 'PA', 'Pará', 'Norte'], ['16', 'AP', 'Amapá', 'Norte'],
    ['17', 'TO', 'Tocantins', 'Norte'],
    ['21', 'MA', 'Maranhão', 'Nordeste'], ['22', 'PI', 'Piauí', 'Nordeste'], ['23', 'CE', 'Ceará', 'Nordeste'],
    ['24', 'RN', 'Rio Grande do Norte', 'Nordeste'], ['25', 'PB', 'Paraíba', 'Nordeste'],
    ['26', 'PE', 'Pernambuco', 'Nordeste'], ['27', 'AL', 'Alagoas', 'Nordeste'], ['28', 'SE', 'Sergipe', 'Nordeste'],
    ['29', 'BA', 'Bahia', 'Nordeste'],
    ['31', 'MG', 'Minas Gerais', 'Sudeste'], ['32', 'ES', 'Espírito Santo', 'Sudeste'],
    ['33', 'RJ', 'Rio de Janeiro', 'Sudeste'], ['35', 'SP', 'São Paulo', 'Sudeste'],
    ['41', 'PR', 'Paraná', 'Sul'], ['42', 'SC', 'Santa Catarina', 'Sul'], ['43', 'RS', 'Rio Grande do Sul', 'Sul'],
    ['50', 'MS', 'Mato Grosso do Sul', 'Centro-Oeste'], ['51', 'MT', 'Mato Grosso', 'Centro-Oeste'],
    ['52', 'GO', 'Goiás', 'Centro-Oeste'], ['53', 'DF', 'Distrito Federal', 'Centro-Oeste']
  ].map(function (u) { return { code: u[0], sigla: u[1], nome: u[2], regiao: u[3] }; });

  const UF_BY_CODE = {};
  UFS.forEach(function (u) { UF_BY_CODE[u.code] = u; });

  /* ---------- Formatação (pt-BR) ---------- */
  function nf(d) { return new Intl.NumberFormat('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }); }
  const n0 = nf(0), n1 = nf(1), n2 = nf(2);

  function fmtPop(v) { return v >= 1e6 ? n1.format(v / 1e6) + ' mi' : n0.format(v); }
  function fmtMoney(v) {
    if (v >= 1e12) return 'R$ ' + n2.format(v / 1e12) + ' tri';
    if (v >= 1e9) return 'R$ ' + n1.format(v / 1e9) + ' bi';
    return 'R$ ' + n1.format(v / 1e6) + ' mi';
  }
  function fmtMoneyPc(v) { return 'R$ ' + n0.format(v); }
  function fmtDens(v) { return (v >= 100 ? n0.format(v) : n1.format(v)) + ' hab/km²'; }
  function fmtRatio(v) { return n2.format(v) + '×'; }
  function fmtPct(v) { return n1.format(v * 100) + '%'; }

  const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  function fmtRefDate(date, monthly) {
    if (monthly) return MESES[date.getMonth()] + '/' + date.getFullYear();
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    return dd + '/' + mm + '/' + date.getFullYear();
  }

  /* ---------- Leitura das respostas das APIs ---------- */
  function parseNumber(x) {
    if (x === null || x === undefined) return NaN;
    const s = String(x).trim();
    if (!/^-?\d+([.,]\d+)?$/.test(s)) return NaN; // "-", "...", "X" etc. viram NaN
    return Number(s.replace(',', '.'));
  }

  function unitMultiplier(unit) {
    const u = String(unit || '').toLowerCase();
    if (u.indexOf('bilh') !== -1) return 1e9;
    if (u.indexOf('milh') !== -1) return 1e6;
    if (u.indexOf('mil reais') !== -1) return 1e3;
    return 1;
  }

  /**
   * Resposta de https://servicodados.ibge.gov.br/api/v3/agregados/... para
   * localidades N3 (estados). Devolve { values: Map<codUF, número>, year, unit }.
   * Valores em "Mil Reais" são convertidos para reais.
   */
  function parseAgregado(json) {
    if (!Array.isArray(json) || !json.length) throw new Error('resposta do IBGE vazia ou em formato inesperado');
    const variavel = json[0];
    const series = variavel.resultados && variavel.resultados[0] && variavel.resultados[0].series;
    if (!series || !series.length) throw new Error('resposta do IBGE sem séries');
    const mult = unitMultiplier(variavel.unidade);
    const values = new Map();
    let year = null;
    series.forEach(function (s) {
      const id = String(s.localidade && s.localidade.id);
      if (!UF_BY_CODE[id]) return;
      const years = Object.keys(s.serie || {}).sort();
      for (let i = years.length - 1; i >= 0; i--) {
        const v = parseNumber(s.serie[years[i]]);
        if (!Number.isNaN(v)) {
          values.set(id, v * mult);
          if (!year || years[i] > year) year = years[i];
          break;
        }
      }
    });
    if (!values.size) throw new Error('nenhum valor numérico para os estados');
    return { values: values, year: year, unit: variavel.unidade || '' };
  }

  /**
   * Resposta de https://api.bcb.gov.br/dados/serie/bcdata.sgs.N/dados/ultimos/K.
   * Devolve o último ponto com data menor ou igual a "today".
   */
  function parseSGS(json, today) {
    if (!Array.isArray(json)) throw new Error('resposta do Banco Central em formato inesperado');
    const limit = today || new Date();
    const rows = json.map(function (r) {
      const p = String(r.data).split('/').map(Number);
      return { date: new Date(p[2], p[1] - 1, p[0]), value: parseNumber(r.valor) };
    }).filter(function (r) {
      return !Number.isNaN(r.value) && r.date <= limit;
    }).sort(function (a, b) { return a.date - b.date; });
    if (!rows.length) throw new Error('série sem valores até hoje');
    return rows[rows.length - 1];
  }

  /* ---------- Indicadores ---------- */
  function sum(map) { let s = 0; map.forEach(function (v) { s += v; }); return s; }

  /**
   * raw = { pop, dens, pib } (cada um no formato devolvido por parseAgregado, ou null).
   * Devolve a lista de indicadores que dá para montar com o que carregou.
   */
  function buildIndicators(raw) {
    const out = [];
    const pop = raw.pop, dens = raw.dens, pib = raw.pib;

    if (pop) {
      out.push({
        id: 'pop', label: 'População', short: 'População', kind: 'total',
        values: pop.values, national: sum(pop.values), fmt: fmtPop, year: pop.year,
        source: 'IBGE, Censo Demográfico', refName: 'do total do país',
        note: 'Pessoas residentes em 1º de agosto de 2022, data de referência do Censo.'
      });
    }

    if (dens) {
      let nat = null;
      if (pop) {
        let p = 0, area = 0;
        dens.values.forEach(function (d, code) {
          if (pop.values.has(code) && d > 0) { p += pop.values.get(code); area += pop.values.get(code) / d; }
        });
        if (area > 0) nat = p / area;
      }
      if (nat === null) nat = sum(dens.values) / dens.values.size;
      out.push({
        id: 'dens', label: 'Densidade demográfica', short: 'Densidade', kind: 'ratio',
        values: dens.values, national: nat, fmt: fmtDens, year: dens.year,
        source: 'IBGE, Censo Demográfico', refName: 'da média do Brasil',
        note: 'Habitantes por quilômetro quadrado. Estados grandes e pouco povoados, como Amazonas, ficam com valores baixos.'
      });
    }

    if (pib) {
      out.push({
        id: 'pib', label: 'PIB', short: 'PIB', kind: 'total',
        values: pib.values, national: sum(pib.values), fmt: fmtMoney, year: pib.year,
        source: 'IBGE, Contas Regionais', refName: 'do total do país',
        note: 'Produto Interno Bruto a preços correntes, em reais.'
      });
    }

    if (pop && pib) {
      const pc = new Map();
      const share = new Map();
      let sp = 0, sb = 0;
      pib.values.forEach(function (b, code) {
        if (pop.values.has(code)) { sp += pop.values.get(code); sb += b; }
      });
      pib.values.forEach(function (b, code) {
        const p = pop.values.get(code);
        if (p > 0) {
          pc.set(code, b / p);
          share.set(code, (b / sb) / (p / sp));
        }
      });
      out.push({
        id: 'pib_pc', label: 'PIB per capita', short: 'PIB per capita', kind: 'ratio',
        values: pc, national: sb / sp, fmt: fmtMoneyPc, year: pib.year,
        source: 'IBGE (PIB ÷ população do Censo)', refName: 'da média do Brasil',
        note: 'PIB do estado dividido pelo número de habitantes. Mede o tamanho da economia por pessoa, não a renda de cada morador.'
      });
      out.push({
        id: 'peso', label: 'Peso econômico ÷ peso populacional', short: 'Peso econômico', kind: 'ratio',
        values: share, national: 1, fmt: fmtRatio, year: pib.year,
        source: 'IBGE (PIB e população)', refName: 'do equilíbrio (1,00×)',
        note: 'Quanto a fatia do estado no PIB nacional é maior ou menor que sua fatia na população. Acima de 1× a economia pesa mais que a população.'
      });
    }
    return out;
  }

  /** Posição (1 = maior valor) e total de estados com valor. */
  function rankOf(values, code) {
    const v = values.get(code);
    if (v === undefined) return null;
    let better = 0;
    values.forEach(function (x) { if (x > v) better++; });
    return { pos: better + 1, of: values.size };
  }

  /** Frase de comparação com o Brasil. */
  function compareToNational(ind, v) {
    if (ind.kind === 'total') return fmtPct(v / ind.national) + ' ' + ind.refName;
    const r = v / ind.national;
    if (Math.abs(r - 1) < 0.005) return 'igual ' + ind.refName.replace(/^da /, 'à ').replace(/^do /, 'ao ');
    return fmtPct(Math.abs(r - 1)) + (r > 1 ? ' acima ' : ' abaixo ') + ind.refName;
  }

  return {
    UFS: UFS, UF_BY_CODE: UF_BY_CODE,
    n0: n0, n1: n1, n2: n2,
    fmtPop: fmtPop, fmtMoney: fmtMoney, fmtMoneyPc: fmtMoneyPc, fmtDens: fmtDens,
    fmtRatio: fmtRatio, fmtPct: fmtPct, fmtRefDate: fmtRefDate,
    parseNumber: parseNumber, parseAgregado: parseAgregado, parseSGS: parseSGS,
    buildIndicators: buildIndicators, rankOf: rankOf, compareToNational: compareToNational
  };
});
