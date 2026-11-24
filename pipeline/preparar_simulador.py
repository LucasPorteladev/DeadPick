"""Gera os dados agregados e o catálogo local do protótipo."""

import argparse
import gzip
import hashlib
import json
import subprocess
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from statistics import median


BASE = Path("data/paradox")
SAIDA = Path("simulador/dados.js")


def catalogo(nome):
    with gzip.open(BASE / "bruto" / f"catalogo-{nome}.json.gz", "rt", encoding="utf-8") as arquivo:
        return json.load(arquivo)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baixar-imagens", action="store_true")
    parser.add_argument('--base', type=Path, help='Base ampliada restaurada, quando estiver fora do pacote Git.')
    args = parser.parse_args()
    auditoria = json.loads((BASE / "auditoria.json").read_text(encoding="utf-8"))
    imagens = {}

    def imagem(tipo, id_, url):
        caminho = f"imagens/{tipo}-{id_}.webp"
        imagens[caminho] = url
        return caminho

    catalogo_itens = catalogo('itens')
    nomes_classes = {x['class_name']: x['name'] for x in catalogo_itens}
    itens = {str(x["id"]): {"nome": x["name"], "custo": x["cost"], "tier": x["item_tier"],
                          "componentes": [nomes_classes[c] for c in x.get('component_items', []) if c in nomes_classes],
                          "imagem": imagem("item", x["id"], x["shop_image_webp"])}
             for x in catalogo_itens if x.get("shopable") and x["type"] == "upgrade"}
    herois = sorted(({"nome": x["name"], "imagem": imagem("heroi", x["id"], x["images"]["icon_hero_card_webp"])}
                     for x in catalogo("herois") if x["player_selectable"] and not x["disabled"]),
                    key=lambda x: x["nome"].casefold())

    if args.baixar_imagens:
        (SAIDA.parent / "imagens").mkdir(exist_ok=True)

        def baixar(entrada):
            caminho, url = entrada
            destino = SAIDA.parent / caminho
            if not destino.exists():
                conteudo = subprocess.check_output(["curl", "-fsSL", "--retry", "2", "--max-time", "25", url])
                if conteudo[:4] != b"RIFF" or conteudo[8:12] != b"WEBP":
                    raise ValueError(f"Imagem inválida: {url}")
                destino.write_bytes(conteudo)

        with ThreadPoolExecutor(max_workers=8) as executor:
            list(executor.map(baixar, imagens.items()))
    por_item = defaultdict(set)
    ranks = defaultdict(set)
    with gzip.open(BASE / "decisoes_compra_alto_rank_individual.jsonl.gz", "rt", encoding="utf-8") as arquivo:
        for linha in arquivo:
            compra = json.loads(linha)
            por_item[str(compra["item_id"])].add(compra["match_id"])
            ranks[compra["player_rank_initial_display_rank"] // 10].add(compra["match_id"])
    dados = {
        "versao": auditoria["versao_inferida"], "janela": auditoria["janela_utc"], "herois": herois,
        "itens": itens, "uso": {i: len(m) for i, m in por_item.items()},
        "ranks": {r: len(m) for r, m in ranks.items()},
        "partidas": auditoria["contagens"]["partidas_paradox_alto_rank_individual"],
    }
    modelos = json.loads(Path('data/tracklock-todos/clusters.json').read_text(encoding='utf-8'))
    base_ampliada = args.base or Path(modelos['base'])
    auditoria_ampliada = json.loads((base_ampliada / 'auditoria.json').read_text(encoding='utf-8'))
    tempos = defaultdict(list)
    with gzip.open(base_ampliada / 'eventos.jsonl.gz', 'rt', encoding='utf-8') as arquivo:
        for linha in arquivo:
            evento = json.loads(linha)
            if evento['item_de_loja'] and evento['game_time_s'] >= 0:
                tempos[(evento['hero_id'], str(evento['item_id']))].append(evento['game_time_s'])
    arquivo_tempos = SAIDA.parent / 'tempos_por_perfil.json'
    tempos_perfil = json.loads(arquivo_tempos.read_text(encoding='utf-8')) if arquivo_tempos.exists() else None
    if tempos_perfil and tempos_perfil['clusters_sha256'] != hashlib.sha256(Path('data/tracklock-todos/clusters.json').read_bytes()).hexdigest():
        raise ValueError('Tempos de outra versão dos perfis; recalcular antes de gerar o simulador.')

    def tempo_item(h, c, i):
        amostras = tempos[(h['hero_id'], str(i['item_id']))]
        result = {'nome': i['nome'], 'frequencia': i['frequencia_no_cluster'],
                  'segundo': median(amostras) if amostras else None, 'fonte_tempo': 'heroi'}
        estimativa = (tempos_perfil or {}).get('herois', {}).get(h['nome'], {}).get(str(c['cluster']), {}).get('tempos', {}).get(str(i['item_id']))
        if estimativa:
            result.update(segundo=estimativa['segundo'], segundo_p25=estimativa['p25'], segundo_p75=estimativa['p75'],
                          amostras_tempo=estimativa['amostras'], fonte_tempo='perfil')
        return result

    dados['modelos'] = {h['nome']: {
        'participacoes': h['participacoes_modeladas'], 'silhouette': next((a['silhouette'] for a in h['avaliacoes'] if a['k'] == h['k']), None),
        'perfis': [{ 'id': c['cluster'], 'participacoes': c['participacoes'],
                    'itens': [tempo_item(h, c, i) for i in c['itens']]} for c in h['clusters']]
    } for h in modelos['herois']}
    dados['versao'] = auditoria_ampliada['versao_inferida']
    dados['partidas'] = auditoria_ampliada['contagens']['partidas']
    dados['participacoes'] = sum(h['participacoes_modeladas'] for h in modelos['herois'])
    dados['janela'] = {k: auditoria_ampliada[k] for k in ('inicio_utc', 'fim_exclusivo_utc')}
    arquivo_ameacas = SAIDA.parent / 'ameacas.json'
    if arquivo_ameacas.exists():
        dados['ameacas'] = json.loads(arquivo_ameacas.read_text(encoding='utf-8'))
        if dados['ameacas']['balanceVersion'] != dados['versao']:
            raise ValueError('Modelo defensivo de outra versão de balanceamento; retreinar antes de empacotar.')
    arquivo_imbuimentos = SAIDA.parent / 'imbuimentos.json'
    if arquivo_imbuimentos.exists():
        dados['imbuimentos'] = json.loads(arquivo_imbuimentos.read_text(encoding='utf-8'))
        origem = dados['imbuimentos']['origem']
        if origem.get('contrato_nativo_sha256') != hashlib.sha256(Path('mod/native-imbue-contract.json').read_bytes()).hexdigest():
            raise ValueError('Contrato nativo dos imbuimentos mudou; recalcular antes de empacotar.')
        if dados['imbuimentos']['balanceVersion'] != dados['versao'] or origem['auditoria_base_sha256'] != hashlib.sha256((base_ampliada/'auditoria.json').read_bytes()).hexdigest():
            raise ValueError('Imbuimentos de outro catálogo/recorte; recalcular antes de empacotar.')
        for nome in ('itens', 'herois'):
            if origem['catalogo_'+nome+'_sha256'] != hashlib.sha256((BASE/'bruto'/('catalogo-'+nome+'.json.gz')).read_bytes()).hexdigest():
                raise ValueError('Catálogo de imbuimentos alterado; recalcular antes de empacotar.')
    SAIDA.write_text("// Gerado por preparar_simulador.py\nconst DADOS = " +
                     json.dumps(dados, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")


if __name__ == "__main__":
    main()
