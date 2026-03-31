(function () {
  "use strict";

  try {
    const t = localStorage.getItem("local-notes-theme");
    if (t === "dark" || t === "light") document.documentElement.setAttribute("data-theme", t);
  } catch {
    /* ignore */
  }

  const root = document.getElementById("public-root");
  /** @type {unknown[]} */
  let allPosts = [];
  let searchDebounce = 0;

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escapeAttr(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/\n/g, " ");
  }

  function safeHref(url) {
    const u = String(url).trim();
    if (/^javascript:/i.test(u) || /^data:/i.test(u)) return null;
    if (/^https?:\/\//i.test(u)) return u;
    if (u.startsWith("/") && !u.startsWith("//")) return u;
    return null;
  }

  function safeImgSrc(url) {
    const u = String(url).trim();
    if (/^javascript:/i.test(u) || /^data:/i.test(u)) return null;
    if (/^https?:\/\//i.test(u)) return u;
    if (u.startsWith("/api/public/")) return u;
    if (u.startsWith("/") && !u.startsWith("//")) return u;
    return null;
  }

  function inlineFormat(raw) {
    const ph = [];
    function push(tag) {
      ph.push(tag);
      return "\uE000" + (ph.length - 1) + "\uE001";
    }
    let s = raw;
    s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, url) => {
      const src = safeImgSrc(url);
      if (!src) return escapeHtml("![" + alt + "](" + url + ")");
      return push('<img src="' + escapeAttr(src) + '" alt="' + escapeAttr(alt) + '" loading="lazy" />');
    });
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) => {
      const href = safeHref(url);
      if (!href) return escapeHtml("[" + text + "](" + url + ")");
      return push(
        '<a href="' +
          escapeAttr(href) +
          '" target="_blank" rel="noopener noreferrer">' +
          escapeHtml(text) +
          "</a>"
      );
    });
    s = s.replace(/`([^`]+)`/g, (_, code) => {
      return push("<code>" + escapeHtml(code) + "</code>");
    });
    s = s.replace(/\*\*([^*]+)\*\*/g, (_, t) => {
      return push("<strong>" + escapeHtml(t) + "</strong>");
    });
    s = s.replace(/\*([^*]+)\*/g, (_, t) => {
      return push("<em>" + escapeHtml(t) + "</em>");
    });
    s = escapeHtml(s);
    for (let k = 0; k < ph.length; k++) {
      s = s.replace("\uE000" + k + "\uE001", ph[k]);
    }
    return s;
  }

  function renderMarkdown(text) {
    if (!String(text).trim()) {
      return '<p class="md-empty">（无内容）</p>';
    }
    const parts = String(text).split(/(```[\s\S]*?```)/g);
    let html = "";
    for (const part of parts) {
      if (part.startsWith("```")) {
        const m = part.match(/^```(\w*)\n?([\s\S]*?)```$/);
        const code = m ? m[2] : part.replace(/^```/, "").replace(/```$/, "");
        html += "<pre><code>" + escapeHtml(code) + "</code></pre>";
        continue;
      }
      const lines = part.split("\n");
      const para = [];
      function flushPara() {
        if (!para.length) return;
        const body = inlineFormat(para.join("\n"));
        html += "<p>" + body.replace(/\n/g, "<br>") + "</p>";
        para.length = 0;
      }
      for (const line of lines) {
        const h = line.match(/^(#{1,6})\s+(.*)$/);
        if (h) {
          flushPara();
          const level = h[1].length;
          html += "<h" + level + ">" + inlineFormat(h[2]) + "</h" + level + ">";
          continue;
        }
        if (line.trim() === "") {
          flushPara();
          continue;
        }
        para.push(line);
      }
      flushPara();
    }
    return html;
  }

  function formatTime(ms) {
    if (!ms) return "";
    try {
      return new Date(ms).toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" });
    } catch {
      return "";
    }
  }

  function excerptFromBody(body, max) {
    const t = String(body || "")
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/[#>*`_]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (t.length <= max) return t;
    return t.slice(0, max) + "…";
  }

  function plainTextForSearch(body) {
    return String(body || "")
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/[#>*`_]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function searchTokens(q) {
    return String(q || "")
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
  }

  function postMatchesQuery(post, tokens) {
    if (!tokens.length) return true;
    const title = String(post.title || "").toLowerCase();
    const body = plainTextForSearch(post.body);
    const author = String(post.authorLabel || "").toLowerCase();
    return tokens.every((t) => title.includes(t) || body.includes(t) || author.includes(t));
  }

  function filterPosts(posts, q) {
    const tokens = searchTokens(q);
    return posts.filter((p) => postMatchesQuery(p, tokens));
  }

  function renderListItems(posts) {
    if (!posts.length) return "";
    const h = [];
    h.push('<ul class="public-post-list">');
    for (const p of posts) {
      const title = escapeHtml(p.title || "无标题");
      const url = escapeAttr(p.detailUrl || "#");
      const by = escapeHtml(p.authorLabel || "");
      const when = escapeHtml(formatTime(p.updatedAt));
      const ex = escapeHtml(excerptFromBody(p.body, 220));
      h.push('<li class="public-post-list-item">');
      h.push('<article class="public-post-card">');
      h.push('<h2 class="public-post-card-title"><a href="' + url + '">' + title + "</a></h2>");
      h.push('<p class="public-post-byline">' + by + " · " + when + "</p>");
      h.push('<p class="public-post-excerpt">' + ex + "</p>");
      h.push("</article></li>");
    }
    h.push("</ul>");
    return h.join("");
  }

  function resultMetaHtml(total, shown, qRaw) {
    const q = String(qRaw || "").trim();
    if (!total) {
      return '<p class="public-result-meta">暂无可展示的公开笔记。</p>';
    }
    if (!q) {
      return '<p class="public-result-meta">共 <strong>' + total + "</strong> 篇手记</p>";
    }
    if (shown === 0) {
      return (
        '<p class="public-result-meta public-result-meta-empty">没有匹配「<strong>' +
        escapeHtml(q) +
        "</strong>」的手记（共 " +
        total +
        " 篇）</p>"
      );
    }
    return (
      '<p class="public-result-meta">找到 <strong>' +
      shown +
      "</strong> 篇（共 " +
      total +
      " 篇）· 关键词含空格时表示需同时包含多个词</p>"
    );
  }

  function renderListMount(all, filtered, q) {
    const total = all.length;
    const shown = filtered.length;
    const meta = resultMetaHtml(total, shown, q);
    const listHtml = renderListItems(filtered);
    let bodyHtml = meta;
    if (total && shown === 0) {
      bodyHtml +=
        '<p class="public-empty-hint">试试缩短关键词，或<a href="/public">清空搜索</a>。</p>';
    } else if (listHtml) {
      bodyHtml += listHtml;
    }
    return bodyHtml;
  }

  function renderListPage(all, q) {
    const filtered = filterPosts(all, q);
    const qAttr = escapeAttr(q);
    const mountHtml = renderListMount(all, filtered, q);
    root.innerHTML =
      '<div class="public-shell-inner">' +
      '<header class="public-hero">' +
      '<h1 class="public-blog-title">公共手记</h1>' +
      '<p class="public-blog-sub">由作者主动公开的笔记聚合于此；支持按标题、正文与作者行搜索，多个词用空格连接表示同时包含。</p>' +
      '<div class="public-search-wrap">' +
      '<label class="sr-only" for="public-search">搜索公开手记</label>' +
      '<input type="search" id="public-search" class="public-search-input" placeholder="搜索标题、正文、作者…" autocomplete="off" value="' +
      qAttr +
      '" />' +
      "</div>" +
      '<nav class="public-blog-nav" aria-label="站点导航"><a href="/">我的笔记</a></nav>' +
      "</header>" +
      '<div class="public-list-section" id="public-list-mount">' +
      mountHtml +
      "</div>" +
      "</div>";
  }

  function updateListMount(all, q) {
    const mount = document.getElementById("public-list-mount");
    if (!mount) return;
    const filtered = filterPosts(all, q);
    mount.innerHTML = renderListMount(all, filtered, q);
  }

  function syncSearchUrl(q) {
    const params = new URLSearchParams(location.search);
    const t = String(q || "").trim();
    if (t) params.set("q", t);
    else params.delete("q");
    const qs = params.toString();
    const next = "/public" + (qs ? "?" + qs : "");
    if (next !== location.pathname + location.search) {
      history.replaceState(null, "", next);
    }
  }

  function renderDetail(post) {
    const title = escapeHtml(post.title || "无标题");
    const by = escapeHtml(post.authorLabel || "");
    const when = escapeHtml(formatTime(post.updatedAt));
    const h = [];
    h.push('<div class="public-shell-inner public-shell-inner-detail">');
    h.push('<header class="public-detail-header">');
    h.push('<div class="public-detail-toolbar">');
    h.push('<nav class="public-blog-nav public-detail-nav" aria-label="导航">');
    h.push('<a href="/public">手记列表</a>');
    h.push('<span class="public-nav-sep" aria-hidden="true">·</span>');
    h.push('<a href="/">我的笔记</a>');
    h.push("</nav>");
    h.push(
      '<form class="public-search-form" action="/public" method="get" role="search">' +
        '<label class="sr-only" for="public-detail-search">搜索</label>' +
        '<input type="search" id="public-detail-search" name="q" class="public-search-input public-search-input-compact" placeholder="搜索全部公开手记…" />' +
        '<button type="submit" class="btn btn-primary public-search-submit">搜索</button>' +
        "</form>"
    );
    h.push("</div>");
    h.push('<div class="public-detail-hero-card">');
    h.push('<h1 class="public-post-detail-title">' + title + "</h1>");
    h.push('<p class="public-post-byline">' + by + " · " + when + "</p>");
    h.push("</div>");
    h.push("</header>");
    h.push('<article class="markdown-body public-post-body">' + renderMarkdown(post.body || "") + "</article>");
    h.push("</div>");
    root.innerHTML = h.join("");
  }

  function onSearchInput(ev) {
    const el = ev.target;
    if (!el || el.id !== "public-search") return;
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      const q = el.value;
      syncSearchUrl(q);
      updateListMount(allPosts, q);
    }, 200);
  }

  document.addEventListener("input", onSearchInput);

  window.addEventListener("popstate", () => {
    const path = location.pathname.replace(/\/$/, "") || "/public";
    if (path !== "/public") return;
    const q = new URLSearchParams(location.search).get("q") || "";
    const inp = document.getElementById("public-search");
    if (inp) inp.value = q;
    updateListMount(allPosts, q);
  });

  async function main() {
    if (!root) return;
    let posts;
    try {
      const r = await fetch("/api/public/posts", { credentials: "same-origin" });
      if (!r.ok) throw new Error(String(r.status));
      posts = await r.json();
    } catch {
      root.innerHTML =
        '<div class="public-shell-inner"><p class="public-error">无法加载公共手记列表，请稍后再试。</p><p class="public-blog-nav"><a href="/">返回</a></p></div>';
      return;
    }
    if (!Array.isArray(posts)) posts = [];
    allPosts = posts;

    const path = location.pathname.replace(/\/$/, "") || "/public";
    if (path === "/public") {
      const q = new URLSearchParams(location.search).get("q") || "";
      renderListPage(allPosts, q);
      document.title = "公共手记";
      return;
    }
    const detail = posts.find((p) => (p.detailUrl || "").replace(/\/$/, "") === path);
    if (!detail) {
      root.innerHTML =
        '<div class="public-shell-inner"><p class="public-error">未找到该手记或已不再公开。</p><p class="public-blog-nav"><a href="/public">返回列表</a></p></div>';
      document.title = "手记未找到";
      return;
    }
    renderDetail(detail);
    document.title = (detail.title || "手记") + " · 公共手记";
  }

  main();
})();
