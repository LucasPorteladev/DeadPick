"""Mede a cobertura de rank e heróis da amostra histórica já coletada."""

import gzip
import json
from collections import Counter, defaultdict
from pathlib import Path


BASE = Path("data/paradox")


def ler_linhas(nome):
    with gzip.open(BASE / f"{nome}.jsonl.gz", "rt", encoding="utf-8") as entrada:
        for linha in entrada:
            yield json.loads(linha)


def main():
    with gzip.open(BASE / "bruto/catalogo-herois.json.gz", "rt", encoding="utf-8") as entrada:
        herois = {heroi["id"]: heroi["name"] for heroi in json.load(entrada)}
    jogadores = {}
    partidas = defaultdict(set)
    por_rank = defaultdict(Counter)
    compras = Counter()
    for jogador in ler_linhas("jogadores_partida"):
        rank = jogador.get("player_rank_initial_display_rank") or 0
        if rank < 91:
            continue
        heroi = jogador["hero_id"]
        chave = (jogador["match_id"], jogador["player_slot"])
        jogadores[chave] = heroi
        partidas[heroi].add(jogador["match_id"])
        por_rank[heroi][rank // 10] += 1

    for evento in ler_linhas("eventos_item"):
        heroi = jogadores.get((evento["match_id"], evento["player_slot"]))
        if heroi is not None and evento["item_de_loja"]:
            compras[heroi] += 1

    cobertura = [{
        "hero_id": heroi, "nome": herois[heroi], "partidas_distintas": len(ids),
        "phantom": por_rank[heroi][9], "ascendant": por_rank[heroi][10],
        "eternus": por_rank[heroi][11], "registros_loja": compras[heroi],
    } for heroi, ids in partidas.items()]
    cobertura.sort(key=lambda linha: (-linha["partidas_distintas"], linha["nome"]))
    relatorio = {
        "origem": "720 partidas selecionadas por conter Paradox, de 6 a 8 de novembro de 2026",
        "criterio": "rank individual de entrada Phantom I ou superior",
        "limite": "Os outros herois aparecem somente em partidas que tambem tem Paradox",
        "participacoes_elegiveis": len(jogadores), "herois": cobertura,
    }
    destino = BASE / "cobertura_herois.json"
    destino.write_text(json.dumps(relatorio, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{len(jogadores)} participações de rank alto em {len(cobertura)} heróis. {destino}")


if __name__ == "__main__":
    main()
