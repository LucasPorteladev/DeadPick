"""Gera os dados agregados e o catálogo local do protótipo."""

import argparse
import gzip
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
    base_ampliada = Path(modelos['base'])
    auditoria_ampliada = json.loads((base_ampliada / 'auditoria.json').read_text(encoding='utf-8'))
    tempos = defaultdict(list)
    with gzip.open(base_ampliada / 'eventos.jsonl.gz', 'rt', encoding='utf-8') as arquivo:
        for linha in arquivo:
            evento = json.loads(linha)
            if evento['item_de_loja'] and evento['game_time_s'] >= 0:
                tempos[(evento['hero_id'], str(evento['item_id']))].append(evento['game_time_s'])
    dados['modelos'] = {h['nome']: {
        'participacoes': h['participacoes_modeladas'], 'silhouette': next((a['silhouette'] for a in h['avaliacoes'] if a['k'] == h['k']), None),
        'perfis': [{ 'id': c['cluster'], 'participacoes': c['participacoes'],
                    'itens': [{'nome': i['nome'], 'frequencia': i['frequencia_no_cluster'],
                               'segundo': median(tempos[(h['hero_id'], str(i['item_id']))]) if tempos[(h['hero_id'], str(i['item_id']))] else None}
                              for i in c['itens']]} for c in h['clusters']]
    } for h in modelos['herois']}
    dados['versao'] = auditoria_ampliada['versao_inferida']
    dados['partidas'] = auditoria_ampliada['contagens']['partidas']
    dados['participacoes'] = sum(h['participacoes_modeladas'] for h in modelos['herois'])
    dados['janela'] = {k: auditoria_ampliada[k] for k in ('inicio_utc', 'fim_exclusivo_utc')}
    SAIDA.write_text("// Gerado por preparar_simulador.py\nconst DADOS = " +
                     json.dumps(dados, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")


if __name__ == "__main__":
    main()
