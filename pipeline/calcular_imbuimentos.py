"""Calcula a habilidade mais escolhida por herói/item, sem corte de suporte ou maioria."""
import argparse
import gzip
import hashlib
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def ler_gzip(path):
    with gzip.open(path, 'rt', encoding='utf-8') as f:
        return json.load(f)


def escolher(contagens, habilidades):
    """Maior contagem; empate por slot e ID. Nenhum limiar de confiança."""
    if not contagens:
        return None
    ordered = sorted(contagens, key=lambda i: (-contagens[i], habilidades[i].get('slot') or 99, i))
    winner = ordered[0]
    total = sum(contagens.values())
    return {**habilidades[winner], 'amostras': total, 'escolhas': contagens[winner],
            'pickrate': contagens[winner] / total,
            'distribuicao': [{**habilidades[i], 'escolhas': contagens[i]} for i in ordered]}


def calcular(base, itens, herois, contrato_nativo=None):
    catalog = {i['id']: i for i in itens}
    abilities = {i['id']: i for i in itens if i['type'] == 'ability'}
    def imbuivel(i):
        if contrato_nativo is not None:
            return i['class_name'] in contrato_nativo['classes']
        return bool(re.search(r'\bimbu(?:e|ed|ing|ement)\b', json.dumps([i.get('description'), i.get('tooltip_sections')]), re.I))
    imbue = {i['id']: i for i in itens if i.get('shopable') and i['type'] == 'upgrade' and imbuivel(i)}
    players = {}
    with gzip.open(base/'jogadores.jsonl.gz', 'rt', encoding='utf-8') as f:
        for line in f:
            p = json.loads(line)
            if (p.get('player_rank_initial_display_rank') or 0) >= 91:
                players[p['match_id'], p['player_slot']] = p['hero_id']
    selected_heroes = {h['id']: h for h in herois if h.get('player_selectable') and not h.get('disabled')}
    by_class = {a['class_name']: a for a in abilities.values()}
    skill_maps = {}
    for hid, h in selected_heroes.items():
        skills = {}
        for slot in range(1, 5):
            a = by_class.get(h.get('items', {}).get(f'signature{slot}'))
            if a:
                skills[a['id']] = {'habilidadeId': a['id'], 'slot': slot, 'nome': a['name'], 'classe': a['class_name']}
        skill_maps[hid] = skills
    counts, observations = defaultdict(Counter), {}
    audit = Counter()
    with gzip.open(base/'eventos.jsonl.gz', 'rt', encoding='utf-8') as f:
        for line in f:
            e = json.loads(line)
            key = e['match_id'], e['player_slot']
            hid = players.get(key)
            item, t, raw = e['item_id'], e['game_time_s'], e.get('imbued_ability_id')
            if hid not in selected_heroes or item not in imbue or not e['item_de_loja'] or t < 0:
                continue
            audit['registros_itens_imbuiveis'] += 1
            if not raw:
                audit['sem_habilidade_informada'] += 1
                continue
            if not isinstance(raw, int) or isinstance(raw, bool) or not -(2**31) <= raw < 2**32:
                audit['id_invalido'] += 1
                continue
            aid = raw & 0xffffffff
            if aid not in abilities:
                audit['habilidade_fora_catalogo'] += 1
                continue
            if aid not in skill_maps[hid]:
                audit['habilidade_fora_assinaturas_heroi'] += 1
                continue
            choice_key = (*key, item)
            # Primeira entrada válida da participação/item; não pesa eventuais duplicatas.
            observation = (t, e['indice_registro'], hid, aid)
            if choice_key not in observations or observation[:2] < observations[choice_key][:2]:
                observations[choice_key] = observation
    for (_, _, item), (_, _, hid, aid) in observations.items():
        counts[hid, item][aid] += 1
    result = {'versao': 1, 'balanceVersion': 6860, 'rankMinimo': 91,
              'criterio_itens': 'Campo nativo m_TargetAbilityEffectsToApply' if contrato_nativo is not None else 'Texto do catálogo, incluindo imbue/imbued',
              'politica': 'Maior frequência por herói/item entre escolhas identificadas; sem suporte mínimo ou corte de pickrate. Empate: menor slot, depois ID.',
              'denominador': 'Participações Phantom+ com registro válido de imbuimento do item em uma das quatro habilidades do próprio herói. Uma escolha por partida/slot/item.',
              'limites': 'Escolha registrada nos metadados históricos; não reconstrói reatribuições nem prova benefício estratégico. Não transfere escolhas de outros heróis ou itens.',
              'auditoria': dict(audit), 'herois': {}}
    for hid, hero in sorted(selected_heroes.items(), key=lambda kv: kv[1]['name']):
        choices = {}
        for item in sorted(imbue):
            winner = escolher(counts[hid, item], skill_maps[hid])
            if winner:
                choices[catalog[item]['name']] = {'itemId': item, **winner}
        result['herois'][hero['name']] = {'heroId': hid, 'itens': choices}
    result['auditoria']['participacoes_item_validas'] = len(observations)
    result['auditoria']['pares_heroi_item_com_indicacao'] = sum(len(h['itens']) for h in result['herois'].values())
    result['itensImbuiveis'] = {str(i): v['name'] for i,v in imbue.items()}
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', type=Path, required=True)
    parser.add_argument('--saida', type=Path, default=ROOT/'simulador/imbuimentos.json')
    parser.add_argument('--contrato-nativo', type=Path, default=ROOT/'mod/native-imbue-contract.json')
    args = parser.parse_args()
    audit = json.loads((args.base/'auditoria.json').read_text(encoding='utf-8'))
    if audit['versao_inferida'] != 6860 or audit['rank_individual_minimo'] != 91:
        raise ValueError('Recorte incompatível com catálogo e filtro Phantom+.')
    catdir = ROOT/'data/deadlock-api/bruto'
    contrato = json.loads(args.contrato_nativo.read_text(encoding='utf-8'))
    result = calcular(args.base, ler_gzip(catdir/'catalogo-itens.json.gz'), ler_gzip(catdir/'catalogo-herois.json.gz'), contrato)
    result['origem'] = {'auditoria_base_sha256': hashlib.sha256((args.base/'auditoria.json').read_bytes()).hexdigest(),
                        'catalogo_itens_sha256': hashlib.sha256((catdir/'catalogo-itens.json.gz').read_bytes()).hexdigest(),
                        'catalogo_herois_sha256': hashlib.sha256((catdir/'catalogo-herois.json.gz').read_bytes()).hexdigest()}
    result['origem']['contrato_nativo_sha256'] = hashlib.sha256(args.contrato_nativo.read_bytes()).hexdigest()
    args.saida.write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(json.dumps(result['auditoria'],ensure_ascii=False))


if __name__ == '__main__':
    main()
