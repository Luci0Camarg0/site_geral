(function () {
  const $ = (id) => document.getElementById(id);
  let beats = [], loaded = false, failed = false;
  let view = "grid", activeTag = null, currentId = null;
  const audio = $("audio");

  try { const v = localStorage.getItem("beats.view"); if (v === "list" || v === "grid") view = v; } catch (e) {}
  try { const s = localStorage.getItem("beats.sort"); if (s) $("sort").value = s; } catch (e) {}

  const fmt = (s) => { s = Math.max(0, Math.round(s || 0)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const hash = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); };
  const fmtDate = (d) => { if (!d) return ""; const [y, m, dd] = d.split("-"); return dd && m && y ? `${dd}/${m}/${y}` : d; };
  const slug = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  function genCover(b) {
    const h = hash(b.name || "beat") % 360;
    const bg = `linear-gradient(135deg, hsl(${h} 65% 42%), hsl(${(h + 50) % 360} 70% 22%))`;
    return `<div class="gen" style="background:${bg}">${esc((b.name || "?").split(/\s+/).slice(0, 3).join(" "))}</div>`;
  }
  const coverHTML = (b) => b.cover ? `<img src="${esc(b.cover)}" alt="" loading="lazy" data-fallback="${esc(b.id)}">` : genCover(b);
  // Swap a broken cover image for the generated one.
  document.addEventListener("error", (e) => {
    const img = e.target;
    if (img.tagName !== "IMG" || !img.dataset.fallback) return;
    const b = beats.find((x) => x.id === img.dataset.fallback);
    if (b) img.outerHTML = genCover(b);
  }, true);

  function visible() {
    const q = $("q").value.trim().toLowerCase();
    const list = beats.filter((b) => {
      if (activeTag && !b.tags.includes(activeTag)) return false;
      if (!q) return true;
      return [b.name, b.key, ...b.tags, String(b.bpm || "")].join(" ").toLowerCase().includes(q);
    });
    const [k, dir] = $("sort").value.split("-");
    const sgn = dir === "asc" ? 1 : -1;
    const val = (b) => k === "name" ? (b.name || "").toLowerCase() : k === "bpm" ? (b.bpm ?? -1) : k === "dur" ? (b.duration ?? -1) : (b.date || "");
    list.sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * sgn || (a.name || "").localeCompare(b.name || ""); });
    return list;
  }

  function renderTags() {
    const all = [...new Set(beats.flatMap((b) => b.tags))].sort((a, b) => a.localeCompare(b));
    $("tags").innerHTML = all.length ? [`<button class="chip" data-tag="" aria-pressed="${!activeTag}">Todos</button>`, ...all.map((t) => `<button class="chip" data-tag="${esc(t)}" aria-pressed="${activeTag === t}">${esc(t)}</button>`)].join("") : "";
  }

  const playIcon = `<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 4v16l13-8z"/></svg>`;
  const pauseIcon = `<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>`;
  const isPlaying = (id) => id === currentId && !audio.paused;

  function render() {
    $("vGrid").setAttribute("aria-pressed", view === "grid");
    $("vList").setAttribute("aria-pressed", view === "list");
    renderTags();
    const list = visible();
    $("count").textContent = loaded ? `${list.length} ${list.length === 1 ? "beat" : "beats"}${list.length !== beats.length ? ` de ${beats.length}` : ""}` : "";
    const out = $("out");
    if (failed) { out.innerHTML = `<div class="empty"><strong>Não deu pra abrir a lista</strong><span>O arquivo beats.json não carregou ou tem um erro de formatação.</span></div>`; return; }
    if (!loaded) { out.innerHTML = `<div class="empty"><strong>Carregando o cofre</strong><span>Buscando os beats…</span></div>`; return; }
    if (!beats.length) { out.innerHTML = `<div class="empty"><strong>Nenhum beat ainda</strong><span>Os beats aparecem aqui assim que forem adicionados ao beats.json.</span></div>`; return; }
    if (!list.length) { out.innerHTML = `<div class="empty"><strong>Nada encontrado</strong><span>Tente outra busca ou limpe o filtro de tag.</span></div>`; return; }
    const facts = (b) => [b.bpm ? `${b.bpm} BPM` : "", b.key || "", b.duration ? fmt(b.duration) : "", fmtDate(b.date)].filter(Boolean);
    const label = (b) => b.audio ? (isPlaying(b.id) ? "Pausar " : "Tocar ") + esc(b.name) : "Sem áudio";
    if (view === "grid") {
      out.innerHTML = `<div class="grid">${list.map((b) => `
        <article class="card${b.id === currentId ? " playing" : ""}" id="${esc(b.id)}">
          <div class="cover">${coverHTML(b)}
            <button class="playov" data-play="${esc(b.id)}" ${b.audio ? "" : "disabled"} aria-label="${label(b)}">${isPlaying(b.id) ? pauseIcon : playIcon}</button>
          </div>
          <div class="meta">
            <p class="name">${esc(b.name)}</p>
            <div class="facts mono">${facts(b).map((f) => `<span>${esc(f)}</span>`).join("")}</div>
            ${b.example ? '<span class="example">Exemplo</span>' : ""}
          </div>
        </article>`).join("")}</div>`;
    } else {
      out.innerHTML = `<div class="list">${list.map((b) => `
        <div class="row${b.id === currentId ? " playing" : ""}" id="${esc(b.id)}">
          <button class="rowplay" data-play="${esc(b.id)}" ${b.audio ? "" : "disabled"} aria-label="${label(b)}">${isPlaying(b.id) ? pauseIcon : playIcon}</button>
          <div class="cover">${coverHTML(b)}</div>
          <div class="meta"><p class="name">${esc(b.name)}${b.example ? ' <span class="example">Exemplo</span>' : ""}</p><div class="facts mono">${b.tags.map((t) => `<span>#${esc(t)}</span>`).join("")}</div></div>
          <div class="right mono">
            <span>${b.bpm ? b.bpm + " BPM" : "–"}</span>
            <span class="hide-sm">${esc(b.key || "–")}</span>
            <span class="hide-sm">${b.duration ? fmt(b.duration) : "–"}</span>
          </div>
        </div>`).join("")}</div>`;
    }
  }

  function renderNow() {
    const b = beats.find((x) => x.id === currentId);
    $("ppIcon").innerHTML = audio.paused ? '<path fill="currentColor" d="M7 4v16l13-8z"/>' : '<path fill="currentColor" d="M6 4h4v16H6zM14 4h4v16h-4z"/>';
    $("pp").setAttribute("aria-label", audio.paused ? "Tocar" : "Pausar");
    if (!b) return;
    $("now").innerHTML = `<div class="cover">${coverHTML(b)}</div><div class="t"><p class="name">${esc(b.name)}</p><div class="facts mono">${[b.bpm ? b.bpm + " BPM" : "", b.key || ""].filter(Boolean).map(esc).join(" · ")}</div></div>`;
  }

  async function play(id) {
    const b = beats.find((x) => x.id === id);
    if (!b || !b.audio) return;
    if (id === currentId && audio.src) { audio.paused ? audio.play() : audio.pause(); return; }
    currentId = id;
    audio.src = b.audio;
    renderNow(); render();
    try { await audio.play(); }
    catch (e) { $("now").innerHTML = `<div class="t"><p class="name" style="color:var(--danger)">Não deu pra tocar ${esc(b.name)}. Confira o caminho do áudio.</p></div>`; }
  }

  function step(d) {
    const list = visible().filter((b) => b.audio);
    if (!list.length) return;
    const i = list.findIndex((b) => b.id === currentId);
    play(list[(i + d + list.length) % list.length].id);
  }

  audio.addEventListener("play", () => { renderNow(); render(); });
  audio.addEventListener("pause", () => { renderNow(); render(); });
  audio.addEventListener("ended", () => step(1));
  audio.addEventListener("loadedmetadata", () => {
    const b = beats.find((x) => x.id === currentId);
    if (b && !b.duration && isFinite(audio.duration)) { b.duration = audio.duration; render(); }
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

  document.addEventListener("click", (e) => {
    const p = e.target.closest("[data-play]"); if (p) { play(p.dataset.play); return; }
    const t = e.target.closest("[data-tag]"); if (t) { activeTag = t.dataset.tag || null; render(); }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === " " && e.target === document.body && currentId) { e.preventDefault(); audio.paused ? audio.play() : audio.pause(); }
  });
  $("q").addEventListener("input", render);
  $("sort").addEventListener("change", () => { try { localStorage.setItem("beats.sort", $("sort").value); } catch (e) {} render(); });
  const setView = (v) => { view = v; try { localStorage.setItem("beats.view", v); } catch (e) {} render(); };
  $("vGrid").addEventListener("click", () => setView("grid"));
  $("vList").addEventListener("click", () => setView("list"));

  render();
  fetch("beats.json", { cache: "no-cache" })
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then((data) => {
      const list = Array.isArray(data) ? data : data.beats || [];
      beats = list.filter((b) => b && b.name).map((b, i) => ({
        ...b,
        id: b.id || slug(b.name) || "beat-" + i,
        bpm: b.bpm ? Number(b.bpm) : null,
        tags: (Array.isArray(b.tags) ? b.tags : String(b.tags || "").split(",")).map((t) => String(t).trim().toLowerCase()).filter(Boolean),
      }));
      loaded = true; render();
    })
    .catch(() => { failed = true; render(); });
})();
