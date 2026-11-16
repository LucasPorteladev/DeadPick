# Preservação da versão HTML

Esta entrega congela o simulador com 44 heróis, modelos Tracklock/k-means, imagens locais e a correção de estado da partida e prioridade dos counters. A integração com o jogo permanece como estudo de viabilidade.

## Arquivos da entrega

- `deadpick-html-2026-11-16.zip`: projeto pronto para um repositório. Inclui o simulador executável, 217 imagens, todos os scripts Python e testes Node, documentação, modelos e tabelas normalizadas, catálogos e metadados da coleta.
- Pasta `deadpick-html-2026-11-16/`: o mesmo projeto já extraído, pronta para executar e iniciar o Git.
- `deadpick-dados-completos-2026-11-16.zip`: cópia integral das quatro pastas de coleta (`amostra`, `paradox`, `base-ampliada-6860`, `tracklock-todos`), incluindo snapshots HTML, respostas brutas e arquivos de partidas/eventos/decisões. Não é necessário para abrir o HTML.
- `verificacao-2026-11-16.json`: hashes dos ZIPs, tamanhos e resultados das verificações de integridade.

Os originais do workspace são preservados. Não há publicação remota, criação de repositório ou alteração nos arquivos do jogo nesta operação. Logs temporários de servidor e verificações HTTP não fazem parte da entrega.

## Executar

Dentro da pasta do projeto, abra `simulador/index.html` no navegador. Os dados e imagens são locais; não é necessário instalar dependências nem consultar a API para usar o simulador.

Para servir por HTTP, execute:

```powershell
python -m http.server 8765 --bind 127.0.0.1 --directory simulador
```

Abra `http://127.0.0.1:8765/`.

Para os testes, com Node.js 20 ou superior:

```powershell
node testar_recomendador.cjs
node testar_interface.cjs
```

O primeiro cobre os 44 heróis em três cenários e regressões de urgência, orçamento e upgrades. O segundo verifica os eventos da interface em um DOM mínimo. Não são testes visuais ou avaliação da qualidade estratégica. Os campos de minuto, almas e inventário são controles de simulação; não estão conectados ao cliente do jogo.

## Preservar no Git

Recomendação: iniciar o repositório dentro da pasta extraída, mantendo sua estrutura. A versão HTML fica na `main`; uma tag identifica o ponto de partida. Depois crie a branch do mod. Os comandos abaixo são instruções para executar após revisar os arquivos:

```powershell
git init -b main
git add .
git commit -m "Preserva simulador HTML com 44 herois e modelos historicos"
git tag html-baseline-2026-11-16
git switch -c feature/deadlock-mod
```

Adicionar o remoto e enviar as branches fica a cargo do proprietário do repositório. A branch secundária compartilha o histórico e pode receber a captura do HUD sem apagar o simulador. Uma branch só existe no remoto depois de ser enviada.

O `.gitignore` fornecido nesta pasta permite versionar modelos e resultados normalizados. Ele exclui os dados volumosos, snapshots HTML, caches e arquivos locais. Não é o `.gitignore` antigo do workspace, que ignorava toda a pasta `data`.

Mantenha o ZIP dos dados completos como backup externo ao histórico Git comum. Caso decida hospedá-lo junto ao projeto, use um mecanismo de artefatos apropriado e revise os identificadores de contas presentes nos dados antes de escolher a visibilidade pública. As imagens continuam pertencendo aos seus titulares; não foi atribuída uma licença nova ao projeto.

## Reprocessar a partir da coleta congelada

Extraia o ZIP dos dados completos na raiz do projeto, de forma que `data/base-ampliada-6860/eventos.jsonl.gz` e `data/tracklock-todos/bruto/` fiquem nos caminhos esperados. Os arquivos pequenos já presentes na pasta são cópias do mesmo snapshot.

Instale as dependências de análise em um ambiente virtual, usando `requirements-analise.txt`. O manifesto registra as versões encontradas no ambiente da entrega. Os scripts de coleta também usam o executável `curl`.

```powershell
python agrupar_builds_tracklock.py
python validar_tracklock.py
python preparar_simulador.py
node testar_recomendador.cjs
node testar_interface.cjs
```

Esse fluxo utiliza a extração local. Consultar os sites novamente pode produzir outro conjunto de dados e deve ser registrado como nova versão. O script `validar_base.py` valida separadamente a base ampliada restaurada.

## Conferir integridade

`MANIFESTO_HTML.json` lista o SHA-256 de cada arquivo do projeto, exceto o próprio manifesto. O ZIP de dados contém `MANIFESTO_DADOS.json`, com hashes de todos os arquivos de coleta arquivados. O relatório externo registra os hashes dos dois ZIPs.

Para conferir um arquivo ZIP no Windows:

```powershell
Get-FileHash -Algorithm SHA256 .\deadpick-html-2026-11-16.zip
```

O comando deve ser executado na pasta da entrega. Para gerar outra entrega a partir do workspace original, use `python empacotar_html.py --rotulo NOVO-ROTULO`; o script recusa substituir uma entrega existente.
