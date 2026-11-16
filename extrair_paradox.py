"""Baixa e normaliza o recorte piloto da Paradox, na versão 6860."""

import argparse
import gzip
import json
from collections import Counter, defaultdict
from contextlib import ExitStack
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode

from coletar_amostra import API, buscar_json


HEROI = 10
VERSAO = 6860
INICIO = int(datetime.fromisoformat("2026-11-06T01:00:00+00:00").timestamp())
FIM = int(datetime.fromisoformat("2026-11-09T00:00:00+00:00").timestamp())
LIMITE = 60
FASES = {"inicio": (0, 599), "meio": (600, 1199), "fim": (1200, None)}
RANK_MINIMO = 91  # Phantom I no rank individual de entrada na partida
RANK_MEDIO_REFERENCIA = 101  # Ascendant I no agregado histórico por média do lobby
TIMES = {"Team0": 6, "Team1": 6}
COLUNAS_PARTIDA = (
    "match_id", "start_time", "duration_s", "match_outcome", "match_mode", "game_mode",
    "average_badge_team0", "average_badge_team1", "average_badge", "not_scored", "banned_hero_ids",
)


def gravar_linha(arquivo, dados):
    arquivo.write(json.dumps(dados, ensure_ascii=False, separators=(",", ":")) + "\n")


def eventos_jogador(partida, jogador, catalogo):
    for indice, registro in enumerate(jogador.get("items") or []):
        item = catalogo.get(registro["item_id"], {})
        yield {
            **registro, "match_id": partida["match_id"], "player_slot": jogador["player_slot"],
            "indice_registro": indice, "nome_item": item.get("name"), "tipo_catalogo": item.get("type"),
            "item_de_loja": item.get("shopable") is True and item.get("type") == "upgrade",
            "custo_catalogo": item.get("cost"),
        }


def linha_do_tempo(eventos):
    """Agrupa entradas e saídas por segundo, sem supor ordem dentro do segundo."""
    por_segundo = defaultdict(lambda: {"entradas": [], "saidas": []})
    for evento in eventos:
        if evento["item_de_loja"]:
            por_segundo[evento["game_time_s"]]["entradas"].append(evento)
            if evento.get("sold_time_s"):
                por_segundo[evento["sold_time_s"]]["saidas"].append(evento)

    inventario = {}
    for segundo, acoes in sorted(por_segundo.items()):
        antes = sorted(e["item_id"] for e in inventario.values())
        entradas, saidas = acoes["entradas"], acoes["saidas"]
        indices_ativos = inventario.keys() | {e["indice_registro"] for e in entradas}
        saida_sem_entrada = any(e["indice_registro"] not in indices_ativos for e in saidas)
        inventario.update((e["indice_registro"], e) for e in entradas)
        for evento in saidas:
            inventario.pop(evento["indice_registro"], None)
        yield segundo, entradas, saidas, antes, sorted(e["item_id"] for e in inventario.values()), saida_sem_entrada


