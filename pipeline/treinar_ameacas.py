"""Associa compras verdes à composição completa; não estima efeito causal ou winrate."""
import argparse
import gzip
import hashlib
import json
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import sklearn
from scipy.sparse import csr_matrix
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import log_loss, brier_score_loss
from threadpoolctl import threadpool_limits

WINDOWS = [(360, 840), (840, 1320), (1320, 1800)]
DEFENSES = {
    'Metal Skin': 'fisica', 'Plated Armor': 'fisica', 'Weapon Shielding': 'fisica',
    'Battle Vest': 'fisica', 'Bullet Resilience': 'fisica',
    'Spirit Resilience': 'espiritual', 'Spirit Shielding': 'espiritual',
    'Spellbreaker': 'espiritual', 'Witchmail': 'espiritual',
}


def read_rows(base, name):
    with gzip.open(base / (name + '.jsonl.gz'), 'rt', encoding='utf-8') as f:
        for line in f:
            yield json.loads(line)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--base', type=Path, required=True)
    p.add_argument('--saida', type=Path, default=Path('simulador/ameacas.json'))
    p.add_argument('--relatorio', type=Path, default=Path('relatorios/ameacas.json'))
    args = p.parse_args()
    catalog_root = Path('data/deadlock-api/bruto')
    with gzip.open(catalog_root / 'catalogo-itens.json.gz', 'rt', encoding='utf-8') as f:
        catalog = json.load(f)
    with gzip.open(catalog_root / 'catalogo-herois.json.gz', 'rt', encoding='utf-8') as f:
        heroes = [h for h in json.load(f) if h.get('player_selectable') and not h.get('disabled')]
    hero_names = {h['id']: h['name'] for h in heroes}
    hero_ids = sorted(hero_names)
    idx = {h: i for i, h in enumerate(hero_ids)}
    n = len(idx)
    greens = {i['id']: i for i in catalog if i.get('shopable') and i.get('type') == 'upgrade'
              and i.get('item_slot_type') == 'vitality'}
    matches = {m['match_id']: m for m in read_rows(args.base, 'partidas')
               if m.get('game_mode') == 'Normal' and m.get('match_mode') == 'Ranked'}
    ordered = sorted(matches, key=lambda m: (matches[m]['start_time'], m))
    train_ids = set(ordered[:int(len(ordered) * .7)])
    validation_ids = set(ordered[int(len(ordered)*.7):int(len(ordered)*.85)])
    rosters = defaultdict(list)
    buyers = {}
    for player in read_rows(args.base, 'jogadores'):
        if player['match_id'] not in matches:
            continue
        key = (player['match_id'], player['player_slot'])
        rosters[player['match_id']].append(player)
        if (player.get('player_rank_initial_display_rank') or 0) >= 91 and player['hero_id'] in idx:
            buyers[key] = player
    first = defaultdict(dict)
    for number, event in enumerate(read_rows(args.base, 'eventos')):
        key = (event['match_id'], event['player_slot'])
        t, item = event['game_time_s'], event['item_id']
        if key in buyers and item in greens and event['item_de_loja'] and t >= 0:
            first[key][item] = min(t, first[key].get(item, t))
        if number and number % 1000000 == 0:
            print(f'{number:,} registros examinados', flush=True)
    print(f'{len(buyers):,} participações Phantom+; montando janelas', flush=True)
    columns, row_indices, row_keys, stages, train_flags, own_heroes = [], [], [], [], [], []
    for key, player in buyers.items():
        roster = rosters[player['match_id']]
        enemies = [x['hero_id'] for x in roster if x['team'] != player['team']]
        allies = [x['hero_id'] for x in roster if x['team'] == player['team'] and x['player_slot'] != player['player_slot']]
        if len(enemies) != 6 or len(allies) != 5 or len(set(enemies + allies + [player['hero_id']])) != 12:
            continue
        if any(h not in idx for h in enemies + allies):
            continue
        for stage, (_, end) in enumerate(WINDOWS):
            if matches[key[0]]['duration_s'] < end:
                continue  # Não rotula partidas encerradas antes da janela como não compra.
            row = len(row_keys)
            features = [idx[player['hero_id']]] + [n + idx[h] for h in enemies] + [2*n + idx[h] for h in allies] + [3*n + stage]
            row_indices.extend([row] * len(features)); columns.extend(features)
            row_keys.append(key); stages.append(stage); own_heroes.append(player['hero_id'])
            train_flags.append(key[0] in train_ids)
    x = csr_matrix((np.ones(len(columns)), (row_indices, columns)), shape=(len(row_keys), 3*n+3))
    train_flags = np.array(train_flags, dtype=bool)
    validation_flags = np.array([key[0] in validation_ids for key in row_keys], dtype=bool)
    stages = np.array(stages)
    no_enemies = np.r_[np.arange(n), np.arange(2*n, 3*n+3)]
    means = np.asarray(x[train_flags].mean(axis=0)).ravel()
    exported, audit = [], []
    for item_id, item in greens.items():
        times = np.array([first.get(key, {}).get(item_id, np.inf) for key in row_keys])
        starts = np.array([WINDOWS[s][0] for s in stages])
        ends = np.array([WINDOWS[s][1] for s in stages])
        risk = times >= starts  # Só primeira aquisição; compras anteriores não viram negativos.
        y = ((times >= starts) & (times < ends)).astype(int)
        train = train_flags & risk; validation = validation_flags & risk
        test = (~train_flags) & (~validation_flags) & risk
        if y[train].sum() < 150 or y[validation].sum() < 30 or y[test].sum() < 30 or (~y[train].astype(bool)).sum() < 150:
            continue
        full = LogisticRegression(C=.15, max_iter=180, solver='lbfgs', tol=1e-5)
        baseline = LogisticRegression(C=.15, max_iter=180, solver='lbfgs', tol=1e-5)
        with threadpool_limits(limits=2):
            full.fit(x[train], y[train]); baseline.fit(x[train][:, no_enemies], y[train])
            prob = full.predict_proba(x[test])[:, 1]
            base_prob = baseline.predict_proba(x[test][:, no_enemies])[:, 1]
            validation_prob = full.predict_proba(x[validation])[:, 1]
            validation_base = baseline.predict_proba(x[validation][:, no_enemies])[:, 1]
        loss, base_loss = log_loss(y[test], prob), log_loss(y[test], base_prob)
        validation_loss = log_loss(y[validation], validation_prob)
        validation_base_loss = log_loss(y[validation], validation_base)
        own_counts = Counter(buyers[k]['hero_id'] for k, t in ((k, v.get(item_id)) for k, v in first.items()) if t is not None and k[0] in train_ids)
        coef = full.coef_[0]
        entry = {'nome': item['name'], 'tipo': DEFENSES.get(item['name']), 'tier': item['item_tier'],
                 'ativo': item.get('activation') not in (None, 'passive'),
                 'intercepto': round(float(full.intercept_[0]), 7),
                 'coeficientes': [round(float(v), 7) for v in coef],
                 'compradoresPorHeroi': {hero_names[h]: count for h, count in own_counts.items()},
                 'positivosTreino': int(y[train].sum()), 'positivosTeste': int(y[test].sum()),
                 'logloss': float(loss), 'loglossSemInimigos': float(base_loss),
                 'loglossValidacao': float(validation_loss), 'loglossValidacaoSemInimigos': float(validation_base_loss),
                 'brier': float(brier_score_loss(y[test], prob)),
                 'contextoValidado': bool(validation_loss < validation_base_loss and full.n_iter_[0] < full.max_iter)}
        top = sorted(range(n), key=lambda i: coef[n+i], reverse=True)[:5]
        audit.append({'item': item['name'], 'tipo': entry['tipo'], 'janelas_treino': int(train.sum()),
                      'janelas_teste': int(test.sum()), 'janelas_validacao': int(validation.sum()),
                      'positivos_treino': entry['positivosTreino'],
                      'positivos_teste': entry['positivosTeste'], 'logloss': float(loss),
                      'logloss_sem_inimigos': float(base_loss), 'contexto_validado': entry['contextoValidado'],
                      'logloss_validacao': float(validation_loss), 'logloss_validacao_sem_inimigos': float(validation_base_loss),
                      'associacoes_ajustadas': [{'inimigo': hero_names[hero_ids[i]], 'coeficiente': float(coef[n+i])} for i in top]})
        if entry['tipo']:
            exported.append(entry)
        print(item['name'], int(y[train].sum()), 'ganho logloss', round(base_loss-loss, 5), flush=True)
    source = json.loads((args.base / 'auditoria.json').read_text(encoding='utf-8'))
    output = {'versao': 1, 'balanceVersion': source['versao_inferida'], 'rankMinimo': 91,
              'geradoUtc': datetime.now(timezone.utc).isoformat(), 'herois': [hero_names[h] for h in hero_ids],
              'mediasInimigos': [round(float(v), 7) for v in means[n:2*n]],
              'janelas': WINDOWS, 'itens': exported,
              'limites': ['Associação de primeira compra em janela de oito minutos, não efeito causal ou vitória.',
                         'Partidas que terminaram antes do fim da janela são excluídas.',
                         'Ajuste por herói comprador, cinco aliados, seis inimigos e janela; sem economia ou build inimiga.',
                         'Validação temporal por partida; não separa jogadores recorrentes.',
                         'Perfil não usa dano observado: ameaça é inferida por padrão de compra defensiva.']}
    args.saida.parent.mkdir(parents=True, exist_ok=True)
    args.saida.write_text(json.dumps(output, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    report = {'fonte': 'deadlock-api; metadados e eventos locais', 'rank_minimo': 91,
              'sklearn': sklearn.__version__, 'numpy': np.__version__,
              'auditoria_fonte_sha256': hashlib.sha256((args.base / 'auditoria.json').read_bytes()).hexdigest(),
              'versao_balanceamento': source['versao_inferida'],
              'janela_utc': [source['inicio_utc'], source['fim_exclusivo_utc']],
              'partidas': len(matches), 'participacoes_elegiveis': len(buyers), 'janelas': len(row_keys),
              'partidas_treino': len(train_ids), 'partidas_validacao': len(validation_ids),
              'partidas_teste': len(matches)-len(train_ids)-len(validation_ids),
              'split': '70% partidas mais antigas para treino; 15% para seleção na validação; 15% finais para teste; nenhuma partida cruza os cortes',
              'features': 'herói comprador + seis inimigos + cinco aliados + janela; L2 C=0.15, sem pesos de classe',
              'itens_verdes_avaliados': len(audit), 'defesas_exportadas': len(exported), 'itens': audit,
              'modelo_sha256': hashlib.sha256(args.saida.read_bytes()).hexdigest(), 'limites': output['limites']}
    args.relatorio.parent.mkdir(parents=True, exist_ok=True)
    args.relatorio.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({k: report[k] for k in ('partidas','participacoes_elegiveis','janelas','itens_verdes_avaliados','defesas_exportadas')}, indent=2))


if __name__ == '__main__':
    main()
