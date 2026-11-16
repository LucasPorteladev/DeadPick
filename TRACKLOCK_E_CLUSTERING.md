# Tracklock e agrupamento de compras

## Dados extraídos

A coleta cobre os 44 heróis jogáveis do catálogo local e três páginas públicas por herói:

- `/heroes/<slug>/items`: frequência de uso, winrate, custo e vitórias/derrotas exibidos por item. A página padrão não comprova um filtro Phantom+, e seu período não foi verificado. Contagens abreviadas como `48.9K` são preservadas como texto.
- `/heroes/<slug>/probuild`: partidas de jogadores classificados como profissionais pelo Tracklock, últimos 30 dias, com oito itens mais frequentes em cada uma das fases 0–10, 10–20 e 20+ minutos. Essa classificação não comprova o rank individual.
- `/heroes/<slug>/build`: variante editorial padrão, separada em Core Build, Early, Late, Defensives, Counter Picks e Actives. As listas editoriais não são contagens de compras.

Foram extraídas 6.827 linhas de tabelas de itens e 1.056 referências de compra por fase. A soma dos volumes de Pro Builds é 6.291 participações de heróis, podendo compartilhar partidas; não é um total de partidas únicas. O volume pro varia de 13 para McGinnis a 454 para Deadman Danny.

O índice público fornece os slugs; não há adivinhação de endpoints privados. Cada página tem snapshot HTML, URL, horário de captura e SHA-256. Os IDs são associados por nome exato ao catálogo da Deadlock API; nomes desconhecidos permanecem sem ID. `extracao.json` consolida os dados e erros. Os JSON individuais permitem inspecionar cada personagem.

## Como o k-means é usado

1. A união dos itens de Pro Builds, de todas as seções da build editorial e dos itens com uso de pelo menos 10% na tabela geral forma candidatos por herói. Isso preserva counters e defensivos mesmo com baixa popularidade e inclui itens populares ausentes na variante editorial. O corte de 10% é uma heurística inicial. A origem da tabela geral fica marcada como rank não verificado; a modelagem subsequente usa exclusivamente participações Phantom+.
2. Na base `data/base-ampliada-6860`, selecionamos participações com rank individual Phantom I+ (`>=91`). Cada participação gera um vetor binário: o item apareceu ou não entre seus registros de entrada de loja. Recompras não aumentam o peso.
3. O vetor considera os candidatos do Tracklock e recebe normalização L2 para reduzir a diferença de magnitude entre partidas com quantidades distintas de itens. Isso não elimina o efeito da duração ou do patrimônio.
4. Para cada herói, comparamos k de 2 a 5 por silhouette, exigindo pelo menos 20 participações por grupo. Usamos `random_state=42`, `n_init=20` e registramos a versão do scikit-learn. Quando não há solução elegível, há um grupo único.
5. Exportamos as frequências por item dentro de cada grupo. `itens_frequentes_item_ids` reúne itens presentes em pelo menos 50% do grupo; esse limiar é uma convenção inicial configurada no código. A lista é um perfil de compras e não uma build simultaneamente equipável.

