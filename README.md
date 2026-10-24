# Cofre de Beats

Site para guardar e mostrar instrumentais de rap: capas, BPM, tom, tags, ordenação e player de áudio.
É um site estático (HTML, CSS e JavaScript puros), publicado pelo GitHub Pages.

## Como adicionar um beat

1. Suba o arquivo de áudio em `beats/audio/` (MP3 é o mais leve; o GitHub aceita arquivos de até 100 MB, e pelo navegador até 25 MB).
2. Suba a foto de capa em `beats/capas/` (JPG, PNG ou WebP, de preferência quadrada).
3. Adicione uma entrada no `beats.json`:

```json
{
  "name": "Nome do beat",
  "bpm": 90,
  "key": "Lá menor",
  "date": "2026-10-24",
  "tags": ["boom bap", "sample"],
  "cover": "beats/capas/nome-do-beat.jpg",
  "audio": "beats/audio/nome-do-beat.mp3"
}
```

Só `name` é obrigatório. Sem `cover`, o site gera uma capa colorida com o nome. Sem `audio`, o botão de tocar fica desativado.
A duração aparece sozinha quando o beat toca; se quiser que apareça antes, adicione `"duration": 185` (em segundos).

Dica: use nomes de arquivo sem espaço nem acento (`madrugada-zona-leste.mp3`).

Os três beats marcados com `"example": true` são exemplos e podem ser apagados.

## Testar no computador

Abra um servidor local na pasta (o `beats.json` não carrega abrindo o arquivo direto):

```sh
python3 -m http.server
```

e acesse http://localhost:8000.
