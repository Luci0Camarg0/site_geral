# Terra Fértil

Site para guardar e mostrar instrumentais de rap e PDFs (letras, contratos, fichas): pastas, capas, BPM, tom, tags, ordenação, player de áudio e botão de download.
É um site estático (HTML, CSS e JavaScript puros), publicado pelo GitHub Pages.

## Adicionar pelo próprio site (modo editor)

1. Clique em **Modo editor** no topo do site.
2. Crie um token em https://github.com/settings/personal-access-tokens/new:
   - **Repository access**: Only select repositories → `site_geral`
   - **Permissions** → **Contents**: Read and write
3. Cole o token no site. Ele fica salvo só naquele navegador.

No modo editor você pode:
- **Adicionar** um beat (MP3, WAV, M4A…) ou um PDF, com capa, BPM, tom, tags e pasta. Limite de 45 MB por arquivo.
- **Criar, renomear e apagar pastas.** Apagar uma pasta não apaga os itens, eles vão para "Sem pasta".
- **Arrastar** um item até uma pasta para mover. No celular, use Editar e escolha a pasta.
- **Editar ou apagar** qualquer item.

Cada mudança vira um commit no repositório. O site público atualiza cerca de 1 minuto depois.

## Adicionar à mão

1. Suba o arquivo em `beats/audio/` (áudio) ou `beats/pdf/` (PDF), e a capa em `beats/capas/`.
2. Adicione uma entrada em `items` no `beats.json`:

```json
{
  "id": "nome-do-beat",
  "name": "Nome do beat",
  "type": "beat",
  "bpm": 90,
  "key": "Lá menor",
  "date": "2026-10-24",
  "tags": ["boom bap", "sample"],
  "cover": "beats/capas/nome-do-beat.jpg",
  "file": "beats/audio/nome-do-beat.mp3",
  "folder": "boom-bap"
}
```

Só `name` é obrigatório. `type` é `"beat"` ou `"pdf"`. `folder` é o `id` de uma pasta da lista `folders`.
Sem `cover`, o site gera uma capa colorida com o nome.

Os itens com `"example": true` são exemplos e podem ser apagados.

## Testar no computador

Abra um servidor local na pasta (o `beats.json` não carrega abrindo o arquivo direto):

```sh
python3 -m http.server
```

e acesse http://localhost:8000.
