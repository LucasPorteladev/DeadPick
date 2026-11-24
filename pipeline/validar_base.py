"""Confere integridade, composições, rank e cobertura da extração ampliada."""

import argparse
import csv
import gzip
import json
from collections import Counter, defaultdict
from pathlib import Path

from ampliar_base import salvar_json


def ler(base, nome):
    with gzip.open(base / f"{nome}.jsonl.gz", "rt", encoding="utf-8") as entrada:
        for linha in entrada:
            yield json.loads(linha)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", type=Path, default=Path("data/base-ampliada-6860"))
    base = parser.parse_args().base
    auditoria = json.loads((base / "auditoria.json").read_text(encoding="utf-8"))
    partidas = {}
    for partida in ler(base, "partidas"):
        match_id = partida["match_id"]
        if match_id in partidas:
            raise ValueError(f"Partida repetida: {match_id}")
        partidas[match_id] = partida
    jogadores = {}
    times = defaultdict(Counter)
    for jogador in ler(base, "jogadores"):
        chave = (jogador["match_id"], jogador["player_slot"])
        if chave in jogadores or chave[0] not in partidas:
            raise ValueError(f"Jogador repetido ou partida ausente: {chave}")
        jogadores[chave] = jogador
        times[chave[0]][jogador["team"]] += 1
    if any(times.get(match_id) != {"Team0": 6, "Team1": 6} for match_id in partidas):
        raise ValueError("Composição incompleta")

    totais = Counter()
    cobertura = defaultdict(Counter)
    for tabela in ("eventos", "decisoes"):
        ultimo_match = -1
        chaves = set()
        for registro in ler(base, tabela):
            match_id = registro["match_id"]
            if match_id < ultimo_match:
                raise ValueError(f"Ordem de partidas inconsistente em {tabela}")
            if match_id != ultimo_match:
                chaves.clear()
                ultimo_match = match_id
            chave = (registro["player_slot"], registro["indice_registro"])
            if chave in chaves:
                raise ValueError(f"Registro duplicado em {tabela}: {match_id}, {chave}")
            chaves.add(chave)
            jogador = jogadores[match_id, registro["player_slot"]]
            if jogador["hero_id"] != registro["hero_id"] or (jogador.get("player_rank_initial_display_rank") or 0) < 91:
                raise ValueError(f"Herói ou rank inválido em {tabela}")
            totais[tabela] += 1
            if tabela == "decisoes":
                if len(registro["aliados"]) != 5 or len(registro["inimigos"]) != 6:
                    raise ValueError("Decisão com composição incompleta")
                if "winning_team" in registro:
                    raise ValueError("Resultado foi incluído na tabela de decisões")
                info = cobertura[registro["hero_id"]]
                info["decisoes"] += 1
                info["ordem_ambigua"] += registro["ordem_ambigua"]
                info["inventario_inconsistente"] += registro["inventario_inconsistente"]
                info["catalogo_incompleto"] += bool(registro["ids_sem_catalogo_na_partida"])
                info["patrimonio_ausente"] += registro["net_worth_at_buy"] is None

    esperado = auditoria["contagens"]
    if (len(partidas) != esperado["partidas"] or totais["eventos"] != esperado["registros"]
            or totais["decisoes"] != esperado["decisoes_candidatas"]):
        raise ValueError("Totais divergentes da auditoria")
    por_heroi = []
    for heroi in auditoria["herois"]:
        info = cobertura[heroi["hero_id"]]
        if info["decisoes"] != heroi["decisoes"]:
            raise ValueError(f"Total de decisões divergente para {heroi['nome']}")
        por_heroi.append({
            "hero_id": heroi["hero_id"], "heroi": heroi["nome"], "partidas": heroi["partidas"],
            "jogadores_distintos": heroi["jogadores_distintos"],
            "phantom": heroi["ranks"].get("9", 0), "ascendant": heroi["ranks"].get("10", 0),
            "eternus": heroi["ranks"].get("11", 0), **info,
        })
    por_heroi.sort(key=lambda x: (-x["partidas"], x["heroi"]))
    with (base / "cobertura.csv").open("w", newline="", encoding="utf-8-sig") as saida:
        writer = csv.DictWriter(saida, fieldnames=por_heroi[0].keys())
        writer.writeheader()
        writer.writerows(por_heroi)
    qualidade = {"partidas": len(partidas), "jogadores": len(jogadores), **totais, "herois": por_heroi}
    salvar_json(base / "qualidade.json", qualidade)
    print(json.dumps({k: v for k, v in qualidade.items() if k != "herois"}), flush=True)


if __name__ == "__main__":
    main()
