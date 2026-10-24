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
- **Adicionar** um beat (MP3, WAV, M4A…) ou um PDF, com capa, BPM, tom, tags e pasta. Limite de 45 MB por arquivo no GitHub, ou 95 MB com o Cloudflare.
- **Criar, renomear e apagar pastas.** Apagar uma pasta não apaga os itens, eles vão para "Sem pasta".
- **Arrastar** um item até uma pasta para mover. No celular, use Editar e escolha a pasta.
- **Editar ou apagar** qualquer item.

Cada mudança vira um commit no repositório. O site público atualiza cerca de 1 minuto depois.

## Guardar os arquivos no Cloudflare

O GitHub dá cerca de 1 GB para o site. Para ter mais espaço, os áudios, PDFs e capas podem ir para o Cloudflare R2 (10 GB grátis, sem custo de tráfego). O site e a lista (`beats.json`) continuam no GitHub.

1. Crie uma conta grátis em https://dash.cloudflare.com/sign-up.
2. No menu da esquerda, abra **R2 Object Storage** e ative o R2. O Cloudflare pede um cartão para ativar, mas não cobra nada enquanto você usar menos de 10 GB.
3. Clique em **Create bucket**, dê o nome `terra-fertil` e crie.
4. No menu, abra **Workers & Pages**, clique em **Create**, escolha **Start with Hello World**, dê o nome `terra-fertil` e clique em **Deploy**.
5. Clique em **Edit code**, apague tudo, cole o conteúdo de [`cloudflare/worker.js`](cloudflare/worker.js) e clique em **Deploy**.
6. Volte para a página do Worker, abra **Settings → Bindings → Add → R2 bucket**. Em **Variable name** escreva `BEATS` e escolha o bucket `terra-fertil`. Salve.
7. Copie o endereço do Worker (algo como `https://terra-fertil.seu-nome.workers.dev`). Abrindo esse endereço no navegador deve aparecer "Terra Fértil storage ok".
8. No site, entre no **Modo editor**, clique em **Armazenamento**, cole o endereço e salve.

A partir daí, tudo que você adicionar vai para o Cloudflare (até 95 MB por arquivo). Os arquivos que já estavam no GitHub continuam funcionando.
O Worker só aceita uploads de quem usar um token do GitHub com permissão de escrita neste repositório; tocar e baixar é aberto para todos.

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
