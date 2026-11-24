(function () {
    "use strict";
    function valid(p) { try { return Boolean(p && p.IsValid()); } catch (e) { return false; } }
    function children(p) { return valid(p) ? p.Children() : []; }
    function has(p, c) { return valid(p) && p.BHasClass(c); }
    function directId(p, id) {
        var list = children(p);
        for (var i = 0; i < list.length; i++) if (valid(list[i]) && list[i].id === id) return list[i];
        return null;
    }
    function directClass(p, c) {
        var list = children(p);
        for (var i = 0; i < list.length; i++) if (has(list[i], c)) return list[i];
        return null;
    }
    function find(p, id) { return valid(p) ? p.FindChildTraverse(id) : null; }
    function descendantsClass(p, c) {
        var queue = children(p).slice(), result = [], visited = 0;
        while (queue.length && visited++ < 256) {
            var node = queue.shift();
            if (!valid(node)) continue;
            if (has(node, c)) result.push(node);
            queue = queue.concat(children(node));
        }
        return result;
    }
    function cardHero(card, data) {
        // heroid não é exposto por todas as versões de CitadelHeroBadge.
        // HeroName é um texto atualizado pelo próprio jogo, inclusive em trocas.
        var labels = descendantsClass(card, "HeroName");
        var names = labels.map(function (p) { return String(p.text || "").trim().toLowerCase(); });
        var matches = data.herois.filter(function (h) { return names.indexOf(h.nome.toLowerCase()) !== -1; });
        if (matches.length === 1) return matches[0].id;
        var badge = find(card, "HeroBadge"), id = valid(badge) ? Number(badge.heroid) : NaN;
        return isFinite(id) && id > 0 && Math.floor(id) === id ? id : null;
    }
    function parseClock(text) {
        if (typeof text !== "string") return null;
        var m = text.trim().replace(/\u2212/g, "-").match(/^(-?)(\d{1,3}):([0-5]\d)$/);
        return m ? { seconds: (m[1] ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])), text: m[0] } : null;
    }
    function parseSouls(text) {
        if (typeof text !== "string") return null;
        text = text.trim();
        if (/^\d+$/.test(text)) return Number(text);
        if (/^\d{1,3}([., \u00a0])\d{3}(?:\1\d{3})*$/.test(text)) return Number(text.replace(/[., \u00a0]/g, ""));
        return null; // Valores abreviados, infinito e ausência não são saldo exato.
    }
    function imageKey(value) {
        if (typeof value !== "string") return null;
        var s = value.toLowerCase().replace(/\\/g, "/");
        var pos = s.indexOf("images/");
        if (pos < 0) return null;
        return s.substring(pos).replace(/["')\s]+$/g, "").replace(/(?:_(?:psd|png)\.vtex(?:_c)?|\.psd|\.png|\.webp)$/, "");
    }
    function images(p) {
        if (!valid(p)) return [];
        var values = [];
        if (typeof p.GetAttributeString === "function") {
            values.push(p.GetAttributeString("src", ""), p.GetAttributeString("defaultsrc", ""));
        }
        if (p.style) values.push(String(p.style.backgroundImage || ""));
        return values.map(imageKey).filter(function (v) { return v !== null; });
    }
    function ownedShopNames(shop, registry, localize) {
        var found = [], queue = children(shop).slice(), visited = 0;
        while (queue.length && visited++ < 4096) {
            var node = queue.shift();
            if (!valid(node)) continue;
            if (has(node, "mod_view")) {
                if (has(node, "owned")) descendantsClass(node, "modName").forEach(function (label) {
                    var text = String(label.text || "").trim().toLowerCase();
                    var matches = registry.filter(function (item) {
                        var translated = item.classeNativa && localize ? String(localize("#" + item.classeNativa) || "").trim().toLowerCase() : "";
                        return text && (text === item.nome.toLowerCase() || (translated.charAt(0) !== "#" && text === translated));
                    });
                    if (matches.length === 1 && found.indexOf(matches[0].nome) === -1) found.push(matches[0].nome);
                });
                continue;
            }
            queue = queue.concat(children(node));
        }
        return queue.length === 0 ? found : []; // Não usa uma lista truncada como confirmação.
    }
    function readInventory(core, registry, shopEvidence, expectedSlots) {
        expectedSlots = typeof expectedSlots === "number" ? expectedSlots : 12;
        var lower = directId(directId(core, "StatsAndModsContainer"), "LowerLeft");
        var mods = directId(lower, "ModsContainer");
        var roots = [find(mods, "ModPurchasedPanelUniversal"), find(mods, "ModPurchasedPanelUniversalLocked")];
        var queue = roots.map(function (p, i) { return { panel: p, locked: i === 1 }; }).filter(function (entry) { return valid(entry.panel); });
        var names = [], unknown = [], owners = 0, empty = 0, locked = 0, occupied = 0, inconsistent = false, seen = [], visited = 0, confirmedShop = [];
        var maxTier = registry.reduce(function (max, item) { return Math.max(max, item.tier || 0); }, 4);
        while (queue.length && visited < 1024) {
            var entry = queue.shift(), p = entry.panel; visited++;
            if (!valid(p)) { inconsistent = true; continue; }
            if (seen.indexOf(p) !== -1) { inconsistent = true; continue; }
            seen.push(p);
            var container = directId(p, "modIconContainer");
            if (!valid(container)) {
                queue = queue.concat(children(p).map(function (child) { return { panel: child, locked: entry.locked }; }));
                continue;
            }
            owners++;
            var tier = null;
            for (var t = maxTier; t >= 1; t--) {
                if (has(p, "isTier" + t) || has(find(p, "mod_tier_label"), "ModTierLevel" + t)) { tier = t; break; }
            }
            var kind = has(p, "isWeapon") ? "weapon" : has(p, "isArmor") ? "vitality" : has(p, "isTech") ? "spirit" : null;
            var active = has(p, "isActiveItem") ? true : has(p, "isPassiveItem") ? false : null;
            var keys = images(find(p, "ModIconImage")).concat(images(find(p, "mod_icon")));
            var isLocked = entry.locked || has(p, "Locked");
            var noItem = tier === null && kind === null && keys.length === 0 && active === null && !has(p, "hasAbility") &&
                !registry.some(function (item) { return item.classes.some(function (c) { return has(p, c) || has(container, c); }); });
            // A categoria visual Locked Universal não comprova uma redução da
            // capacidade de 12 itens. Leia seus itens normalmente e mantenha
            // essa marca apenas como diagnóstico, sem bloquear compras.
            if (isLocked) locked++;
            // Os doze espaços nativos vazios não são doze itens desconhecidos.
            // Qualquer evidência de item (categoria/tier/atividade/ícone) mantém a validação estrita.
            if (noItem) {
                empty++; continue;
            }
            occupied++;
            var matches = registry.filter(function (item) {
                if (tier !== null && tier !== item.tier) return false;
                if (kind !== null && kind !== item.tipo) return false;
                if (active !== null && typeof item.ativo === "boolean" && active !== item.ativo) return false;
                if (keys.length && !item.imagens.some(function (k) { return keys.indexOf(k) !== -1; })) return false;
                if (keys.length && !item.classes.some(function (c) { return has(p, c) || has(container, c); })) {
                    // Uma imagem pode identificar o item quando a classe não está disponível.
                    return !registry.some(function (other) { return other !== item && other.classes.some(function (c) { return has(p, c) || has(container, c); }); });
                }
                if (keys.length) return true;
                if (tier === null || kind === null) return false;
                return item.classes.some(function (c) { return has(p, c) || has(container, c); });
            });
            if (matches.length === 1) {
                if (names.indexOf(matches[0].nome) === -1) names.push(matches[0].nome);
                else inconsistent = true;
            } else {
                var possible = matches;
                if (!possible.length && tier !== null && kind !== null) {
                    // Algumas definições nativas não têm classe CSS (ex.: Cultist Sacrifice).
                    // Compatibilidade de metadados restringe a fila, mas não prova identidade.
                    possible = registry.filter(function (item) {
                        return item.tier === tier && item.tipo === kind &&
                            (active === null || typeof item.ativo !== "boolean" || active === item.ativo);
                    });
                }
                unknown.push({ tier: tier, tipo: kind, ativo: active, imagens: keys.slice(0, 2), candidatos: possible.length,
                    origemCandidatos: matches.length ? "identidade visual" : "metadados compatíveis",
                    nomesCandidatos: possible.map(function (item) { return item.nome; }) });
            }
        }
        if (shopEvidence && shopEvidence.ativo) {
            var owned = [], groups = {};
            try { owned = ownedShopNames(shopEvidence.shop, registry, shopEvidence.localize); } catch (shopError) { /* Fonte opcional: preserva leitura dos slots. */ }
            unknown.forEach(function (slot) {
                if (!slot.nomesCandidatos.length) return;
                var key = slot.nomesCandidatos.slice().sort().join("|");
                if (!groups[key]) groups[key] = [];
                groups[key].push(slot);
            });
            Object.keys(groups).forEach(function (key) {
                var slots = groups[key];
                var selected = slots[0].nomesCandidatos.filter(function (n) { return owned.indexOf(n) !== -1 && names.indexOf(n) === -1; });
                // Duas identidades da loja só resolvem dois slots, nunca inventam um slot extra.
                if (selected.length !== slots.length) return;
                selected.forEach(function (n) { names.push(n); confirmedShop.push(n); });
                unknown = unknown.filter(function (slot) { return slots.indexOf(slot) === -1; });
            });
        }
        var structureComplete = expectedSlots === 12 && roots.every(valid) && owners === expectedSlots &&
            queue.length === 0 && !inconsistent && occupied + empty === expectedSlots;
        var complete = structureComplete && unknown.length === 0 && names.length === occupied;
        return { nomes: names.sort(), completo: complete, slotsObservados: owners, desconhecidos: unknown,
            estruturaCompleta: structureComplete, slotsEsperados: expectedSlots, marcadoresLocked: locked,
            slotsDisponiveis: structureComplete ? expectedSlots : null, slotsOcupados: occupied,
            fontes: roots.filter(valid).length, vazios: empty, confirmadosLoja: confirmedShop, limiteAtingido: queue.length > 0 };
    }
    function flag(root, hud, core, name) {
        if (has(root, name) || has(hud, name) || has(core, name)) return true;
        var p = root;
        for (var i = 0; i < 4 && valid(p) && typeof p.GetParent === "function"; i++) {
            p = p.GetParent(); if (has(p, name)) return true;
        }
        return false;
    }
    function readSignature(core, data, localize) {
        var signature = directId(directId(core, "AbilitiesContainer"), "hud_signature");
        var labels = descendantsClass(signature, "ability_name");
        var names = labels.map(function (p) { return String(p.text || "").trim().toLowerCase(); }).filter(function (s) { return s && s.indexOf("{") === -1; });
        var matches = data.herois.filter(function (hero) {
            var found = [];
            (hero.habilidades || []).forEach(function (token) {
                var name = localize ? localize("#" + token) : "";
                name = String(name || "").trim().toLowerCase();
                if (name && name.charAt(0) !== "#" && names.indexOf(name) !== -1 && found.indexOf(name) === -1) found.push(name);
            });
            return found.length >= 2;
        });
        return { id: matches.length === 1 ? matches[0].id : null, nomes: names, candidatos: matches.length };
    }
    function readState(root, data, localize) {
        data = data || { herois: [], registroInventario: [] };
        var hud = directId(root, "Hud"), core = directClass(hud, "HudCore"), top = directId(core, "TopBar");
        var label = directId(directClass(top, "GameClock"), "GameTime");
        var clock = valid(label) ? parseClock(label.text) : null;
        var teams = directId(top, "TeamsContainer"), locals = [], roster = [], targets = [];
        children(teams).forEach(function (team) {
            children(directId(directId(team, "PlayerContents"), "PlayersContainer")).forEach(function (card) {
                if (!valid(card) || has(card, "Empty")) return;
                var id = cardHero(card, data);
                if (has(card, "LocalPlayer")) locals.push(id);
                if (has(card, "SpectatorTarget")) targets.push(id);
                if (id === null) return;
                roster.push({ id: id, time: team.id });
            });
        });
        var heroId = locals.length === 1 ? locals[0] : null;
        var source = heroId !== null ? "LocalPlayer" : "não identificado";
        var shop = directId(core, "CitadelHudHeroShop");
        var shopHeroes = data.herois.filter(function (h) { return has(shop, h.classe); });
        var hideout = flag(root, hud, core, "InHideout");
        // O esconderijo mantém connectedToHideout também na sala de combate.
        var testing = flag(root, hud, core, "connectedToHeroTesting") ||
            (flag(root, hud, core, "connectedToHideout") && !hideout);
        var replay = flag(root, hud, core, "replay_playback") || flag(root, hud, core, "TeamSpectator");
        var brawl = has(top, "gStreetBrawl") || flag(root, hud, core, "gStreetBrawl");
        var signatureHero = readSignature(core, data, localize);
        if ((heroId === null || testing) && locals.length <= 1 && targets.length === 0 && signatureHero.id !== null && !replay) {
            heroId = signatureHero.id; source = "barra de habilidades";
        }
        if (heroId === null && locals.length === 0 && targets.length === 0 && shopHeroes.length === 1 && (hideout || testing || roster.length === 0)) {
            heroId = shopHeroes[0].id; source = "classe da loja";
        }
        var spectating = replay || targets.some(function (id) { return heroId === null || id !== heroId; });
        // A loja pode reter o herói anterior até ser reaberta. O cartão local prevalece.
        var conflict = locals.length > 1 || (locals.length === 1 && heroId === null);
        // A mesma evidência deve confirmar o jogador e classificar a sessão.
        // LocalPlayer pode faltar após o aquecimento; as habilidades próprias,
        // com relógio válido, continuam identificando a partida sem usar a loja antiga.
        var signatureConfirmed = source === "barra de habilidades" && (testing || clock !== null);
        var localConfirmed = !spectating && !conflict && !hideout && !brawl && (locals.length === 1 ||
            signatureConfirmed || (testing && source === "classe da loja"));
        var mode = hideout ? "esconderijo" : testing ? "teste de herói" : localConfirmed ? "partida" : "contexto não confirmado";
        if (brawl) mode = "Street Brawl";
        var postGame = flag(root, hud, core, "GameStatePostGame") || flag(root, hud, core, "GameStatePostGamePlayOfTheGame");
        var hudVisible = valid(core) && localConfirmed && !hideout && !postGame &&
            (mode === "partida" || mode === "teste de herói");
        var hiddenReason = !valid(core) ? "HUD nativo indisponível" : hideout ? "menu inicial" : postGame ? "pós-partida" :
            brawl ? "modo não suportado" : spectating ? "espectador ou replay" : conflict ? "identidade local ambígua" :
            heroId === null ? "herói não identificado" : !localConfirmed ? "jogador local não confirmado" :
            !hudVisible ? "contexto não confirmado" : null;
        var lower = directId(directId(core, "StatsAndModsContainer"), "LowerLeft");
        var gold = directId(directId(directId(directId(lower, "gold_and_ap_container"), "hudGoldContainer"), "CurrentGoldAmount"), "hudCurGoldLabel");
        var souls = valid(gold) && !spectating ? parseSouls(gold.text) : null;
        var shopMatches = shopHeroes.length === 1 && shopHeroes[0].id === heroId;
        var shopOpen = flag(root, hud, core, "gShopOpen") || has(directId(core, "StatsAndModsContainer"), "gShopOpen");
        var inventory = spectating ? { nomes: [], completo: false, slotsObservados: 0, desconhecidos: [], fontes: 0 } : readInventory(core, data.registroInventario,
            { ativo: shopMatches && shopOpen && localConfirmed, shop: shop, localize: localize },
            data.contratoInventario ? data.contratoInventario.slotsTotais : 12);
        var friendly = roster.filter(function (p) { return p.time === "TeamFriendly"; });
        var enemy = roster.filter(function (p) { return p.time === "TeamEnemy"; });
        var ids = roster.map(function (p) { return p.id; });
        var complete = friendly.length === 6 && enemy.length === 6 && ids.every(function (id, i) {
            return ids.indexOf(id) === i && data.herois.some(function (h) { return h.id === id; });
        }) && friendly.some(function (p) { return p.id === heroId; });
        return { clock: clock, heroId: heroId, heroSource: source, habilidadesObservadas: signatureHero.nomes,
            hudAvailable: valid(core), hudVisivel: hudVisible, motivoOculto: hiddenReason, localCandidates: locals.length,
            modo: mode, localConfirmado: localConfirmed, espectando: spectating, conflito: conflict,
            modoSuportado: !brawl && !replay,
            almas: souls, inventario: inventory, aliados: friendly.map(function (p) { return p.id; }),
            inimigos: enemy.map(function (p) { return p.id; }), composicaoCompleta: complete };
    }
    function readExperimentalSignals(root, data) {
        // Observação apenas: estes dados não entram na escolha dos itens até validação no cliente.
        function textClass(parent, c) {
            var labels = descendantsClass(parent, c);
            return labels.length ? String(labels[0].text || "").slice(0, 160) : null;
        }
        var core = directClass(directId(root, "Hud"), "HudCore");
        var holder = directId(core, "CitadelHudDamageReport");
        var panels = descendantsClass(holder, "HudDamageReport");
        var report = has(holder, "HudDamageReport") ? holder : panels[0];
        var top = directId(core, "TopBar"), teams = directId(top, "TeamsContainer"), enemyTeam = directId(teams, "TeamEnemy");
        var enemyRows = children(directId(directId(enemyTeam, "PlayerContents"), "PlayersContainer"));
        var economy = enemyRows.filter(function (card) { return !has(card, "Empty"); }).map(function (card) {
            var label = find(card, "SoulsValue");
            return { heroi: cardHero(card, data), texto: valid(label) ? String(label.text || "").slice(0, 60) : null };
        });
        var friendlyTeam = directId(teams, "TeamFriendly");
        var localCards = children(directId(directId(friendlyTeam, "PlayerContents"), "PlayersContainer")).filter(function (card) { return has(card, "LocalPlayer"); });
        var localGold = localCards.length === 1 ? find(localCards[0], "SoulsValue") : null;
        return { validado: false, almasPlacarLocalTexto: valid(localGold) ? String(localGold.text || "").slice(0, 60) : null,
            relatorio: { encontrado: valid(report), oculto: has(report, "Hidden"),
            flagOutgoing: has(report, "Outgoing"), vidaAtual: has(report, "ShowingLastLife"),
            armaTexto: textClass(report, "weaponDmg"), espiritoTexto: textClass(report, "spiritDmg"), totalTexto: textClass(report, "DamageValue") },
            almasPlacarInimigos: economy };
    }
    function buildView(state, data, engine) {
        var hero = data.herois.filter(function (h) { return h.id === state.heroId; })[0];
        if (state.modoSuportado === false) return { hero: hero, itens: [], titulo: "Modo ainda não suportado", motivo: "Modelos desta versão são para partidas normais.", previa: true };
        var reasons = [];
        if (!state.localConfirmado) reasons.push("confirmar jogador local");
        if (!state.clock || state.modo === "esconderijo") reasons.push("relógio de partida");
        if (!state.inventario.completo) reasons.push("identificar inventário completo");
        if (state.espectando) reasons.push("inventário pode pertencer ao alvo assistido");
        if (state.conflito) reasons.push("fontes de herói divergentes");
        if (!hero || !data.modelos[hero.nome] || !engine) return { hero: hero, itens: [], titulo: "Aguardando herói identificado", motivo: reasons.join(" · "), previa: true };
        if (state.inventario.estruturaCompleta === false || state.inventario.fontes === 0) {
            return { hero: hero, itens: [], previa: true, inventarioPendente: true,
                titulo: "Aguardando leitura do inventário", motivo: "Estrutura de slots incompleta; nenhuma compra confirmada." };
        }
        var previa = reasons.length > 0;
        function names(ids) { return ids.map(function (id) { return data.herois.filter(function (h) { return h.id === id; })[0].nome; }); }
        var result = engine.recomendar({ jogador: hero.nome, modelo: data.modelos[hero.nome], catalogo: data.itens,
            modeloAmeacas: data.ameacas || null,
            modeloImbuimentos: data.imbuimentos || null,
            aliados: state.composicaoCompleta ? names(state.aliados.filter(function (id) { return id !== state.heroId; })) : [],
            inimigos: state.composicaoCompleta ? names(state.inimigos) : [], adversariosLane: [],
            minuto: state.clock && state.modo !== "esconderijo" ? Math.max(0, state.clock.seconds / 60) : 0,
            // Comprado no passado não significa equipado: vendas liberam a recompra.
            // O motor já cobre componentes transitivos das evoluções ainda no inventário.
            inventario: new Set(state.inventario.nomes), historico: new Set(state.inventario.nomes),
            // Item sem identidade ainda ocupa espaço. Não o transforma em vaga livre.
            limiteSlots: Math.max(0, (state.inventario.slotsEsperados || 12) -
                (state.inventario.desconhecidos || []).length),
            limiteSlotsPlanejados: Math.max(0, (state.inventario.slotsEsperados || 12) - (state.inventario.desconhecidos || []).length),
            almas: previa ? null : state.almas });
        var catalog = Object.values(data.itens);
        var uncertain = new Set();
        function possibleOwned(name) {
            if (uncertain.has(name)) return;
            uncertain.add(name);
            var item = catalog.filter(function (m) { return m.nome === name; })[0];
            if (item) (item.componentes || []).forEach(possibleOwned);
        }
        (state.inventario.desconhecidos || []).forEach(function (slot) { (slot.nomesCandidatos || []).forEach(possibleOwned); });
        var unresolved = state.inventario.estruturaCompleta === false || state.inventario.fontes === 0 ||
            (state.inventario.desconhecidos || []).some(function (slot) { return !(slot.nomesCandidatos || []).length; });
        return { hero: hero, previa: previa, titulo: previa ? "Prévia da build" : "Próximas compras experimentais",
            inventarioPendente: unresolved,
            semEspaco: !unresolved && Boolean(result.semEspaco),
            semContinuacao: !unresolved && state.inventario.completo && !result.semEspaco && result.itens.length === 0,
            slotsPlanejados: result.slotsPlanejados,
            motivo: previa ? reasons.join(" · ") : (state.composicaoCompleta ? "Composição identificada" : "Composição incompleta: usando o perfil do herói"),
            itens: (unresolved ? [] : result.itens.filter(function (i) { return !uncertain.has(i.nome); })).slice(0, 3).map(function (i) {
                var meta = catalog.filter(function (m) { return m.nome === i.nome; })[0];
                return { nome: i.nome, imagem: meta.imagem, tier: meta.tier, custo: i.custoCompra,
                    imbuimento: i.imbuimento || null,
                    idNativo: meta.idNativo, classeNativa: meta.classeNativa,
                    ordemReferencia: i.ordem, ordemEfetiva: i.ordemEfetiva, evolucaoEconomica: Boolean(i.evolucaoEconomica),
                    justificativa: i.motivo,
                    motivo: i.contextual ? "Resposta à composição" : i.frequencia !== undefined ? Math.round(i.frequencia * 100) + "% de presença no perfil" : "Componente de evolução" };
            }) };
    }
    function attach(api, data, engine) {
        var root = api.GetContextPanel(); if (!valid(root)) return null;
        if (root.__deadpickDiagnostic) root.__deadpickDiagnostic.stop();
        var stopped = false, pending = null, reads = 0, errors = 0, calculationErrors = 0, signature = null, nativeSignature = null, view = null, signalsSignature = null, decisionSignature = null;
        var localizedSkills = {};
        function skillName(choice) {
            if (localizedSkills[choice.classe]) return localizedSkills[choice.classe];
            var token = "#" + choice.classe, translated = null;
            try { if (typeof api.Localize === "function") translated = api.Localize(token); } catch (e) {}
            return localizedSkills[choice.classe] = translated && translated !== token ? translated : choice.nome;
        }
        function paint(id, text) { try { var p = find(directId(root, "DeadpickDiagnostics"), id); if (valid(p) && p.text !== text) p.text = text; } catch (e) {} }
        function image(id, src) { try { var p = find(directId(root, "DeadpickDiagnostics"), id); if (valid(p)) { p.visible = Boolean(src); if (src && p.__deadpickSrc !== src) { p.SetImage(src); p.__deadpickSrc = src; } } } catch (e) {} }
        function stop() { stopped = true; if (pending !== null) { api.CancelScheduled(pending); pending = null; } }
        function compact(show, notice) {
            var panel = directId(root, "DeadpickDiagnostics");
            if (valid(panel)) {
                panel.visible = Boolean(show);
                if (typeof panel.SetHasClass === "function") panel.SetHasClass("DeadpickHasNotice", Boolean(notice));
            }
            paint("DeadpickNotice", notice || "");
        }
        function clearCards() {
            for (var i = 0; i < 3; i++) {
                paint("DeadpickItem" + i, ""); paint("DeadpickCost" + i, ""); paint("DeadpickTier" + i, ""); image("DeadpickIcon" + i, null);
                paint("DeadpickImbue" + i, ""); image("DeadpickImbueIcon" + i, null);
                var imbueBox = find(directId(root, "DeadpickDiagnostics"), "DeadpickImbueBox" + i);
                if (valid(imbueBox)) imbueBox.visible = false;
                var row = find(directId(root, "DeadpickDiagnostics"), "DeadpickRow" + i);
                if (valid(row)) row.visible = false;
            }
        }
        function tick() {
            pending = null; if (stopped || !valid(root)) return;
            var delay = 0.5;
            try {
                var state = readState(root, data, typeof api.Localize === "function" ? function (token) { return api.Localize(token); } : null); reads++;
                var nextSignature = JSON.stringify(state);
                var observationSignature = JSON.stringify([state.heroId, state.heroSource, state.modo, state.inventario, state.aliados, state.inimigos, state.habilidadesObservadas,
                    state.hudVisivel, state.motivoOculto, state.localConfirmado, state.espectando, state.conflito]);
                if (nativeSignature !== observationSignature) {
                    nativeSignature = observationSignature;
                    api.Msg("[Deadpick] estado " + JSON.stringify({ heroi: state.heroId, origem: state.heroSource, modo: state.modo,
                        inventario: state.inventario, composicao: [state.aliados.length, state.inimigos.length],
                        habilidades: state.habilidadesObservadas, locais: state.localCandidates,
                        visivel: state.hudVisivel, motivoOculto: state.motivoOculto, localConfirmado: state.localConfirmado,
                        espectando: state.espectando, conflito: state.conflito }));
                }
                var observedHero = data ? data.herois.filter(function (h) { return h.id === state.heroId; })[0] : null;
                paint("DeadpickClock", "Relógio do HUD: " + (state.clock ? state.clock.text : "não observado") + " · " + state.modo);
                paint("DeadpickHero", "Herói: " + (observedHero ? observedHero.nome : state.heroId !== null ? "ID " + state.heroId : "não observado") + " · " + state.heroSource);
                paint("DeadpickSouls", "Almas: " + (state.almas !== null ? state.almas : "não observadas com precisão"));
                paint("DeadpickInventory", "Inventário: " + state.inventario.nomes.length + " identificados · " + state.inventario.desconhecidos.length + " pendentes");
                paint("DeadpickTeams", "Composição: " + state.aliados.length + "/6 aliados · " + state.inimigos.length + "/6 inimigos");
                image("DeadpickHeroImage", observedHero ? observedHero.imagem : null);
                paint("DeadpickHeroName", observedHero ? observedHero.nome : "");
                var viewStage = "calculo";
                try {
                    if (signature !== nextSignature) {
                        view = data && engine ? buildView(state, data, engine) : null;
                        signature = nextSignature;
                        var decisionKey = JSON.stringify(view ? [state.heroId, view.previa, view.itens] : null);
                        if (state.hudVisivel && decisionSignature !== decisionKey) {
                            decisionSignature = decisionKey;
                            api.Msg("[Deadpick] decisao " + JSON.stringify({ heroi: state.heroId, previa: view ? view.previa : true,
                                slots: { ocupados: state.inventario.slotsOcupados, disponiveis: state.inventario.slotsDisponiveis,
                                    planejados: view ? view.slotsPlanejados : null },
                                itens: view ? view.itens.map(function (i) { return { nome: i.nome, custo: i.custo,
                                    ordemReferencia: i.ordemReferencia, ordemEfetiva: i.ordemEfetiva,
                                    evolucaoEconomica: i.evolucaoEconomica, motivo: i.justificativa }; }) : [] }));
                        }
                    }
                    viewStage = "painel";
                    paint("DeadpickView", view ? view.titulo : "Aguardando modelos");
                    paint("DeadpickPlanStatus", view && !view.inventarioPendente && typeof view.slotsPlanejados === "number" ?
                        "Plano: " + view.slotsPlanejados + " · Equipados: " +
                        (typeof state.inventario.slotsOcupados === "number" ? state.inventario.slotsOcupados : state.inventario.nomes.length + (state.inventario.desconhecidos || []).length) +
                        "/" + (state.inventario.slotsEsperados || 12) : "Ordem de compra");
                    paint("DeadpickReason", view ? view.motivo : "");
                    clearCards();
                    if (view) view.itens.forEach(function (item, i) {
                        var row = find(directId(root, "DeadpickDiagnostics"), "DeadpickRow" + i);
                        if (valid(row)) row.visible = true;
                        paint("DeadpickItem" + i, item.nome);
                        paint("DeadpickCost" + i, item.custo + " almas (catálogo) · " + item.motivo);
                        paint("DeadpickTier" + i, ["", "I", "II", "III", "IV", "V"][item.tier] || "?");
                        var badge = find(directId(root, "DeadpickDiagnostics"), "DeadpickTier" + i);
                        if (valid(badge)) for (var t = 1; t <= 5; t++) badge.SetHasClass("DeadpickTier" + t, item.tier === t);
                        image("DeadpickIcon" + i, item.imagem);
                        if (item.imbuimento) {
                            paint("DeadpickImbue" + i, "Imbuir: " + item.imbuimento.slot + " · " + skillName(item.imbuimento));
                            image("DeadpickImbueIcon" + i, item.imbuimento.imagem);
                            var hint = find(directId(root, "DeadpickDiagnostics"), "DeadpickImbueBox" + i);
                            if (valid(hint)) hint.visible = true;
                        }
                    });
                    compact(observedHero && state.hudVisivel, view && view.inventarioPendente ? "Aguardando leitura do inventário" :
                        view && view.semEspaco ? "Inventário cheio · libere espaço" :
                        view && view.semContinuacao ? "Sem continuação no perfil" :
                        view && view.itens.length ? (view.previa ? "Prévia" : "") : "Aguardando recomendações");
                    paint("DeadpickStatus", "JS ativo · leitura " + reads + " · v0.4.6 · " + (state.hudAvailable ? "HUD encontrado" : "aguardando HUD"));
                    calculationErrors = 0;
                } catch (calculationError) {
                    // Uma falha no motor/painel não invalida relógio, identidade ou saldo já lidos.
                    calculationErrors++; signature = null; view = null; delay = 2; clearCards();
                    paint("DeadpickPlanStatus", "Ordem de compra");
                    compact(observedHero && state.hudVisivel, "Aguardando recomendações");
                    paint("DeadpickView", "Cálculo indisponível; leituras preservadas");
                    paint("DeadpickReason", "Nova tentativa automática em 2s");
                    paint("DeadpickStatus", "JS ativo · leitura " + reads + " · falha no " + viewStage + " · v0.4.6");
                    if (calculationErrors <= 3) api.Msg("[Deadpick] " + viewStage + " falhou: " + String(calculationError.stack || calculationError));
                }
                errors = 0;
                if (state.hudVisivel && reads % 4 === 0) {
                    try {
                        var signals = readExperimentalSignals(root, data), signalKey = JSON.stringify(signals);
                        if (signalKey !== signalsSignature) {
                            signalsSignature = signalKey;
                            api.Msg("[Deadpick] sinais-experimentais " + JSON.stringify({ heroiLocal: state.heroId, saldoLocal: state.almas,
                                relogio: state.clock ? state.clock.text : null, dados: signals }));
                        }
                    } catch (signalError) { /* Não afeta inventário, recomendações ou agendamento. */ }
                } else if (!state.hudVisivel) signalsSignature = null;
            } catch (error) {
                errors++; delay = 2; signature = null; nativeSignature = null; view = null; calculationErrors = 0;
                paint("DeadpickClock", "Relógio: não observado"); paint("DeadpickHero", "Herói local: não observado");
                paint("DeadpickSouls", "Almas: não observadas"); paint("DeadpickInventory", "Inventário: leitura indisponível");
                paint("DeadpickTeams", "Composição: não observada"); paint("DeadpickReason", ""); image("DeadpickHeroImage", null);
                paint("DeadpickView", "Recomendação suspensa: leitura indisponível"); clearCards();
                paint("DeadpickPlanStatus", "Ordem de compra");
                compact(false, "");
                paint("DeadpickStatus", "Leitura indisponível; nova tentativa em 2s");
                if (errors <= 3) api.Msg("[Deadpick] leitura falhou: " + String(error.stack || error));
            }
            if (!stopped && valid(root)) pending = api.Schedule(delay, tick);
        }
        var controller = { stop: stop }; root.__deadpickDiagnostic = controller;
        api.Msg("[Deadpick] recomendador piloto v0.4.6 carregado; contrato Steam build 26770241");
        pending = api.Schedule(0, tick); return controller;
    }
    if (typeof module !== "undefined" && module.exports) module.exports = { parseClock: parseClock, parseSouls: parseSouls, imageKey: imageKey, readInventory: readInventory, readState: readState, readExperimentalSignals: readExperimentalSignals, buildView: buildView, attach: attach };
    if (typeof $ !== "undefined" && typeof $.GetContextPanel === "function") {
        attach($, typeof DeadpickData !== "undefined" ? DeadpickData : null, typeof recomendar === "function" ? { recomendar: recomendar } : null);
    }
})();
