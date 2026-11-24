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

// Panorama pode oferecer toLocaleString sem os dados ICU necessários para executá-lo.
function formatarContagem(valor) {
  return String(valor).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

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

// Conta o inventário depois do consumo, inclusive ancestrais transitivos.
function projetarInventario({ nome, catalogo, inventario, limiteSlots = 12 }) {
  if (!Number.isInteger(limiteSlots) || limiteSlots < 0 || limiteSlots > 12) throw new Error('Limite de slots inválido.');
  const mapa = new Map(Object.values(catalogo).map(i => [i.nome, i]));
  if (!mapa.has(nome)) throw new Error('Item fora do catálogo.');
  const novo = new Set(inventario), visitados = new Set();
  const consumir = item => {
    if (visitados.has(item)) return;
    visitados.add(item);
    for (const c of mapa.get(item)?.componentes ?? []) {
      novo.delete(c);
      consumir(c);
    }
  };
  consumir(nome);
  novo.add(nome);
  return { inventario: novo, slotsDepois: novo.size, cabe: novo.size <= limiteSlots };
}

function efetuarCompra({ nome, catalogo, inventario, historico = inventario, almas = null, limiteSlots = 12 }) {
  if (coberturaInventario(catalogo, inventario).has(nome)) throw new Error('O item já está no inventário ou em uma evolução.');
  const custo = custoCompra(nome, catalogo, inventario);
  if (almas !== null && almas < custo) throw new Error('Almas insuficientes.');
  const projecao = projetarInventario({ nome, catalogo, inventario, limiteSlots });
  if (!projecao.cabe) throw new Error('Inventário cheio; é necessário liberar espaço antes desta compra.');
  return { inventario: projecao.inventario, historico: new Set([...historico, nome]), almas: almas === null ? null : almas - custo };
}

function analisarAmeacas({ jogador, aliados = [], inimigos = [], minuto = 0, modeloAmeacas }) {
  const vazio = { candidatos: [], sinais: [] };
  if (!modeloAmeacas || modeloAmeacas.versao !== 1 || inimigos.length !== 6 || aliados.length !== 5 || minuto < 6) return vazio;
  const heroes = modeloAmeacas.herois;
  const all = [jogador, ...aliados, ...inimigos];
  if (new Set(all).size !== 12 || all.some(h => !heroes.includes(h))) return vazio;
  const n = heroes.length;
  const phase = minuto < 14 ? 0 : minuto < 22 ? 1 : 2;
  const enemyIdx = inimigos.map(h => heroes.indexOf(h));
  const allyIdx = aliados.map(h => heroes.indexOf(h));
  const sigmoid = z => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));
  const candidatos = [];
  for (const item of modeloAmeacas.itens) {
    if (!item.contextoValidado || !['fisica', 'espiritual'].includes(item.tipo) ||
        (item.compradoresPorHeroi[jogador] || 0) < 10) continue;
    const c = item.coeficientes;
    const common = item.intercepto + c[heroes.indexOf(jogador)] +
      allyIdx.reduce((s, i) => s + c[2*n+i], 0) + c[3*n+phase];
    const actual = enemyIdx.reduce((s, i) => s + c[n+i], 0);
    const reference = modeloAmeacas.mediasInimigos.reduce((s, v, i) => s + v*c[n+i], 0);
    const delta = actual - reference;
    const probabilidade = sigmoid(common + actual);
    // Sinais de compra condicionada, não uma estimativa do dano que cada herói causou.
    if (delta < .35 || probabilidade < .025) continue;
    const fontes = enemyIdx.filter(i => c[n+i] >= .1).sort((a, b) => c[n+b]-c[n+a]).slice(0, 3).map(i => heroes[i]);
    if (!fontes.length) continue;
    candidatos.push({ nome: item.nome, tipo: item.tipo, ativo: item.ativo, probabilidade,
      referencia: sigmoid(common+reference), elevacaoLogOdds: delta, fontes,
      intensidade: 1 + Math.min(3, delta) });
  }
  candidatos.sort((a, b) => b.probabilidade*Math.min(b.elevacaoLogOdds, 2) - a.probabilidade*Math.min(a.elevacaoLogOdds, 2));
  const sinais = ['fisica', 'espiritual'].flatMap(tipo => {
    const best = candidatos.find(i => i.tipo === tipo);
    return best ? [{ texto: `Pressão ${tipo === 'fisica' ? 'física' : 'espiritual'} estimada por padrões de compra · ${best.fontes.join(', ')}`, alerta: true }] : [];
  });
  return { candidatos, sinais };
}

