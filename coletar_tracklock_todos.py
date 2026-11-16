"""Coleta snapshots públicos e normaliza itens/probuild/build dos heróis do catálogo."""
import argparse
import gzip
import hashlib
import json
import re
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

from bs4 import BeautifulSoup
from extrair_tracklock import build, compras_profissionais, tabela_itens

ROOT = Path('data/tracklock-todos')

def catalogo(tipo):
    with gzip.open(f'data/paradox/bruto/catalogo-{tipo}.json.gz', 'rt', encoding='utf-8') as f:
        return json.load(f)

def baixar(slug, secao, atualizar=False):
    path = ROOT / 'bruto' / f'{slug}-{secao}.html'
    url = f'https://prod.tracklock.gg/heroes/{slug}/{secao}'
    if atualizar or not path.exists():
        conteudo = subprocess.check_output(['curl.exe', '-fsSL', '--retry', '2', '--retry-delay', '2', '--max-time', '40', url])
        if b'<html' not in conteudo.lower():
            raise ValueError(f'Resposta sem HTML: {url}')
        path.write_bytes(conteudo)
        time.sleep(.4)
    data = path.read_bytes()
    origem = dict(url=url, snapshot=str(path), sha256=hashlib.sha256(data).hexdigest(),
                  captura_utc=datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat())
    return BeautifulSoup(data, 'html.parser'), origem

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--atualizar', action='store_true')
    args = parser.parse_args()
    (ROOT / 'bruto').mkdir(parents=True, exist_ok=True)
    indice_path = ROOT / 'bruto/heroes.html'
    if args.atualizar or not indice_path.exists():
        indice_path.write_bytes(subprocess.check_output(['curl.exe', '-fsSL', '--retry', '2', '--max-time', '40',
                                                        'https://prod.tracklock.gg/heroes']))
    indice = BeautifulSoup(indice_path.read_bytes(), 'html.parser')
    slugs = {a['href'].split('/')[2] for a in indice.select('a[href]') if re.fullmatch(r'/heroes/[^/]+/probuild', a['href'])}
    itens = {x['name']: x['id'] for x in catalogo('itens') if x.get('shopable') and x['type'] == 'upgrade'}
    herois = [x for x in catalogo('herois') if x['player_selectable'] and not x['disabled']]
    def mapear(x):
        return {**x, 'item_id': itens.get(x['nome_item'])}
    def coletar(heroi):
        slug = heroi['name'].lower().replace(' & ', '-and-').replace(' ', '-')
        if slug not in slugs:
            return {'hero_id': heroi['id'], 'nome': heroi['name'], 'erro': 'Heroi ausente no indice Tracklock'}
        resultado = {'hero_id': heroi['id'], 'nome': heroi['name'], 'slug': slug, 'erros': []}
        for secao in ('items', 'probuild', 'build'):
            try:
                html, origem = baixar(slug, secao, args.atualizar)
                if secao == 'items':
                    conteudo = {'rank': 'nao verificado; pagina padrao', 'janela': 'nao verificada',
                                'itens': [mapear(x) for x in tabela_itens(html)]}
                elif secao == 'probuild':
                    conteudo = compras_profissionais(html)
                    conteudo['rank'] = 'jogadores classificados como pro pelo Tracklock; nao equivale a filtro Phantom+'
                    conteudo['fases'] = {k: [mapear(x) for x in v] for k,v in conteudo['fases'].items()}
                else:
                    conteudo = {'variante': 'padrao', 'secoes': {k: [mapear({'nome_item': n}) for n in v] for k,v in build(html).items()}}
                resultado[secao] = {**origem, **conteudo}
            except Exception as e:
                resultado['erros'].append({'secao': secao, 'erro': str(e)})
        (ROOT / f'{slug}.json').write_text(json.dumps(resultado, ensure_ascii=False, indent=2), encoding='utf-8')
        print(f"{heroi['name']}: {len(resultado.get('items', {}).get('itens', []))} itens; erros={len(resultado['erros'])}", flush=True)
        return resultado
    with ThreadPoolExecutor(max_workers=2) as pool:
        resultados = list(pool.map(coletar, herois))
    saida = {'gerado_utc': datetime.now(timezone.utc).isoformat(), 'herois': resultados}
    (ROOT / 'extracao.json').write_text(json.dumps(saida, ensure_ascii=False, indent=2), encoding='utf-8')
    if any(x.get('erros') or x.get('erro') for x in resultados):
        raise SystemExit('Extracao parcial: conferir erros em extracao.json')

if __name__ == '__main__':
    main()
