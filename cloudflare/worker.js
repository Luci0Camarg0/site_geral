// Terra Fértil: guarda os arquivos (áudio, PDF, capas) e a lista de beats no Cloudflare R2.
//
// Público (qualquer pessoa):
//   GET  /audio/... /pdf/... /capas/...   toca e baixa os arquivos (?dl=nome baixa como anexo)
//   GET  /api/list                        a lista de pastas e itens
//   POST /api/upload?kind=audio|pdf|capas&ext=mp3   envia um arquivo e devolve o endereço dele
//   POST /api/add                         adiciona um item novo à lista (JSON)
// Só no modo editor (token do GitHub com permissão de escrita no repositório do site):
//   PUT  /api/list                        troca a lista inteira (mover, editar, apagar, pastas)
//   PUT/DELETE /audio/... etc.            envia ou apaga um arquivo num caminho exato
//
// O bucket R2 precisa estar ligado a este Worker com o nome de variável BEATS.

const REPO = "Luci0Camarg0/site_geral";
const SEED_URL = `https://raw.githubusercontent.com/${REPO}/main/beats.json`;
const LIST_KEY = "data/list.json";
const FOLDERS = ["audio/", "pdf/", "capas/"];
const MAX_BYTES = 95 * 1024 * 1024; // o plano grátis do Workers aceita uploads de até 100 MB
const MAX_COVER = 5 * 1024 * 1024;
const EXTS = {
  audio: ["mp3", "wav", "m4a", "aac", "ogg", "flac"],
  pdf: ["pdf"],
  capas: ["jpg", "jpeg", "png", "webp"],
};
const TYPES = {
  mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac", ogg: "audio/ogg", flac: "audio/flac",
  pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
};
// Limites por pessoa (endereço IP) a cada hora, pra ninguém lotar o site de spam.
const LIMITS = { upload: 40, add: 20 };

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Range, If-Match",
  "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges, ETag",
  "Access-Control-Max-Age": "86400",
};

const reply = (body, status = 200, extra = {}) =>
  new Response(body, { status, headers: { ...CORS, "Content-Type": "text/plain; charset=utf-8", ...extra } });
const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra } });

async function canWrite(request) {
  const auth = request.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return false;
  const r = await fetch(`https://api.github.com/repos/${REPO}`, {
    headers: { Authorization: auth, Accept: "application/vnd.github+json", "User-Agent": "terra-fertil-worker" },
  });
  if (!r.ok) return false;
  const repo = await r.json();
  return !!(repo.permissions && repo.permissions.push);
}

// Conta quantas vezes este IP fez a ação nesta hora. Devolve false quando passou do limite.
async function withinLimit(env, request, action) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const hour = Math.floor(Date.now() / 3600000);
  const key = `ratelimit/${action}/${hour}/${ip}`;
  const obj = await env.BEATS.get(key);
  const n = obj ? Number(await obj.text()) || 0 : 0;
  if (n >= LIMITS[action]) return false;
  await env.BEATS.put(key, String(n + 1));
  return true;
}

async function readList(env) {
  const obj = await env.BEATS.get(LIST_KEY);
  if (obj) return { list: await obj.json(), etag: obj.etag };
  // Primeira vez: começa com a lista que está no GitHub.
  let list = { folders: [], items: [] };
  try {
    const r = await fetch(SEED_URL, { headers: { "User-Agent": "terra-fertil-worker" } });
    if (r.ok) list = await r.json();
  } catch (e) {}
  delete list.storage;
  const put = await env.BEATS.put(LIST_KEY, JSON.stringify(list), { httpMetadata: { contentType: "application/json" } });
  return { list, etag: put.etag };
}

