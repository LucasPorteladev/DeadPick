"""Coleta partidas elegíveis e normaliza decisões Phantom I+ de todos os heróis."""

import argparse
import gzip
import hashlib
import json
import shutil
from collections import Counter, defaultdict
from contextlib import ExitStack
from datetime import datetime, timezone
from http.client import IncompleteRead
from pathlib import Path
from time import sleep
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode

from extrair_paradox import (
    API, INICIO, FIM, VERSAO, TIMES, buscar_json, eventos_jogador, gravar_linha, linha_do_tempo,
)


def salvar_json(destino, dados):
    temporario = destino.with_suffix(destino.suffix + ".tmp")
    temporario.write_text(json.dumps(dados, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporario.replace(destino)


def obter_pagina(bruto, ids, offline):
    identificador = hashlib.sha256(json.dumps(ids).encode()).hexdigest()[:16]
    arquivo = bruto / f"partidas-{identificador}.json.gz"
    caminho = "/v1/matches/metadata?" + urlencode({
        "match_ids": ",".join(map(str, ids)), "include_player_info": "true",
        "include_player_items": "true", "limit": len(ids), "order_by": "match_id", "order_direction": "asc",
    })
    if arquivo.exists():
        with gzip.open(arquivo, "rt", encoding="utf-8") as entrada:
            return json.load(entrada), caminho
    if offline:
        raise FileNotFoundError(arquivo)
    for tentativa in range(4):
        try:
            dados = buscar_json(caminho, timeout=60)
            break
        except HTTPError as erro:
            if erro.code not in (429, 502, 503) or tentativa == 3:
                raise
            espera = erro.headers.get("Retry-After", "30")
            sleep(int(espera) if espera.isdigit() else 30)
        except (IncompleteRead, EOFError, TimeoutError, ConnectionError, URLError, json.JSONDecodeError):
            if tentativa == 3:
                raise
            sleep(3 * (tentativa + 1))
    if not isinstance(dados, list) or any(p["match_id"] not in ids for p in dados):
        raise ValueError("Resposta de metadados incompatível com a página solicitada")
    temporario = arquivo.with_suffix(".tmp")
    with gzip.open(temporario, "wt", encoding="utf-8") as saida:
        json.dump(dados, saida, ensure_ascii=False, separators=(",", ":"))
    temporario.replace(arquivo)
    sleep(2.1)
    return dados, caminho


def normalizar_partida(partida, catalogo, arquivos, cobertura, contagens):
    jogadores = partida["players"]
    instante = datetime.fromisoformat(partida["start_time"]).replace(tzinfo=timezone.utc).timestamp()
    if not INICIO <= instante < FIM:
        raise ValueError(f"Partida {partida['match_id']} fora do recorte")
    if (Counter(j["team"] for j in jogadores) != TIMES
            or len({j["player_slot"] for j in jogadores}) != 12
            or partida.get("not_scored") or partida["winning_team"] not in TIMES):
        contagens["partidas_invalidas"] += 1
        return
    match_id = partida["match_id"]
    gravar_linha(arquivos["partidas"], {k: v for k, v in partida.items() if k != "players"})
    contagens["partidas"] += 1
    for jogador in jogadores:
        rank = jogador.get("player_rank_initial_display_rank") or 0
        gravar_linha(arquivos["jogadores"], {
            "match_id": match_id, **{k: jogador.get(k) for k in (
                "account_id", "player_slot", "hero_id", "team", "assigned_lane", "player_rank_initial_display_rank",
            )},
        })
        if rank < 91:
            continue
        heroi = jogador["hero_id"]
        info = cobertura[heroi]
        info["partidas"].add(match_id)
        info["jogadores"].add(jogador["account_id"])
        info["ranks"][rank // 10] += 1
        eventos = list(eventos_jogador(partida, jogador, catalogo))
        desconhecidos = sorted({e["item_id"] for e in eventos if e["tipo_catalogo"] is None})
        contagens["participacoes_elegiveis"] += 1
        contagens["participacoes_sem_itens"] += not eventos
        for evento in eventos:
            gravar_linha(arquivos["eventos"], {"hero_id": heroi, **evento})
            contagens["registros"] += 1
        inconsistente = False
        for segundo, entradas, saidas, antes, depois, erro in linha_do_tempo(eventos):
            inconsistente |= erro
            ambiguo = len(entradas) + len(saidas) > 1
            for evento in entradas:
                decisao = {
                    "match_id": match_id, "player_slot": jogador["player_slot"], "hero_id": heroi,
                    "team": jogador["team"], "player_rank_initial_display_rank": rank,
                    "game_time_s": segundo, "indice_registro": evento["indice_registro"],
                    "item_id": evento["item_id"], "nome_item": evento["nome_item"],
                    "inventario_antes_do_segundo": antes, "ordem_ambigua": ambiguo,
                    "inventario_inconsistente": inconsistente, "ids_sem_catalogo_na_partida": desconhecidos,
                    "net_worth_at_buy": evento.get("net_worth_at_buy"), "custo_catalogo": evento["custo_catalogo"],
                    "aliados": sorted(j["hero_id"] for j in jogadores if j["team"] == jogador["team"] and j is not jogador),
                    "inimigos": sorted(j["hero_id"] for j in jogadores if j["team"] != jogador["team"]),
                }
                gravar_linha(arquivos["decisoes"], decisao)
                contagens["decisoes_candidatas"] += 1
                contagens["ordem_ambigua"] += ambiguo
                info["decisoes"] += 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--saida", type=Path, default=Path("data/base-ampliada-6860"))
    parser.add_argument("--offline", action="store_true")
    args = parser.parse_args()
    headers = Path("data/elegiveis-headers.txt").read_text().lower()
    if "x-truncated: true" in headers:
        raise ValueError("A consulta de elegibilidade foi truncada. Divida o recorte antes de coletar.")
    elegiveis = json.loads(Path("data/elegiveis-rank.json").read_text(encoding="utf-8"))
    ids = sorted({p["match_id"] for p in elegiveis})
    bruto = args.saida / "bruto"
    bruto.mkdir(parents=True, exist_ok=True)
    for nome in ("consulta-elegiveis.sql", "elegiveis-headers.txt", "elegiveis-rank.json"):
        shutil.copyfile(Path("data") / nome, bruto / nome)
    for nome in ("catalogo-itens", "catalogo-herois", "ranks", "patches"):
        shutil.copyfile(Path("data/paradox/bruto") / f"{nome}.json.gz", bruto / f"{nome}.json.gz")
    with gzip.open(bruto / "catalogo-itens.json.gz", "rt", encoding="utf-8") as entrada:
        catalogo = {i["id"]: i for i in json.load(entrada)}
    with gzip.open(bruto / "catalogo-herois.json.gz", "rt", encoding="utf-8") as entrada:
        nomes = {h["id"]: h["name"] for h in json.load(entrada)}
    paginas = []
    contagens = Counter()
    cobertura = defaultdict(lambda: {"partidas": set(), "jogadores": set(), "ranks": Counter(), "decisoes": 0})
    faltantes = []
    vistos = set()
    with ExitStack() as pilha:
        arquivos = {n: pilha.enter_context(gzip.open(args.saida / f"{n}.jsonl.gz.tmp", "wt", encoding="utf-8"))
                    for n in ("partidas", "jogadores", "eventos", "decisoes")}
        for inicio in range(0, len(ids), 200):
            lote = ids[inicio:inicio + 200]
            partidas, caminho = obter_pagina(bruto, lote, args.offline)
            paginas.append({"url": API + caminho, "partidas": len(partidas)})
            faltantes.extend(set(lote) - {p["match_id"] for p in partidas})
            for partida in partidas:
                if partida["match_id"] in vistos:
                    raise ValueError("Partida duplicada entre páginas")
                vistos.add(partida["match_id"])
                normalizar_partida(partida, catalogo, arquivos, cobertura, contagens)
            print(f"{min(inicio + 200, len(ids))}/{len(ids)} partidas consultadas; "
                  f"{contagens['decisoes_candidatas']} decisões elegíveis", flush=True)
    for n in arquivos:
        (args.saida / f"{n}.jsonl.gz.tmp").replace(args.saida / f"{n}.jsonl.gz")
    relatorio = {
        "versao_inferida": VERSAO, "inicio_utc": "2026-11-06T01:00:00Z", "fim_exclusivo_utc": "2026-11-09T00:00:00Z",
        "rank_individual_minimo": 91, "partidas_solicitadas": len(ids), "partidas_indisponiveis": sorted(faltantes),
        "contagens": contagens, "paginas": paginas,
        "herois": [{"hero_id": h, "nome": nomes.get(h), "partidas": len(x["partidas"]),
                    "jogadores_distintos": len(x["jogadores"]), "ranks": x["ranks"], "decisoes": x["decisoes"]}
                   for h, x in sorted(cobertura.items())],
    }
    salvar_json(args.saida / "auditoria.json", relatorio)
    print(dict(contagens), flush=True)


if __name__ == "__main__":
    main()
