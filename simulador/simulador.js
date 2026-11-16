const grupos = {
  cura: ['Nurse Harrow', 'Kelvin', 'Ivy', 'Rem', 'Abrams', 'Mo & Krill'],
  controle: ['Dynamo', 'Bebop', 'Wraith', 'Haze', 'Lash', 'Abrams'],
  alcance: ['Vindicta', 'Grey Talon', 'Mirage', 'Venator'],
  protecao: ['Paige', 'Dynamo', 'Kelvin', 'Nurse Harrow'],
};

const componentes = {
  Sharpshooter: ['High-Velocity Rounds', 'Long Range'],
  Tankbuster: ['Mystic Burst'],
  'Superior Cooldown': ['Compress Cooldown'],
};

function custoCompra(nome, catalogo, inventario) {
  const mapa = new Map(Object.values(catalogo).map(i => [i.nome, i]));
  const desconto = (item, vistos = new Set()) => {
    if (vistos.has(item)) return 0;
    vistos.add(item);
    if (inventario.has(item)) return mapa.get(item)?.custo ?? 0;
    return (mapa.get(item)?.componentes ?? []).reduce((s, c) => s + desconto(c, vistos), 0);
  };
  const item = mapa.get(nome);
  if (!item) throw new Error('Item fora do catálogo.');
  const vistos = new Set();
  return Math.max(0, item.custo - (item.componentes ?? []).reduce((s, c) => s + desconto(c, vistos), 0));
}

function coberturaInventario(catalogo, inventario) {
  const mapa = new Map(Object.values(catalogo).map(i => [i.nome, i]));
  const cobertos = new Set(inventario);
  const visitar = nome => {
    for (const c of mapa.get(nome)?.componentes ?? []) {
      if (cobertos.has(c)) continue;
      cobertos.add(c);
      visitar(c);
    }
  };
  [...inventario].forEach(visitar);
  return cobertos;
}

function efetuarCompra({ nome, catalogo, inventario, historico = inventario, almas = null }) {
  if (coberturaInventario(catalogo, inventario).has(nome)) throw new Error('O item já está no inventário ou em uma evolução.');
  const custo = custoCompra(nome, catalogo, inventario);
  if (almas !== null && almas < custo) throw new Error('Almas insuficientes.');
  const mapa = new Map(Object.values(catalogo).map(i => [i.nome, i]));
  const novo = new Set(inventario);
  const remover = item => {
    for (const c of mapa.get(item)?.componentes ?? []) {
      novo.delete(c);
      remover(c);
    }
  };
  remover(nome);
  novo.add(nome);
  return { inventario: novo, historico: new Set([...historico, nome]), almas: almas === null ? null : almas - custo };
}

