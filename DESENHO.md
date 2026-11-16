# Desenho do recomendador

## O que é uma boa compra

O recomendador sugere **qual item comprar a seguir** quando o jogador pretende comprar. Compara alternativas de custo semelhante para aquele herói, naquele momento e com aquele inventário. Uma boa compra pode reforçar uma combinação já montada ou cobrir uma necessidade da partida. A primeira versão ordena alternativas por evidência histórica em contextos comparáveis. Decidir se vale comprar agora ou guardar almas exige observar também momentos em que o jogador podia comprar e decidiu esperar.

| Fator | Pergunta para cada candidato | Dados e prioridade |
| --- | --- | --- |
| Herói e inventário atual | O item aproveita as habilidades do herói e complementa o que ele já tem? Há redundância, dependência de outro item ou uma melhoria direta? | **Base.** Herói, inventário reconstruído antes da compra e catálogo versionado com efeitos, custos e relações de melhoria. |
| Composição inimiga | O item responde a uma ameaça relevante, como cura, controle ou dano de um tipo predominante? | **Base.** IDs dos heróis inimigos e interações item × herói. **Depois.** Inventário inimigo conhecido e métricas de ameaça até o instante da compra, se houver cobertura. |
| Composição aliada | O item supre uma função que falta à equipe ou repete uma utilidade que os aliados já oferecem? | **Base.** IDs dos aliados. **Depois.** Inventário aliado e classificação dos efeitos para medir cobertura e redundância. |
| Tempo e ordem | A compra faz sentido agora, considerando o tempo de jogo, os itens anteriores e quando a ameaça costuma aparecer? | **Base.** Tempo e sequência das compras. Comparar compras em janelas semelhantes e registrar compras simultâneas sem inventar uma ordem. |
| Custo e estado da partida | Que alternativas concorrem pelo mesmo investimento? O jogador já estava à frente quando comprou? | **Base.** Custo no catálogo e `net_worth_at_buy` como possível indicador de economia individual. **Depois.** Almas disponíveis, slots e vantagem do time no instante da decisão para filtrar compras viáveis e melhorar a comparação. |
| Contexto e confiança | A evidência vem do mesmo patch, modo e faixa de habilidade? Quantas partidas sustentam a comparação? | **Base.** Modo, início da partida, faixa de rank, versão atribuída, número de partidas distintas e incerteza da estimativa. |

## Como medir sinergia e counters

1. Para avaliar um candidato **A** quando **B** já está equipado, comparar quem comprou **A** com quem comprou uma alternativa **C** de custo parecido. Usar o mesmo herói e patch, uma janela de tempo próxima e inventários anteriores semelhantes. Considerar a economia prévia quando sua semântica estiver validada.
2. Repetir a comparação em situações equivalentes sem **B**. Se a diferença entre **A** e **C** for mais favorável quando **B** está presente, temos um sinal de sinergia. O contexto, o suporte e a incerteza acompanham o sinal. Essa comparação é observacional e pode refletir diferenças de habilidade, estratégia ou estado da partida.
3. Aplicar a mesma lógica a counters. Comparar um item com alternativas diante de um herói ou ameaça específica e verificar se sua vantagem relativa muda quando a ameaça está ausente. O catálogo ajuda a propor hipóteses, como redução de cura contra uma composição com muita cura.

A análise de pares começa com **um item já no inventário e uma compra candidata**. Trios entram quando houver partidas suficientes para medir interações com dois itens já equipados. Popularidade, taxa de vitória observada e sinal de interação são métricas separadas. Para medir o ganho da abordagem, comparar uma referência por herói, item e fase com versões que acrescentam inventário, composições e interações. K-means pode ajudar a explorar famílias de builds quando tivermos uma representação adequada dos inventários.

## Filtro de candidatos por herói

