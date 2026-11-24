"""Verifica bibliotecas Steam e arquivos do Deadlock sem alterar o jogo.

Uso: python mod/tools/verificar_ambiente.py [--jogo PASTA] [--steam PASTA]
Opcional: --sdk PASTA --saida mod/local/ambiente.json
"""
import argparse
import json
import os
import re
import shutil
from pathlib import Path


def valores_vdf(texto, chave):
    padrao = r'^\s*"' + re.escape(chave) + r'"\s*"((?:\\.|[^"\\])*)"'
    return [v.replace('\\"', '"').replace('\\\\', '\\') for v in re.findall(padrao, texto, re.MULTILINE)]


def ler(path):
    return path.read_text(encoding='utf-8-sig', errors='replace')


def steam_registro():
    if os.name != 'nt':
        return []
    import winreg
    resultado = []
    for raiz, chave, valor in (
        (winreg.HKEY_CURRENT_USER, r'Software\Valve\Steam', 'SteamPath'),
        (winreg.HKEY_LOCAL_MACHINE, r'SOFTWARE\WOW6432Node\Valve\Steam', 'InstallPath'),
    ):
        try:
            with winreg.OpenKey(raiz, chave) as entrada:
                resultado.append(Path(winreg.QueryValueEx(entrada, valor)[0]))
        except OSError:
            pass
    return resultado


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--jogo', type=Path, help='Pasta que contém game/citadel, não a pasta addons.')
    parser.add_argument('--steam', type=Path, help='Pasta principal da Steam, com steamapps/libraryfolders.vdf.')
    parser.add_argument('--sdk', type=Path, help='Pasta do SDK, caso já instalado; não baixa ou instala nada.')
    parser.add_argument('--saida', type=Path, help='Opcional: salva este relatório em JSON.')
    args = parser.parse_args()
    raizes = ([args.steam] if args.steam else steam_registro() + [
        Path(os.environ.get('ProgramFiles(x86)', 'C:/Program Files (x86)')) / 'Steam',
        Path(os.environ.get('ProgramFiles', 'C:/Program Files')) / 'Steam',
    ])
    bibliotecas = set()
    erros = []
    for raiz in raizes:
        if not raiz.is_dir():
            continue
        bibliotecas.add(raiz.resolve())
        arquivo = raiz / 'steamapps/libraryfolders.vdf'
        if arquivo.is_file():
            try:
                bibliotecas.update(Path(v).resolve() for v in valores_vdf(ler(arquivo), 'path'))
            except OSError as e:
                erros.append(f'Falha ao ler {arquivo}: {e}')
    candidatos = [args.jogo.resolve()] if args.jogo else []
    for biblioteca in sorted(bibliotecas):
        manifesto = biblioteca / 'steamapps/appmanifest_1422450.acf'
        if not manifesto.is_file():
            continue
        try:
            diretorios = valores_vdf(ler(manifesto), 'installdir')
            if len(diretorios) == 1:
                candidato = (biblioteca / 'steamapps/common' / diretorios[0]).resolve()
                if candidato not in candidatos:
                    candidatos.append(candidato)
        except OSError as e:
            erros.append(f'Falha ao ler {manifesto}: {e}')
    jogos = []
    for pasta in candidatos:
        jogos.append({'pasta': str(pasta), 'existe': pasta.is_dir(),
                      'vpk_nativo_encontrado': (pasta / 'game/citadel/pak01_dir.vpk').is_file(),
                      'gameinfo_encontrado': (pasta / 'game/citadel/gameinfo.gi').is_file()})
    relatorio = {
        'tipo': 'diagnostico-local-somente-leitura',
        'bibliotecas_steam': [str(p) for p in sorted(bibliotecas)],
        'instalacoes_candidatas': jogos,
        'arquivos_basicos_deadlock_encontrados': any(j['vpk_nativo_encontrado'] and j['gameinfo_encontrado'] for j in jogos),
        'ferramentas_no_path': {n: shutil.which(n) for n in ('git', 'node', 'python', 'resourcecompiler', 'vpk', 'modlock')},
        'sdk_informado': str(args.sdk) if args.sdk else None,
        'pasta_sdk_existe': args.sdk.is_dir() if args.sdk else None,
        'erros_leitura': erros,
        'limites': ['Arquivos presentes nao comprovam instalacao completa, ferramentas compativeis ou carregamento do mod.',
                   'O SDK nao foi executado nem validado; caminhos e comportamento do HUD dependem de teste no cliente.',
                   'Este programa nao instala, inicia, fecha ou modifica a Steam, o jogo ou o Mod Manager.'],
    }
    if args.saida:
        args.saida.parent.mkdir(parents=True, exist_ok=True)
        args.saida.write_text(json.dumps(relatorio, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(relatorio, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