Não usamos winrate como feature para favorecer itens de final de jogo ou de jogadores que já estavam vencendo. Também não calculamos um winrate dos clusters nesta etapa. [KMeans](https://scikit-learn.org/stable/modules/generated/sklearn.cluster.KMeans.html) · [Silhouette](https://scikit-learn.org/stable/modules/generated/sklearn.metrics.silhouette_score.html)

## Uso e limites

A execução concluída modelou 116.364 das 116.369 participações elegíveis; cinco não tiveram entrada de um candidato do filtro. Cada herói ficou com 34 a 62 candidatos. A cobertura dos pares participação–item comprado varia de 83,96% a 96,69%. A validação passou para as 132 páginas e todos os modelos, sem referências de itens sem ID.

Para Paradox, são 4.496 participações, 38 candidatos e dois grupos, com 2.783 e 1.713 participações. O primeiro tem maior presença de Sharpshooter/Long Range; o segundo, Headshot Booster/Headhunter. Os grupos se sobrepõem muito: o silhouette selecionado é 0,091, uma separação fraca. Entre todos os heróis, os valores selecionados variam de 0,068 a 0,317. Esses números reforçam o uso exploratório, sem atribuir uma classe rígida ou uma build ideal a cada personagem.

`candidatos.json` é o ponto de entrada para o recomendador: candidatos por hero_id, origem de cada item e itens frequentes por perfil. `clusters.json` contém centroides, ordem das features, avaliações de k, frequências completas e diagnóstico dos itens comprados fora do filtro. `resumo.csv` facilita comparar os heróis; `qualidade.json` registra as verificações.

O filtro é experimental e deve priorizar candidatos, permitindo exceções pelo contexto. Uma baixa cobertura de compras indica que a lista precisa ser revisada. A página editorial coletada é a variante padrão; variantes alternativas ainda podem acrescentar estilos ausentes.

Os agrupamentos descrevem coocorrência de compras na mesma participação. Não demonstram sinergia causal nem qual compra aumenta a chance de vencer. Incluem itens vendidos e componentes substituídos: a ordem e o inventário simultâneo precisam dos registros de decisões. Um grupo pode refletir duração, riqueza, estilo ou matchup, e o melhor silhouette entre as opções não garante uma separação forte.

As partidas Phantom+ são históricas, de 6 a 8 de novembro de 2026, catálogo 6860. O Tracklock foi capturado posteriormente e seus Pro Builds abrangem 30 dias, sem separação por patch. Essa mistura foi aceita para exploração, mas não deve ser interpretada como um modelo validado para o balanceamento atual. O conjunto pro possui amostras pequenas em alguns heróis. A validação preditiva e a escolha contextual de perfil continuam pendentes.

O simulador foi integrado aos perfis dos 44 heróis. A seleção automática considera tamanho do grupo e presença das compras marcadas. A fila considera itens com frequência de pelo menos 45% no perfil (até 18 antes de acrescentar componentes e counters), medianas históricas de tempo por herói e precedência de componentes do catálogo. Os counters continuam baseados em regras manuais. Frequências exibidas se referem ao perfil, e os horários são referências históricas, não prazos obrigatórios. Testes locais verificam geração e avanço da fila em 132 cenários.

## Reprodução

### Estado da partida e prioridade contextual no simulador

O minuto atual e as almas disponíveis são enviados pela interface ao recomendador. Saldo em branco significa desconhecido: permite explorar a sequência, mas não permite antecipar um counter pelas regras de contexto. Com saldo informado, a compra só pode ser marcada se houver almas suficientes; o valor restante é atualizado. O preço da evolução desconta componentes atualmente equipados, que são removidos do inventário ao concluir o upgrade.

Inventário atual e histórico são separados. O perfil usa o inventário atual. O histórico impede repetir compras e conserva componentes consumidos na sequência realizada. **Adicionar item existente** sincroniza o estado informado sem cobrar almas; remover um item corrige esse estado, sem simular venda ou receita. **Desfazer alteração** restaura inventário, histórico e saldo da última compra/edição de inventário. O tempo não avança automaticamente. Não há ingestão do estado do jogo, limite de slots, vendas ou leitura de patrimônio inimigo nesta etapa.

Detectar uma ameaça gera uma sugestão em **Respostas à composição**. Para promover uma resposta para a frente da fila, são exigidos:

- Pelo menos duas das três compras iniciais do perfil, desconsiderando os três counters manuais; componentes cobertos por upgrades também contam.
- Minuto mínimo provisório por tier: I = 4, II = 6, III = 12, IV = 20.
- Saldo conhecido e suficiente, descontados componentes atuais.

Esses limites são heurísticas iniciais, sem validação estratégica ou aprendizado. Um item que já pertence à build mantém a posição natural se não for promovido; nenhum counter é adicionado à fila apenas por detectar um herói no início. Uma única resposta recebe promoção por decisão, priorizando o número de ameaças reconhecidas e depois o menor custo. Para controle, a opção avaliada antes de 12 minutos é Reactive Barrier quando não há proteção aliada; nos demais casos é Counterspell. A composição e os grupos de ameaça continuam manuais.

Quando o counter já integra o perfil, sua entrada é atualizada sem duplicar o item. Componentes continuam precedendo upgrades. Itens disponíveis por contexto podem passar pelo filtro de popularidade; o bloco contextual mostra o motivo e as condições ainda pendentes. Um saldo insuficiente não faz o sistema trocar automaticamente a build por um item barato: a interface indica quanto falta para a próxima compra.

Validação: `node testar_recomendador.cjs` cobre 132 cenários dos 44 heróis com inventário/histórico separados e regressões de urgência, tempo, orçamento, duplicatas e upgrades. `node testar_interface.cjs` exercita os eventos reais da interface em um DOM mínimo, verificando os campos, fila, saldo, correção de inventário e desfazer. Esses testes não são validação visual em navegador nem avaliação de qualidade estratégica.

Dependências: Python 3.11+, curl, beautifulsoup4, numpy, scikit-learn e threadpoolctl.

```powershell
python coletar_tracklock_todos.py
python agrupar_builds_tracklock.py
python validar_tracklock.py
```

A coleta reutiliza os snapshots existentes e retoma páginas ausentes. Para renovar todas as páginas, execute `python coletar_tracklock_todos.py --atualizar` e depois repita o agrupamento e a validação. Para manter histórico, copie a pasta antes da atualização, pois esse comando substitui os snapshots. O processamento dos clusters é local e exige a base ampliada e os catálogos já extraídos. Os hashes da extração e da auditoria da base ficam registrados em `clusters.json`.
