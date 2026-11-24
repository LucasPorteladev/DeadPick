"""Valida cobertura, integridade dos snapshots e reconciliacao dos clusters."""
import hashlib
import json
from pathlib import Path

from coletar_tracklock_todos import catalogo

ROOT = Path('data/tracklock-todos')

def verificar(condicao, mensagem):
    if not condicao:
        raise ValueError(mensagem)

def main():
    extracao = json.loads((ROOT / 'extracao.json').read_text(encoding='utf-8'))
    modelos = json.loads((ROOT / 'clusters.json').read_text(encoding='utf-8'))
    exportacao = json.loads((ROOT / 'candidatos.json').read_text(encoding='utf-8'))
    esperados = {h['id'] for h in catalogo('herois') if h['player_selectable'] and not h['disabled']}
    verificar({h['hero_id'] for h in extracao['herois']} == esperados, 'Cobertura de extracao incompleta')
    verificar({h['hero_id'] for h in modelos['herois']} == esperados, 'Cobertura de modelos incompleta')
    verificar({int(i) for i in exportacao['herois']} == esperados, 'Exportacao de candidatos incompleta')
    sem_mapeamento = []
    total_itens = total_pro = total_refs = 0
    for h in extracao['herois']:
        verificar(not h.get('erros') and not h.get('erro'), f"Erros de extracao: {h['nome']}")
        for s in ('items', 'probuild', 'build'):
            pagina = h[s]
            verificar(hashlib.sha256(Path(pagina['snapshot']).read_bytes()).hexdigest() == pagina['sha256'], 'Snapshot alterado')
        linhas = h['items']['itens']
        verificar(len({i['nome_item'] for i in linhas}) == len(linhas), 'Itens duplicados na tabela')
        total_itens += len(linhas)
        total_pro += h['probuild']['partidas_totais_exibidas']
        referencias = linhas + [i for fase in h['probuild']['fases'].values() for i in fase]
        referencias += [i for secao in h['build']['secoes'].values() for i in secao]
        total_refs += len(referencias)
        for i in referencias:
            if i['item_id'] is None:
                sem_mapeamento.append({'heroi': h['nome'], 'item': i['nome_item']})
            if 'uso_percentual' in i:
                verificar(0 <= i['uso_percentual'] <= 100, 'Percentual fora do intervalo')
    scores = []
    for h in modelos['herois']:
        verificar('erro' not in h, 'Heroi sem modelo')
        n = h['participacoes_modeladas']
        verificar(sum(c['participacoes'] for c in h['clusters']) == n, 'Participacoes nao reconciliam')
        verificar(n + h['sem_candidato_comprado'] == h['participacoes_elegiveis'], 'Elegibilidade inconsistente')
        ids = set(h['ordem_features_item_ids'])
        verificar(ids == {i['item_id'] for i in h['candidatos']}, 'Features e filtro divergem')
        verificar(ids == {i['item_id'] for i in exportacao['herois'][str(h['hero_id'])]['candidatos']}, 'Exportacao diverge do modelo')
        for c in h['clusters']:
            verificar(len(c['centroide_l2']) == len(ids), 'Dimensao de centroide incorreta')
            verificar({i['item_id'] for i in c['itens']} == ids, 'Cluster perdeu features')
            for i in c['itens']:
                verificar(0 <= i['participacoes_com_compra'] <= c['participacoes'], 'Contagem de compra invalida')
                verificar(abs(i['frequencia_no_cluster'] - i['participacoes_com_compra']/c['participacoes']) < 1e-10, 'Frequencia inconsistente')
        scores += [a['silhouette'] for a in h['avaliacoes'] if a['k'] == h['k']]
    resumo = {'status': 'ok', 'herois': len(esperados), 'paginas_validadas': len(esperados)*3,
              'linhas_tabelas_itens': total_itens, 'referencias_itens': total_refs,
              'referencias_sem_mapeamento': sem_mapeamento,
              'participacoes_pro_somadas_nao_partidas_unicas': total_pro,
              'participacoes_phantom_modeladas': sum(h['participacoes_modeladas'] for h in modelos['herois']),
              'silhouette_minimo': min(scores), 'silhouette_maximo': max(scores),
              'cobertura_filtro_minima': min(h['fracao_compras_distintas_coberta'] for h in modelos['herois']),
              'cobertura_filtro_maxima': max(h['fracao_compras_distintas_coberta'] for h in modelos['herois'])}
    (ROOT / 'qualidade.json').write_text(json.dumps(resumo, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(resumo, ensure_ascii=False, indent=2))

if __name__ == '__main__':
    main()
