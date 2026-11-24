# DeadPick

[![Ler o artigo final (PDF)](artigo/ler-artigo.svg)](artigo/artigo.pdf)

Recomendador contextual de itens para Deadlock, desenvolvido por **Lucas Cerqueira Portela** e **Bruno Prado dos Santos** na disciplina de Ciência de Dados, com o professor Higor Alexandre, na UFCI MG.

O DeadPick sugere a próxima compra com base no herói, no inventário, na composição das equipes, no tempo e no saldo. O simulador HTML e o mod usam o mesmo motor de recomendação e os modelos do recorte histórico do catálogo **6860**, com **44 heróis** e **173 itens de loja**.

## Executar a demonstração

### Simulador HTML

1. Selecione a branch `DeadPick`, baixe e extraia o repositório. Abra `simulador/index.html` em um navegador. A abertura local funciona sem instalar dependências ou consultar a API.
2. Escolha seu herói e a lane. Monte as equipes e informe o minuto da partida e o saldo em almas.
3. Registre compras, evoluções ou vendas para observar como a ordem de recomendações muda com o inventário.

Também é possível servir a pasta localmente com `python -m http.server 8000 --directory simulador` e acessar [localhost:8000](http://localhost:8000).

### Mod do jogo

1. Baixe o [VPK do DeadPick v0.4.6](mod/deadpick_diagnostico_dir.vpk) e feche o Deadlock.
2. Para importar pelo Deadlock Mod Manager, crie um ZIP com apenas o arquivo `deadpick_diagnostico_dir.vpk` na raiz. Desative qualquer versão anterior do DeadPick, importe o ZIP como mod local e ative-o.
3. Abra o jogo e entre no treino para visualizar o painel do DeadPick à esquerda. O painel observa o HUD para atualizar as sugestões. As compras permanecem a cargo do jogador.

O VPK foi compilado para a build Steam **26770241**. A transição do aquecimento para a partida foi exercitada em teste automatizado e está descrita no artigo.

## Dados, tratamento e métricas

A base histórica contém **13.458 partidas** e **116.369 participações elegíveis** de Phantom I ou acima, de 6 de novembro de 2026 às 01h UTC até 9 de novembro às 00h UTC. A Deadlock API fornece os metadados de partida. O Tracklock fornece frequências de uso e builds de referência para delimitar os itens candidatos.

O tratamento liga eventos ao catálogo e reconstrói o inventário por segundo. O k-means agrupa padrões de compra e os perfis registram frequências e tempos típicos. A avaliação usa cobertura de compras e coeficiente de silhueta para o agrupamento, além de log loss e escore de Brier para as regressões de compra defensiva. As escolhas de imbuimento são agregadas por herói e item. O artigo descreve como interpretar essas métricas.

### Reproduzir o processamento

Execute os comandos a partir da raiz. Use Python 3.11 ou superior e instale as dependências com `python -m pip install -r requirements.txt`. As capturas do Tracklock e do catálogo de imagens usam `curl`, chamado como `curl.exe` na captura histórica do Tracklock.

- **Deadlock API.** Se partir dos caches, restaure os arquivos da coleta piloto em `data/deadlock-api/bruto/` e execute `python pipeline/extrair_paradox.py --offline`. A base ampliada é produzida por `python pipeline/ampliar_base.py --offline`, com os lotes em `data/base-ampliada-6860/bruto/`, os arquivos `data/elegiveis-rank.json` e `data/elegiveis-headers.txt`, a consulta executada em `data/consulta-elegiveis.sql` e os catálogos auxiliares de ranks e patches em `data/deadlock-api/bruto/`. A consulta versionada está em `pipeline/consulta-elegiveis.sql`. Sem `--offline`, os extratores consultam a API para os lotes ausentes.
- **Históricos já normalizados.** Restaure `partidas.jsonl.gz`, `jogadores.jsonl.gz`, `eventos.jsonl.gz`, `decisoes.jsonl.gz` e o `auditoria.json` correspondente em `data/base-ampliada-6860/`. Para gerar o catálogo do simulador, restaure também `data/deadlock-api/auditoria.json` e `data/deadlock-api/decisoes_compra_alto_rank_individual.jsonl.gz` da coleta piloto.
- **Tracklock.** A extração agregada histórica já acompanha a entrega. A validação dos snapshots exige os HTMLs originais em `data/tracklock/bruto/`. Para uma nova coleta, execute `python pipeline/coletar_tracklock_todos.py --atualizar`.

Com esses insumos, execute o processamento nesta ordem.

```sh
python pipeline/validar_base.py
python pipeline/agrupar_builds_tracklock.py
python pipeline/validar_tracklock.py
python pipeline/recalcular_tempos_perfil.py --base data/base-ampliada-6860
python pipeline/treinar_ameacas.py --base data/base-ampliada-6860
python pipeline/calcular_imbuimentos.py --base data/base-ampliada-6860
python pipeline/preparar_simulador.py --base data/base-ampliada-6860 --baixar-imagens
python pipeline/incorporar_imagens.py
```

A demonstração usa os modelos já exportados. Para obter os mesmos resultados de treinamento, são necessários os dados históricos da coleta original.

## Verificar e recompilar

### Testes automatizados

Execute na raiz com Node.js 22 e Python 3.11 ou superior.

```sh
node --test tests/*.cjs mod/tests/*.test.cjs
python -B -m unittest discover -s tests -p "testar_*.py"
```

A suíte cobre **67 testes Node.js e 4 testes Python**, incluindo a progressão de compra dos 44 heróis e a leitura simulada da interface do jogo.

### Compilação do mod

Use uma instalação do Deadlock compatível com `mod/native-contract.json` e o Modlock v0.1.85 em `mod/local/tools/modlock-v0.1.85.exe`. O contrato contém o hash da ferramenta e o endereço de origem.

```sh
python mod/tools/verificar_ambiente.py --jogo "CAMINHO_DO_DEADLOCK"
python mod/tools/build_diagnostico.py --jogo "CAMINHO_DO_DEADLOCK"
```

O compilador valida o HUD nativo, empacota os cinco recursos Panorama e grava o resultado em `mod/build/`.

## Arquivos da entrega

### Raiz

| Arquivo | Função |
| --- | --- |
| `README.md` | Apresentação do projeto, instruções de execução e inventário da entrega. |
| `requirements.txt` | Versões das bibliotecas Python usadas na extração e na análise. |
| `.gitignore` | Exclui dados brutos, relatórios gerados, caches e builds locais do Git. |
| `.gitattributes` | Define o tratamento de binários e preserva os bytes dos insumos verificados por SHA-256. |

### Pipeline de dados e métricas

| Arquivo | Função |
| --- | --- |
| [`pipeline/consulta-elegiveis.sql`](pipeline/consulta-elegiveis.sql) | Seleciona os IDs das partidas ranqueadas com pelo menos um participante de rank inicial Phantom I ou acima no recorte. |
| [`pipeline/extrair_paradox.py`](pipeline/extrair_paradox.py) | Faz as requisições HTTP à Deadlock API, extrai o recorte piloto e fornece as rotinas de normalização e reconstrução de inventário. |
| [`pipeline/ampliar_base.py`](pipeline/ampliar_base.py) | Consulta os metadados em lotes, guarda o cache e normaliza partidas, jogadores, eventos e decisões dos participantes elegíveis. |
| [`pipeline/extrair_tracklock.py`](pipeline/extrair_tracklock.py) | Lê tabelas de itens, frequências de profissionais por fase e seções de builds nos HTMLs. |
| [`pipeline/coletar_tracklock_todos.py`](pipeline/coletar_tracklock_todos.py) | Coleta os snapshots do Tracklock para os heróis jogáveis, associa os itens ao catálogo e grava a extração consolidada. |
| [`pipeline/validar_base.py`](pipeline/validar_base.py) | Confere chaves, ranks, composições e totais da base ampliada e calcula a cobertura por herói. |
| [`pipeline/agrupar_builds_tracklock.py`](pipeline/agrupar_builds_tracklock.py) | Filtra os candidatos, ajusta os clusters por herói e calcula silhueta, cobertura e frequências de compra. |
| [`pipeline/validar_tracklock.py`](pipeline/validar_tracklock.py) | Confere a integridade das capturas e reconcilia as tabelas, os candidatos e os clusters. |
| [`pipeline/recalcular_tempos_perfil.py`](pipeline/recalcular_tempos_perfil.py) | Calcula a mediana e os percentis 25 e 75 da primeira aquisição de um item por perfil. |
| [`pipeline/treinar_ameacas.py`](pipeline/treinar_ameacas.py) | Treina regressões de compra defensiva por composição e calcula as métricas em uma divisão temporal de treino, validação e teste. |
| [`pipeline/calcular_imbuimentos.py`](pipeline/calcular_imbuimentos.py) | Conta as escolhas por herói, item e habilidade e seleciona a habilidade mais usada para cada par. |
| [`pipeline/preparar_simulador.py`](pipeline/preparar_simulador.py) | Combina catálogos, perfis, tempos e modelos em `simulador/dados.js`. Pode baixar as imagens usadas pelo catálogo. |
| [`pipeline/incorporar_imagens.py`](pipeline/incorporar_imagens.py) | Incorpora os retratos e os ícones em `dados.js` para o navegador carregá-los localmente. |

### Catálogos e dados agregados

| Arquivo | Função |
| --- | --- |
| [`data/deadlock-api/bruto/catalogo-herois.json.gz`](data/deadlock-api/bruto/catalogo-herois.json.gz) | Catálogo histórico de heróis e habilidades da API. Serve à preparação, aos testes e à exportação do mod. |
| [`data/deadlock-api/bruto/catalogo-itens.json.gz`](data/deadlock-api/bruto/catalogo-itens.json.gz) | Catálogo histórico de itens, com identidades, custos, tiers e componentes. |
| [`data/tracklock/extracao.json`](data/tracklock/extracao.json) | Entradas consolidadas do Tracklock que alimentam a seleção de candidatos ao agrupamento. |
| [`data/tracklock/candidatos.json`](data/tracklock/candidatos.json) | Exportação dos itens candidatos e dos perfis frequentes por herói, usada na validação dos clusters. |
| [`data/tracklock/clusters.json`](data/tracklock/clusters.json) | Perfis ajustados, frequências, métricas e metadados do agrupamento. |

### Simulador HTML

| Arquivo | Função |
| --- | --- |
| [`simulador/index.html`](simulador/index.html) | Página inicial com controles de herói, equipes, tempo, saldo e inventário. |
| [`simulador/estilo.css`](simulador/estilo.css) | Aparência e organização visual da página. |
| [`simulador/simulador.js`](simulador/simulador.js) | Conecta os controles ao motor, mantém o estado da simulação e atualiza as recomendações. |
| [`simulador/motor.js`](simulador/motor.js) | Seleciona perfis, ordena compras, calcula custo restante e aplica regras de inventário, evolução e defesa. É compartilhado com o mod. |
| [`simulador/dados.js`](simulador/dados.js) | Catálogo e modelos prontos para execução, com 44 retratos e 173 ícones incorporados. |
| [`simulador/ameacas.json`](simulador/ameacas.json) | Coeficientes, métricas e parâmetros exportados para as recomendações defensivas. |
| [`simulador/imbuimentos.json`](simulador/imbuimentos.json) | Frequências por habilidade e escolhas exportadas para os itens imbuíveis. |
| [`simulador/tempos_por_perfil.json`](simulador/tempos_por_perfil.json) | Estatísticas do tempo de aquisição para ordenar as compras dentro de cada perfil. |

### Mod e ferramentas de compilação

| Arquivo | Função |
| --- | --- |
| [`mod/deadpick_diagnostico_dir.vpk`](mod/deadpick_diagnostico_dir.vpk) | Arquivo instalável do DeadPick v0.4.6, com o HUD, o script e os modelos compilados. |
| [`mod/native-contract.json`](mod/native-contract.json) | Define a versão da Steam, os hashes e o layout nativo esperados para a compilação. |
| [`mod/native-imbue-contract.json`](mod/native-imbue-contract.json) | Relaciona os itens imbuíveis aos tipos nativos de efeito sobre habilidades. |
| [`mod/src/panel.xml`](mod/src/panel.xml) | Estrutura do painel que o DeadPick adiciona ao HUD. |
| [`mod/src/panorama/scripts/deadpick_runtime.js`](mod/src/panorama/scripts/deadpick_runtime.js) | Lê os painéis nativos do jogo, atualiza a lista de compras e mostra as sugestões no HUD. |
| [`mod/src/panorama/styles/deadpick_diagnostics.css`](mod/src/panorama/styles/deadpick_diagnostics.css) | Estilos Panorama do painel de recomendações. |
| [`mod/tools/verificar_ambiente.py`](mod/tools/verificar_ambiente.py) | Localiza a biblioteca Steam e verifica os arquivos e ferramentas para o build. |
| [`mod/tools/exportar_modelos.py`](mod/tools/exportar_modelos.py) | Empacota os dados do simulador, o motor e as referências a classes e imagens nativas. |
| [`mod/tools/build_diagnostico.py`](mod/tools/build_diagnostico.py) | Valida a instalação e aciona o Modlock para compilar e conferir o VPK. |

### Testes

| Arquivo | Função |
| --- | --- |
| [`tests/testar_recomendador.cjs`](tests/testar_recomendador.cjs) | Exercita recomendações, custos e transações para os 44 heróis do simulador. |
| [`tests/testar_ameacas.cjs`](tests/testar_ameacas.cjs) | Verifica a seleção das respostas defensivas e seus requisitos de composição, espaço e estágio. |
| [`tests/testar_ordem.cjs`](tests/testar_ordem.cjs) | Verifica a ordem temporal e as dependências entre componentes e evoluções. |
| [`tests/testar_interface.cjs`](tests/testar_interface.cjs) | Executa os fluxos da página usando um DOM simulado. |
| [`tests/testar_imbuimentos.py`](tests/testar_imbuimentos.py) | Confere a agregação, os desempates e a consistência dos dados exportados de imbuimento. |
| [`mod/tests/diagnostico.test.cjs`](mod/tests/diagnostico.test.cjs) | Verifica leitura de relógio, identidade do jogador, recarga e recuperação de falhas. |
| [`mod/tests/recomendador.test.cjs`](mod/tests/recomendador.test.cjs) | Integra leitura do HUD, inventário, motor e novas compras em sessões simuladas. |
| [`mod/tests/continuacao.test.cjs`](mod/tests/continuacao.test.cjs) | Exercita a progressão dos heróis e perfis, incluindo cadeias longas e recompras. |
| [`mod/tests/slots.test.cjs`](mod/tests/slots.test.cjs) | Confere o limite de 12 itens, o consumo de componentes e a leitura de slots ambíguos. |
| [`mod/tests/icu.test.cjs`](mod/tests/icu.test.cjs) | Exercita o motor quando a infraestrutura ICU/Intl de formatação numérica está indisponível. |
| [`mod/tests/imbuimentos.test.cjs`](mod/tests/imbuimentos.test.cjs) | Confere a escolha de habilidade no motor e sua apresentação no HUD. |
| [`mod/tests/vindicta.test.cjs`](mod/tests/vindicta.test.cjs) | Cobre a progressão e as sugestões de imbuimento dos perfis da Vindicta. |

### Artigo final

| Arquivo | Função |
| --- | --- |
| `artigo/artigo.pdf` | Artigo acadêmico final em formato IEEE, com metodologia, resultados, limitações e referências. |
| `artigo/ler-artigo.svg` | Imagem do botão de leitura no início do README. |
