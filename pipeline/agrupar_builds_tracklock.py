"""Agrupa compras reais Phantom+ com k-means, usando candidatos do Tracklock.

O vetor indica se o item foi comprado alguma vez: nao representa inventario final,
ordem, causalidade ou recomendacao contextual. Nao usa winrate como feature.
"""
import gzip
import json
import os
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

os.environ.setdefault('OMP_NUM_THREADS', '2')
os.environ.setdefault('OPENBLAS_NUM_THREADS', '2')
import numpy as np
from sklearn import __version__ as sklearn_version
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score
from sklearn.preprocessing import normalize
from threadpoolctl import threadpool_limits

BASE = Path('data/base-ampliada-6860')
ROOT = Path('data/tracklock-todos')

def linhas(nome):
    with gzip.open(BASE / f'{nome}.jsonl.gz', 'rt', encoding='utf-8') as f:
        for linha in f:
            yield json.loads(linha)

def main():
    extracao = json.loads((ROOT / 'extracao.json').read_text(encoding='utf-8'))
    candidatos, fontes = {}, {}
    for h in extracao['herois']:
        refs = defaultdict(list)
        for i in h.get('items', {}).get('itens', []):
            if i['item_id'] is not None and i['uso_percentual'] >= 10:
                refs[i['item_id']].append({'fonte': 'tabela_geral_rank_nao_verificado',
                                          'uso_percentual': i['uso_percentual']})
        for fase, itens in h.get('probuild', {}).get('fases', {}).items():
            for i in itens:
                if i['item_id'] is not None:
                    refs[i['item_id']].append({'fonte': 'probuild', 'fase': fase, 'uso_percentual': i['uso_percentual']})
        for secao, itens in h.get('build', {}).get('secoes', {}).items():
            for i in itens:
                if i['item_id'] is not None:
                    refs[i['item_id']].append({'fonte': 'build_editorial', 'secao': secao})
        candidatos[h['hero_id']], fontes[h['hero_id']] = set(refs), refs
    jogadores = {}
    por_heroi = defaultdict(list)
    for p in linhas('jogadores'):
        if (p.get('player_rank_initial_display_rank') or 0) >= 91:
            chave = (p['match_id'], p['player_slot'])
            jogadores[chave] = p['hero_id']
            por_heroi[p['hero_id']].append(chave)
    compras = defaultdict(set)
    for e in linhas('eventos'):
        chave = (e['match_id'], e['player_slot'])
        if e['item_de_loja'] and chave in jogadores:
            compras[chave].add(e['item_id'])
    with gzip.open('data/paradox/bruto/catalogo-itens.json.gz', 'rt', encoding='utf-8') as f:
        catalogo = {i['id']: i for i in json.load(f)}
    import hashlib
    saida = {'gerado_utc': datetime.now(timezone.utc).isoformat(), 'sklearn': sklearn_version,
             'extracao_sha256': hashlib.sha256((ROOT / 'extracao.json').read_bytes()).hexdigest(),
             'auditoria_base_sha256': hashlib.sha256((BASE / 'auditoria.json').read_bytes()).hexdigest(),
             'base': str(BASE), 'rank_minimo': 91, 'random_state': 42,
             'uso_minimo_tabela_geral_percentual': 10,
             'features': 'presenca de compra por participacao, restrita aos candidatos Tracklock; normalizacao L2',
             'selecao_k': 'maior silhouette entre k=2..5, minimo 20 participacoes por cluster; fallback k=1',
             'limites': ['Agregados pro e builds editoriais nao comprovam rank individual.',
                         'Clusters descrevem conjuntos comprados, incluindo itens vendidos e upgrades.',
                         'Nao inferem ordem, counters, causalidade ou build otima.',
                         'Catalogo e partidas historicos; Tracklock atual pode ter outro balanceamento.'],
             'herois': []}
    for h in sorted(extracao['herois'], key=lambda x: x['nome']):
        hid = h['hero_id']
        registros = por_heroi[hid]
        ids = sorted(candidatos[hid])
        if not ids:
            saida['herois'].append({'hero_id': hid, 'nome': h['nome'], 'erro': 'Sem candidatos Tracklock mapeados'})
            continue
        X = np.array([[int(i in compras[ch]) for i in ids] for ch in registros], dtype=np.float64)
        validos = X.sum(axis=1) > 0
        X = X[validos]
        Z = normalize(X)
        avaliacoes = []
        modelos = {}
        with threadpool_limits(limits=2):
            for k in range(2, min(5, len(np.unique(X, axis=0)) - 1) + 1):
                modelo = KMeans(n_clusters=k, n_init=20, random_state=42).fit(Z)
                tamanhos = np.bincount(modelo.labels_, minlength=k)
                if min(tamanhos) < 20:
                    continue
                score = float(silhouette_score(Z, modelo.labels_, sample_size=min(1000, len(Z)), random_state=42))
                avaliacoes.append({'k': k, 'silhouette': score, 'menor_cluster': int(min(tamanhos))})
                modelos[k] = modelo
            k = max(avaliacoes, key=lambda x: x['silhouette'])['k'] if avaliacoes else 1
            modelo = modelos[k] if k in modelos else KMeans(n_clusters=1, n_init=20, random_state=42).fit(Z)
        clusters = []
        for label in range(k):
            grupo = X[modelo.labels_ == label]
            frequencia = grupo.mean(axis=0)
            ordenados = sorted(range(len(ids)), key=lambda j: (-frequencia[j], ids[j]))
            clusters.append({'cluster': label, 'participacoes': len(grupo),
                             'itens_frequentes_item_ids': [ids[j] for j in ordenados if frequencia[j] >= .5],
                             'centroide_l2': modelo.cluster_centers_[label].tolist(),
                             'itens': [{'item_id': ids[j], 'nome': catalogo[ids[j]]['name'],
                                        'frequencia_no_cluster': float(frequencia[j]),
                                        'participacoes_com_compra': int(grupo[:, j].sum())} for j in ordenados]})
        excluidos = Counter(i for ch in registros for i in compras[ch] if i not in candidatos[hid])
        tabela = {i['item_id']: i for i in h.get('items', {}).get('itens', []) if i['item_id'] is not None}
        resultado = {'hero_id': hid, 'nome': h['nome'], 'participacoes_elegiveis': len(registros),
                     'participacoes_modeladas': len(X), 'sem_candidato_comprado': int((~validos).sum()),
                     'k': k, 'avaliacoes': avaliacoes, 'clusters': clusters, 'ordem_features_item_ids': ids,
                     'fracao_compras_distintas_coberta': float(X.sum() / sum(len(compras[ch]) for ch in registros)),
                     'candidatos': [{'item_id': i, 'nome': catalogo[i]['name'], 'origens': fontes[hid][i],
                                     'uso_tabela_geral_percentual': tabela.get(i, {}).get('uso_percentual')} for i in ids],
                     'fora_do_filtro_mais_comprados': [{'item_id': i, 'nome': catalogo.get(i, {}).get('name'), 'participacoes': n}
                                                     for i, n in excluidos.most_common(15)],
                     'pro_partidas_exibidas': h.get('probuild', {}).get('partidas_totais_exibidas'),
                     'urls': {s: h[s]['url'] for s in ('items', 'probuild', 'build') if s in h}}
        saida['herois'].append(resultado)
        print(f"{h['nome']}: n={len(X)}, candidatos={len(ids)}, k={k}", flush=True)
    (ROOT / 'clusters.json').write_text(json.dumps(saida, ensure_ascii=False, indent=2), encoding='utf-8')
    exportacao = {'gerado_utc': saida['gerado_utc'], 'status': 'experimental',
                  'politica': 'priorizar candidatos; permitir itens externos por contexto e revisar diagnostico de cobertura',
                  'herois': {str(h['hero_id']): {'nome': h['nome'], 'candidatos': h['candidatos'],
                             'perfis': [{'cluster': c['cluster'], 'participacoes': c['participacoes'],
                                         'itens_frequentes_item_ids': c['itens_frequentes_item_ids']} for c in h['clusters']]}
                             for h in saida['herois'] if 'erro' not in h}}
    (ROOT / 'candidatos.json').write_text(json.dumps(exportacao, ensure_ascii=False, indent=2), encoding='utf-8')
    import csv
    with (ROOT / 'resumo.csv').open('w', encoding='utf-8-sig', newline='') as f:
        w = csv.writer(f)
        w.writerow(['heroi', 'participacoes', 'candidatos', 'k', 'silhouette', 'partidas_pro_tracklock'])
        for h in saida['herois']:
            if 'erro' not in h:
                w.writerow([h['nome'], h['participacoes_modeladas'], len(h['candidatos']), h['k'],
                            next((a['silhouette'] for a in h['avaliacoes'] if a['k'] == h['k']), None), h['pro_partidas_exibidas']])

if __name__ == '__main__':
    main()
