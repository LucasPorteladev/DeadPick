"""Extrai as tabelas e builds da Paradox dos snapshots HTML do Tracklock."""

import argparse
import gzip
import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from bs4 import BeautifulSoup


BASE = "https://prod.tracklock.gg/heroes/paradox"
SECOES = ("Core Build", "Early", "Late", "Defensives", "Counter Picks", "Actives")


def pagina(bruto, arquivo, url):
    caminho = bruto / arquivo
    origem = {
        "url": f"{BASE}/{url}", "snapshot": arquivo,
        "captura_utc": datetime.fromtimestamp(caminho.stat().st_mtime, timezone.utc).isoformat(),
    }
    return BeautifulSoup(caminho.read_text(encoding="utf-8"), "html.parser"), origem


def build(html):
    grupos = {}
    for secao in SECOES:
        titulo = html.find("span", string=secao)
        if titulo:
            grupos[secao] = [i["alt"] for i in titulo.parent.parent.find_all("img", alt=True)]
    if not grupos.get("Core Build"):
        raise ValueError("A build do Tracklock nao trouxe a secao Core Build")
    return grupos


def compras_profissionais(html):
    fases = {}
    for fase in ("Early Game", "Mid Game", "Late Game"):
        titulo = html.find(string=fase)
        if not titulo:
            raise ValueError(f"A pagina de Pro Builds nao trouxe a fase {fase}")
        itens = []
        for imagem in titulo.parent.parent.find_all("img", alt=True):
            percentual = imagem.parent.parent.find_all("span")[-1].get_text(strip=True)
            itens.append({"nome_item": imagem["alt"], "uso_percentual": float(percentual.rstrip("%"))})
        fases[fase] = itens
    return {
        "janela_dias": 30, "patch_isolado": False,
        "partidas_totais_exibidas": int(html.find("span", string="Games").find_next_sibling().get_text(strip=True)),
        "fases": fases,
    }


def tabela_itens(html):
    itens = []
    for linha in html.select("table tbody tr"):
        colunas = linha.find_all("td")
        if len(colunas) != 7:
            raise ValueError("Formato inesperado na tabela de itens do Tracklock")
        valores = [list(coluna.stripped_strings) for coluna in colunas]
        itens.append({
            "nome_item": colunas[0].find("img")["alt"], "custo_exibido": valores[1][0],
            "winrate_percentual": float(valores[2][0].rstrip("%")),
            "uso_percentual": float(valores[4][0].rstrip("%")),
            "vitorias_e_derrotas_exibidas": " ".join(valores[6]),
        })
    if not itens:
        raise ValueError("A tabela de itens do Tracklock esta vazia")
    return itens


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--saida", type=Path, default=Path("data/paradox"))
    destino = parser.parse_args().saida
    bruto = destino / "bruto"
    ids_por_nome = defaultdict(list)
    with gzip.open(bruto / "catalogo-itens.json.gz", "rt", encoding="utf-8") as entrada:
        for item in json.load(entrada):
            if item.get("shopable") is True and item.get("type") == "upgrade":
                ids_por_nome[item["name"]].append(item["id"])

    def mapear(item):
        ids = ids_por_nome[item["nome_item"]]
        return {**item, "item_id": ids[0] if len(ids) == 1 else None}

    html, origem = pagina(bruto, "tracklock-probuild.html", "probuild")
    pro = compras_profissionais(html)
    pro["fases"] = {fase: [mapear(item) for item in itens] for fase, itens in pro["fases"].items()}
    html, origem_itens = pagina(bruto, "tracklock-itens-prod.html", "items")
    builds = []
    for arquivo, url, variante in (("tracklock-build.html", "build", 1), ("tracklock-build-2.html", "build?build=2", 2)):
        html_build, origem_build = pagina(bruto, arquivo, url)
        rotulo = html_build.select_one(f'a[href$="?build={variante}"]')
        builds.append({**origem_build, "variante": variante, "rotulo": rotulo.get_text(" ", strip=True),
                       "secoes": {secao: [mapear({"nome_item": nome}) for nome in nomes]
                                  for secao, nomes in build(html_build).items()}})

    dados = {"hero_id": 10, "pro_builds": {**origem, **pro}, "builds": builds,
             "tabela_itens": {**origem_itens, "recorte": "pagina padrao, sem filtro de rank aplicado",
                              "itens": [mapear(item) for item in tabela_itens(html)]}}
    with (destino / "tracklock.json").open("w", encoding="utf-8") as saida:
        json.dump(dados, saida, ensure_ascii=False, indent=2)
    print(f"Tracklock: {len(dados['tabela_itens']['itens'])} itens, {len(builds)} builds e 3 fases pro")


if __name__ == "__main__":
    main()