const clean = (v, max) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);
const rand = () => crypto.randomUUID().replace(/-/g, "").slice(0, 10);
const slug = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = decodeURIComponent(url.pathname.slice(1));
    const m = request.method;

    if (m === "OPTIONS") return new Response(null, { headers: CORS });
    if (!env.BEATS) return reply("O bucket R2 não está ligado a este Worker (variável BEATS).", 500);
    if (!path) return reply("Terra Fértil storage ok");

    /* ---------- a lista ---------- */
    if (path === "api/list" && m === "GET") {
      const { list, etag } = await readList(env);
      return json(list, 200, { ETag: `"${etag}"` });
    }

    if (path === "api/list" && m === "PUT") {
      if (!(await canWrite(request))) return reply("Sem permissão. Use o token do modo editor.", 401);
      let list;
      try { list = await request.json(); } catch (e) { return reply("Lista inválida.", 400); }
      if (!list || !Array.isArray(list.items) || !Array.isArray(list.folders)) return reply("Lista inválida.", 400);
      delete list.storage;
      const ifMatch = (request.headers.get("If-Match") || "").replace(/"/g, "");
      await readList(env); // garante que a lista existe antes de comparar a versão
      const put = await env.BEATS.put(LIST_KEY, JSON.stringify(list), {
        httpMetadata: { contentType: "application/json" },
        ...(ifMatch ? { onlyIf: { etagMatches: ifMatch } } : {}),
      });
      if (!put) return reply("A lista mudou enquanto você editava. Tente de novo.", 412);
      return json({ ok: true }, 200, { ETag: `"${put.etag}"` });
    }

    /* ---------- envio aberto ---------- */
    if (path === "api/upload" && m === "POST") {
      const kind = url.searchParams.get("kind");
      const ext = (url.searchParams.get("ext") || "").toLowerCase();
      if (!EXTS[kind] || !EXTS[kind].includes(ext)) return reply("Tipo de arquivo não aceito.", 415);
      const size = Number(request.headers.get("Content-Length") || 0);
      if (!size) return reply("Arquivo vazio.", 400);
      if (size > (kind === "capas" ? MAX_COVER : MAX_BYTES)) return reply(kind === "capas" ? "Capa grande demais (máximo 5 MB)." : "Arquivo grande demais (máximo 95 MB).", 413);
      const trusted = request.headers.has("Authorization") && (await canWrite(request));
      if (!trusted && !(await withinLimit(env, request, "upload"))) return reply("Muitos envios seguidos. Espere uma hora e tente de novo.", 429);
      const name = slug(url.searchParams.get("name") || "") || "arquivo";
      const key = `${kind}/${name}-${rand()}.${ext}`;
      await env.BEATS.put(key, request.body, { httpMetadata: { contentType: TYPES[ext] } });
      return json({ url: `${url.origin}/${key}` }, 201);
    }

    if (path === "api/add" && m === "POST") {
      let b;
      try { b = await request.json(); } catch (e) { return reply("Pedido inválido.", 400); }
      if (b.website) return json({ ok: true }); // campo escondido: só robô preenche
      const name = clean(b.name, 80);
      if (!name) return reply("Dê um nome.", 400);
      const own = (u, kind) => typeof u === "string" && u.startsWith(`${url.origin}/${kind}/`) && !u.includes("..");
      const type = b.type === "pdf" ? "pdf" : "beat";
      if (!own(b.file, type === "pdf" ? "pdf" : "audio")) return reply("Envie o arquivo primeiro.", 400);
      if (b.cover && !own(b.cover, "capas")) return reply("Capa inválida.", 400);
      if (!(await env.BEATS.head(b.file.slice(url.origin.length + 1)))) return reply("O arquivo não chegou. Envie de novo.", 400);
      const trusted = request.headers.has("Authorization") && (await canWrite(request));
      if (!trusted && !(await withinLimit(env, request, "add"))) return reply("Muitos itens seguidos. Espere uma hora e tente de novo.", 429);

      const item = {
        id: `${slug(name) || "item"}-${rand().slice(0, 4)}`,
        name, type,
        date: /^\d{4}-\d{2}-\d{2}$/.test(b.date || "") ? b.date : new Date().toISOString().slice(0, 10),
        tags: (Array.isArray(b.tags) ? b.tags : []).map((t) => clean(t, 30).toLowerCase()).filter(Boolean).slice(0, 12),
        file: b.file,
        addedAt: new Date().toISOString(),
      };
      if (b.cover) item.cover = b.cover;
      if (Number(b.size) > 0) item.size = Math.round(Number(b.size));
      if (type === "beat") {
        const bpm = Math.round(Number(b.bpm));
        if (bpm >= 40 && bpm <= 300) item.bpm = bpm;
        const key = clean(b.key, 20);
        if (key) item.key = key;
        const dur = Math.round(Number(b.duration));
        if (dur > 0 && dur < 3600) item.duration = dur;
      }
      if (b.author) item.author = clean(b.author, 40);

      // Junta o item à lista; se outra pessoa salvou ao mesmo tempo, lê de novo e tenta outra vez.
      for (let i = 0; i < 5; i++) {
        const { list, etag } = await readList(env);
        if (b.folder && (list.folders || []).some((f) => f.id === b.folder)) item.folder = b.folder;
        list.items = [...(list.items || []), item];
        const put = await env.BEATS.put(LIST_KEY, JSON.stringify(list), { httpMetadata: { contentType: "application/json" }, onlyIf: { etagMatches: etag } });
        if (put) return json({ item }, 201);
        await new Promise((r) => setTimeout(r, 150 * (i + 1)));
      }
      return reply("O site está ocupado. Tente de novo.", 503);
    }

    /* ---------- arquivos ---------- */
    if (!FOLDERS.some((f) => path.startsWith(f)) || path.includes("..")) return reply("Não encontrado.", 404);

    if (m === "GET" || m === "HEAD") {
      const object = await env.BEATS.get(path, { range: request.headers, onlyIf: request.headers });
      if (object === null) return reply("Arquivo não encontrado.", 404);

      const headers = new Headers(CORS);
      object.writeHttpMetadata(headers);
      headers.set("ETag", object.httpEtag);
      headers.set("Accept-Ranges", "bytes");
      headers.set("Cache-Control", "public, max-age=31536000, immutable");
      const dl = url.searchParams.get("dl");
      if (dl) headers.set("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(dl)}`);

      if (!("body" in object)) return new Response(null, { status: 304, headers });

      let status = 200, length = object.size;
      if (request.headers.has("Range") && object.range) {
        const r = object.range;
        const offset = "suffix" in r ? object.size - r.suffix : (r.offset || 0);
        length = "suffix" in r ? r.suffix : (r.length ?? object.size - offset);
        headers.set("Content-Range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
        status = 206;
      }
      headers.set("Content-Length", String(length));
      return new Response(m === "HEAD" ? null : object.body, { status, headers });
    }

    if (m === "PUT" || m === "DELETE") {
      if (!(await canWrite(request))) return reply("Sem permissão. Use o token do modo editor.", 401);
      if (m === "DELETE") {
        await env.BEATS.delete(path);
        return reply("Apagado.");
      }
      const size = Number(request.headers.get("Content-Length") || 0);
      if (size > MAX_BYTES) return reply("Arquivo grande demais (máximo 95 MB).", 413);
      await env.BEATS.put(path, request.body, {
        httpMetadata: { contentType: request.headers.get("Content-Type") || "application/octet-stream" },
      });
      return reply("Salvo.", 201);
    }

    return reply("Método não suportado.", 405);
  },
};