def normalizar(destino, partidas, catalogo, alto_rank, fontes):
    contagem = Counter()
    desconhecidos = Counter()
    ranks = Counter()
    ranks_individuais_paradox = Counter()
    tabelas = ("partidas", "jogadores_partida", "eventos_item", "linha_do_tempo",
               "decisoes_compra_candidatas", "decisoes_compra_alto_rank_individual", "resultados")
    with ExitStack() as pilha:
        arquivos = {n: pilha.enter_context(gzip.open(destino / f"{n}.jsonl.gz", "wt", encoding="utf-8"))
                    for n in tabelas}
        for partida in sorted(partidas.values(), key=lambda p: (p["start_time"], p["match_id"])):
            match_id = partida["match_id"]
            jogadores = partida["players"]
            if Counter(j["team"] for j in jogadores) != TIMES or len({j["player_slot"] for j in jogadores}) != 12:
                contagem["composicao_incompleta"] += 1
                continue
            alvos = [j for j in jogadores if j["hero_id"] == HEROI]
            if len(alvos) != 1:
                contagem["partidas_sem_paradox_unica"] += 1
                continue
            if partida.get("not_scored") or partida.get("winning_team") not in TIMES:
                contagem["partidas_sem_resultado_valido"] += 1
                continue

            contagem["partidas"] += 1
            ranks[str(partida.get("average_badge"))] += 1
            rank_paradox = alvos[0].get("player_rank_initial_display_rank")
            ranks_individuais_paradox[str(rank_paradox) if rank_paradox is not None else "ausente"] += 1
            alto_rank_individual = rank_paradox is not None and rank_paradox >= RANK_MINIMO
            contagem["partidas_paradox_alto_rank_individual"] += alto_rank_individual
            gravar_linha(arquivos["partidas"], {
                **{k: partida.get(k) for k in COLUNAS_PARTIDA}, "versao_inferida": VERSAO,
            })
            gravar_linha(arquivos["resultados"], {"match_id": match_id, "winning_team": partida["winning_team"]})
            for jogador in jogadores:
                slot = jogador["player_slot"]
                time = jogador["team"]
                chave = {"match_id": match_id, "player_slot": slot}
                gravar_linha(arquivos["jogadores_partida"], {
                    **chave, "hero_id": jogador["hero_id"], "team": time,
                    "player_rank_initial_display_rank": jogador.get("player_rank_initial_display_rank"),
                    "assigned_lane": jogador.get("assigned_lane"), "hero_build_id": jogador.get("hero_build_id"),
                })
                contagem["jogadores"] += 1
                eventos = list(eventos_jogador(partida, jogador, catalogo))
                contagem["jogadores_sem_registros"] += not eventos
                for evento in eventos:
                    gravar_linha(arquivos["eventos_item"], evento)
                    contagem["eventos_item"] += 1
                    if evento["tipo_catalogo"] is None:
                        desconhecidos[evento["item_id"]] += 1

                if jogador["hero_id"] != HEROI:
                    continue
                composicoes = {
                    "aliados": sorted(j["hero_id"] for j in jogadores if j["team"] == time and j is not jogador),
                    "inimigos": sorted(j["hero_id"] for j in jogadores if j["team"] != time),
                }
                ids_desconhecidos = sorted({e["item_id"] for e in eventos if e["tipo_catalogo"] is None})
                inconsistente = False
                for segundo, entradas, saidas, antes, depois, saida_sem_entrada in linha_do_tempo(eventos):
                    ordem_ambigua = len(entradas) + len(saidas) > 1
                    inconsistente |= saida_sem_entrada
                    contexto = {**chave, "game_time_s": segundo, "inventario_antes_do_segundo": antes,
                                "ordem_ambigua": ordem_ambigua, "inventario_inconsistente": inconsistente,
                                "ids_sem_catalogo_na_partida": ids_desconhecidos}
                    gravar_linha(arquivos["linha_do_tempo"], {
                        **contexto, "inventario_depois_do_segundo": depois,
                        "entradas": [e["indice_registro"] for e in entradas],
                        "saidas": [e["indice_registro"] for e in saidas],
                    })
                    contagem["instantes_linha_do_tempo"] += 1
                    for evento in entradas:
                        decisao = {
                            **contexto, **composicoes, "hero_id": HEROI, "team": time,
                            "player_rank_initial_display_rank": rank_paradox,
                            "indice_registro": evento["indice_registro"], "item_id": evento["item_id"],
                            "nome_item": evento["nome_item"], "custo_catalogo": evento["custo_catalogo"],
                            "net_worth_at_buy": evento.get("net_worth_at_buy"),
                        }
                        gravar_linha(arquivos["decisoes_compra_candidatas"], decisao)
                        if alto_rank_individual:
                            gravar_linha(arquivos["decisoes_compra_alto_rank_individual"], decisao)
                            contagem["candidatas_alto_rank_individual"] += 1
                            contagem["candidatas_alto_rank_individual_ordem_ambigua"] += ordem_ambigua
                        contagem["decisoes_compra_candidatas"] += 1
                        contagem["candidatas_com_ordem_ambigua"] += ordem_ambigua
                        contagem["candidatas_com_inventario_inconsistente"] += inconsistente
                        contagem["candidatas_com_id_sem_catalogo_na_partida"] += bool(ids_desconhecidos)

    with (destino / "uso_alto_rank.json").open("w", encoding="utf-8") as saida:
        json.dump({"min_average_badge": RANK_MEDIO_REFERENCIA, "fases_segundos": FASES,
                   "estatisticas": alto_rank}, saida, ensure_ascii=False, indent=2)
    with (destino / "auditoria.json").open("w", encoding="utf-8") as saida:
        json.dump({"versao_inferida": VERSAO, "janela_utc": [datetime.fromtimestamp(t, timezone.utc).isoformat()
                   for t in (INICIO, FIM)], "fontes": fontes, "partidas_distintas_brutas": len(partidas),
                   "contagens": contagem, "ranks_medios": ranks,
                   "rank_individual_minimo": RANK_MINIMO, "ranks_individuais_paradox": ranks_individuais_paradox,
                   "ids_sem_catalogo": desconhecidos},
                  saida, ensure_ascii=False, indent=2)
    print(dict(contagem), flush=True)


