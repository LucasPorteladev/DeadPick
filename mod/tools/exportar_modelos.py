"""Exporta os mesmos modelos do HTML e associa imagens/classes ao pacote nativo."""
import gzip
import hashlib
import json
import re
from pathlib import Path
from urllib.parse import urlparse

REPO = Path(__file__).resolve().parents[2]


def imagem_key(value):
    path = value.replace('\\', '/').lower()
    if 'images/' not in path:
        return None
    path = path[path.index('images/'):]
    return re.sub(r'(?:_psd\.vtex(?:_c)?|\.psd|\.png|\.webp)$', '', path)


def exportar(destino, run, archive):
    raw = (REPO / 'simulador/dados.js').read_text(encoding='utf-8')
    dados = json.loads(raw.split('const DADOS = ', 1)[1].strip().removesuffix(';'))
    if dados.get('ameacas') and dados['ameacas']['balanceVersion'] != dados['versao']:
        raise ValueError('Modelo defensivo incompatível com a versão do catálogo.')
    with gzip.open(REPO / 'data/deadlock-api/bruto/catalogo-herois.json.gz', 'rt', encoding='utf-8') as f:
        heroes = json.load(f)
    with gzip.open(REPO / 'data/deadlock-api/bruto/catalogo-itens.json.gz', 'rt', encoding='utf-8') as f:
        items = json.load(f)
    listing = run('vpk', 'list', archive).decode('utf-8')
    resources = {line.split()[-1] for line in listing.splitlines() if line.strip()}
    native_heroes = json.loads(run('kv3', '--archive', archive, 'scripts/heroes.vdata_c'))
    native_abilities = json.loads(run('kv3', '--archive', archive, 'scripts/abilities.vdata_c'))
    heroes_by_id = {v['m_HeroID']: (k, v) for k, v in native_heroes.items() if isinstance(v, dict) and 'm_HeroID' in v}
    def native_image(path):
        resource = 'panorama/' + path + '_psd.vtex_c'
        return 's2r://' + resource.removesuffix('_c') if resource in resources else None
    def native_reference(value):
        if not value or '{images}/' not in value:
            return None
        name = value.split('{images}/', 1)[1]
        resource = 'panorama/images/' + re.sub(r'\.(psd|png)$', lambda m: '_' + m[1] + '.vtex_c', name)
        return 's2r://' + resource.removesuffix('_c') if resource in resources else None
    herois = []
    for h in heroes:
        if h['name'] not in dados['modelos']:
            continue
        if h['id'] not in heroes_by_id:
            raise ValueError(f"Herói {h['name']} não está no catálogo nativo atual; revisar o modelo.")
        native_class, native = heroes_by_id[h['id']]
        portrait = native_reference(native.get('m_strIconImageSmall')) or native_reference(native.get('m_strIconHeroCard'))
        if not portrait:
            raise ValueError(f"Retrato nativo não resolvido para {h['name']}.")
        skills = [v for k, v in native.get('m_mapBoundAbilities', {}).items() if k.startswith('ESlot_Signature_')]
        herois.append({'id': h['id'], 'nome': h['name'], 'classe': native_class, 'imagem': portrait,
                       'habilidades': skills})
    por_id = {str(i['id']): i for i in items}
    catalogo = {}
    registry = []
    for item_id, i in dados['itens'].items():
        original = por_id[item_id]
        native = native_abilities.get(original['class_name'], {})
        native_class = native.get('m_strCSSClass')
        modern = imagem_key(urlparse(original.get('shop_image') or original.get('shop_image_webp') or '').path)
        legacy = imagem_key(urlparse(original.get('image') or original.get('image_webp') or '').path)
        catalogo[item_id] = {**i, 'imagem': native_image(modern) if modern else None,
                             'idNativo': int(item_id), 'classeNativa': original['class_name']}
        registry.append({'nome': i['nome'], 'tier': i['tier'], 'tipo': original['item_slot_type'],
                         'classeNativa': original['class_name'],
                         'ativo': native.get('m_eAbilityActivation', '') != 'CITADEL_ABILITY_ACTIVATION_PASSIVE'
                         if native.get('m_eAbilityActivation') else None,
                         'imagens': sorted({k for k in (modern, legacy) if k}),
                         # Imagens antigas são compartilhadas entre itens diferentes.
                         # A identidade vem da definição do item, não do seletor visual.
                         'classes': [native_class] if native_class else []})
    imbuimentos = dados.get('imbuimentos')
    if imbuimentos:
        if imbuimentos['balanceVersion'] != dados['versao']:
            raise ValueError('Recorte de imbuimento diferente do catálogo.')
        required = {str(i['id']) for i in items if i.get('shopable') and i['type'] == 'upgrade' and
                    'IMBUE' in native_abilities.get(i['class_name'], {}).get('m_TargetAbilityEffectsToApply', '')}
        if required != set(imbuimentos['itensImbuiveis']):
            raise ValueError('Lista de itens imbuíveis diverge do campo nativo; recalcular antes de compilar.')
        for h in imbuimentos['herois'].values():
            native = heroes_by_id[h['heroId']][1]
            for choice in h['itens'].values():
                expected = native.get('m_mapBoundAbilities', {}).get('ESlot_Signature_'+str(choice['slot']))
                if expected != choice['classe']:
                    raise ValueError('Habilidade histórica não corresponde ao slot nativo: '+choice['classe'])
                choice['imagem'] = native_reference(native_abilities[choice['classe']].get('m_strAbilityImage'))
    pacote = {'versao': dados['versao'], 'modelos': dados['modelos'], 'itens': catalogo, 'ameacas': dados.get('ameacas'),
              'imbuimentos': imbuimentos,
              'herois': herois, 'registroInventario': registry,
              'contratoInventario': {'slotsTotais': 12}}
    collisions = {}
    for item in registry:
        for css_class in item['classes']:
            collisions.setdefault((item['tier'], item['tipo'], css_class), []).append(item)
    audit = [{'classe': key[2], 'itens': [i['nome'] for i in group],
              'resolvido_por_ativacao': len({i['ativo'] for i in group}) == len(group) and
              all(i['ativo'] is not None for i in group)}
             for key, group in collisions.items() if len(group) > 1]
    output = destino / 'panorama/scripts'
    output.mkdir(parents=True, exist_ok=True)
    (output / 'deadpick_data.js').write_text('var DeadpickData = ' + json.dumps(pacote, ensure_ascii=False, separators=(',', ':')) + ';\n', encoding='utf-8')
    shutil_source = REPO / 'simulador/motor.js'
    (output / 'deadpick_motor.js').write_bytes(shutil_source.read_bytes())
    return {'herois': len(herois), 'modelos': len(dados['modelos']),
            'indicacoes_imbuimento': sum(len(h['itens']) for h in (imbuimentos or {}).get('herois', {}).values()),
            'icones_imbuimento': sum(bool(i.get('imagem')) for h in (imbuimentos or {}).get('herois', {}).values() for i in h['itens'].values()),
            'defesas_contextuais_ativas': sum(i['contextoValidado'] for i in (dados.get('ameacas') or {}).get('itens', [])),
            'retratos_nativos': sum(h['imagem'] is not None for h in herois),
            'imagens_itens_disponiveis': sum(i['imagem'] is not None for i in catalogo.values()),
            'classes_inventario_mapeadas': sum(bool(i['classes']) for i in registry),
            'colisoes_classes_inventario': audit,
            'motor_sha256': hashlib.sha256(shutil_source.read_bytes()).hexdigest(),
            'dados_sha256': hashlib.sha256((REPO / 'simulador/dados.js').read_bytes()).hexdigest()}
