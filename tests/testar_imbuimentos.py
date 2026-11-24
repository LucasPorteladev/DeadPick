import gzip
import json
import tempfile
import unittest
from collections import Counter
from pathlib import Path

from pipeline.calcular_imbuimentos import calcular, escolher


class TestImbuimentos(unittest.TestCase):
    def test_imbued_e_campo_nativo_nao_dependem_da_palavra_imbue(self):
        items=[dict(id=99,type='ability',class_name='skill',name='Habilidade'),
               dict(id=10,type='upgrade',class_name='upgrade_mercurial',name='Mercurial',shopable=True,
                    description={'desc':'Your imbued ability charges up over time.'})]
        heroes=[dict(id=1,name='Heroi',player_selectable=True,items={'signature1':'skill'})]
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp)
            records={'jogadores':[dict(match_id=1,player_slot=0,hero_id=1,player_rank_initial_display_rank=91)],
                     'eventos':[dict(match_id=1,player_slot=0,hero_id=1,item_id=10,imbued_ability_id=99,
                                     game_time_s=100,indice_registro=0,item_de_loja=True)]}
            for name,rs in records.items():
                with gzip.open(p/(name+'.jsonl.gz'),'wt',encoding='utf-8') as f:
                    for r in rs:f.write(json.dumps(r)+'\n')
            self.assertIn('Mercurial',calcular(p,items,heroes)['herois']['Heroi']['itens'])
            items[1]['description']={'desc':'Texto sem termo em inglês'}
            native={'classes':{'upgrade_mercurial':'CITADEL_TARGET_ABILITY_BEHAVIOR_IMBUE_ACTIVE'}}
            self.assertIn('Mercurial',calcular(p,items,heroes,native)['herois']['Heroi']['itens'])

    def test_pluralidade_amostra_unica_e_empate(self):
        skills = {99: {'slot': 1}, 2: {'slot': 2}, 3: {'slot': 3}, 4: {'slot': 4}}
        choice = escolher(Counter({99: 4, 2: 3, 3: 3, 4: 2}), skills)
        self.assertEqual(choice['slot'], 1)
        self.assertAlmostEqual(choice['pickrate'], 1/3)
        self.assertEqual(escolher(Counter({2: 1}), skills)['slot'], 2)
        self.assertEqual(escolher(Counter({2: 5, 99: 5}), skills)['slot'], 1)
        self.assertIsNone(escolher(Counter(), skills))

    def test_filtra_origem_e_nao_pesa_duplicatas(self):
        items = [dict(id=99, type='ability', class_name='skill1', name='Primeira'),
                 dict(id=2, type='ability', class_name='skill2', name='Segunda'),
                 dict(id=3, type='ability', class_name='outra', name='Outro heroi'),
                 dict(id=10, type='upgrade', shopable=True, name='Imbuivel', description={'desc':'Imbue an ability'}),
                 dict(id=11, type='upgrade', shopable=True, name='Normal', description={'desc':'Gain spirit'})]
        heroes = [dict(id=1, name='Heroi', player_selectable=True, items={'signature1':'skill1','signature2':'skill2'})]
        players = [dict(match_id=i, player_slot=0, hero_id=1, player_rank_initial_display_rank=91 if i!=3 else 90) for i in range(1,5)]
        def event(match, item, ability, t=100, index=0):
            return dict(match_id=match, player_slot=0, hero_id=1, item_id=item, imbued_ability_id=ability,
                        game_time_s=t, indice_registro=index, item_de_loja=True)
        events = [event(1,10,99),event(1,10,2,200,1),event(2,10,2),event(3,10,2),
                  event(4,11,99),event(4,10,0),event(4,10,3),event(4,10,999),event(4,10,99,-1)]
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp)
            for name, records in [('jogadores',players),('eventos',events)]:
                with gzip.open(p/(name+'.jsonl.gz'),'wt',encoding='utf-8') as f:
                    for r in records:f.write(json.dumps(r)+'\n')
            result=calcular(p,items,heroes)
        choice=result['herois']['Heroi']['itens']['Imbuivel']
        self.assertEqual(choice['amostras'],2)
        self.assertEqual(choice['slot'],1)
        self.assertEqual(choice['pickrate'],.5)
        self.assertNotIn('Normal', result['herois']['Heroi']['itens'])
        self.assertEqual(result['auditoria']['habilidade_fora_assinaturas_heroi'],1)

    def test_artefato_sempre_escolhe_maximo_sem_limites_de_suporte(self):
        d=json.loads(Path('simulador/imbuimentos.json').read_text(encoding='utf-8'))
        choices=[v for h in d['herois'].values() for v in h['itens'].values()]
        self.assertEqual(len(d['herois']),44)
        self.assertEqual(len(choices),348)
        merc=d['herois']['Vindicta']['itens']['Mercurial Magnum']
        self.assertEqual(merc['slot'],3)
        self.assertEqual(merc['amostras'],576)
        self.assertEqual(len(d['itensImbuiveis']),11)
        for c in choices:
            self.assertEqual(c['escolhas'],max(x['escolhas'] for x in c['distribuicao']))
            self.assertEqual(c['amostras'],sum(x['escolhas'] for x in c['distribuicao']))
            self.assertAlmostEqual(c['pickrate'],c['escolhas']/c['amostras'])
        self.assertEqual(min(c['amostras'] for c in choices),1)
        self.assertLess(min(c['pickrate'] for c in choices),.5)


if __name__ == '__main__':
    unittest.main()
