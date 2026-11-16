# Deadpick dentro do Deadlock: análise de viabilidade

Levantamento documental em 16/11/2026. Não houve compilação, instalação ou teste no cliente do jogo nesta investigação.

## Conclusão

Há evidência suficiente para iniciar uma prova de conceito de mod de HUD em Panorama. Ainda não há evidência de que o Deadpick consiga obter automaticamente todos os campos com identidade e atualização corretas na versão atual do cliente. O próximo marco deve ser validar a captura, antes de portar a apresentação completa ou refinar mais o modelo.

O Mod Manager instala/gerencia os arquivos; não fornece automaticamente um fluxo de estado da partida para o recomendador. Os recursos e compatibilidade de distribuição são descritos pelo [FAQ do gerenciador](https://docs.deadlockmods.app/using-mod-manager/faq).

## Evidências e pendências

| Campo/capacidade | Evidência consultada | Verificação necessária no Deadpick |
| --- | --- | --- |
| Relógio | QOLLOCK lê o texto nativo `HudCore > TopBar > GameClock > GameTime`. | Pausas, pré-jogo, mudança de partida, parsing e rótulo ausente. Nunca substituir falta de leitura por minuto zero. |
| Heróis e composição | QOLLOCK percorre `TeamsContainer`, cartas e `HeroBadge.heroid`. Há classes `LocalPlayer`, `SpectatorTarget` e `Empty`. | Os 12 slots, lado aliado/inimigo e identidade local. O helper de retrato pode preferir o alvo espectado: não copiá-lo como identificação do jogador. |
| Inventário próprio | O mod QOLLOCK manipula a apresentação de `ModsContainer`; o contêiner existe nas fontes consultadas. | Identidade de cada item e slot, inventário completo versus componentes, bloqueios, compra, upgrade e desfazer. Leitura de estilos não comprova leitura completa do inventário. |
| Histórico de compras | QOLLOCK observa linhas nativas com item, tempo, herói e classes de time/tier em `RecentPurchasesContainer`. | Cobertura, atualização com loja fechada, linhas recicladas, disponibilidade após reconexão e tradução de nomes para IDs. Não confundir feed com inventário atual. |
| Almas disponíveis | Há acesso documentado aos painéis de economia; o módulo de almas não seguras lê um valor próprio. | Identificar o saldo efetivamente gastável, precisão e atualização. Almas não seguras e patrimônio total não devem ser usados automaticamente como saldo. |
| Lane/adversários de rota | Não foi localizado um contrato suficiente nas fontes inspecionadas. | Identificador confiável ou inferência medida. Pode ficar desconhecido no primeiro MVP sem pedir preenchimento por partida. |
| Mostrar recomendação no HUD | Active Stats demonstra leitura e exibição de valores nativos; há projetos públicos com XML/CSS/JS compilados em VPK. | Posição, imagens, sobreposição com loja/placar, ciclo de vida e compatibilidade com outros HUDs. |

Fontes específicas: [relógio](https://github.com/civo7/QOLLOCK/blob/main/panorama/scripts/core/ql_time.js), [identidade e retratos](https://github.com/civo7/QOLLOCK/blob/main/panorama/scripts/core/ql_hero_probe.js), [contrato das compras recentes](https://github.com/civo7/QOLLOCK/blob/main/docs/features/ql_recent_purchases.md), [contêiner de inventário](https://github.com/civo7/QOLLOCK/blob/main/panorama/scripts/manifests/ql_items/manifest.js), [almas não seguras](https://github.com/civo7/QOLLOCK/blob/main/panorama/scripts/manifests/ql_unsecured_souls_timer/manifest.js), [Active Stats](https://github.com/Predi-i/Deadlock-UI-Mods/blob/main/Active-Stats/README.md).

## Arquitetura proposta

```text
Deadlock: painéis nativos do HUD
  → Adaptador de leitura: identidade + valores + validade + idade da observação
  → Estado normalizado da partida
  → Motor de recomendação JavaScript + artefato de modelo local
  → Painel Panorama: próximo item, preço restante e motivo curto
```

Python continua responsável por coleta, k-means e avaliação fora do jogo. Exportamos catálogo e perfis compactos para inferência local. A interface HTML do simulador permanece como bancada de testes; o desenho do HUD deve usar os recursos próprios do Panorama.

Não há evidência para tratar o runtime como uma página comum: a [arquitetura do QOLLOCK](https://github.com/civo7/QOLLOCK/blob/main/ARCHITECTURE.md) diferencia os contextos do HUD, configurações e HTML embutido. As APIs de navegador e Node não podem ser assumidas no script Panorama. O núcleo puro do Deadpick pode ser adaptado; sua interface atual usa `document`, diálogos e eventos do navegador e exige outra implementação visual.

A [investigação de transporte de Predi-i](https://github.com/Predi-i/Deadlock-UI-Mods/blob/main/HTML_TRANSPORT_HANDOFF.md) relata restrições de rede no JavaScript do Panorama e experimentos com um painel HTML separado. Isso demonstra uma alternativa experimental para comunicação, não uma ponte pronta para o Deadpick. O MVP local evita depender dela. Atualizar modelos inicialmente pode exigir uma nova versão do pacote; atualização durante a partida não faz parte da prova de conceito.

## Contrato do estado

Cada campo deve distinguir valor conhecido, desconhecido e observação antiga. Registrar origem, instante da última mudança verificada e instante da leitura; reler um texto parado não prova que o jogo o atualizou. Preservar precisão: um saldo abreviado não deve autorizar uma compra como se fosse exato.

O estado deve separar: sessão da partida, modo (jogando/espectando/teste), jogador local, equipes, segundos de jogo, saldo gastável, inventário atual e histórico observado. Respeitar pausa e nunca trocar o herói local pelo aliado assistido após morrer. Ao mudar de partida, invalidar estado, caches e histórico anteriores.

Sem lane confiável, o sistema utiliza contexto global. Composição incompleta ou saldo desconhecido não devem disparar counters agressivos. Sem inventário confiável, suspender sugestões que possam repetir compras e indicar sincronização pendente, em vez de exigir uma correção manual habitual.

## Prova de conceito e critérios de aprovação

1. **Instrumentação pequena:** exibir herói local, relógio, saldo, itens atuais e composição detectada; validar leituras dirigidas, sem varrer toda a árvore continuamente. O HUD-Dumper é ferramenta de diagnóstico, não coletor de produção. Sua própria [documentação](https://github.com/Predi-i/Deadlock-UI-Mods/blob/main/HUD-Dumper/README.md) distingue integridade do dump de cobertura e frescor dos dados.
2. **Cenários no cliente:** entrada em partida, preparação, loja/placar abertos e fechados, compra, upgrade, desfazer, morte/espectador, respawn, pausa, reconexão e próxima partida. Conferir os valores contra o HUD nativo e medir demora de atualização e falhas.
3. **Passagem automática:** detectar o início da partida e preencher os campos essenciais sem digitação. Compras devem atualizar o inventário e retirar recomendações repetidas. Os testes precisam incluir estado oculto/desatualizado; sucesso só com loja ou Tab abertos é cobertura parcial.
4. **Recomendação:** conectar o estado validado ao mesmo motor utilizado no simulador e mostrar somente próximo item, custo restante e motivo no MVP. Verificar orçamento, componentes e counters com o estado real.
5. **Empacotamento:** compilar XML/CSS/JS e gerar VPK compatível com o fluxo de importação do gerenciador. Conferir conflitos de layouts e medir estabilidade/custo em jogo. Pacote instalável e funcionamento no cliente são marcos diferentes de testes unitários.

Não foi localizado/validado um ambiente de compilação ou cliente em execução nesta investigação. Antes do teste nativo será necessário confirmar a pasta do jogo e o processo de compilação escolhido. Nenhum arquivo do jogo foi alterado.

## Alternativa caso o HUD não forneça o necessário

Um aplicativo com captura de imagem e overlay também pode dispensar preenchimento manual. O [Deadlock Blueprint](https://github.com/PedroGomesFR/deadlock-blueprint) declara detectar heróis, inventário e almas por visão/OCR, com limitações de HDR, escala e formato de tela. Essa é evidência de outro caminho de produto, não validação independente de sua precisão nem de compatibilidade com o Deadpick. Mantemos o mod como primeira opção; só avaliar captura se a prova no HUD encontrar um bloqueio relevante.

## Política e distribuição

O FAQ do Mod Manager não é uma autorização da Valve. Não foi encontrada nesta investigação uma aprovação oficial específica para recomendação dinâmica de compras. Funcionamento técnico, publicação e aceitação em partidas competitivas precisam de verificações distintas. O escopo proposto lê informações disponibilizadas pela interface e apresenta recomendações; compras continuam sendo decisões e ações do jogador.

## Decisão recomendada

Priorizar o adaptador de estado e a prova no cliente. Não ampliar agora o formulário manual nem pressupor que acesso visual ao HUD equivale a telemetria completa. Só após a validação do contrato dos dados avançar para o pacote utilizável do recomendador.
