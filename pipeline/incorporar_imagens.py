"""Incorpora os ícones locais ao catálogo JavaScript sem alterar o modelo."""
import base64
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def main():
    source = ROOT/'simulador/dados.js'
    text = source.read_text(encoding='utf-8')
    data = json.loads(text.split('const DADOS = ',1)[1].strip().removesuffix(';'))
    images = {}
    def replace(value):
        if isinstance(value,dict): return {k:replace(v) for k,v in value.items()}
        if isinstance(value,list): return [replace(v) for v in value]
        if isinstance(value,str) and value.startswith('imagens/'):
            if value not in images:
                p = (ROOT/'simulador'/value).resolve(strict=True)
                if not p.is_relative_to((ROOT/'simulador/imagens').resolve()):
                    raise ValueError('Imagem fora da pasta esperada.')
                binary=p.read_bytes()
                if binary[:4]!=b'RIFF' or binary[8:12]!=b'WEBP':
                    raise ValueError('Imagem WEBP inválida: '+value)
                images[value]='data:image/webp;base64,'+base64.b64encode(binary).decode('ascii')
            return images[value]
        return value
    result=replace(data)
    if images:
        source.write_text('const DADOS = '+json.dumps(result,ensure_ascii=False,separators=(',',':'))+';\n',encoding='utf-8')
    print(f'{len(images)} imagens incorporadas; os demais dados foram preservados.')

if __name__=='__main__': main()