def consultas():
    for nome in ("itens", "herois"):
        recurso = {"itens": "items", "herois": "heroes"}[nome]
        yield f"catalogo-{nome}", f"/v1/assets/{recurso}?client_version={VERSAO}&language=english"
    yield "patches", "/v2/patches"
    yield "ranks", "/v1/assets/ranks"

    janela = 6 * 3600
    for inicio in range(INICIO, FIM, janela):
        params = urlencode({
            "hero_ids": HEROI, "game_mode": "normal", "match_mode": "ranked",
            "min_unix_timestamp": inicio, "max_unix_timestamp": min(inicio + janela, FIM) - 1,
            "include_player_info": "true", "include_player_items": "true",
            "order_by": "match_id", "order_direction": "asc", "limit": LIMITE,
        })
        yield f"partidas-{inicio}", f"/v1/matches/metadata?{params}"

    for fase, (minimo, maximo) in FASES.items():
        recorte = {
            "game_mode": "normal", "match_mode": "ranked", "min_unix_timestamp": INICIO,
            "max_unix_timestamp": FIM - 1, "min_average_badge": RANK_MEDIO_REFERENCIA,
        }
        params = {
            **recorte,
            "hero_ids": HEROI, "min_matches": 1, "min_bought_at_s": minimo,
        }
        if maximo is not None:
            params["max_bought_at_s"] = maximo
        yield f"alto-rank-{fase}", f"/v1/analytics/item-stats?{urlencode(params)}"
        params = urlencode({**recorte, "min_duration_s": minimo})
        yield f"populacao-alto-rank-{fase}", f"/v1/analytics/hero-stats?{params}"


def obter(bruto, nome, caminho, offline):
    arquivo = bruto / f"{nome}.json.gz"
    if arquivo.exists():
        with gzip.open(arquivo, "rt", encoding="utf-8") as entrada:
            return json.load(entrada)
    if offline:
        raise FileNotFoundError(arquivo)
    dados = buscar_json(caminho, timeout=45)
    if not isinstance(dados, list):
        raise ValueError(f"Resposta inesperada em {caminho}")
    temporario = arquivo.with_suffix(".tmp")
    with gzip.open(temporario, "wt", encoding="utf-8") as saida:
        json.dump(dados, saida, ensure_ascii=False, separators=(",", ":"))
    temporario.replace(arquivo)
    return dados


def verificar_patch(versoes, notas):
    versao_recente = max(versoes)
    notas_novas = [nota for nota in notas if nota.get("pub_date") and
                   datetime.fromisoformat(nota["pub_date"]).timestamp() >= INICIO]
    print(f"Versão da coleta: {VERSAO}. Última versão no catálogo: {versao_recente}.")
    for nota in notas_novas:
        print(f"{nota['pub_date']} | {nota['title'].strip()} | {nota['link']}")
    if versao_recente != VERSAO or notas_novas:
        print("Há atualização a revisar antes de ampliar a janela. Confirme a versão e a hora de lançamento.")
        return 1
    print("A API não listou versão posterior nem notas publicadas desde o início da coleta.")
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--saida", type=Path, default=Path("data/paradox"))
    parser.add_argument("--offline", action="store_true", help="Reprocessa os arquivos brutos locais")
    parser.add_argument("--verificar-patch", action="store_true", help="Consulta as notas e versões públicas atuais")
    args = parser.parse_args()
    if args.verificar_patch:
        if args.offline:
            parser.error("--verificar-patch requer rede")
        return verificar_patch(buscar_json("/v1/assets/client-versions"), buscar_json("/v2/patches"))
    bruto = args.saida / "bruto"
    bruto.mkdir(parents=True, exist_ok=True)
    fontes = {}
    partidas = {}
    alto_rank = {fase: {} for fase in FASES}
    catalogo = {}
    for nome, caminho in consultas():
        dados = obter(bruto, nome, caminho, args.offline)
        fontes[nome] = {"url": f"{API}{caminho}", "linhas": len(dados)}
        if nome.startswith("partidas-"):
            partidas.update((p["match_id"], p) for p in dados)
        elif nome.startswith("alto-rank-"):
            alto_rank[nome.removeprefix("alto-rank-")]["itens"] = dados
        elif nome.startswith("populacao-alto-rank-"):
            alto_rank[nome.removeprefix("populacao-alto-rank-")]["populacao_paradox"] = next(
                (linha for linha in dados if linha["hero_id"] == HEROI), None
            )
        elif nome == "catalogo-itens":
            catalogo = {item["id"]: item for item in dados}
        print(f"{nome}: {len(dados)}", flush=True)

    normalizar(args.saida, partidas, catalogo, alto_rank, fontes)


if __name__ == "__main__":
    raise SystemExit(main())
