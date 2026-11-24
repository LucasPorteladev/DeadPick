"""Interpreta as tabelas e builds dos snapshots HTML do Tracklock."""

SECOES = ("Core Build", "Early", "Late", "Defensives", "Counter Picks", "Actives")


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
