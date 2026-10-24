(function () {
  // Where the editor mode saves. The public site reads beats.json; the editor writes it through the GitHub API.
  const REPO = { owner: "Luci0Camarg0", name: "site_geral", branch: "main" };
  const API = `https://api.github.com/repos/${REPO.owner}/${REPO.name}`;
  const MB = 1024 * 1024;
  const maxBytes = () => (data.storage ? 95 : 45) * MB; // Cloudflare Worker upload cap vs. what the GitHub API takes comfortably

  const $ = (id) => document.getElementById(id);
  const audio = $("audio");
  let data = { storage: "", folders: [], items: [] }, loaded = false, failed = false;
  let view = "grid", folderSel = "all", activeTag = null, currentId = null;
  let token = null;
  const localUrls = new Map(); // repo path -> blob URL, for files uploaded this session that Pages hasn't deployed yet

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} },
  };
  if (["list", "grid"].includes(store.get("tf.view"))) view = store.get("tf.view");
  if (store.get("tf.sort")) $("sort").value = store.get("tf.sort");
  token = store.get("tf.token");

  /* ---------- helpers ---------- */
  const fmt = (s) => { s = Math.max(0, Math.round(s || 0)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const hash = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); };
  const fmtDate = (d) => { if (!d) return ""; const [y, m, dd] = d.split("-"); return dd && m && y ? `${dd}/${m}/${y}` : d; };
  const fmtSize = (b) => b ? (b >= 1048576 ? (b / 1048576).toFixed(1).replace(".", ",") + " MB" : Math.max(1, Math.round(b / 1024)) + " KB") : "";
  const slug = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50);
  const rand = () => Math.random().toString(36).slice(2, 6);
  const ext = (p) => (String(p).match(/\.([a-z0-9]+)$/i) || [, ""])[1].toLowerCase();
  const url = (p) => localUrls.get(p) || p;
  const isRemote = (p) => /^https?:\/\//.test(p || "");
  const folderName = (id) => data.folders.find((f) => f.id === id)?.name || "";
  const dlName = (it) => (slug(it.name) || "arquivo") + (ext(it.file) ? "." + ext(it.file) : "");

  function normalize(raw) {
    const src = Array.isArray(raw) ? { folders: [], items: raw } : raw || {};
    const folders = (src.folders || []).filter((f) => f && f.id && f.name).map((f) => ({ id: String(f.id), name: String(f.name) }));
    const ids = new Set();
    const items = (src.items || src.beats || []).filter((it) => it && it.name).map((it, i) => {
      const file = it.file || it.audio || it.pdf || "";
      let id = it.id || slug(it.name) || "item-" + i;
      while (ids.has(id)) id += "-" + i;
      ids.add(id);
      const out = { ...it, id, file, type: it.type || (ext(file) === "pdf" ? "pdf" : "beat") };
      delete out.audio; delete out.pdf;
      out.bpm = it.bpm ? Number(it.bpm) : null;
      out.tags = (Array.isArray(it.tags) ? it.tags : String(it.tags || "").split(",")).map((t) => String(t).trim().toLowerCase()).filter(Boolean);
      out.folder = folders.some((f) => f.id === it.folder) ? it.folder : null;
      return out;
    });
    const storage = typeof src.storage === "string" && isRemote(src.storage) ? src.storage.trim().replace(/\/+$/, "") : "";
    return { storage, folders, items };
  }

  /* ---------- filtering ---------- */
  function inFolder(it) { return folderSel === "all" || (folderSel === "none" ? !it.folder : it.folder === folderSel); }
  function visible() {
    const q = $("q").value.trim().toLowerCase();
    const type = $("type").value;
    const list = data.items.filter((it) => {
      if (!inFolder(it)) return false;
      if (type !== "all" && it.type !== type) return false;
      if (activeTag && !it.tags.includes(activeTag)) return false;
      if (!q) return true;
      return [it.name, it.key, folderName(it.folder), ...it.tags, String(it.bpm || "")].join(" ").toLowerCase().includes(q);
    });
    const [k, dir] = $("sort").value.split("-");
    const sgn = dir === "asc" ? 1 : -1;
    const val = (b) => k === "name" ? (b.name || "").toLowerCase() : k === "bpm" ? (b.bpm ?? -1) : k === "dur" ? (b.duration ?? -1) : (b.date || "");
    list.sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * sgn || (a.name || "").localeCompare(b.name || ""); });
    return list;
  }

  /* ---------- rendering ---------- */
  const I = {
    play: `<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 4v16l13-8z"/></svg>`,
    pause: `<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>`,
    doc: `<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6 2h8l5 5v15H6zM13 3.5V8h4.5zM8.5 12h8v1.5h-8zm0 3h8v1.5h-8z"/></svg>`,
    down: `<svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M11 3h2v10.2l3.6-3.6 1.4 1.4-6 6-6-6 1.4-1.4 3.6 3.6zM4 19h16v2H4z"/></svg>`,
    folder: `<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3 5h7l2 2h9v12H3z" opacity=".9"/></svg>`,
  };
  const isPlaying = (id) => id === currentId && !audio.paused;

  function genCover(it) {
    const h = hash(it.name || "item") % 360;
    const bg = it.type === "pdf"
      ? `linear-gradient(160deg, hsl(${h} 18% 34%), hsl(${h} 22% 18%))`
      : `linear-gradient(135deg, hsl(${h} 65% 42%), hsl(${(h + 50) % 360} 70% 22%))`;
    return `<div class="gen" style="background:${bg}">${esc((it.name || "?").split(/\s+/).slice(0, 3).join(" "))}</div>`;
  }
  const coverHTML = (it) => (it.cover ? `<img src="${esc(url(it.cover))}" alt="" loading="lazy" data-fallback="${esc(it.id)}">` : genCover(it)) + (it.type === "pdf" ? '<span class="kind">PDF</span>' : "");
  document.addEventListener("error", (e) => {
    const img = e.target;
    if (img.tagName !== "IMG" || !img.dataset.fallback) return;
    const it = data.items.find((x) => x.id === img.dataset.fallback);
    if (it) img.outerHTML = genCover(it);
  }, true);

  function primaryBtn(it, cls) {
    if (it.type === "pdf") {
      return it.file ? `<a class="${cls}" href="${esc(url(it.file))}" target="_blank" rel="noopener" aria-label="Abrir ${esc(it.name)}">${I.doc}</a>` : `<button class="${cls}" disabled aria-label="Sem arquivo">${I.doc}</button>`;
    }
    const lab = it.file ? (isPlaying(it.id) ? "Pausar " : "Tocar ") + esc(it.name) : "Sem áudio";
    return `<button class="${cls}" data-play="${esc(it.id)}" ${it.file ? "" : "disabled"} aria-label="${lab}">${isPlaying(it.id) ? I.pause : I.play}</button>`;
  }
  // Cross-origin files ignore the download attribute, so the Worker sends them as attachments via ?dl=.
  const dlHref = (it) => isRemote(it.file) ? it.file + "?dl=" + encodeURIComponent(dlName(it)) : url(it.file);
  const downloadLink = (it, compact) => it.file
    ? `<a class="${compact ? "iconlink" : "link"}" href="${esc(dlHref(it))}" download="${esc(dlName(it))}" aria-label="Baixar ${esc(it.name)}">${I.down}${compact ? "" : "Baixar"}</a>`
    : "";

  function facts(it) {
    const f = it.type === "pdf"
      ? ["PDF", fmtSize(it.size), fmtDate(it.date)]
      : [it.bpm ? `${it.bpm} BPM` : "", it.key || "", it.duration ? fmt(it.duration) : "", fmtDate(it.date)];
    if (folderSel === "all" && it.folder) f.push(folderName(it.folder));
    return f.filter(Boolean);
  }

  function renderFolders() {
    const n = (pred) => data.items.filter(pred).length;
    const btn = (id, name, count, drop) => `<button class="folder" data-folder="${esc(id)}" ${drop ? `data-drop="${esc(id)}"` : ""} aria-pressed="${folderSel === id}">${id === "all" ? "" : I.folder}<span>${esc(name)}</span><span class="n">${count}</span></button>`;
    if (loaded && folderSel !== "all" && !(folderSel === "none" && data.folders.length) && !data.folders.some((f) => f.id === folderSel)) folderSel = "all";
    const parts = [btn("all", "Tudo", data.items.length, false)];
    if (data.folders.length) parts.push(btn("none", "Sem pasta", n((it) => !it.folder), true));
    data.folders.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach((f) => parts.push(btn(f.id, f.name, n((it) => it.folder === f.id), true)));
    if (token) parts.push(`<button class="folder add" id="newFolderBtn">+ Nova pasta</button>`);
    $("folders").innerHTML = parts.join("");
    $("folderTools").hidden = !(token && data.folders.some((f) => f.id === folderSel));
  }

  function renderTags() {
    const all = [...new Set(data.items.filter(inFolder).flatMap((b) => b.tags))].sort((a, b) => a.localeCompare(b));
    if (activeTag && !all.includes(activeTag)) activeTag = null;
    $("tags").innerHTML = all.length > 1 ? [`<button class="chip" data-tag="" aria-pressed="${!activeTag}">Todas as tags</button>`, ...all.map((t) => `<button class="chip" data-tag="${esc(t)}" aria-pressed="${activeTag === t}">${esc(t)}</button>`)].join("") : "";
  }

  function render() {
    $("vGrid").setAttribute("aria-pressed", view === "grid");
    $("vList").setAttribute("aria-pressed", view === "list");
    $("loginBtn").hidden = !!token;
    $("editorBar").hidden = !token;
    $("dragHint").hidden = !(token && data.folders.length && data.items.length);
    renderFolders();
    renderTags();
    const list = visible();
    const total = data.items.filter(inFolder).length;
    $("count").textContent = loaded ? `${list.length} ${list.length === 1 ? "item" : "itens"}${list.length !== total ? ` de ${total}` : ""}` : "";
    const out = $("out");
    if (failed) { out.innerHTML = `<div class="empty"><strong>Não deu pra abrir a lista</strong><span>O arquivo beats.json não carregou ou tem um erro de formatação.</span></div>`; return; }
    if (!loaded) { out.innerHTML = `<div class="empty"><strong>Carregando</strong><span>Buscando os beats…</span></div>`; return; }
    if (!list.length) {
      const empty = !data.items.length
        ? `<strong>Nada aqui ainda</strong><span>${token ? "Clique em Adicionar pra subir o primeiro beat ou PDF." : "Os beats aparecem aqui assim que forem adicionados."}</span>`
        : total ? `<strong>Nada encontrado</strong><span>Tente outra busca, outro tipo ou limpe o filtro de tag.</span>`
        : `<strong>Pasta vazia</strong><span>${token ? "Arraste itens até esta pasta, ou escolha a pasta ao adicionar." : "Ainda não tem nada nesta pasta."}</span>`;
      out.innerHTML = `<div class="empty">${empty}</div>`;
      return;
    }
    const drag = token ? 'draggable="true"' : "";
    if (view === "grid") {
      out.innerHTML = `<div class="grid">${list.map((it) => `
        <article class="card${it.id === currentId ? " playing" : ""}" data-id="${esc(it.id)}" ${drag}>
          <div class="cover">${coverHTML(it)}${primaryBtn(it, "playov")}</div>
          <div class="meta">
            <p class="name">${esc(it.name)}</p>
            <div class="facts mono">${facts(it).map((f) => `<span>${esc(f)}</span>`).join("")}</div>
            ${it.example ? '<span class="example">Exemplo</span>' : ""}
          </div>
          <div class="itemActions">${downloadLink(it)}${token ? `<button class="link" data-edit="${esc(it.id)}">Editar</button>` : ""}</div>
        </article>`).join("")}</div>`;
    } else {
      out.innerHTML = `<div class="list">${list.map((it) => `
        <div class="row${it.id === currentId ? " playing" : ""}" data-id="${esc(it.id)}" ${drag}>
          ${primaryBtn(it, "rowplay")}
          <div class="cover">${coverHTML(it)}</div>
          <div class="meta"><p class="name">${esc(it.name)}${it.example ? ' <span class="example">Exemplo</span>' : ""}</p><div class="facts mono">${[folderSel === "all" && it.folder ? folderName(it.folder) : "", ...it.tags.map((t) => "#" + t)].filter(Boolean).map((t) => `<span>${esc(t)}</span>`).join("")}</div></div>
          <div class="right mono">
            ${it.type === "pdf" ? `<span>PDF</span><span class="hide-sm">${fmtSize(it.size) || "–"}</span>` : `<span>${it.bpm ? it.bpm + " BPM" : "–"}</span><span class="hide-sm">${esc(it.key || "–")}</span><span class="hide-sm">${it.duration ? fmt(it.duration) : "–"}</span>`}
            ${downloadLink(it, true)}
            ${token ? `<button class="link" data-edit="${esc(it.id)}">Editar</button>` : ""}
          </div>
        </div>`).join("")}</div>`;
    }
  }

  /* ---------- player ---------- */
  function renderNow() {
    const it = data.items.find((x) => x.id === currentId);
    $("ppIcon").innerHTML = audio.paused ? '<path fill="currentColor" d="M7 4v16l13-8z"/>' : '<path fill="currentColor" d="M6 4h4v16H6zM14 4h4v16h-4z"/>';
    $("pp").setAttribute("aria-label", audio.paused ? "Tocar" : "Pausar");
    if (!it) return;
    $("now").innerHTML = `<div class="cover">${coverHTML(it)}</div><div class="t"><p class="name">${esc(it.name)}</p><div class="facts mono">${[it.bpm ? it.bpm + " BPM" : "", it.key || ""].filter(Boolean).map(esc).join(" · ")}</div></div>`;
  }

  async function play(id) {
    const it = data.items.find((x) => x.id === id);
    if (!it || !it.file || it.type !== "beat") return;
    if (id === currentId && audio.src) { audio.paused ? audio.play() : audio.pause(); return; }
    currentId = id;
    audio.src = url(it.file);
    renderNow(); render();
    try { await audio.play(); }
    catch (e) { $("now").innerHTML = `<div class="t"><p class="name" style="color:var(--danger)">Não deu pra tocar ${esc(it.name)}. Se acabou de subir, espere um minuto e recarregue.</p></div>`; }
  }
  function step(d) {
    const list = visible().filter((b) => b.type === "beat" && b.file);
    if (!list.length) return;
    const i = list.findIndex((b) => b.id === currentId);
    play(list[(i + d + list.length) % list.length].id);
  }
  audio.addEventListener("play", () => { renderNow(); render(); });
  audio.addEventListener("pause", () => { renderNow(); render(); });
  audio.addEventListener("ended", () => step(1));
  audio.addEventListener("loadedmetadata", () => {
    const it = data.items.find((x) => x.id === currentId);
    if (it && !it.duration && isFinite(audio.duration)) { it.duration = Math.round(audio.duration); render(); }
  });
  audio.addEventListener("timeupdate", () => {
    $("cur").textContent = fmt(audio.currentTime);
    $("tot").textContent = fmt(audio.duration);
    if (audio.duration) $("bar").value = Math.round((audio.currentTime / audio.duration) * 1000);
  });
  $("bar").addEventListener("input", (e) => { if (audio.duration) audio.currentTime = (e.target.value / 1000) * audio.duration; });
  $("vol").addEventListener("input", (e) => { audio.volume = e.target.value / 100; });
  audio.volume = 0.85;
  $("pp").addEventListener("click", () => { if (!currentId) step(0); else if (audio.src) audio.paused ? audio.play() : audio.pause(); });
  $("prev").addEventListener("click", () => { if (audio.currentTime > 3) audio.currentTime = 0; else step(-1); });
  $("next").addEventListener("click", () => step(1));

  /* ---------- toast ---------- */
  let toastTimer = null;
  function toast(text, kind) {
    const t = $("toast");
    clearTimeout(toastTimer);
    t.textContent = text; t.className = "toast" + (kind === "err" ? " err" : ""); t.hidden = false;
    if (kind !== "busy") toastTimer = setTimeout(() => { t.hidden = true; }, kind === "err" ? 7000 : 4500);
  }

  /* ---------- GitHub API (editor mode) ---------- */
  class GhError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
  async function gh(path, opts = {}) {
    const r = await fetch(API + path, {
      ...opts,
      headers: { Authorization: "Bearer " + token, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(opts.body ? { "Content-Type": "application/json" } : {}) },
    });
    if (!r.ok) { let m = ""; try { m = (await r.json()).message; } catch (e) {} throw new GhError(r.status, m); }
    return r.status === 204 ? null : r.json();
  }
  function bytesToB64(u8) { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
  const textToB64 = (t) => bytesToB64(new TextEncoder().encode(t));
  const b64ToText = (b) => { const bin = atob(b.replace(/\s/g, "")); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return new TextDecoder().decode(u8); };
  const contentsPath = (p) => "/contents/" + p.split("/").map(encodeURIComponent).join("/");

  async function ghReadData() {
    try {
      const r = await gh(contentsPath("beats.json") + "?ref=" + REPO.branch);
      return { data: normalize(JSON.parse(b64ToText(r.content))), sha: r.sha };
    } catch (e) { if (e.status === 404) return { data: { storage: "", folders: [], items: [] }, sha: null }; throw e; }
  }
  function serialize(d) {
    const keep = ([k, v]) => v != null && v !== "" && v !== false && !(Array.isArray(v) && !v.length);
    const clean = (it) => Object.fromEntries(Object.entries(it).filter(keep));
    return JSON.stringify({ ...(d.storage ? { storage: d.storage } : {}), folders: d.folders, items: d.items.map(clean) }, null, 2) + "\n";
  }
  // Re-read beats.json, apply the change to the fresh copy, write it back. Retries once if someone else saved in between.
  async function saveData(mutate, message) {
    for (let attempt = 0; ; attempt++) {
      const { data: fresh, sha } = await ghReadData();
      mutate(fresh);
      try {
        await gh(contentsPath("beats.json"), { method: "PUT", body: JSON.stringify({ message, content: textToB64(serialize(fresh)), branch: REPO.branch, ...(sha ? { sha } : {}) }) });
        data = fresh;
        render();
        return;
      } catch (e) { if (attempt === 0 && (e.status === 409 || e.status === 422)) continue; throw e; }
    }
  }
  // Stores a file and returns what goes in beats.json: a full Cloudflare URL, or a repo path when no storage is set.
  async function uploadFile(path, blob, message) {
    if (data.storage) {
      const key = path.replace(/^beats\//, "");
      const r = await fetch(`${data.storage}/${key.split("/").map(encodeURIComponent).join("/")}`, {
        method: "PUT", body: blob, headers: { Authorization: "Bearer " + token, "Content-Type": blob.type || "application/octet-stream" },
      });
      if (!r.ok) throw new GhError(r.status === 401 ? 403 : r.status, await r.text().catch(() => ""));
      const ref = `${data.storage}/${key}`;
      localUrls.set(ref, URL.createObjectURL(blob));
      return ref;
    }
    const b64 = bytesToB64(new Uint8Array(await blob.arrayBuffer()));
    await gh(contentsPath(path), { method: "PUT", body: JSON.stringify({ message, content: b64, branch: REPO.branch }) });
    localUrls.set(path, URL.createObjectURL(blob));
    return path;
  }
  async function deleteFile(path, message) {
    try {
      if (isRemote(path)) {
        if (data.storage && path.startsWith(data.storage + "/")) await fetch(path, { method: "DELETE", headers: { Authorization: "Bearer " + token } });
        return;
      }
      const r = await gh(contentsPath(path) + "?ref=" + REPO.branch);
      await gh(contentsPath(path), { method: "DELETE", body: JSON.stringify({ message, sha: r.sha, branch: REPO.branch }) });
    } catch (e) { /* already gone or not ours to delete: the list entry is what matters */ }
  }
  function errText(e) {
    if (e?.status === 401) return "O token não vale mais. Saia do editor e entre de novo com um token novo.";
    if (e?.status === 403 || e?.status === 404) return "O token não tem permissão de escrita. Confira se ele tem Contents: Read and write no repositório site_geral.";
    if (e?.status === 413 || (e?.status === 422 && /too large|size/i.test(e.message))) return "O arquivo é grande demais. Tente um MP3.";
    if (e instanceof TypeError) return data.storage ? "Não deu pra falar com o GitHub ou o Cloudflare. Confira a internet e o endereço em Armazenamento." : "Sem conexão com o GitHub. Confira a internet e tente de novo.";
    return "Algo deu errado ao salvar" + (e?.message ? ` (${e.message})` : "") + ". Tente de novo.";
  }
  const PUBLISH_NOTE = "Salvo. O site público atualiza em cerca de 1 minuto.";

  /* ---------- dialogs ---------- */
  const open = (id) => { $(id).hidden = false; setTimeout(() => $(id).querySelector("input:not([type=file]), select")?.focus(), 30); };
  const close = (el) => { el.closest(".scrim").hidden = true; };
  document.querySelectorAll(".scrim").forEach((s) => s.addEventListener("click", (e) => { if (e.target === s || e.target.closest("[data-close]")) s.hidden = true; }));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") document.querySelectorAll(".scrim").forEach((s) => (s.hidden = true));
    if (e.key === " " && e.target === document.body && currentId) { e.preventDefault(); audio.paused ? audio.play() : audio.pause(); }
  });
  const setMsg = (id, t, err) => { $(id).textContent = t; $(id).classList.toggle("err", !!err); };

  // login
  $("loginBtn").addEventListener("click", () => { $("fToken").value = ""; setMsg("loginMsg", ""); open("loginDlg"); });
  $("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const t = $("fToken").value.trim();
    if (!t) return;
    $("loginSave").disabled = true; setMsg("loginMsg", "Conferindo…");
    const prev = token; token = t;
    try {
      const repo = await gh("");
      if (repo.permissions && !repo.permissions.push) throw new GhError(403, "");
      store.set("tf.token", t);
      close($("loginForm"));
      await load();
      toast("Modo editor ligado. Agora dá pra adicionar, mover e apagar.");
    } catch (err) {
      token = prev;
      setMsg("loginMsg", err.status === 401 ? "Esse token não foi aceito pelo GitHub. Confira se copiou inteiro." : err.status === 404 ? "Esse token não enxerga o repositório site_geral. Marque o repositório ao criar o token." : errText(err), true);
    } finally { $("loginSave").disabled = false; }
  });
  $("logoutBtn").addEventListener("click", () => { token = null; store.set("tf.token", null); render(); toast("Você saiu do modo editor neste navegador."); });

  // folders
  let folderEditing = null;
  function openFolder(f) {
    folderEditing = f || null;
    $("folderTitle").textContent = f ? "Renomear pasta" : "Nova pasta";
    $("fFolderName").value = f?.name || "";
    $("folderConfirm").hidden = true;
    setMsg("folderMsg", "");
    open("folderDlg");
  }
  $("folderForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("fFolderName").value.trim();
    if (!name) return;
    $("folderSave").disabled = true; setMsg("folderMsg", "Salvando…");
    try {
      if (folderEditing) {
        const id = folderEditing.id;
        await saveData((d) => { const f = d.folders.find((x) => x.id === id); if (f) f.name = name; }, `Renomeia pasta: ${name}`);
      } else {
        const id = (slug(name) || "pasta") + "-" + rand();
        await saveData((d) => { d.folders.push({ id, name }); }, `Cria pasta: ${name}`);
        folderSel = id; render();
      }
      close($("folderForm")); toast(PUBLISH_NOTE);
    } catch (err) { setMsg("folderMsg", errText(err), true); }
    finally { $("folderSave").disabled = false; }
  });
  $("renameFolderBtn").addEventListener("click", () => openFolder(data.folders.find((f) => f.id === folderSel)));
  $("deleteFolderBtn").addEventListener("click", () => { openFolder(data.folders.find((f) => f.id === folderSel)); $("folderConfirm").hidden = false; });
  $("folderNoDel").addEventListener("click", () => { $("folderConfirm").hidden = true; });
  $("folderYesDel").addEventListener("click", async () => {
    if (!folderEditing) return;
    const { id, name } = folderEditing;
    setMsg("folderMsg", "Apagando…");
    try {
      await saveData((d) => { d.folders = d.folders.filter((f) => f.id !== id); d.items.forEach((it) => { if (it.folder === id) it.folder = null; }); }, `Apaga pasta: ${name}`);
      folderSel = "all"; render();
      close($("folderForm")); toast(PUBLISH_NOTE);
    } catch (err) { setMsg("folderMsg", errText(err), true); }
  });

  // move by drag and drop
  async function moveItem(id, folder) {
    const it = data.items.find((x) => x.id === id);
    if (!it || (it.folder || null) === folder) return;
    const before = it.folder;
    it.folder = folder; render();
    toast(`Movendo ${it.name}…`, "busy");
    try {
      await saveData((d) => { const x = d.items.find((y) => y.id === id); if (x) x.folder = folder; }, `Move ${it.name} para ${folder ? folderName(folder) : "Sem pasta"}`);
      toast(`${it.name} foi para ${folder ? folderName(folder) : "Sem pasta"}.`);
    } catch (err) { it.folder = before; render(); toast(errText(err), "err"); }
  }
  let dragId = null;
  document.addEventListener("dragstart", (e) => {
    const el = e.target.closest?.("[data-id][draggable=true]");
    if (!el) return;
    dragId = el.dataset.id; el.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", dragId);
  });
  document.addEventListener("dragend", () => { dragId = null; document.querySelectorAll(".dragging, .dropok").forEach((x) => x.classList.remove("dragging", "dropok")); });
  document.addEventListener("dragover", (e) => {
    const t = e.target.closest?.("[data-drop]");
    document.querySelectorAll(".dropok").forEach((x) => x !== t && x.classList.remove("dropok"));
    if (!t || !dragId) return;
    e.preventDefault(); e.dataTransfer.dropEffect = "move"; t.classList.add("dropok");
  });
  document.addEventListener("drop", (e) => {
    const t = e.target.closest?.("[data-drop]");
    if (!t || !dragId) return;
    e.preventDefault();
    const id = dragId;
    t.classList.remove("dropok");
    moveItem(id, t.dataset.drop === "none" ? null : t.dataset.drop);
  });

  // add / edit item
  let editing = null, newFile = null, newCover = null, newDuration = null;
  const isPdfFile = (f) => f && (f.type === "application/pdf" || ext(f.name) === "pdf");
  function syncKind() {
    const pdf = newFile ? isPdfFile(newFile) : editing?.type === "pdf";
    $("itemForm").classList.toggle("is-pdf", !!pdf);
  }
  function openItem(it) {
    editing = it || null; newFile = newCover = newDuration = null;
    $("itemTitle").textContent = it ? "Editar" : "Adicionar";
    $("fName").value = it?.name || "";
    $("fBpm").value = it?.bpm ?? "";
    $("fKey").value = it?.key || "";
    $("fDate").value = it?.date || new Date().toISOString().slice(0, 10);
    $("fTags").value = (it?.tags || []).join(", ");
    $("fFolder").innerHTML = `<option value="">Sem pasta</option>` + data.folders.map((f) => `<option value="${esc(f.id)}">${esc(f.name)}</option>`).join("");
    $("fFolder").value = it ? (it.folder || "") : (["all", "none"].includes(folderSel) ? "" : folderSel);
    $("fFile").value = ""; $("fCover").value = "";
    $("fileInfo").textContent = it?.file ? `Arquivo salvo${it.duration ? " (" + fmt(it.duration) + ")" : ""}. Escolha outro pra trocar.` : `MP3 é o mais leve. WAV e PDF também funcionam. Até ${maxBytes() / MB} MB, guardado no ${data.storage ? "Cloudflare" : "GitHub"}.`;
    $("coverPrev").innerHTML = coverHTML(it || { name: "Capa", type: "beat" });
    $("coverInfo").textContent = it?.cover ? "Escolha outra imagem pra trocar a capa." : "PNG, JPG ou WebP. Fica quadrada automaticamente.";
    $("itemDelBtn").hidden = !it; $("itemConfirm").hidden = true;
    setMsg("itemMsg", "");
    syncKind();
    open("itemDlg");
  }
  $("fFile").addEventListener("change", (e) => {
    const f = e.target.files[0]; newFile = null; newDuration = null;
    if (!f) return syncKind();
    if (f.size > maxBytes()) { setMsg("itemMsg", `Esse arquivo tem ${fmtSize(f.size)}. O limite é ${maxBytes() / MB} MB; exporte em MP3 pra ficar menor.`, true); e.target.value = ""; return; }
    setMsg("itemMsg", "");
    newFile = f;
    if (!$("fName").value.trim()) $("fName").value = f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
    $("fileInfo").textContent = `${f.name} · ${fmtSize(f.size)}`;
    syncKind();
    if (!isPdfFile(f)) {
      const u = URL.createObjectURL(f), a = new Audio();
      a.preload = "metadata";
      a.onloadedmetadata = () => { if (isFinite(a.duration)) { newDuration = a.duration; $("fileInfo").textContent = `${f.name} · ${fmtSize(f.size)} · ${fmt(a.duration)}`; } URL.revokeObjectURL(u); };
      a.onerror = () => URL.revokeObjectURL(u);
      a.src = u;
    }
  });
  $("fCover").addEventListener("change", async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      newCover = await squareImage(f, 900);
      $("coverPrev").innerHTML = `<img src="${URL.createObjectURL(newCover)}" alt="">`;
      $("coverInfo").textContent = f.name;
    } catch (err) { newCover = null; setMsg("itemMsg", "Essa imagem não abriu. Tente um PNG ou JPG.", true); }
  });
  function squareImage(file, size) {
    return new Promise((res, rej) => {
      const img = new Image(), u = URL.createObjectURL(file);
      img.onload = () => {
        const s = Math.min(img.naturalWidth, img.naturalHeight), out = Math.min(size, s);
        const c = document.createElement("canvas"); c.width = c.height = out;
        c.getContext("2d").drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, out, out);
        URL.revokeObjectURL(u);
        c.toBlob((b) => b ? res(b) : rej(new Error("encode")), "image/jpeg", 0.88);
      };
      img.onerror = () => { URL.revokeObjectURL(u); rej(new Error("load")); };
      img.src = u;
    });
  }

  $("itemForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("fName").value.trim();
    if (!name) { setMsg("itemMsg", "Dê um nome pro item.", true); return; }
    if (!editing && !newFile) { setMsg("itemMsg", "Escolha o arquivo de áudio ou PDF.", true); return; }
    $("itemSave").disabled = true;
    const base = slug(name) || "item";
    try {
      const fields = {
        name,
        date: $("fDate").value || null,
        tags: [...new Set($("fTags").value.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 12),
        folder: $("fFolder").value || null,
      };
      const type = newFile ? (isPdfFile(newFile) ? "pdf" : "beat") : editing.type;
      fields.type = type;
      fields.bpm = type === "beat" && $("fBpm").value ? Math.round(+$("fBpm").value) : null;
      fields.key = type === "beat" ? ($("fKey").value.trim() || null) : null;
      const old = { file: editing?.file, cover: editing?.cover };
      if (newCover) {
        setMsg("itemMsg", "Enviando capa…");
        fields.cover = await uploadFile(`beats/capas/${base}-${rand()}.jpg`, newCover, `Capa: ${name}`);
      }
      if (newFile) {
        setMsg("itemMsg", `Enviando ${type === "pdf" ? "PDF" : "áudio"} (${fmtSize(newFile.size)})…`);
        fields.file = await uploadFile(`beats/${type === "pdf" ? "pdf" : "audio"}/${base}-${rand()}.${ext(newFile.name) || (type === "pdf" ? "pdf" : "mp3")}`, newFile, `${type === "pdf" ? "PDF" : "Beat"}: ${name}`);
        fields.size = newFile.size;
        fields.duration = type === "beat" && newDuration ? Math.round(newDuration) : null;
        fields.example = false;
      }
      setMsg("itemMsg", "Salvando a lista…");
      if (editing) {
        const id = editing.id;
        await saveData((d) => { const x = d.items.find((y) => y.id === id); if (x) Object.assign(x, fields); }, `Edita: ${name}`);
        if (newCover && old.cover) deleteFile(old.cover, `Remove capa antiga: ${name}`);
        if (newFile && old.file) deleteFile(old.file, `Remove arquivo antigo: ${name}`);
      } else {
        const id = base + "-" + rand();
        await saveData((d) => { d.items.push({ id, ...fields }); }, `Adiciona: ${name}`);
      }
      close($("itemForm")); toast(PUBLISH_NOTE);
    } catch (err) { setMsg("itemMsg", errText(err), true); }
    finally { $("itemSave").disabled = false; }
  });
  $("itemDelBtn").addEventListener("click", () => { $("itemConfirm").hidden = false; });
  $("itemNoDel").addEventListener("click", () => { $("itemConfirm").hidden = true; });
  $("itemYesDel").addEventListener("click", async () => {
    if (!editing) return;
    const it = editing;
    setMsg("itemMsg", "Apagando…");
    try {
      await saveData((d) => { d.items = d.items.filter((x) => x.id !== it.id); }, `Apaga: ${it.name}`);
      if (currentId === it.id) { audio.pause(); audio.removeAttribute("src"); currentId = null; }
      close($("itemForm")); toast("Apagado.");
      for (const p of [it.cover, it.file]) if (p) await deleteFile(p, `Apaga arquivo: ${it.name}`);
    } catch (err) { setMsg("itemMsg", errText(err), true); }
  });

  // storage (Cloudflare Worker address)
  $("storageBtn").addEventListener("click", () => {
    $("fStorage").value = data.storage || "";
    $("storageNow").textContent = data.storage ? "Hoje os arquivos novos vão para o Cloudflare." : "Hoje os arquivos novos vão para o GitHub (limite de cerca de 1 GB).";
    setMsg("storageMsg", "");
    open("storageDlg");
  });
  $("storageForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    let v = $("fStorage").value.trim().replace(/\/+$/, "");
    if (v && !/^https?:\/\//.test(v)) v = "https://" + v;
    $("storageSave").disabled = true;
    try {
      if (v) {
        setMsg("storageMsg", "Testando o endereço…");
        let ok = false;
        try { const r = await fetch(v + "/"); ok = r.ok && /Terra F/.test(await r.text()); } catch (err) {}
        if (!ok) { setMsg("storageMsg", "Esse endereço não respondeu como o Worker do Terra Fértil. Confira se colou o código do worker.js e ligou o bucket com o nome BEATS.", true); return; }
      }
      setMsg("storageMsg", "Salvando…");
      await saveData((d) => { d.storage = v; }, v ? "Usa o Cloudflare para os arquivos" : "Volta a guardar os arquivos no GitHub");
      close($("storageForm"));
      toast(v ? "Pronto. Os próximos arquivos vão para o Cloudflare." : "Pronto. Os próximos arquivos vão para o GitHub.");
    } catch (err) { setMsg("storageMsg", errText(err), true); }
    finally { $("storageSave").disabled = false; }
  });

  /* ---------- clicks & controls ---------- */
  document.addEventListener("click", (e) => {
    const p = e.target.closest("[data-play]"); if (p) { play(p.dataset.play); return; }
    const f = e.target.closest("[data-folder]"); if (f) { folderSel = f.dataset.folder; store.set("tf.folder", folderSel); render(); return; }
    const t = e.target.closest("[data-tag]"); if (t) { activeTag = t.dataset.tag || null; render(); return; }
    const ed = e.target.closest("[data-edit]"); if (ed) { openItem(data.items.find((x) => x.id === ed.dataset.edit)); return; }
    if (e.target.closest("#newFolderBtn")) openFolder(null);
  });
  $("addBtn").addEventListener("click", () => openItem(null));
  $("q").addEventListener("input", render);
  $("type").addEventListener("change", render);
  $("sort").addEventListener("change", () => { store.set("tf.sort", $("sort").value); render(); });
  const setView = (v) => { view = v; store.set("tf.view", v); render(); };
  $("vGrid").addEventListener("click", () => setView("grid"));
  $("vList").addEventListener("click", () => setView("list"));
  folderSel = store.get("tf.folder") || "all";

  /* ---------- load ---------- */
  async function load() {
    try {
      if (token) {
        try { data = (await ghReadData()).data; loaded = true; failed = false; render(); return; }
        catch (e) { if (e.status === 401) { token = null; store.set("tf.token", null); toast("O token salvo não vale mais. Entre no modo editor de novo.", "err"); } }
      }
      const r = await fetch("beats.json", { cache: "no-cache" });
      if (!r.ok) throw new Error(r.status);
      data = normalize(await r.json());
      loaded = true; failed = false;
    } catch (e) { failed = true; }
    render();
  }
  render();
  load();
})();
