"""Coleta piloto de metadados de partidas normais de Deadlock."""

import argparse
import gzip
import json
import sys
from collections import Counter
from pathlib import Path
from time import time
from urllib.parse import urlencode
from urllib.request import Request, urlopen


API = "https://api.deadlock-api.com"
TIMES = {"Team0": 6, "Team1": 6}


def buscar_json(caminho, timeout=20):
    pedido = Request(f"{API}{caminho}", headers={
        "Accept": "application/json", "User-Agent": "Deadpick/0.1", "Accept-Encoding": "gzip",
    })
    with urlopen(pedido, timeout=timeout) as resposta:
        if resposta.headers.get("Content-Encoding") == "gzip":
            with gzip.GzipFile(fileobj=resposta) as conteudo:
                return json.load(conteudo)
        return json.load(resposta)


def salvar_json(diretorio, nome, dados):
    (diretorio / nome).write_text(
        json.dumps(dados, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def auditar_partida(partida):
    jogadores = partida["players"]
    times = Counter(jogador.get("team") for jogador in jogadores)
    registros = [item for jogador in jogadores for item in (jogador.get("items") or [])]
    return {
        "match_id": partida["match_id"],
        "composicoes_completas": times == TIMES and all(
            jogador.get("hero_id") for jogador in jogadores
        ),
        "vencedor_registrado": partida.get("winning_team") in TIMES,
        "jogadores": len(jogadores),
        "jogadores_com_registros_de_item": sum(bool(j.get("items")) for j in jogadores),
        "registros_de_item": len(registros),
        "registros_com_id_e_tempo": sum(
            bool(item.get("item_id")) and item.get("game_time_s") is not None
            for item in registros
        ),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limite", type=int, choices=range(1, 21), metavar="1-20", default=5)
    parser.add_argument("--saida", type=Path, default=Path("data/amostra"))
    args = parser.parse_args()
    if args.saida.exists():
        parser.error("o diretório de saída já existe. Escolha outro com --saida")

    consulta = urlencode({
        "game_mode": "normal", "min_unix_timestamp": int(time()) - 7 * 86400,
        "order_by": "match_id",
        "order_direction": "desc", "limit": args.limite,
        "include_player_info": "true", "include_player_items": "true",
    })
    lista = buscar_json(f"/v1/matches/metadata?{consulta}")
    auditorias = [auditar_partida(partida) for partida in lista]

    args.saida.mkdir(parents=True, exist_ok=False)
    salvar_json(args.saida, "partidas.json", lista)
    resumo = {"consulta": consulta, "partidas": auditorias}
    salvar_json(args.saida, "auditoria.json", resumo)
    print(f"{len(auditorias)} partidas auditadas em {args.saida}")
    return 0 if auditorias else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, KeyError, TypeError) as erro:
        print(f"Falha na coleta: {erro}", file=sys.stderr)
        sys.exit(1)