function recomendar({ jogador = 'Paradox', modelo, catalogo = {}, aliados, inimigos, adversariosLane = [], minuto = 0, inventario, limiteSlots = 12, limiteSlotsPlanejados = limiteSlots,
  historico = inventario, almas = null, modeloAmeacas = null, modeloImbuimentos = null }) {
  const faseAtual = minuto < 10 ? 0 : minuto < 20 ? 1 : 2;
  const contar = (time, grupo) => time.filter(heroi => grupos[grupo].includes(heroi));
  const cura = contar(inimigos, 'cura');
  const controle = contar(inimigos, 'controle');
  const alcance = contar(inimigos, 'alcance');
  const protecao = contar(aliados, 'protecao');
  const sinais = [];
  if (!modelo?.perfis?.length) return { itens: [], sinais, situacionais: [], perfil: null };
  const nomesCatalogo = new Map(Object.values(catalogo).map(i => [i.nome, i]));
  if (!Number.isInteger(limiteSlotsPlanejados) || limiteSlotsPlanejados < limiteSlots || limiteSlotsPlanejados > 12) {
    throw new Error('Capacidade do plano inválida.');
  }
  // Histórico é trilha de transações; somente o inventário atual comprova posse.
  const cobertos = new Set(inventario);
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
    .map(i => ({ nome: i.nome, fase: i.segundo < 600 ? 0 : i.segundo < 1200 ? 1 : 2,
      ordem: i.segundo, frequencia: i.frequencia,
      motivo: `${Math.round(i.frequencia * 100)}% das ${formatarContagem(perfil.participacoes)} participações deste perfil de ${jogador}. Entrada típica: ${Math.floor(i.segundo / 60)} min; referência histórica, sem horário obrigatório.` }));
  // O início da build é referência para exigir uma fundação antes de antecipar counters.
  const respostas = new Set(['Healbane', 'Reactive Barrier', 'Counterspell']);
  const abertura = [...plano].filter(i => !respostas.has(i.nome)).sort((a, b) => a.ordem - b.ordem).slice(0, 3);
  const fundacao = abertura.filter(i => cobertos.has(i.nome)).length >= 2;
  const situacionais = [];
  const promover = [];
  const avaliarCounter = (nome, motivo, intensidade, evidencia = null) => {
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
    if (!projetarInventario({ nome, catalogo, inventario, limiteSlots }).cabe) restricoes.push('inventário cheio; venda não planejada');
    const elegivel = restricoes.length === 0;
    situacionais.push({ nome, motivo, minimo, elegivel, restricoes, custo: preco, evidencia });
    if (elegivel) promover.push({ nome, motivo, intensidade, custo: preco, evidencia });
    return elegivel;
  };

  if (cura.length >= 2 || (faseAtual === 0 && contar(adversariosLane, 'cura').length > 0)) {
    avaliarCounter('Healbane', `Resposta experimental à cura de ${cura.join(', ')}.`, cura.length);
  }
  if (controle.length >= 2 || (faseAtual === 0 && contar(adversariosLane, 'controle').length > 0)) {
    // Uma resposta de controle por decisão; a alternativa barata precede a tardia.
    const resposta = !protecao.length && minuto < 12 ? 'Reactive Barrier' : 'Counterspell';
    avaliarCounter(resposta, `Resposta experimental ao controle de ${controle.join(', ')}.`, controle.length);
  }
  const ameacas = analisarAmeacas({ jogador, aliados, inimigos, minuto, modeloAmeacas });
  sinais.push(...ameacas.sinais);
  // Uma resposta avançada por tipo; defesa barata não impede uma evolução tardia.
  for (const tipo of ['fisica', 'espiritual']) {
    for (const candidato of ameacas.candidatos.filter(i => i.tipo === tipo)) {
      if (!nomesCatalogo.has(candidato.nome) || cobertos.has(candidato.nome)) continue;
      const protegida = modeloAmeacas.itens.some(i => i.tipo === tipo && inventario.has(i.nome) &&
        ((nomesCatalogo.get(i.nome)?.tier || 0) >= 3 ||
         (i.ativo === candidato.ativo && (nomesCatalogo.get(i.nome)?.tier || 0) >= nomesCatalogo.get(candidato.nome).tier)));
      if (protegida) continue;
      const label = tipo === 'fisica' ? 'física' : 'espiritual';
      const motivo = `Proteção ${label} associada à composição com ${candidato.fontes.join(', ')}; modelo ajustado por comprador, aliados, demais inimigos e fase. Associação histórica, sem garantia de counter.`;
      if (avaliarCounter(candidato.nome, motivo, candidato.intensidade, candidato)) break;
    }
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
    existente.evidencia = antecipado.evidencia;
    existente.motivo = `${antecipado.motivo} Antecipado após a abertura, com tempo e orçamento compatíveis; regra provisória.`;
  }
  // Dimensiona a continuação por itens finais, nunca por número de compras.
  // A união normalizada remove os ancestrais incorporados às evoluções planejadas.
  const cacheAncestrais = new Map();
  const ancestrais = nome => {
    if (cacheAncestrais.has(nome)) return cacheAncestrais.get(nome);
    const encontrados = new Set(), fila = [...(nomesCatalogo.get(nome)?.componentes ?? [])];
    while (fila.length) {
      const n = fila.pop();
      if (encontrados.has(n)) continue;
      encontrados.add(n); fila.push(...(nomesCatalogo.get(n)?.componentes ?? []));
    }
    cacheAncestrais.set(nome, encontrados); return encontrados;
  };
  const normalizarAlvos = nomes => {
    const resultado = new Set(nomes);
    for (const n of nomes) for (const c of ancestrais(n)) resultado.delete(c);
    return resultado;
  };
  let alvos = normalizarAlvos([...inventario, ...plano.map(i => i.nome)]);
  const slotsNucleo = alvos.size;
  const adiadosPorEspaco = [];
  while (alvos.size > limiteSlotsPlanejados) {
    const removiveis = [...alvos].filter(n => !inventario.has(n) && !plano.some(p => p.nome === n && p.contextual))
      .sort((a,b) => (plano.find(i => i.nome === a)?.frequencia ?? 0) - (plano.find(i => i.nome === b)?.frequencia ?? 0));
    let retirado = false;
    for (const n of removiveis) {
      const proximos = normalizarAlvos([...inventario, ...[...alvos].filter(x => x !== n)]);
      if (proximos.size >= alvos.size) continue;
      const cobertura = coberturaInventario(catalogo, proximos);
      for (let j = plano.length-1; j >= 0; j--) if (!cobertura.has(plano[j].nome)) plano.splice(j,1);
      adiadosPorEspaco.push(n); alvos = proximos; retirado = true; break;
    }
    if (!retirado) break;
  }
  const horizonteNucleo = Math.max(0, ...plano.map(i => i.ordem));
  const defesas = new Set([...(modeloAmeacas?.itens ?? []).map(i => i.nome), ...respostas]);
  const extensoes = perfil.itens.filter(i => {
    const meta = nomesCatalogo.get(i.nome);
    return meta && i.segundo !== null && Number.isFinite(i.segundo) && i.frequencia >= .15 &&
      Math.round(i.frequencia * perfil.participacoes) >= 30 &&
      (meta.tier >= 3 || (meta.componentes || []).length > 0);
  }).sort((a,b) => {
    const evolui = i => [...ancestrais(i.nome)].some(c => alvos.has(c));
    return Number(evolui(b)) - Number(evolui(a)) || b.frequencia-a.frequencia || a.segundo-b.segundo ||
      (a.nome < b.nome ? -1 : a.nome > b.nome ? 1 : 0);
  });
  for (const i of extensoes) {
    const coberturaAlvos = coberturaInventario(catalogo, alvos);
    if (coberturaAlvos.has(i.nome) || plano.some(p => p.nome === i.nome)) continue;
    // Não acrescenta defesa contextual só para ocupar uma vaga; permite concluir
    // uma cadeia defensiva já escolhida pelo perfil/inventário.
    if (defesas.has(i.nome) && ![...ancestrais(i.nome)].some(c => alvos.has(c))) continue;
    const proximos = normalizarAlvos([...alvos, i.nome]);
    if (proximos.size > limiteSlotsPlanejados) continue;
    const ordem = Math.max(horizonteNucleo, i.segundo);
    plano.push({ nome:i.nome, fase:ordem < 600 ? 0 : ordem < 1200 ? 1 : 2,
      ordem, frequencia:i.frequencia, continuacao:true,
      motivo:`Continuação do perfil: ${Math.round(i.frequencia*100)}% das ${formatarContagem(perfil.participacoes)} participações. Planejamento por slots finais, com componentes consumidos; referência histórica, sem garantia de compra ideal.` });
    alvos = proximos;
  }

  // Inclui componentes de upgrades e preserva sua precedência na sequência.
  const adicionarComponentes = (nome, visitados = new Set()) => {
    if (visitados.has(nome)) return;
    visitados.add(nome);
    for (const anterior of nomesCatalogo.get(nome)?.componentes ?? []) {
      if (!nomesCatalogo.has(anterior)) continue;
      const pai = plano.find(i => i.nome === nome);
      let componente = plano.find(i => i.nome === anterior);
      if (!componente) {
        const observado = perfil.itens.find(i => i.nome === anterior);
        const referencia = Math.min(observado?.segundo ?? pai.ordem, pai.ordem);
        const ordem = pai.continuacao ? Math.max(horizonteNucleo, referencia) : referencia;
        componente = { nome: anterior, fase: ordem < 600 ? 0 : ordem < 1200 ? 1 : 2, ordem,
          continuacao: Boolean(pai.continuacao),
          frequencia: observado?.frequencia,
          motivo: `Componente de ${nome}; preparação na fase da evolução, preservando a referência histórica disponível.` };
        plano.push(componente);
      } else if (componente.ordem > pai.ordem) {
        componente.ordem = pai.ordem;
        componente.fase = pai.ordem < 600 ? 0 : pai.ordem < 1200 ? 1 : 2;
      }
      if (!pai.continuacao) componente.continuacao = false;
      adicionarComponentes(anterior, visitados);
    }
  };
  for (const item of [...plano]) adicionarComponentes(item.nome);

  if (alcance.length >= 2) {
    sinais.push({ texto: `Pressão de longe · ${alcance.join(', ')}`, alerta: true });
  }
  if (protecao.length) sinais.push({ texto: `Proteção aliada · ${protecao.join(', ')}`, alerta: false });

  const possui = new Set(inventario);
  const consumirComponentes = nome => {
    for (const anterior of nomesCatalogo.get(nome)?.componentes ?? componentes[nome] ?? []) {
      if (possui.has(anterior)) continue;
      possui.add(anterior);
      consumirComponentes(anterior);
    }
  };
  for (const item of inventario) consumirComponentes(item);
  for (const item of plano) {
    const meta = nomesCatalogo.get(item.nome);
    const restante = custoCompra(item.nome, catalogo, inventario);
    item.evolucaoEconomica = Boolean(fundacao && (almas === null || almas >= restante) &&
      (meta.componentes || []).some(c => inventario.has(c)) && restante <= meta.custo*.5);
    item.ordemEfetiva = item.evolucaoEconomica ? item.ordem * restante/meta.custo : item.ordem;
    item.faseEfetiva = item.ordemEfetiva < 600 ? 0 : item.ordemEfetiva < 1200 ? 1 : 2;
    if (item.evolucaoEconomica) item.motivo += ` Prioridade ajustada pelo investimento já feito: componente equipado e custo restante de ${restante} almas. Heurística de progressão, sem compra automática.`;
  }
  const candidatos = plano.filter((item, i) => plano.findIndex(x => x.nome === item.nome) === i && !possui.has(item.nome) && nomesCatalogo.has(item.nome))
    .sort((a, b) => Number(Boolean(b.contextual)) - Number(Boolean(a.contextual)) ||
      Number(Boolean(a.continuacao)) - Number(Boolean(b.continuacao)) ||
      (a.continuacao && b.continuacao ?
        projetarInventario({ nome:a.nome,catalogo,inventario,limiteSlots }).slotsDepois -
        projetarInventario({ nome:b.nome,catalogo,inventario,limiteSlots }).slotsDepois : 0) ||
      Math.max(a.faseEfetiva, faseAtual) - Math.max(b.faseEfetiva, faseAtual) || a.ordemEfetiva - b.ordemEfetiva);
  // A fila comum deve obedecer à mesma legalidade das respostas contextuais.
  // Não elimina por saldo: um alvo pode exigir economizar, mas nunca um slot extra.
  const bloqueadosPorEspaco = candidatos.filter(i => !projetarInventario({ nome: i.nome, catalogo, inventario, limiteSlots }).cabe);
  const permitidos = candidatos.filter(i => !bloqueadosPorEspaco.includes(i));
  const itens = [];
  const ordenar = item => {
    if (itens.includes(item)) return;
    for (const nome of nomesCatalogo.get(item.nome)?.componentes ?? []) {
      const anterior = permitidos.find(i => i.nome === nome);
      if (anterior) ordenar(anterior);
    }
    itens.push(item);
  };
  permitidos.forEach(ordenar);
  for (const item of itens) {
    item.custoCompra = custoCompra(item.nome, catalogo, inventario);
    item.imbuimento = modeloImbuimentos?.herois?.[jogador]?.itens?.[item.nome] ?? null;
  }
  return { itens, sinais, situacionais, perfil, bloqueadosPorEspaco,
    slotsNucleo, slotsPlanejados: alvos.size, inventarioPlanejado: [...alvos], adiadosPorEspaco,
    semEspaco: (bloqueadosPorEspaco.length > 0 || adiadosPorEspaco.length > 0) && itens.length === 0 };
}


if (typeof module !== "undefined") module.exports = { recomendar, custoCompra, efetuarCompra, analisarAmeacas, projetarInventario };
