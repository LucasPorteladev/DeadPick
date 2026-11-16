"""Preserva o simulador HTML e a coleta completa em pacotes verificáveis."""
import argparse
import hashlib
import importlib.metadata
import json
import shutil
import zipfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent

GITIGNORE = '''__pycache__/
*.py[cod]
.venv/
venv/
node_modules/
entregas/
*.log
.env
.env.*
/data/*
!/data/tracklock-todos/
!/data/paradox/
!/data/base-ampliada-6860/
/data/tracklock-todos/bruto/
/data/base-ampliada-6860/*
!/data/base-ampliada-6860/auditoria.json
!/data/base-ampliada-6860/qualidade.json
!/data/base-ampliada-6860/cobertura.csv
/data/paradox/bruto/*
!/data/paradox/bruto/catalogo-*.json.gz
'''

def sha(path):
    with path.open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()

def info(path, relativo):
    return {'caminho': relativo, 'bytes': path.stat().st_size, 'sha256': sha(path)}

def escrever_json(path, dados):
    path.write_text(json.dumps(dados, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

def adicionar_zip(z, path, nome):
    compressao = zipfile.ZIP_STORED if path.suffix in ('.gz', '.webp') else zipfile.ZIP_DEFLATED
    z.write(path, nome, compress_type=compressao, compresslevel=6)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rotulo', default='2026-11-16')
    rotulo = parser.parse_args().rotulo
    if not rotulo or any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_' for c in rotulo):
        raise SystemExit('Rotulo deve conter somente letras, numeros, hifen ou sublinhado.')
    destino = ROOT / 'entregas'
    destino.mkdir(exist_ok=True)
    pasta = destino / f'deadpick-html-{rotulo}'
    zip_html = destino / f'deadpick-html-{rotulo}.zip'
    zip_dados = destino / f'deadpick-dados-completos-{rotulo}.zip'
    relatorio_path = destino / f'verificacao-{rotulo}.json'
    if any(p.exists() for p in (pasta, zip_html, zip_dados, relatorio_path)):
        raise SystemExit('Entrega existente: use outro --rotulo para preservar o snapshot anterior.')

    arquivos = set(ROOT.glob('*.py')) | set(ROOT.glob('*.md')) | set(ROOT.glob('*.cjs'))
    arquivos |= {p for p in (ROOT / 'simulador').rglob('*') if p.is_file()}
    arquivos |= {p for p in (ROOT / 'data/tracklock-todos').glob('*') if p.is_file()}
    arquivos |= {p for p in (ROOT / 'data/paradox').glob('*') if p.is_file()}
    arquivos |= set((ROOT / 'data/paradox/bruto').glob('catalogo-*.json.gz'))
    arquivos |= {ROOT / 'data/base-ampliada-6860' / n for n in ('auditoria.json', 'qualidade.json', 'cobertura.csv')}
    pasta.mkdir()
    for p in sorted(arquivos):
        alvo = pasta / p.relative_to(ROOT)
        alvo.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(p, alvo)
    (pasta / '.gitignore').write_text(GITIGNORE, encoding='utf-8')
    (pasta / '.gitattributes').write_text('* text=auto\n*.webp binary\n*.gz binary\n', encoding='utf-8')
    versoes = {n: importlib.metadata.version(n) for n in ('beautifulsoup4', 'numpy', 'scikit-learn', 'threadpoolctl')}
    (pasta / 'requirements-analise.txt').write_text(''.join(f'{n}=={v}\n' for n,v in versoes.items()), encoding='utf-8')
    readme = pasta / 'README.md'
    readme.write_text('> **Versão HTML preservada.** Comece por [PRESERVACAO_HTML.md](PRESERVACAO_HTML.md) para executar, testar, restaurar a coleta e organizar as branches. O simulador funciona com os dados locais incluídos.\n\n' + readme.read_text(encoding='utf-8'), encoding='utf-8')

    agora = datetime.now(timezone.utc).isoformat()
    manifesto = {'rotulo': rotulo, 'gerado_utc': agora, 'tipo': 'baseline-html',
                 'herois': 44, 'imagens_locais': len(list((pasta / 'simulador/imagens').glob('*.webp'))),
                 'dependencias_analise': versoes,
                 'backup_dados': zip_dados.name,
                 'arquivos': [info(p, p.relative_to(pasta).as_posix()) for p in sorted(pasta.rglob('*')) if p.is_file()]}
    escrever_json(pasta / 'MANIFESTO_HTML.json', manifesto)
    with zipfile.ZipFile(zip_html, 'w') as z:
        for p in sorted(pasta.rglob('*')):
            if p.is_file():
                adicionar_zip(z, p, f'{pasta.name}/{p.relative_to(pasta).as_posix()}')
    print(f'Projeto preservado: {zip_html.name}', flush=True)

    dados = sorted(p for n in ('amostra', 'paradox', 'base-ampliada-6860', 'tracklock-todos')
                   for p in (ROOT / 'data' / n).rglob('*') if p.is_file())
    manifesto_dados = {'rotulo': rotulo, 'gerado_utc': agora, 'tipo': 'coleta-completa',
                       'arquivos': [info(p, p.relative_to(ROOT).as_posix()) for p in dados]}
    with zipfile.ZipFile(zip_dados, 'w') as z:
        for p in dados:
            adicionar_zip(z, p, p.relative_to(ROOT).as_posix())
        z.writestr('MANIFESTO_DADOS.json', json.dumps(manifesto_dados, ensure_ascii=False, indent=2), compress_type=zipfile.ZIP_DEFLATED)
    print(f'Coleta preservada: {zip_dados.name}', flush=True)

    for zip_path in (zip_html, zip_dados):
        with zipfile.ZipFile(zip_path) as z:
            erro = z.testzip()
            if erro:
                raise ValueError(f'Falha de CRC em {zip_path.name}: {erro}')
    # Confere os hashes de todos os membros, além do CRC dos dois arquivos.
    with zipfile.ZipFile(zip_html) as z:
        for f in manifesto['arquivos']:
            if hashlib.sha256(z.read(f"{pasta.name}/{f['caminho']}")).hexdigest() != f['sha256']:
                raise ValueError(f"Hash do projeto diverge: {f['caminho']}")
    with zipfile.ZipFile(zip_dados) as z:
        for f in manifesto_dados['arquivos']:
            with z.open(f['caminho']) as entrada:
                digest = hashlib.file_digest(entrada, 'sha256').hexdigest()
            if digest != f['sha256']:
                raise ValueError(f"Hash da coleta diverge: {f['caminho']}")
    relatorio = {'rotulo': rotulo, 'gerado_utc': agora, 'integridade': 'CRC e SHA-256 de todos os membros conferidos',
                 'projeto_arquivos': len(manifesto['arquivos']) + 1, 'coleta_arquivos': len(dados),
                 'originais_preservados': True,
                 'zips': [info(p, p.name) for p in (zip_html, zip_dados)]}
    escrever_json(relatorio_path, relatorio)
    print(json.dumps(relatorio, ensure_ascii=False, indent=2), flush=True)

if __name__ == '__main__':
    main()