Para analisar as compras da Paradox, selecionar quem entrou na partida com rank individual Phantom I ou superior. Usar `player_rank_initial_display_rank` e separar Phantom, Ascendant e Eternus na auditoria. Excluir ranks ausentes ou iguais a zero do recorte. Manter os outros jogadores para reconstruir as composições. O rank médio do lobby serve como contexto e o agregado da API filtrado pela média fica como referência separada. [Especificação da Deadlock API](https://api.deadlock-api.com/openapi.json)

Usar as compras de alto nível para reduzir o conjunto de candidatos antes de calcular sinergia e adequação à partida. O Tracklock tem dois recortes úteis. **Pro Builds** acompanha partidas de profissionais monitorados e mostra itens por fase em páginas por herói. **Items** permite consultar frequência de uso por herói e filtrar por rank e período. Manter os recortes separados para distinguir profissionais monitorados de jogadores em partidas de rank alto. [Pro Builds de Paradox](https://prod.tracklock.gg/heroes/paradox) · [Itens de Paradox](https://tracklock.gg/heroes/10/items)

- **Núcleo do herói.** Incluir itens com uso recorrente e suporte suficiente no mesmo patch, herói e fase. Se houver caminhos de build distintos, manter candidatos de cada caminho com suporte. O inventário atual ajuda a decidir qual caminho faz sentido naquela partida.
- **Situacionais.** Incluir itens ligados a uma ameaça identificada, mesmo com baixa frequência geral. Por exemplo, um item defensivo raro pode entrar na lista quando a composição inimiga tem controle relevante. Usar o catálogo e, quando houver dados suficientes, a frequência de compra naquele confronto.
- **Baixa evidência.** Excluir da lista padrão os itens com pouca evidência de uso para o herói e sem justificativa situacional. Se o recorte do herói ou da fase tiver poucas partidas, ampliar o recorte antes de excluir. Preservar todos os eventos na base para reavaliar a regra.

Registrar a fonte, o recorte, o patch, a fase, a data de coleta e as contagens disponíveis. Uma página com janela móvel pode cruzar patches e exibir só parte dos itens. Itens ausentes nessa página ficam com frequência desconhecida. Antes de automatizar a importação direta, verificar se o Tracklock oferece API ou exportação pública documentada. Para uma coleta reproduzível, a Deadlock API permite gerar o recorte de partidas de rank alto por herói, faixa de rank médio dos times, datas e tempo de compra em `/v1/analytics/item-stats`. A taxa de uso pode ser derivada dos eventos normalizados, contando jogadores do herói que compraram o item entre os que chegaram à fase. [Especificação da Deadlock API](https://api.deadlock-api.com/openapi.json)

Testar com um herói e um patch antes de fixar os limiares. Em partidas posteriores às usadas para montar o filtro, medir quantos candidatos foram removidos e qual proporção das compras reais continuou elegível, por fase e em confrontos com counters esperados. Essa cobertura mede o que o filtro consegue preservar. A avaliação de sinergia e dos resultados continua na etapa de ordenação.

## Janela de análise por patch

Consultar `/v2/patches` a cada atualização dos dados. O feed reúne publicações oficiais do fórum e da Steam com data e hora. Usar as notas para identificar mudanças de balanceamento e conferir a hora de lançamento e a versão do jogo antes de fixar o corte. A hora de publicação da nota pode diferir da hora em que o patch entrou em vigor. Excluir partidas cuja versão seja incerta na transição. [Especificação da Deadlock API](https://api.deadlock-api.com/openapi.json)

A janela começa no lançamento do patch de balanceamento vigente e cresce enquanto o patch estiver ativo. Uma nota informativa, cosmética ou sem mudança de jogabilidade mantém a janela. Um ajuste de herói, item ou regra de jogo inicia uma nova janela para as análises afetadas. Na primeira versão, aplicar o corte global para mudanças de balanceamento, mantendo os dados anteriores em recortes separados. Se a amostra pós-patch for pequena, mostrar suporte insuficiente e acompanhar o volume à medida que chegam novas partidas de rank alto.

## O que extrair

| Tabela | Campos e origem |
| --- | --- |
| `partidas` | `match_id`, `start_time`, `winning_team`, `duration_s`, `match_mode`, `game_mode` e faixa de rank dos times em `/v1/matches/metadata`. Atribuir a versão com uma janela validada de patch. A amostra piloto não trouxe `client_version` na listagem. |
| `jogadores_partida` | `match_id`, `player_slot`, `hero_id`, `team` e `player_rank_initial_display_rank`. A composição é derivada pela relação entre o time do jogador e os demais slots. |
| `eventos_item` | `match_id`, `player_slot`, índice do registro na resposta, `item_id`, `upgrade_id`, `game_time_s`, `sold_time_s`, `flags`, `imbued_ability_id`, `upgrade_info` e `net_worth_at_buy`. Preservar os valores originais e derivar o tipo de evento após validar o catálogo e o replay. |
| `catalogo_itens` e `catalogo_herois` | IDs e definições versionadas de `/v1/assets/items` e `/v1/assets/heroes`. Mapear custos, relações de melhoria e os efeitos que conseguirmos estruturar. |
| `decisoes_compra` | Uma linha por compra de loja validada. Derivar herói, composições, inventário imediatamente anterior, tempo, histórico de compras, contexto econômico disponível, item escolhido e resultado da partida em coluna separada. |
| `uso_item_heroi` | `hero_id`, `item_id`, patch, fase, modo, recorte de rank ou profissionais, fonte, janela de coleta, contagem de jogadores que compraram e denominador quando conhecido. Manter a definição de uso de cada fonte e a justificativa de inclusão no filtro. |

No piloto, os 1.001 registros de item tinham `net_worth_at_buy`, 766 tinham `upgrade_id` diferente de zero e 94 tinham `sold_time_s` positivo. Esses campos orientam a extração, mas seus valores ainda precisam ser confrontados com o catálogo e com a sequência de eventos de algumas partidas. Patrimônio e saldo disponível são variáveis diferentes. Até termos o saldo e os slots no momento da decisão, a faixa de custo permite comparar alternativas, mas a disponibilidade de cada compra fica indeterminada. [Amostra local](data/amostra/partidas.json) · [Especificação da Deadlock API](https://api.deadlock-api.com/openapi.json)

## Critérios para passar da extração à análise

- Validar em partidas de um patch a resolução dos IDs, a distinção entre compra e melhoria, as vendas e o inventário antes de cada compra. Registrar campos ausentes e eventos ambíguos. Quando eventos empatados alterarem o inventário e a ordem for desconhecida, marcar a decisão como ambígua.
- Começar por um herói com volume suficiente. Comparar alternativas apenas onde houver suporte em ambos os grupos e usar uma referência mais ampla quando o contexto for raro. Mostrar contagens e incerteza, especialmente em itens tardios e counters específicos.
- Separar treino e avaliação por data, mantendo cada partida inteira em uma divisão. Usar vencedor como desfecho e excluir estatísticas finais das entradas. Conferir se as interações se repetem em partidas posteriores. Acertar a compra histórica mede concordância com os jogadores, enquanto o resultado observado mede associação com vitória.