function recomendar({ jogador = 'Paradox', modelo, catalogo = {}, aliados, inimigos, adversariosLane = [], minuto = 0, inventario,
  historico = inventario, almas = null }) {
  const faseAtual = minuto < 10 ? 0 : minuto < 20 ? 1 : 2;
  const contar = (time, grupo) => time.filter(heroi => grupos[grupo].includes(heroi));
  const cura = contar(inimigos, 'cura');
  const controle = contar(inimigos, 'controle');
  const alcance = contar(inimigos, 'alcance');
  const protecao = contar(aliados, 'protecao');
  const sinais = [];
  if (!modelo?.perfis?.length) return { itens: [], sinais, situacionais: [], perfil: null };
  const nomesCatalogo = new Map(Object.values(catalogo).map(i => [i.nome, i]));
  const cobertos = new Set([...historico, ...inventario]);
  const cobrirComponentes = nome => {
    for (const c of nomesCatalogo.get(nome)?.componentes ?? []) {
      if (cobertos.has(c)) continue;
      cobertos.add(c);
      cobrirComponentes(c);
    }
  };
  for (const nome of [...cobertos]) cobrirComponentes(nome);
  const perfil = [...modelo.perfis].sort((a, b) => {
    const pontuar = p => Math.log(p.participacoes / modelo.participacoes) + [...inventario].reduce((s, nome) => {
      const item = p.itens.find(i => i.nome === nome);
      return s + (item ? Math.log(Math.max(.01, item.frequencia)) : 0);
    }, 0);
    return pontuar(b) - pontuar(a);
  })[0];
  const plano = perfil.itens.filter(i => i.frequencia >= .45 && i.segundo !== null && nomesCatalogo.has(i.nome))
    .slice(0, 18).map(i => ({ nome: i.nome, fase: i.segundo < 600 ? 0 : i.segundo < 1200 ? 1 : 2,
      ordem: i.segundo, frequencia: i.frequencia,
      motivo: `${Math.round(i.frequencia * 100)}% das ${perfil.participacoes.toLocaleString('pt-BR')} participações deste perfil de ${jogador}. Entrada típica: ${Math.floor(i.segundo / 60)} min; referência histórica, sem horário obrigatório.` }));
  // O início da build é referência para exigir uma fundação antes de antecipar counters.
  const respostas = new Set(['Healbane', 'Reactive Barrier', 'Counterspell']);
  const abertura = [...plano].filter(i => !respostas.has(i.nome)).sort((a, b) => a.ordem - b.ordem).slice(0, 3);
  const fundacao = abertura.filter(i => cobertos.has(i.nome)).length >= 2;
  const situacionais = [];
  const promover = [];
  const avaliarCounter = (nome, motivo, intensidade) => {
    const item = nomesCatalogo.get(nome);
    if (!item) return;
    const minimo = ({ 1: 4, 2: 6, 3: 12, 4: 20 })[item.tier] ?? 20;
    const preco = custoCompra(nome, catalogo, inventario);
    const comprado = cobertos.has(nome);
    if (comprado) return;
    const restricoes = [];
    if (minuto < minimo) restricoes.push(`reavaliar a partir de ${minimo} min`);
    if (!fundacao) restricoes.push('concluir pelo menos 2 das 3 compras iniciais da build');
    if (almas === null) restricoes.push('informar almas disponíveis para antecipar');
    if (almas !== null && almas < preco) restricoes.push(`faltam ${preco - almas} almas`);
    const elegivel = restricoes.length === 0;
    situacionais.push({ nome, motivo, minimo, elegivel, restricoes, custo: preco });
    if (elegivel) promover.push({ nome, motivo, intensidade, custo: preco });
  };

  if (cura.length >= 2 || (faseAtual === 0 && contar(adversariosLane, 'cura').length > 0)) {
    avaliarCounter('Healbane', `Resposta experimental à cura de ${cura.join(', ')}.`, cura.length);
  }
  if (controle.length >= 2 || (faseAtual === 0 && contar(adversariosLane, 'controle').length > 0)) {
    // Uma resposta de controle por decisão; a alternativa barata precede a tardia.
    const resposta = !protecao.length && minuto < 12 ? 'Reactive Barrier' : 'Counterspell';
    avaliarCounter(resposta, `Resposta experimental ao controle de ${controle.join(', ')}.`, controle.length);
  }
  // Só uma exceção contextual ganha prioridade por decisão, sem pontuações negativas.
  const antecipado = promover.sort((a, b) => b.intensidade - a.intensidade || a.custo - b.custo)[0];
  if (antecipado) {
    let existente = plano.find(i => i.nome === antecipado.nome);
    if (!existente) {
      existente = { nome: antecipado.nome, fase: faseAtual, ordem: minuto * 60 };
      plano.push(existente);
    }
    existente.contextual = true;
    existente.motivo = `${antecipado.motivo} Antecipado após a abertura, com tempo e orçamento compatíveis; regra provisória.`;
  }
  // Inclui componentes de upgrades e preserva sua precedência na sequência.
  const adicionarComponentes = (nome, visitados = new Set()) => {
    if (visitados.has(nome)) return;
    visitados.add(nome);
    for (const anterior of nomesCatalogo.get(nome)?.componentes ?? []) {
      if (!nomesCatalogo.has(anterior)) continue;
      if (!plano.some(i => i.nome === anterior)) {
        const observado = perfil.itens.find(i => i.nome === anterior);
        plano.push({ nome: anterior, fase: 0, ordem: observado?.segundo ?? 0,
          frequencia: observado?.frequencia,
          motivo: `Componente de ${nome}; incluído para preparar a evolução do item.` });
      }
      adicionarComponentes(anterior, visitados);
    }
  };
  for (const item of [...plano]) adicionarComponentes(item.nome);

  if (alcance.length >= 2) {
    sinais.push({ texto: `Pressão de longe · ${alcance.join(', ')}`, alerta: true });
  }
  if (protecao.length) sinais.push({ texto: `Proteção aliada · ${protecao.join(', ')}`, alerta: false });

  const possui = new Set([...historico, ...inventario]);
  const consumirComponentes = nome => {
    for (const anterior of nomesCatalogo.get(nome)?.componentes ?? componentes[nome] ?? []) {
      if (possui.has(anterior)) continue;
      possui.add(anterior);
      consumirComponentes(anterior);
    }
  };
  for (const item of [...historico, ...inventario]) consumirComponentes(item);
  const candidatos = plano.filter((item, i) => plano.findIndex(x => x.nome === item.nome) === i && !possui.has(item.nome) && nomesCatalogo.has(item.nome))
    .sort((a, b) => Number(Boolean(b.contextual)) - Number(Boolean(a.contextual)) ||
      Math.max(a.fase, faseAtual) - Math.max(b.fase, faseAtual) || a.ordem - b.ordem);
  const itens = [];
  const ordenar = item => {
    if (itens.includes(item)) return;
    for (const nome of nomesCatalogo.get(item.nome)?.componentes ?? []) {
      const anterior = candidatos.find(i => i.nome === nome);
      if (anterior) ordenar(anterior);
    }
    itens.push(item);
  };
  candidatos.forEach(ordenar);
  for (const item of itens) item.custoCompra = custoCompra(item.nome, catalogo, inventario);
  return { itens, sinais, situacionais, perfil };
}

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
    const { itens: plano, perfil, situacionais } = recomendar({ jogador, modelo: dados.modelos[jogador], catalogo: dados.itens,
      aliados: times.aliados.filter(heroi => heroi !== jogador), inimigos: times.inimigos,
      adversariosLane: times.inimigos.slice(laneJogador * 2, laneJogador * 2 + 2), inventario, historico, ...estado });
    el('respostas').replaceChildren(...situacionais.map(s => {
      const linha = criar('p', '', `${s.nome}: ${s.elegivel ? 'pode ser antecipado após a abertura' : s.restricoes.join(' · ')}.`);
      return linha;
    }));
    el('contexto-counter').hidden = situacionais.length === 0;
    el('perfil-base').textContent = `${formato.format(dados.modelos[jogador].participacoes)} participações Phantom+ · Perfil ${perfil.id + 1} · Ordem por tempos históricos e componentes. Composição: regras experimentais.`;
    el('estado').textContent = plano.length ? `Próxima compra: ${plano[0].nome}` : 'Você já tem os itens sugeridos neste cenário.';
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
if (typeof module !== 'undefined') module.exports = { recomendar, custoCompra, efetuarCompra };

