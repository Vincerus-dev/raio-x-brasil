/*
 * Raio-X do Brasil — interface: busca os dados nas APIs oficiais, desenha o mapa
 * e liga seleção, comparação e ranking. Depende de d3 (CDN) e de lib.js (window.RX).
 */
(function () {
  'use strict';

  const RX = window.RX;
  const d3 = window.d3;
  const $ = function (s) { return document.querySelector(s); };

  /* ---------- Fontes de dados ---------- */
  const API = {
    malha: 'https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR?intrarregiao=UF&qualidade=minima&formato=' +
      encodeURIComponent('application/vnd.geo+json'),
    agregado: function (tabela, periodo, variavel) {
      return 'https://servicodados.ibge.gov.br/api/v3/agregados/' + tabela + '/periodos/' + periodo +
        '/variaveis/' + variavel + '?localidades=N3[all]';
    },
    // Janela de datas terminando hoje. Algumas séries (como a meta da Selic) trazem datas futuras,
    // então "os últimos N pontos" poderia vir só com datas que ainda não aconteceram.
    sgs: function (serie, days) {
      const end = new Date();
      const start = new Date(end.getTime() - days * 864e5);
      const br = function (d) {
        return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
      };
      return 'https://api.bcb.gov.br/dados/serie/bcdata.sgs.' + serie + '/dados?formato=json&dataInicial=' + br(start) +
        '&dataFinal=' + br(end);
    }
  };

  const MACRO = [
    { serie: 432, label: 'Selic, meta do Copom', monthly: false, fmt: function (v) { return RX.n2.format(v) + '% a.a.'; } },
    { serie: 13522, label: 'Inflação em 12 meses (IPCA)', monthly: true, fmt: function (v) { return RX.n2.format(v) + '%'; } },
    { serie: 1, label: 'Dólar comercial, venda', monthly: false, fmt: function (v) { return 'R$ ' + RX.n2.format(v); } },
    { serie: 24369, label: 'Desemprego (PNAD Contínua)', monthly: true, fmt: function (v) { return RX.n1.format(v) + '%'; } }
  ];

  const RAMP = ['#eaf1ee', '#cfe3db', '#a9d0c3', '#78b5a6', '#3f9486', '#1c6f66', '#0b4a47'];

  /* ---------- Estado ---------- */
  const state = { geo: null, inds: [], cur: null, a: null, b: null, scale: null, status: {} };

  /* ---------- Rede (com cache de sessão) ---------- */
  function getJSON(url) {
    const key = 'rx:' + url;
    try {
      const c = JSON.parse(sessionStorage.getItem(key) || 'null');
      if (c && Date.now() - c.t < 6 * 3600e3) return Promise.resolve(c.d);
    } catch (e) { /* sem cache */ }

    const ctrl = new AbortController();
    const timer = setTimeout(function () { ctrl.abort(); }, 25000);
    return fetch(url, { signal: ctrl.signal })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        try { sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), d: data })); } catch (e) { /* cheio */ }
        return data;
      })
      .catch(function (err) {
        throw new Error(err.name === 'AbortError' ? 'tempo esgotado' : err.message);
      })
      .finally(function () { clearTimeout(timer); });
  }

  /* ---------- Hash da URL (link compartilhável) ---------- */
  function readHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    return { ind: p.get('ind'), a: p.get('uf'), b: p.get('vs') };
  }

  function writeHash() {
    const p = new URLSearchParams();
    if (state.cur) p.set('ind', state.cur.id);
    if (state.a) p.set('uf', state.a);
    if (state.b) p.set('vs', state.b);
    try { history.replaceState(null, '', '#' + p.toString()); } catch (e) { /* ignora */ }
  }

  /* ---------- Faixa de indicadores nacionais ---------- */
  function renderTickerSkeleton() {
    $('#ticker').innerHTML = MACRO.map(function (m, i) {
      return '<li id="tick' + i + '"><span class="tick-v">…</span><span class="tick-l">' + m.label + '</span></li>';
    }).join('');
  }

  function loadTicker() {
    renderTickerSkeleton();
    MACRO.forEach(function (m, i) {
      getJSON(API.sgs(m.serie, m.monthly ? 400 : 45))
        .then(function (json) { return RX.parseSGS(json); })
        .then(function (row) {
          $('#tick' + i).innerHTML =
            '<span class="tick-v">' + m.fmt(row.value) + '</span>' +
            '<span class="tick-l">' + m.label + '</span>' +
            '<span class="tick-r">ref. ' + RX.fmtRefDate(row.date, m.monthly) + '</span>';
        })
        .catch(function () {
          $('#tick' + i).innerHTML =
            '<span class="tick-v na">sem dado agora</span><span class="tick-l">' + m.label + '</span>';
        });
    });
  }

  /* ---------- Seleção ---------- */
  function code(f) { return String(f.properties.codarea); }

  function selectUF(c, asCompare) {
    if (asCompare) {
      if (c === state.a) return;
      state.b = state.b === c ? null : c;
    } else {
      state.a = c;
      if (state.b === c) state.b = null;
    }
    refresh();
  }

  /* ---------- Abas ---------- */
  function renderTabs() {
    const box = $('#tabs');
    box.innerHTML = state.inds.map(function (ind) {
      return '<button type="button" class="tab" data-ind="' + ind.id + '" aria-pressed="' +
        (ind === state.cur) + '">' + ind.short + '</button>';
    }).join('');
    box.querySelectorAll('.tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.cur = state.inds.find(function (i) { return i.id === btn.dataset.ind; });
        updateScale();
        refresh();
      });
    });
  }

  // Só troca o estado "pressionado": não recria os botões, para não perder o foco do teclado.
  function updateTabs() {
    document.querySelectorAll('#tabs .tab').forEach(function (btn) {
      btn.setAttribute('aria-pressed', String(btn.dataset.ind === state.cur.id));
    });
  }

  function updateScale() {
    const vals = Array.from(state.cur.values.values());
    state.scale = d3.scaleQuantile().domain(vals).range(RAMP);
  }

  /* ---------- Mapa ---------- */
  function showMapMsg(html) {
    const el = $('#mapMsg');
    el.innerHTML = html;
    el.hidden = false;
  }

  function buildMap() {
    const svg = d3.select('#map');
    svg.selectAll('*').remove();
    if (!state.geo) {
      showMapMsg('Não foi possível carregar o mapa do IBGE. <button type="button" id="retry">Tentar de novo</button>');
      const r = $('#retry');
      if (r) r.addEventListener('click', function () { location.reload(); });
      return;
    }
    $('#mapMsg').hidden = true;

    const W = 640, H = 640, margin = 12;
    // Projeção plana (sem ordem de enrolamento esférica), com correção de longitude pela latitude média do país.
    const k = Math.cos(15 * Math.PI / 180);
    const flat = d3.geoTransform({ point: function (x, y) { this.stream.point(x * k, -y); } });
    const b = d3.geoPath(flat).bounds(state.geo);
    const w = b[1][0] - b[0][0], h = b[1][1] - b[0][1];
    const s = Math.min((W - 2 * margin) / w, (H - 2 * margin) / h);
    const ox = (W - s * w) / 2, oy = (H - s * h) / 2;
    const proj = d3.geoTransform({
      point: function (x, y) { this.stream.point((x * k - b[0][0]) * s + ox, (-y - b[0][1]) * s + oy); }
    });
    const path = d3.geoPath(proj);

    const g = svg.append('g');
    g.selectAll('path')
      .data(state.geo.features, code)
      .join('path')
      .attr('class', 'uf')
      .attr('d', path)
      .attr('fill-rule', 'evenodd')
      .attr('tabindex', 0)
      .attr('role', 'button')
      .attr('aria-label', function (f) { const u = RX.UF_BY_CODE[code(f)]; return u ? u.nome : 'Estado'; })
      .on('click', function (e, f) { selectUF(code(f), e.shiftKey || e.metaKey || e.ctrlKey); })
      .on('keydown', function (e, f) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectUF(code(f), e.shiftKey); }
      })
      .on('mousemove', function (e, f) { showTip(f, e); })
      .on('mouseleave', hideTip)
      .on('focus', function (e, f) { showTip(f, null, this); })
      .on('blur', hideTip);

    g.append('g')
      .selectAll('text')
      .data(state.geo.features.filter(function (f) { return path.area(f) > 700; }), code)
      .join('text')
      .attr('class', 'lab')
      .attr('x', function (f) { return path.centroid(f)[0]; })
      .attr('y', function (f) { return path.centroid(f)[1]; })
      .text(function (f) { const u = RX.UF_BY_CODE[code(f)]; return u ? u.sigla : ''; });
  }

  function paintMap() {
    if (!state.geo || !state.cur) return;
    const ind = state.cur;
    const darkFrom = RAMP.indexOf('#3f9486');
    d3.selectAll('#map path.uf')
      .attr('fill', function (f) {
        const v = ind.values.get(code(f));
        return v === undefined ? 'var(--none)' : state.scale(v);
      })
      .classed('is-a', function (f) { return code(f) === state.a; })
      .classed('is-b', function (f) { return code(f) === state.b; })
      .filter(function (f) { return code(f) === state.a || code(f) === state.b; })
      .raise();

    d3.selectAll('#map text.lab').classed('on-dark', function (f) {
      const v = ind.values.get(code(f));
      return v !== undefined && RAMP.indexOf(state.scale(v)) >= darkFrom;
    });
  }

  function showTip(f, evt, node) {
    const u = RX.UF_BY_CODE[code(f)];
    const v = state.cur && state.cur.values.get(code(f));
    const tip = $('#tip');
    tip.innerHTML = '<strong>' + (u ? u.nome : 'Estado') + '</strong>' +
      (v !== undefined && state.cur ? state.cur.fmt(v) : 'sem dado');
    tip.hidden = false;
    const wrap = $('.mapwrap').getBoundingClientRect();
    let x, y;
    if (evt) { x = evt.clientX - wrap.left + 14; y = evt.clientY - wrap.top + 14; }
    else { const r = node.getBoundingClientRect(); x = r.left - wrap.left + r.width / 2; y = r.top - wrap.top + r.height / 2; }
    const maxX = wrap.width - tip.offsetWidth - 4;
    tip.style.left = Math.max(0, Math.min(x, maxX)) + 'px';
    tip.style.top = y + 'px';
  }

  function hideTip() { $('#tip').hidden = true; }

  /* ---------- Legenda ---------- */
  function renderLegend() {
    const ind = state.cur;
    const vals = Array.from(ind.values.values());
    $('#legend').innerHTML =
      '<div class="legend-bar" aria-hidden="true">' + RAMP.map(function (c) { return '<i style="background:' + c + '"></i>'; }).join('') + '</div>' +
      '<div class="legend-ends"><span>Menor: ' + ind.fmt(d3.min(vals)) + '</span><span>Maior: ' + ind.fmt(d3.max(vals)) + '</span></div>' +
      '<p class="legend-note">As 7 cores dividem os estados em grupos do mesmo tamanho, do menor para o maior valor.</p>';
  }

  /* ---------- Seletores ---------- */
  function fillSelectors() {
    const opt = RX.UFS.slice().sort(function (x, y) { return x.nome.localeCompare(y.nome, 'pt-BR'); })
      .map(function (u) { return '<option value="' + u.code + '">' + u.nome + '</option>'; }).join('');
    $('#selA').innerHTML = opt;
    $('#selB').innerHTML = '<option value="">Nenhum</option>' + opt;
    $('#selA').addEventListener('change', function (e) { selectUF(e.target.value, false); });
    $('#selB').addEventListener('change', function (e) {
      state.b = e.target.value && e.target.value !== state.a ? e.target.value : null;
      refresh();
    });
  }

  /* ---------- Ficha e comparação ---------- */
  function renderDossier() {
    const ind = state.cur;
    $('#selA').value = state.a || '';
    $('#selB').value = state.b || '';

    const u = RX.UF_BY_CODE[state.a];
    const v = ind.values.get(state.a);
    if (!u || v === undefined) {
      $('#facts').innerHTML = '<p class="note">Escolha um estado no mapa ou na lista acima.</p>';
    } else {
      const rk = RX.rankOf(ind.values, state.a);
      $('#facts').innerHTML =
        '<h2>' + u.nome + '</h2>' +
        '<p class="region">' + u.sigla + ', região ' + u.regiao + '</p>' +
        '<p class="fig-label">' + ind.label + (ind.year ? ' (' + ind.year + ')' : '') + '</p>' +
        '<p class="fig">' + ind.fmt(v) + '</p>' +
        '<ul class="facts-list">' +
        '<li><span>Posição entre os estados</span><strong>' + rk.pos + 'º de ' + rk.of + '</strong></li>' +
        '<li><span>Em relação ao Brasil</span><strong>' + RX.compareToNational(ind, v) + '</strong></li>' +
        '</ul>' +
        '<p class="note">' + ind.note + ' Fonte: ' + ind.source + '.</p>';
    }

    const ub = RX.UF_BY_CODE[state.b];
    if (!u || !ub) { $('#compare').innerHTML = ''; return; }
    const rows = state.inds.map(function (i) {
      const x = i.values.get(state.a), y = i.values.get(state.b);
      if (x === undefined || y === undefined) return '';
      return '<tr><td>' + i.short + '</td><td class="' + (x > y ? 'win' : '') + '">' + i.fmt(x) +
        '</td><td class="' + (y > x ? 'win' : '') + '">' + i.fmt(y) + '</td></tr>';
    }).join('');
    $('#compare').innerHTML =
      '<table class="cmp"><caption>Lado a lado</caption><thead><tr><th scope="col"><span class="sr">Indicador</span></th>' +
      '<th scope="col" class="ca">' + u.sigla + '</th><th scope="col" class="cb">' + ub.sigla + '</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>';
  }

  /* ---------- Ranking ---------- */
  function renderRank() {
    const ind = state.cur;
    const rows = Array.from(ind.values.entries()).map(function (e) { return { c: e[0], v: e[1] }; })
      .sort(function (x, y) { return y.v - x.v; });
    const max = rows.length ? rows[0].v : 1;
    $('#rankTitle').textContent = 'Ranking: ' + ind.label;
    $('#rankList').innerHTML = rows.map(function (r, i) {
      const cls = r.c === state.a ? 'is-a' : (r.c === state.b ? 'is-b' : '');
      const u = RX.UF_BY_CODE[r.c];
      return '<li><button type="button" class="' + cls + '" data-uf="' + r.c + '" title="' + u.nome + '">' +
        '<span class="r-pos">' + (i + 1) + '</span><span class="r-uf">' + u.sigla + '</span>' +
        '<span class="r-bar"><i style="width:' + Math.max(1, r.v / max * 100).toFixed(1) + '%"></i></span>' +
        '<span class="r-val">' + ind.fmt(r.v) + '</span></button></li>';
    }).join('');
  }

  /* ---------- Atualização geral ---------- */
  function refresh() {
    paintMap();
    updateTabs();
    renderLegend();
    renderDossier();
    renderRank();
    writeHash();
  }

  function renderStatus() {
    const names = { geo: 'mapa', pop: 'população', dens: 'densidade', pib: 'PIB' };
    const bad = Object.keys(state.status).filter(function (k) { return state.status[k] !== 'ok'; });
    $('#status').textContent = bad.length === 0
      ? 'Todas as fontes carregaram.'
      : 'Fontes que não carregaram: ' + bad.map(function (k) { return names[k] + ' (' + state.status[k] + ')'; }).join(', ') +
        '. O que depende delas fica de fora até a próxima tentativa.';
  }

  /* ---------- Início ---------- */
  function init() {
    if (!d3) { $('#status').textContent = 'Não foi possível carregar a biblioteca de mapas (d3).'; return; }
    fillSelectors();
    loadTicker();

    $('#rankList').addEventListener('click', function (e) {
      const btn = e.target.closest('button[data-uf]');
      if (btn) selectUF(btn.dataset.uf, e.shiftKey);
    });

    const want = readHash();
    const jobs = {
      geo: getJSON(API.malha),
      pop: getJSON(API.agregado(4714, 2022, 93)).then(RX.parseAgregado),
      dens: getJSON(API.agregado(4714, 2022, 616)).then(RX.parseAgregado),
      pib: getJSON(API.agregado(5938, -1, 37)).then(RX.parseAgregado)
    };
    const names = Object.keys(jobs);

    Promise.allSettled(names.map(function (n) { return jobs[n]; })).then(function (res) {
      const got = {};
      res.forEach(function (r, i) {
        state.status[names[i]] = r.status === 'fulfilled' ? 'ok' : ((r.reason && r.reason.message) || 'erro');
        got[names[i]] = r.status === 'fulfilled' ? r.value : null;
      });
      renderStatus();

      state.geo = got.geo && Array.isArray(got.geo.features) ? got.geo : null;
      state.inds = RX.buildIndicators({ pop: got.pop, dens: got.dens, pib: got.pib });

      if (!state.inds.length) {
        showMapMsg('Não foi possível carregar os dados do IBGE agora. <button type="button" id="retry">Tentar de novo</button>');
        $('#retry').addEventListener('click', function () { location.reload(); });
        $('#facts').innerHTML = '<p class="note">Sem dados para mostrar.</p>';
        return;
      }

      state.cur = state.inds.find(function (i) { return i.id === want.ind; }) || state.inds[0];
      state.a = RX.UF_BY_CODE[want.a] ? want.a : '35';
      state.b = RX.UF_BY_CODE[want.b] && want.b !== state.a ? want.b : null;
      updateScale();
      renderTabs();
      buildMap();
      refresh();
    });
  }

  init();
})();
