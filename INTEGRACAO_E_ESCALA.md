# Integração com Deadlock e ampliação da análise

Investigação de 12 de novembro de 2026.

Atualização: o estudo de integração foi revisado em [VIABILIDADE_MOD.md](VIABILIDADE_MOD.md) em 16/11/2026, com fontes específicas de relógio, identidade e compras. As seções de ampliação abaixo registram o estágio histórico do piloto; a base ampliada e a integração do simulador já estão descritas no README atual.

## O que o Mod Manager fornece

O Deadlock Mod Manager instala e gerencia arquivos de mod. Mods de HUD encontrados na pesquisa usam Panorama, com XML, CSS e JavaScript compilados e empacotados em VPK. A aba de estatísticas do gerenciador consulta a Deadlock API. Assim, a integração do Deadpick depende dos dados que o cliente expõe ao HUD e do código que conseguirmos executar nesse ambiente. [Documentação do gerenciador](https://docs.deadlockmods.app/using-mod-manager/faq) · [Estatísticas do gerenciador](https://docs.deadlockmods.app/using-mod-manager/community) · [Exemplo de build e instalação de mod de HUD](https://github.com/Predi-i/Deadlock-UI-Mods)

O projeto Active Stats lê valores e classes dos painéis nativos de atributos e modificadores para exibi-los em outro local do HUD. É uma demonstração concreta de leitura de dados da interface. O HUD Dumper registra árvores de painéis e textos, com limitações de cobertura e atualização documentadas pelos autores. Nenhum desses exemplos confirma, por si só, todos os campos necessários ao Deadpick. [Active Stats](https://raw.githubusercontent.com/Predi-i/Deadlock-UI-Mods/main/Active-Stats/README.md) · [HUD Dumper](https://github.com/Predi-i/Deadlock-UI-Mods/blob/main/HUD-Dumper/README.md)

## Informações que queremos validar no cliente

| Informação | Uso no recomendador | Situação da evidência |
| --- | --- | --- |
| Modificadores e atributos do jogador | Reconhecer alterações de resistência, lentidão e outros efeitos que podem mudar a prioridade de uma compra. | Leitura de valores renderizados demonstrada pelo Active Stats. Requer verificar os campos na versão usada pelo Deadpick. |
| Herói local, heróis e times da partida | Preencher a composição automaticamente e usar os efeitos específicos de cada herói. | Candidato a leitura do HUD. Mapear IDs estáveis e testar entrada na partida, troca de herói e atualização do placar. |
| Inventário próprio, nível dos itens e slots disponíveis | Identificar componentes já comprados, melhorias e viabilidade da próxima compra. | Mapear os painéis e eventos da loja. Testar compra, melhoria, desfazer e remoção antes de definir o contrato. |
| Almas disponíveis e tempo de partida | Comparar compras acessíveis e decidir se vale guardar para uma melhoria. | Validar valores do HUD, unidades, atualização e comportamento durante pausas e morte. |
| Vida e estado de combate | Ajustar o momento da sugestão e reconhecer necessidades recorrentes de sobrevivência. | Mapear e validar no cliente. Uma leitura momentânea precisa de contexto histórico para orientar uma compra. |
| Itens e atributos observados de aliados e inimigos | Identificar ameaças concretas e redundância de utilidade na equipe. | Medir o que o placar e outros painéis realmente atualizam. Registrar hora da observação e ausência de informação. |
| Lane atual e adversário de rota | Ajustar as primeiras compras ao confronto de lane. | Confirmar se há um identificador exposto ou se precisaremos inferir a partir de observações. Lane atribuída e posição atual exigem campos diferentes. |

A próxima prova de integração deve medir a cobertura desses campos em um ambiente de teste do jogo. Cada leitura deve informar origem, horário da observação e validade. Um valor ausente fica como desconhecido. Ao fechar o placar ou a loja, precisamos descobrir se as leituras continuam atualizando ou se passam a representar o último estado exibido.

## Onde executar o algoritmo

Minha proposta inicial é treinar e avaliar os modelos em Python e exportar para o mod um artefato leve, versionado por patch, com os parâmetros e catálogos necessários à inferência. O mod lê o estado disponível e recalcula a recomendação quando o contexto muda. O simulador do navegador usa o mesmo formato de entrada e o mesmo artefato para permitir inspeção.

Experimentos de um autor de mods documentam que, na versão testada, o JavaScript de Panorama não oferecia as APIs normais de navegador, como `fetch`, `document` e `window`. O próprio autor diferencia esse ambiente do Chromium de um painel HTML e documenta mecanismos experimentais de comunicação. Precisamos validar o runtime antes de escolher dependências, tamanho do modelo ou comunicação com um serviço. [Investigação de transporte no Panorama](https://raw.githubusercontent.com/Predi-i/Deadlock-UI-Mods/main/HTML_TRANSPORT_HANDOFF.md)

A compatibilidade técnica e a possibilidade de uso em partidas competitivas exigem verificações distintas. O FAQ do gerenciador orienta conferir a política vigente da Valve para modificações que afetam jogabilidade. [FAQ do gerenciador](https://docs.deadlockmods.app/using-mod-manager/faq)

## Como ampliar os dados

A coleta atual busca os primeiros 60 IDs em cada uma de 12 janelas. Todas atingiram o limite. Isso deixou partidas disponíveis fora da amostra. A janela temporal do piloto vai de 6 de novembro de 2026 às 01h UTC até 9 de novembro às 00h UTC, com fim exclusivo e catálogo 6860 atribuído por horário. A primeira expansão deve esgotar as páginas desse recorte e depois avaliar a ampliação até os limites confirmados do patch.

Para o próximo coletor, fixar início e fim da janela, ordenar por ID e continuar após o último ID recebido até esgotar cada intervalo. Registrar checkpoint e consulta por página, eliminar duplicações por `match_id` e retomar de onde parou em caso de falha. O endpoint de metadados oferece limites por ID, ordenação e filtros temporais. Em escala maior, avaliar o data lake público com DuckDB/DuckLake e consultar somente as colunas necessárias. [Especificação da API](https://api.deadlock-api.com/openapi.json) · [Data lake da Deadlock API](https://deadlock-api.com/data-dumps)

Manter o corte pelo rank individual de entrada Phantom I+ e registrar Phantom, Ascendant e Eternus separadamente. O filtro de rank médio dos endpoints de analytics serve como referência agregada. Para a base de decisões individuais, o campo `player_rank_initial_display_rank` define a elegibilidade.

O piloto tem 1.049 participações elegíveis nos 44 heróis, incluindo as 82 de Paradox. Haze tem 52, Venator 44 e Wraith 43. Essas contagens medem a cobertura local. Todos esses jogadores aparecem em partidas selecionadas por conter Paradox, então precisamos de uma coleta direta para cada novo herói ou de um recorte geral independente. Proponho começar o próximo lote com Paradox, Haze e Wraith e ampliar conforme a cobertura de compras e confrontos de cada um. [Auditoria de cobertura](data/paradox/cobertura_herois.json)

Usar como meta de exploração cerca de 2.000 partidas elegíveis por herói, dentro do patch, e acompanhar curvas de aprendizado e suporte por situação. O volume necessário para avaliar combinações raras pode ser maior. A aceitação de uma comparação depende das contagens e da incerteza no contexto analisado.

## Como melhorar o cálculo dos itens

1. **Gerar candidatos.** Usar compras de alto nível por herói e fase, componentes do inventário e itens situacionais compatíveis com as ameaças observadas. Aplicar preço, slots e regras de melhoria quando esses dados estiverem disponíveis.
2. **Criar uma referência contextual.** Medir frequência, sequências de compra e resultado observado por herói, inventário anterior, momento e economia anterior à compra. Usar suavização para estimativas com pouco suporte. O endpoint `item-flow-stats` já oferece transições por fase e uma taxa ajustada por faixas de patrimônio na compra, que pode servir de referência agregada. Suas fases em modo normal são 0–9, 9–20, 20–30 e 30+ minutos, diferentes dos intervalos de 10 minutos usados no nosso piloto. [Especificação de item flow](https://api.deadlock-api.com/openapi.json)
3. **Aprender interações.** Comparar um modelo supervisionado com herói, composição, inventário e economia com versões que incluam interações entre itens e entre item e ameaça. A recomendação avalia o ganho relativo de acrescentar o candidato ao estado atual. A capacidade de prever o desfecho exige avaliação própria, pois a escolha dos jogadores é influenciada por estratégia, habilidade e vantagem prévia.
4. **Validar em datas posteriores.** Manter toda a partida na mesma divisão e acompanhar também repetição de jogadores entre treino e avaliação. Comparar a referência de popularidade com os modelos contextuais, medir concordância com compras históricas e calibração das estimativas de vitória separadamente. Avaliar counters em seus confrontos relevantes e verificar se os recursos usados no treino estarão disponíveis ao mod.

K-means pode ajudar a encontrar famílias de builds. Para a próxima compra, sequências e interações condicionadas ao inventário oferecem uma representação mais direta do problema.

## Próximas entregas

- Mapa validado dos campos que o HUD fornece, com exemplos de mudanças de estado e medições de atualização.
- Coletor paginado e retomável para múltiplos heróis, com manifesto de patch e auditoria de rank individual.
- Referência de compras condicionadas ao inventário, comparada às regras atuais no simulador e em dados posteriores.

O levantamento acima é documental e a cobertura foi calculada sobre a base local. A coleta ampliada e a prova dentro do cliente ainda precisam ser executadas.
