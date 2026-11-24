const lanes = [
  { nome: 'Amarela', cor: 'amarela' },
  { nome: 'Azul', cor: 'azul' },
  { nome: 'Roxa', cor: 'roxa' },
];

function iniciar(dados) {
  const el = id => document.getElementById(id);
  const herois = new Map(dados.herois.map(heroi => [heroi.nome, heroi]));
  const itemPorNome = new Map(Object.entries(dados.itens).map(([id, item]) => [item.nome, { ...item, id }]));
  const times = { aliados: Array(6).fill(null), inimigos: Array(6).fill(null) };
  const inventario = new Set();
  const historico = new Set();
  const desfazer = [];
  const seletor = el('seletor');
  const formato = new Intl.NumberFormat('pt-BR');
  let jogador = null;
  let destino;
  let proximaCompra = null;

  function estadoPartida() {
    return { minuto: Math.max(0, Number(el('minuto').value) || 0),
      almas: el('almas').value.trim() === '' ? null : Math.max(0, Math.floor(Number(el('almas').value) || 0)) };
  }

  function guardarEstado() {
    desfazer.push({ inventario: [...inventario], historico: [...historico], almas: el('almas').value });
  }

  function substituirEstado(novo) {
    inventario.clear();
    novo.inventario.forEach(i => inventario.add(i));
    historico.clear();
    novo.historico.forEach(i => historico.add(i));
  }

  function criar(tag, classe, texto) {
    const elemento = document.createElement(tag);
    if (classe) elemento.className = classe;
    if (texto !== undefined) elemento.textContent = texto;
    return elemento;
  }

  function botao(classe, rotulo, acao) {
    const elemento = criar('button', classe, rotulo);
    elemento.type = 'button';
    elemento.addEventListener('click', acao);
    return elemento;
  }

  function imagem(entrada) {
    const elemento = criar('img');
    elemento.src = entrada.imagem;
    elemento.alt = '';
    return elemento;
  }

  function tier(item) {
    const romano = ['', 'I', 'II', 'III', 'IV', 'V'][item.tier];
    const etiqueta = criar('span', `tier tier-${item.tier}`, romano);
    etiqueta.title = `Tier ${romano}`;
    etiqueta.setAttribute('aria-label', etiqueta.title);
    return etiqueta;
  }

  function posicaoJogador() {
    return jogador ? times.aliados.indexOf(jogador) : -1;
  }

  function trocarPosicoes(time, origem, alvo) {
    if (origem === alvo) return;
    const vagas = times[time];
    [vagas[origem], vagas[alvo]] = [vagas[alvo], vagas[origem]];
    atualizar();
  }

  function abrir(tipo, time, posicao) {
    destino = { tipo, time, posicao };
    el('pergunta').textContent = tipo === 'item' ? 'Quais itens você já possui?' : tipo === 'jogador' ? 'Qual herói você está usando?' :
      `${time === 'aliados' ? 'Seu time' : 'Time inimigo'} · Lane ${lanes[Math.floor(posicao / 2)].nome}`;
    el('busca').placeholder = tipo === 'item' ? 'Buscar item' : 'Buscar herói';
    el('busca').value = '';
    el('busca').hidden = false;
    el('fechar').hidden = !jogador;
    el('mover').hidden = time === undefined || !times[time][posicao];
    el('remover').hidden = tipo !== 'slot' || !times[time][posicao];
    desenharCatalogo();
    seletor.showModal();
    el('busca').focus();
  }

  function desenharCatalogo() {
    const { tipo, time, posicao } = destino;
    if (tipo === 'item') {
      const termo = el('busca').value.trim().toLocaleLowerCase('pt-BR');
      const opcoes = [...itemPorNome.values()].filter(i => i.tier <= 4 && i.nome.toLocaleLowerCase('pt-BR').includes(termo));
      el('opcoes').replaceChildren(...opcoes.map(item => {
        const opcao = botao('opcao', undefined, () => {
          guardarEstado();
          substituirEstado(efetuarCompra({ nome: item.nome, catalogo: dados.itens, inventario, historico }));
          seletor.close();
          atualizar();
        });
        opcao.disabled = coberturaInventario(dados.itens, inventario).has(item.nome);
        opcao.append(imagem(item), criar('span', '', item.nome), tier(item));
        return opcao;
      }));
      return;
    }
    const escolhidos = new Set([...times.aliados, ...times.inimigos, jogador]);
    const atual = tipo === 'slot' ? times[time][posicao] : jogador;
    const termo = el('busca').value.trim().toLocaleLowerCase('pt-BR');
    const opcoes = dados.herois.filter(entrada => entrada.nome.toLocaleLowerCase('pt-BR').includes(termo));
    el('opcoes').replaceChildren(...opcoes.map(entrada => {
      const opcao = botao('opcao', undefined, () => selecionar(entrada.nome));
      opcao.disabled = escolhidos.has(entrada.nome) && entrada.nome !== atual;
      const miniatura = imagem(entrada);
      miniatura.loading = 'lazy';
      opcao.append(miniatura, criar('span', '', entrada.nome));
      return opcao;
    }));
    if (!opcoes.length) el('opcoes').append(criar('p', 'subtitulo', 'Nenhum resultado.'));
  }

  function selecionar(nome) {
    const { tipo, time, posicao } = destino;
    if (tipo === 'jogador' && jogador !== nome) {
      const anterior = posicaoJogador();
      jogador = nome;
      if (anterior >= 0) times.aliados[anterior] = jogador;
      inventario.clear();
      historico.clear();
      desfazer.length = 0;
    }
    if (tipo === 'slot') times[time][posicao] = nome;
    seletor.close();
    atualizar();
    if (tipo === 'jogador' && posicaoJogador() < 0) el('opcoes-lane').querySelector('button:enabled')?.focus();
  }

  function habilitarArraste(slot, time, origem) {
    const tabuleiro = el(time);
    const aviso = el('aviso-arraste');
    let inicio;
    let alvo;
    let arrastando = false;

    function limparArraste() {
      inicio = null;
      slot.classList.remove('segurado', 'arrastando');
      tabuleiro.classList.remove('movendo');
      alvo?.classList.remove('alvo');
      alvo = null;
      aviso.hidden = true;
    }

    slot.addEventListener('pointerdown', evento => {
      if (!evento.isPrimary || evento.button !== 0) return;
      arrastando = false;
      inicio = { x: evento.clientX, y: evento.clientY };
      slot.setPointerCapture(evento.pointerId);
      slot.classList.add('segurado');
      tabuleiro.classList.add('movendo');
      aviso.hidden = false;
    });
    slot.addEventListener('pointermove', evento => {
      if (!inicio) return;
      if (!arrastando && Math.hypot(evento.clientX - inicio.x, evento.clientY - inicio.y) < 7) return;
      arrastando = true;
      slot.classList.add('arrastando');
      alvo?.classList.remove('alvo');
      const vaga = document.elementFromPoint(evento.clientX, evento.clientY)?.closest('.slot');
      alvo = vaga !== slot && vaga?.dataset.time === time ? vaga : null;
      alvo?.classList.add('alvo');
    });
    slot.addEventListener('pointerup', () => {
      const destino = alvo;
      limparArraste();
      if (destino) trocarPosicoes(time, origem, Number(destino.dataset.posicao));
    });
    slot.addEventListener('pointercancel', () => {
      arrastando = false;
      limparArraste();
    });
    slot.addEventListener('lostpointercapture', () => {
      if (inicio) limparArraste();
    });
    slot.addEventListener('click', evento => {
      if (!arrastando) return;
      arrastando = false;
      evento.stopImmediatePropagation();
    }, true);
  }

  function desenharTime(time) {
    el(time).replaceChildren(...lanes.map(({ nome, cor }, indice) => {
      const lane = criar('div', `lane ${cor}`);
      const slots = criar('div', 'slots');
      lane.append(criar('h3', '', nome), slots);
      for (const posicao of [indice * 2, indice * 2 + 1]) {
        const heroi = times[time][posicao];
        const souEu = time === 'aliados' && heroi && heroi === jogador;
        const slot = botao(`slot${souEu ? ' voce' : ''}`, undefined, () => abrir(souEu ? 'jogador' : 'slot', time, posicao));
        slot.dataset.time = time;
        slot.dataset.posicao = posicao;
        slot.setAttribute('aria-label', `${time === 'aliados' ? 'Aliado' : 'Inimigo'} · Lane ${nome} · posição ${posicao % 2 + 1}${heroi ? ` · ${heroi}${souEu ? ' (você)' : ''}` : ' · Adicionar herói'}`);
        if (heroi) {
          slot.classList.add('ocupado');
          const retrato = imagem(herois.get(heroi));
          retrato.draggable = false;
          slot.append(retrato, criar('span', '', souEu ? `${heroi} · Você` : heroi));
          habilitarArraste(slot, time, posicao);
        } else slot.append(criar('span', 'mais', '+'));
        slots.append(slot);
      }
      return lane;
    }));
  }

  function mostrarDetalhe(item, motivo, frequencia) {
    const texto = criar('div');
    texto.append(criar('strong', '', item.nome), tier(item), criar('p', '', motivo),
      criar('small', '', `${formato.format(item.custo)} almas no catálogo${frequencia === undefined ? ' · Regra de contexto ou componente' : ` · ${Math.round(frequencia * 100)}% de presença no perfil`}`));
    const imb = dados.imbuimentos?.herois?.[jogador]?.itens?.[item.nome];
    if (imb) texto.append(criar('p', 'indicacao-imbuimento', `Imbuir: ${imb.slot} · ${imb.nome} · ${(100*imb.pickrate).toFixed(1)}% das escolhas registradas`));
    el('detalhe-item').replaceChildren(imagem(item), texto);
  }

  function atualizar() {
    const estado = estadoPartida();
    el('desfazer').disabled = desfazer.length === 0;
    el('inventario-atual').replaceChildren(...[...inventario].map(nome => {
      const item = itemPorNome.get(nome);
      const remover = botao('item-inventario', undefined, () => {
        guardarEstado();
        inventario.delete(nome);
        historico.delete(nome);
        atualizar();
      });
      remover.setAttribute('aria-label', `Corrigir inventário: remover ${nome}, sem alterar almas`);
      remover.title = `Remover ${nome} do estado informado; sem simular venda`;
      remover.append(imagem(item), criar('span', '', nome), tier(item), criar('small', '', '×'));
      return remover;
    }));
    el('inventario-vazio').hidden = inventario.size > 0;
    const posicao = posicaoJogador();
    const laneJogador = posicao < 0 ? null : Math.floor(posicao / 2);
    desenharTime('aliados');
    desenharTime('inimigos');
    el('nome-jogador').textContent = jogador ?? 'Escolha seu herói';
    el('trocar-heroi').replaceChildren(jogador ? imagem(herois.get(jogador)) : '+');
    el('trocar-heroi').setAttribute('aria-label', jogador ? `Trocar seu herói · ${jogador}` : 'Escolher seu herói');
    el('escolha-lane').hidden = !jogador;
    el('opcoes-lane').replaceChildren(...lanes.map(({ nome, cor }, i) => {
      const escolha = botao(cor, nome, () => {
        if (laneJogador === i) return;
        const alvo = times.aliados[i * 2] ? i * 2 + 1 : i * 2;
        if (posicao < 0) {
          times.aliados[alvo] = jogador;
          atualizar();
        } else trocarPosicoes('aliados', posicao, alvo);
        el('opcoes-lane').children[i].focus();
      });
      escolha.disabled = laneJogador !== i && Boolean(times.aliados[i * 2] && times.aliados[i * 2 + 1]);
      escolha.setAttribute('aria-pressed', String(laneJogador === i));
      if (escolha.disabled) escolha.title = 'Lane cheia';
      return escolha;
    }));

    const podeRecomendar = Boolean(dados.modelos[jogador]) && laneJogador !== null;
    el('build').replaceChildren();
    el('proxima').hidden = true;
    el('plano').hidden = !podeRecomendar;
    el('estado').classList.remove('somente-leitor');
    proximaCompra = null;
    if (!podeRecomendar) {
      el('estado').textContent = !jogador ? 'Selecione o herói que você está jogando.' :
        laneJogador === null ? 'Selecione sua lane para continuar.' :
          `Não há dados disponíveis para ${jogador}.`;
      return;
    }
    const { itens: plano, perfil, situacionais, semEspaco, slotsPlanejados } = recomendar({ jogador, modelo: dados.modelos[jogador], catalogo: dados.itens,
      modeloAmeacas: dados.ameacas || null,
      modeloImbuimentos: dados.imbuimentos || null,
      aliados: times.aliados.filter(heroi => heroi !== jogador), inimigos: times.inimigos,
      adversariosLane: times.inimigos.slice(laneJogador * 2, laneJogador * 2 + 2), inventario, historico, ...estado });
    el('respostas').replaceChildren(...situacionais.map(s => {
      const linha = criar('p', '', `${s.nome}: ${s.elegivel ? 'pode ser antecipado após a abertura' : s.restricoes.join(' · ')}.`);
      return linha;
    }));
    el('contexto-counter').hidden = situacionais.length === 0;
    el('perfil-base').textContent = `${formato.format(dados.modelos[jogador].participacoes)} participações Phantom+ · Perfil ${perfil.id + 1} · Ordem por tempos históricos e componentes. Composição: regras experimentais.`;
    el('estado').textContent = plano.length ? `Próxima compra: ${plano[0].nome} · ${slotsPlanejados} slots finais no plano` :
      semEspaco ? 'Inventário cheio: libere espaço para novas compras.' : 'Sem novos candidatos qualificados neste perfil.';
    if (plano.length) {
      el('estado').classList.add('somente-leitor');
      proximaCompra = plano[0].nome;
      mostrarDetalhe(itemPorNome.get(proximaCompra), plano[0].motivo, plano[0].frequencia);
      const preco = plano[0].custoCompra;
      const faltam = estado.almas === null ? null : Math.max(0, preco - estado.almas);
      el('custo-proxima').textContent = `${formato.format(preco)} almas para comprar${estado.almas === null ? ' · Saldo não informado' : faltam ? ` · Economize mais ${formato.format(faltam)}` : ' · Cabe no saldo informado'}`;
      el('comprar').disabled = faltam !== null && faltam > 0;
      el('proxima').hidden = false;
    }
    const buildCompleta = [...historico, ...plano.map(item => item.nome)];
    el('build').replaceChildren(...buildCompleta.map((nome, i) => {
      const item = itemPorNome.get(nome);
      const linha = criar('li', 'compra');
      if (nome === proximaCompra) {
        linha.classList.add('compra-atual');
        linha.setAttribute('aria-current', 'step');
      }
      if (historico.has(nome)) linha.classList.add('compra-concluida');
      linha.append(criar('small', 'numero', String(i + 1).padStart(2, '0')),
        imagem(item), criar('span', '', nome), tier(item));
      const imb = dados.imbuimentos?.herois?.[jogador]?.itens?.[nome];
      if (imb) linha.title = `Imbuir: ${imb.slot} · ${imb.nome} · ${(100*imb.pickrate).toFixed(1)}% das escolhas registradas`;
      if (historico.has(nome)) linha.append(criar('span', 'somente-leitor', inventario.has(nome) ? 'No inventário' : 'Componente consumido'));
      return linha;
    }));
  }

  el('dados-base').textContent = `44 HERÓIS · ${formato.format(dados.participacoes)} PARTICIPAÇÕES PHANTOM I+ · AMOSTRA HISTÓRICA ${dados.versao}`;
  el('trocar-heroi').addEventListener('click', () => abrir('jogador'));
  el('fechar').addEventListener('click', () => seletor.close());
  seletor.addEventListener('cancel', evento => { if (!jogador) evento.preventDefault(); });
  el('busca').addEventListener('input', desenharCatalogo);
  el('remover').addEventListener('click', () => selecionar(null));
  el('mover').addEventListener('click', () => {
    const { time, posicao } = destino;
    el('pergunta').textContent = `Mover ${times[time][posicao]}`;
    el('busca').hidden = true;
    el('mover').hidden = true;
    el('remover').hidden = true;
    el('opcoes').replaceChildren(...times[time].flatMap((heroi, alvo) => {
      if (alvo === posicao) return [];
      const lane = lanes[Math.floor(alvo / 2)].nome;
      return botao('opcao', `${lane} · ${alvo % 2 + 1} · ${heroi ?? 'Vazio'}`, () => {
        seletor.close();
        trocarPosicoes(time, posicao, alvo);
      });
    }));
    el('opcoes').querySelector('button')?.focus();
  });
  el('comprar').addEventListener('click', () => {
    if (!proximaCompra) return;
    const estado = estadoPartida();
    const novo = efetuarCompra({ nome: proximaCompra, catalogo: dados.itens, inventario, historico, almas: estado.almas });
    guardarEstado();
    substituirEstado(novo);
    if (novo.almas !== null) el('almas').value = novo.almas;
    atualizar();
  });
  el('minuto').addEventListener('input', atualizar);
  el('almas').addEventListener('input', atualizar);
  el('adicionar-item').addEventListener('click', () => abrir('item'));
  el('desfazer').addEventListener('click', () => {
    const anterior = desfazer.pop();
    if (!anterior) return;
    substituirEstado(anterior);
    el('almas').value = anterior.almas;
    atualizar();
  });
  atualizar();
  abrir('jogador');
}

if (typeof document !== 'undefined') iniciar(DADOS);
if (typeof module !== 'undefined') module.exports = require("./motor.js");
