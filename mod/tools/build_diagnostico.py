"""Compila o piloto do recomendador no projeto. Nunca instala ou altera o jogo."""
import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import xml.etree.ElementTree as ET
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from verificar_ambiente import ler, valores_vdf
from exportar_modelos import exportar

MOD = Path(__file__).resolve().parents[1]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--jogo', type=Path, required=True)
    p.add_argument('--modlock', type=Path, default=MOD / 'local/tools/modlock-v0.1.85.exe')
    args = p.parse_args()
    game = args.jogo.resolve()
    exe = args.modlock.resolve()
    contract = json.loads((MOD / 'native-contract.json').read_text(encoding='utf-8'))
    if not exe.is_file() or digest(exe) != contract['modlock_sha256']:
        raise ValueError('Modlock ausente ou diferente da versão registrada no contrato.')
    def run(*command):
        return subprocess.check_output([str(exe), *map(str, command)], stderr=subprocess.PIPE)
    version = run('--version').decode('utf-8').strip()
    if version != 'modlock version ' + contract['modlock_version']:
        raise ValueError('Versão inesperada do compilador.')
    archive = game / 'game/citadel/pak01_dir.vpk'
    gameinfo = game / 'game/citadel/gameinfo.gi'
    manifest = game.parents[1] / 'appmanifest_1422450.acf'
    builds = valores_vdf(ler(manifest), 'buildid')
    if builds != [contract['steam_build_id']]:
        raise ValueError('A versão Steam mudou. Reinspecionar os layouts e revisar o contrato antes de compilar.')
    before = {'native_vpk_directory_sha256': digest(archive), 'gameinfo_sha256': digest(gameinfo)}
    native = run('panorama', 'decompile', '--archive', archive, contract['native_layout'])
    if hashlib.sha256(native).hexdigest() != contract['base_hud_decompiled_sha256']:
        raise ValueError('Layout nativo mudou; não foi gerado um override desatualizado.')
    root = ET.fromstring(native)
    host = root.find('Panel')
    if root.tag != 'root' or host is None or len(host) != 1 or host[0].tag != 'CitadelHud' or host[0].get('id') != 'Hud':
        raise ValueError('Estrutura nativa inesperada; interrompido antes de criar o pacote.')
    styles = root.find('styles')
    if styles is None:
        raise ValueError('Layout sem bloco de estilos.')
    ET.SubElement(styles, 'include', src='s2r://panorama/styles/deadpick_diagnostics.vcss_c')
    scripts = ET.Element('scripts')
    for name in ('deadpick_data', 'deadpick_motor', 'deadpick_runtime'):
        ET.SubElement(scripts, 'include', src=f's2r://panorama/scripts/{name}.vjs_c')
    root.insert(list(root).index(host), scripts)
    host.append(ET.fromstring((MOD / 'src/panel.xml').read_text(encoding='utf-8')))

    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    output = MOD / 'build' / f'diagnostico-{contract["steam_build_id"]}-{stamp}'
    source = output / 'content'
    source.parent.mkdir(parents=True, exist_ok=False)
    shutil.copytree(MOD / 'src/panorama', source / 'panorama')
    modelos = exportar(source, run, archive)
    layout = source / 'panorama/layout/base_hud.xml'
    layout.parent.mkdir(parents=True)
    ET.indent(root)
    ET.ElementTree(root).write(layout, encoding='utf-8', xml_declaration=False)
    vpk = output / 'deadpick_diagnostico_dir.vpk'
    log = run('panorama', 'compile', source, '--addon', 'deadpick_diagnostico', '--output', vpk)
    (output / 'compiler.log').write_bytes(log)
    listing = run('vpk', 'list', vpk).decode('utf-8')
    (output / 'conteudo-vpk.txt').write_text(listing, encoding='utf-8')
    expected = ['panorama/layout/base_hud.vxml_c', 'panorama/scripts/deadpick_runtime.vjs_c',
                'panorama/styles/deadpick_diagnostics.vcss_c', 'panorama/scripts/deadpick_data.vjs_c',
                'panorama/scripts/deadpick_motor.vjs_c']
    if any(name not in listing for name in expected):
        raise ValueError('O VPK não contém todos os recursos esperados.')
    # Reabre o recurso compilado para conferir a preservação do HUD nativo.
    compiled_xml = run('panorama', 'decompile', '--archive', vpk, expected[0])
    compiled = ET.fromstring(compiled_xml)
    if len(compiled.findall(".//CitadelHud[@id='Hud']")) != 1 or len(compiled.findall(".//Panel[@id='DeadpickDiagnostics']")) != 1:
        raise ValueError('Layout compilado perdeu ou duplicou o HUD/painel.')
    (output / 'base_hud-reaberto.xml').write_bytes(compiled_xml)
    after = {'native_vpk_directory_sha256': digest(archive), 'gameinfo_sha256': digest(gameinfo)}
    if after != before:
        raise ValueError('Os arquivos monitorados do jogo mudaram durante o build; revisar antes de instalar.')
    pacote = output / f'deadpick-recomendador-v{contract["mod_version"]}.zip'
    with zipfile.ZipFile(pacote, 'w', compression=zipfile.ZIP_DEFLATED) as z:
        z.write(vpk, vpk.name)
    report = {'steam_build_id': contract['steam_build_id'], 'mod_version': contract['mod_version'],
              'modelos': modelos, 'modlock': version, 'modlock_sha256': digest(exe),
              'vpk_sha256': digest(vpk), 'zip_sha256': digest(pacote), 'arquivos_monitorados_do_jogo_inalterados': before == after,
              'native_hashes': before, 'recursos_esperados': expected,
              'validacao': 'compilado, listado e layout reaberto; ainda não testado no cliente',
              'vpk': str(vpk), 'zip': str(pacote)}
    (output / 'relatorio-build.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, ET.ParseError, subprocess.CalledProcessError) as error:
        print(f'Build interrompido: {error}', file=sys.stderr)
        if isinstance(error, subprocess.CalledProcessError) and error.stderr:
            print(error.stderr.decode('utf-8', errors='replace'), file=sys.stderr)
        raise SystemExit(1)
