// Terra Fértil: guarda os arquivos (áudio, PDF, capas) no Cloudflare R2.
// GET/HEAD são públicos (o site toca e baixa daqui). PUT/DELETE exigem o mesmo token do GitHub
// usado no modo editor, e só passam se o dono do token puder escrever no repositório do site.
// O bucket R2 precisa estar ligado a este Worker com o nome de variável BEATS.

const REPO = "Luci0Camarg0/site_geral";
const FOLDERS = ["audio/", "pdf/", "capas/"];
const MAX_BYTES = 95 * 1024 * 1024; // o plano grátis do Workers aceita uploads de até 100 MB

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Range",
  "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges, ETag",
  "Access-Control-Max-Age": "86400",
};

const reply = (body, status = 200, extra = {}) =>
  new Response(body, { status, headers: { ...CORS, "Content-Type": "text/plain; charset=utf-8", ...extra } });

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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const key = decodeURIComponent(url.pathname.slice(1));

    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (!env.BEATS) return reply("O bucket R2 não está ligado a este Worker (variável BEATS).", 500);

    if (request.method === "GET" || request.method === "HEAD") {
      if (!key) return reply("Terra Fértil storage ok");
      const object = await env.BEATS.get(key, { range: request.headers, onlyIf: request.headers });
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
      return new Response(request.method === "HEAD" ? null : object.body, { status, headers });
    }

    if (request.method === "PUT" || request.method === "DELETE") {
      if (!FOLDERS.some((f) => key.startsWith(f)) || key.includes("..")) return reply("Caminho inválido.", 400);
      if (!(await canWrite(request))) return reply("Sem permissão. Use o token do modo editor.", 401);

      if (request.method === "DELETE") {
        await env.BEATS.delete(key);
        return reply("Apagado.");
      }
      const size = Number(request.headers.get("Content-Length") || 0);
      if (size > MAX_BYTES) return reply("Arquivo grande demais (máximo 95 MB).", 413);
      await env.BEATS.put(key, request.body, {
        httpMetadata: { contentType: request.headers.get("Content-Type") || "application/octet-stream" },
      });
      return reply("Salvo.", 201);
    }

    return reply("Método não suportado.", 405);
  },
};
