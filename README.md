> **Versão HTML preservada.** Comece por [PRESERVACAO_HTML.md](PRESERVACAO_HTML.md) para executar, testar, restaurar a coleta e organizar as branches. O simulador funciona com os dados locais incluídos.

# Deadpick

Sistema de recomendação de compras para Deadlock. A pergunta do projeto é qual item faz sentido comprar a seguir dado o herói, as duas composições, o tempo de jogo e os itens já comprados.

## Etapa 1 — validar os dados

O piloto usa Python 3.11 e a biblioteca padrão. A partir da pasta do projeto, execute:

```powershell
python coletar_amostra.py
```

Por padrão, o script consulta até cinco partidas do modo normal dos últimos sete dias, em ordem decrescente de ID. Em `data/amostra/`, ele grava `partidas.json` com a resposta da API e `auditoria.json` com os parâmetros da consulta e a cobertura de composições, vencedor e registros de itens com ID e tempo. Para repetir a coleta, indique um diretório novo com `--saida`.

O piloto preserva os registros de item como vieram da API. Antes de tratá-los como compras de loja, a próxima etapa vai cruzar os IDs com o catálogo e validar a semântica dos horários, vendas e melhorias. [Documentação da Deadlock API](https://api.deadlock-api.com/docs)

## Próximas etapas

O [desenho do recomendador](DESENHO.md) define os fatores, os dados necessários e como avaliar sinergias.

A [investigação de integração e escala](INTEGRACAO_E_ESCALA.md) descreve a integração futura com o HUD do jogo, as informações a validar no cliente e a expansão para mais partidas e heróis. `python auditar_cobertura.py` gera a cobertura local por herói e rank em `data/paradox/cobertura_herois.json`.

## Extração da Paradox

A coleta local está em `data/paradox/`. O recorte cobre o modo normal ranqueado de 6 de novembro de 2026 às 01h UTC até 9 de novembro às 00h UTC, com fim exclusivo. A versão 6860 foi atribuída pela janela de tempo e usada no catálogo. A listagem de partidas não informa a versão individual. A coleta pegou os primeiros 60 IDs elegíveis por janela de até seis horas. Todas as 12 janelas atingiram o limite. [Histórico de versões](https://postgame.news/builds/gametracking/GameTracking-Deadlock) · [Deadlock API](https://api.deadlock-api.com/openapi.json)

| Arquivo em `data/paradox/` | Conteúdo |
| --- | --- |
| `bruto/` | Respostas por consulta, catálogos de itens e heróis, ranks, patches e snapshots do Tracklock. |
| `auditoria.json` | URLs, volumes, janela de coleta e contagens de qualidade. |
| `partidas.jsonl.gz` e `jogadores_partida.jsonl.gz` | 720 partidas e 8.640 jogadores, com heróis e times. |
| `eventos_item.jsonl.gz` | 275.310 registros originais de itens e habilidades, associados ao catálogo e identificados por partida, slot e índice. |
| `linha_do_tempo.jsonl.gz` | Inventário inferido da Paradox antes e depois de cada segundo com entradas ou saídas. |
| `decisoes_compra_candidatas.jsonl.gz` | 11.757 entradas de itens de loja, com inventário anterior ao segundo, composições, custo de catálogo e patrimônio registrado. |
| `decisoes_compra_alto_rank_individual.jsonl.gz` | 1.255 entradas em que a Paradox começou a partida em Phantom I ou acima. O rank individual está no campo `player_rank_initial_display_rank`. |
| `resultados.jsonl.gz` | Time vencedor por partida, separado das entradas do recomendador. |
| `uso_alto_rank.json` | Contagens por item e fase para partidas com filtro de rank médio mínimo Ascendant I, com população da Paradox que chegou a cada fase. |
| `tracklock.json` | 24 frequências de profissionais por fase, duas variantes de build com suas seções e 156 itens da tabela padrão. |

O piloto de 720 partidas cobre todos os ranks encontrados. O recorte individual contém 57 partidas de Phantom, 25 de Ascendant e nenhuma de Eternus. O agregado `uso_alto_rank.json` usa a média do lobby, com corte Ascendant I, no mesmo período da coleta. Os profissionais monitorados pelo Tracklock são outro recorte, de 30 dias. A tabela padrão do Tracklock foi coletada sem filtro de rank. [Pro Builds](https://prod.tracklock.gg/heroes/paradox/probuild) · [Itens](https://prod.tracklock.gg/heroes/paradox/items)

A reconstrução usa `game_time_s` como entrada e `sold_time_s` positivo como saída de um registro de loja. Quando mais de uma ação ocorre no mesmo segundo, a ordem e o inventário imediatamente anterior à ação específica ficam ambíguos. Isso afeta 4.367 entradas. Uma saída também pode corresponder ao consumo de um componente. O custo de catálogo e o patrimônio são preservados em campos distintos. As entradas de loja são candidatas a compras até validar a semântica dos eventos com replay.

Na partida `133825977`, aos 6m20s, o inventário reconstruído passa de Battle Vest, High-Velocity Rounds, Long Range e Restorative Shot para Battle Vest, Sharpshooter e Restorative Shot. A linha do tempo registra as duas saídas e a entrada de Sharpshooter no mesmo segundo e conserva a referência a cada registro original.

A API retornou o esquema do replay de `133825977`, mas as consultas de compra, aquisição e estado do jogador falharam porque as tabelas estavam indisponíveis durante a execução. As requisições e respostas estão em `bruto/demo-*.json`. A verificação da linha do tempo foi feita contra os metadados de partida. A confirmação independente por replay permanece pendente.

```powershell
python extrair_paradox.py            # baixa ou reutiliza a coleta da Deadlock API
python extrair_paradox.py --offline  # reprocessa os brutos sem rede
python extrair_paradox.py --verificar-patch  # confere o catálogo e as notas publicadas
python extrair_tracklock.py          # lê os quatro snapshots HTML locais, requer beautifulsoup4
```

## Base ampliada

`python ampliar_base.py` baixa e normaliza as partidas listadas na consulta de elegibilidade local. A extração concluída tem 13.458 partidas, 116.369 participações Phantom I+, 3.623.432 registros de itens e habilidades e 1.925.159 decisões candidatas. A consulta ao data lake selecionou os IDs distintos no mesmo período de 6 a 8 de novembro de 2026, com pelo menos um jogador de rank individual Phantom I+. A resposta foi conferida quanto ao cabeçalho de truncamento antes de iniciar a coleta. Todos os IDs solicitados retornaram metadados.

A base cobre os 44 heróis jogáveis do catálogo 6860. Paradox passou de 82 para 4.496 participações elegíveis, com 71.319 decisões candidatas de 1.314 jogadores distintos. Os volumes por herói variam de 841 participações de Sinclair a 5.882 de Haze. As participações podem compartilhar a mesma partida, e um jogador pode aparecer em várias partidas.

Os arquivos ficam em `data/base-ampliada-6860/`. Os brutos são cacheados por lote de IDs para permitir retomar a coleta. `auditoria.json` é gerado após completar os lotes e contém as contagens por herói, jogadores distintos, ranks e decisões. As composições incluem todos os jogadores, e os eventos e decisões normalizados usam somente participantes de rank individual Phantom I+. `python ampliar_base.py --offline` reprocessa os lotes já baixados. Os arquivos normalizados usam nomes temporários durante a execução e são finalizados ao terminar o processamento.

| Arquivo | Conteúdo |
| --- | --- |
| `partidas.jsonl.gz` | Data, duração, modo, resultado e contexto de cada partida. |
| `jogadores.jsonl.gz` | Os 12 participantes, com herói, time, lane atribuída e rank individual de entrada. |
| `eventos.jsonl.gz` | Eventos de itens e habilidades dos jogadores elegíveis, com os campos originais e associação ao catálogo. |
| `decisoes.jsonl.gz` | Entradas de loja, inventário anterior ao segundo, composições, patrimônio na compra e marcadores de ambiguidade ou inconsistência. |
| `auditoria.json` | Consultas, lotes, partidas indisponíveis e volumes por herói e rank. |
| `qualidade.json` e `cobertura.csv` | Resultado da validação, jogadores distintos e cobertura por herói. |

Execute `python validar_base.py` após a coleta. A validação lê integralmente os quatro arquivos comprimidos, procura duplicações, confere ranks e composições e reconcilia os totais com a auditoria. A chave dos registros de evento e decisão é `(match_id, player_slot, indice_registro)`.

A validação da extração concluída passou. Há 1.152.591 decisões sem empate de ordem e 772.568 decisões com mais de uma ação no mesmo segundo. Os marcadores de inventário inconsistente, catálogo incompleto e patrimônio ausente ficaram zerados nas decisões. Uma participação elegível veio sem registros de itens e permanece identificada na auditoria.

A consulta SQL, os cabeçalhos HTTP e os IDs selecionados ficam preservados em `bruto/`. O corte mantém o catálogo 6860 do piloto. A API já lista 6861 entre as versões disponíveis, então esse conjunto deve ser tratado como um recorte histórico. Para novas datas, confirmar os limites da versão antes de criar outro conjunto. [API e data lake](https://api.deadlock-api.com/docs)

## Tracklock para todos os heróis e k-means

A coleta em `data/tracklock-todos/` contém as páginas de itens, Pro Builds e build padrão dos 44 heróis, com snapshots, URLs, horários e hashes. Foram extraídas 6.827 linhas de itens e 1.056 referências de compra por fase. O agrupamento cruza candidatos do Tracklock com conjuntos de compras de jogadores Phantom I+ da base ampliada. Os recortes Pro Builds e tabela geral ficam identificados separadamente, pois não comprovam o mesmo corte de rank.

```powershell
python coletar_tracklock_todos.py
python agrupar_builds_tracklock.py
python validar_tracklock.py
```

`candidatos.json` exporta os itens por herói e os perfis frequentes; `clusters.json` contém as métricas e frequências completas; `resumo.csv` permite comparar todos os heróis. O filtro é experimental e preserva counters e defensivos. A documentação [TRACKLOCK_E_CLUSTERING.md](TRACKLOCK_E_CLUSTERING.md) explica os critérios, a reprodução e os limites. O simulador usa agora os perfis de todos os 44 heróis, combinados com regras manuais de composição.

## Simulador local

Abra `simulador/index.html` no navegador. Escolha seu herói e indique sua lane no painel central. Complete as duas composições clicando nos espaços das lanes. Todos os 44 heróis jogáveis e os 173 itens de loja do catálogo 6860 têm imagens locais. A composição aceita todos esses heróis, e as recomendações experimentais estão disponíveis para todos os 44 heróis.

Arraste um herói para uma vaga do mesmo time para movê-lo ou trocá-lo com o ocupante. Também é possível clicar no herói e escolher **Mover ou trocar de posição**. O painel central mostra a próxima compra com o motivo, o tier, o preço cheio de catálogo e a frequência na amostra. **Marcar como comprado** adiciona o item ao inventário e atualiza a fila. As ameaças de composição aparecem em Respostas à composição. A antecipação de um counter exige uma abertura mínima da build, minuto compatível e saldo informado suficiente.

A build completa fica visível em ordem de compra. O simulador usa a composição e a lane para sugerir o próximo item. Ao marcar uma compra, o item continua na sequência com um sinal de conclusão.

As regras de cura, controle e proteção são manuais. A frequência exibida vem do perfil k-means selecionado para o herói, na base ampliada Phantom+. A sequência usa a mediana histórica dos tempos de entrada de cada item e respeita componentes antes dos upgrades. O perfil é escolhido automaticamente pelo volume e pelo inventário atual; os tempos são agregados por herói, não por cluster. A ordem ainda não foi validada como estratégia ideal. Para atualizar os agregados locais depois de reprocessar a base, execute `python preparar_simulador.py`. Para baixar as imagens públicas dos catálogos locais, execute `python preparar_simulador.py --baixar-imagens` com acesso à internet e `curl` instalado. [Catálogo de imagens da Deadlock API](https://api.deadlock-api.com/docs)

O comando `--verificar-patch` sinaliza novas notas ou versões para revisão. O corte do piloto continua fixo na versão 6860, e o simulador mostra essa versão como amostra histórica. Antes de ampliar a coleta, confirmar a hora efetiva da mudança e abrir um novo recorte se houver balanceamento.

Para testar localmente, abra `simulador/index.html` diretamente no navegador. Para servir por HTTP: `python -m http.server 8765 --bind 127.0.0.1 --directory simulador`, depois abra `http://127.0.0.1:8765/`. Execute `node testar_recomendador.cjs` para verificar os 44 heróis em três cenários de composição.

Informe o minuto atual e, opcionalmente, as almas disponíveis. As compras descontam o saldo conhecido e consomem componentes de upgrades. Inventário atual e histórico de compras são separados. É possível informar itens já existentes, corrigir o inventário e desfazer alterações sem simular vendas. Os limites provisórios de counters e de escopo do estado estão descritos em `TRACKLOCK_E_CLUSTERING.md`. Teste adicional dos eventos da interface: `node testar_interface.cjs`.
