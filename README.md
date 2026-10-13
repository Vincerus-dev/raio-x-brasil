# Raio-X do Brasil

Mapa interativo dos 27 estados com dados oficiais do **IBGE** e do **Banco Central**, buscados direto das APIs públicas toda vez que a página abre. Clique em um estado para ver a ficha dele, compare com outro lado a lado e compartilhe o link exato do que você está vendo.

**Demo:** `https://SEU-USUARIO.github.io/raio-x-brasil/` (troque pelo seu usuário depois de publicar)

## O que dá para fazer

- Colorir o mapa por **população**, **densidade demográfica**, **PIB**, **PIB per capita** e **peso econômico** (fatia do PIB dividida pela fatia da população).
- Clicar em um estado para ver valor, posição entre os 27 e comparação com o Brasil. Segure **Shift** ao clicar para escolher um segundo estado e ver os dois lado a lado.
- Acompanhar o **ranking** completo do indicador escolhido.
- Ver, no topo, **Selic, IPCA em 12 meses, dólar e desemprego** com a data de referência de cada um.
- Copiar a URL: o indicador e os estados escolhidos ficam no endereço (`#ind=pib_pc&uf=33&vs=35`).
- Usar só o teclado: o mapa, as abas, as listas e o ranking têm foco visível, e os estados também podem ser escolhidos pelas listas.

## De onde vêm os dados

Nada é guardado no repositório. Tudo é pedido às fontes oficiais pelo navegador de quem abre a página:

| Dado | Fonte | Endereço |
| --- | --- | --- |
| Contorno dos estados | IBGE, API de malhas | `servicodados.ibge.gov.br/api/v3/malhas/paises/BR?intrarregiao=UF` |
| População e densidade (Censo 2022) | IBGE, API de agregados, tabela 4714 | variáveis 93 e 616 |
| PIB por estado | IBGE, Contas Regionais, tabela 5938 | variável 37, período mais recente |
| Selic, IPCA, dólar, desemprego | Banco Central, SGS | séries 432, 13522, 1 e 24369 |

PIB per capita e peso econômico são **calculados** aqui a partir do PIB e da população. Como o PIB é de um ano posterior ao Censo, o resultado mistura os dois anos, e a ficha mostra o ano do PIB.

Se uma fonte falhar, o site mostra qual foi e continua funcionando com o resto. A lista de fontes que carregaram aparece no rodapé.

## Como rodar no seu computador

Não precisa instalar nada. Só é preciso servir os arquivos por HTTP (abrir o `index.html` direto do disco bloqueia as chamadas às APIs):

```bash
npm run serve        # ou: python3 -m http.server 8000
# abra http://localhost:8000
```

## Testes

A lógica que não depende do navegador (leitura das respostas das APIs, conversão de unidades, indicadores derivados, ranking, formatação) fica em `lib.js` e tem testes com o executor nativo do Node:

```bash
npm test
```

A integração roda a cada push no GitHub (`.github/workflows/test.yml`).

## Publicar no GitHub Pages

1. Crie o repositório `raio-x-brasil` no GitHub e envie estes arquivos.
2. Em **Settings, Pages**, escolha **Deploy from a branch**, branch `main`, pasta `/ (root)`.
3. Em um ou dois minutos o site fica em `https://SEU-USUARIO.github.io/raio-x-brasil/`.

## Estrutura

```
index.html   página e metadados de compartilhamento
style.css    visual
lib.js       funções puras: leitura das APIs, indicadores, formatação
app.js       interface: mapa, seleção, comparação, ranking
tests/       testes de lib.js
```

## Decisões de projeto

- **Sem build e sem framework.** HTML, CSS e JavaScript puro, mais d3 pelo CDN só para desenhar o mapa. Qualquer pessoa abre, lê e altera.
- **Projeção plana em vez de esférica.** O d3 espera polígonos com um sentido de desenho específico; a projeção plana, com correção de longitude, evita estados "invertidos" venha o arquivo como vier.
- **Cores por quantis.** População e PIB são muito desiguais entre estados. Dividir em 7 grupos de tamanho igual deixa o mapa legível, e a legenda avisa disso.
- **Cada fonte carrega separada.** Uma API fora do ar não derruba o site inteiro.
- **Só dados oficiais e sem opinião.** Nenhum dado eleitoral ou de pesquisa de opinião, de propósito.

## Ideias para evoluir

- Mais indicadores por estado (alfabetização, renda, esperança de vida).
- Zoom para municípios de um estado.
- Série histórica do PIB com gráfico de linha ao escolher um estado.

## Licença

MIT. Veja o arquivo `LICENSE`. Os dados pertencem às suas fontes (IBGE e Banco Central do Brasil).
