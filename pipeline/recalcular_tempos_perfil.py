"""Tempos da primeira aquisição por perfil retrospectivo; não é avaliação de eficácia."""
import argparse
import gzip
import hashlib
import json
from collections import defaultdict, Counter
from pathlib import Path

import numpy as np


def rows(base, name):
    with gzip.open(base / (name + '.jsonl.gz'), 'rt', encoding='utf-8') as f:
        for line in f:
            yield json.loads(line)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--base', type=Path, required=True)
    args = p.parse_args()
    source = Path('data/tracklock/clusters.json')
    clusters = json.loads(source.read_text(encoding='utf-8'))
    assert hashlib.sha256((args.base/'auditoria.json').read_bytes()).hexdigest() == clusters['auditoria_base_sha256'], 'Base diferente da usada no clustering'
    players = {(x['match_id'], x['player_slot']): x['hero_id'] for x in rows(args.base, 'jogadores')
               if (x.get('player_rank_initial_display_rank') or 0) >= 91}
    first = defaultdict(dict)
    for event in rows(args.base, 'eventos'):
        key = (event['match_id'], event['player_slot'])
        if key not in players or not event['item_de_loja']:
            continue
        t, item = event['game_time_s'], event['item_id']
        if item not in first[key]:
            first[key][item] = None
        if t >= 0:
            previous = first[key][item]
            first[key][item] = t if previous is None else min(previous, t)
    by_hero = defaultdict(list)
    for key, hero in players.items():
        by_hero[hero].append(key)
    result = {'versao': 1, 'balanceVersion': 6860,
              'clusters_sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
              'metodo': 'Presença de compras normalizada L2; centroide mais próximo do clustering existente; primeira aquisição não negativa por jogador/item; mínimo 20 aquisições por estimativa.',
              'limites': 'Perfil reassociado retrospectivamente usando compras da partida inteira. Estatística descritiva; sem validação preditiva ou de vitória.',
              'herois': {}}
    for hero in clusters['herois']:
        ids = hero['ordem_features_item_ids']
        keys = by_hero[hero['hero_id']]
        x = np.array([[int(i in first.get(key, {})) for i in ids] for key in keys], dtype=np.float64)
        norms = np.linalg.norm(x, axis=1)
        centers = np.array([c['centroide_l2'] for c in hero['clusters']])
        x = x / np.maximum(norms[:, None], 1)
        distances = np.sum(x*x, axis=1)[:, None] - 2*x@centers.T + np.sum(centers*centers, axis=1)
        labels = np.argmin(distances, axis=1)
        times = defaultdict(list); counts = Counter()
        for key, norm, label in zip(keys, norms, labels):
            if norm == 0:
                continue
            counts[int(label)] += 1
            for item, time in first.get(key, {}).items():
                if time is not None:
                    times[(int(label), item)].append(time)
        expected = sum(c['participacoes'] for c in hero['clusters'])
        assert sum(counts.values()) == expected, (hero['nome'], sum(counts.values()), expected)
        profiles = {}
        for label, cluster in enumerate(hero['clusters']):
            estimates = {}
            for item in ids:
                samples = times[(label, item)]
                if len(samples) < 20:
                    continue
                q25, med, q75 = np.quantile(samples, [.25, .5, .75])
                estimates[str(item)] = {'segundo': float(med), 'p25': float(q25), 'p75': float(q75), 'amostras': len(samples)}
            profiles[str(cluster['cluster'])] = {'participacoes_reassociadas': counts[label],
                'participacoes_originais': cluster['participacoes'], 'tempos': estimates}
        result['herois'][hero['nome']] = profiles
        print(hero['nome'], counts, flush=True)
    output = Path('simulador/tempos_por_perfil.json')
    output.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print('Gravado', output)


if __name__ == '__main__':
    main()
