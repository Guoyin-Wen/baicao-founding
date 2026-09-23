// ==UserScript==
// @name         百草园 PT 建站时间显示
// @namespace    https://pting.club/
// @version      0.2.0
// @description  在蜂巢百草园（baicao）的 PT 站条目下方显示建站时间与站龄，十二大站点站名动态渐变红。数据来自 ptseek.pages.dev
// @author       Guoyin-Wen
// @match        https://pting.club/baicao*
// @grant        none
// @run-at       document-idle
// @license      MIT
// @homepageURL  https://github.com/Guoyin-Wen/baicao-founding
// @supportURL   https://github.com/Guoyin-Wen/baicao-founding/issues
// @updateURL    https://raw.githubusercontent.com/Guoyin-Wen/baicao-founding/main/baicao-founding.user.js
// @downloadURL  https://raw.githubusercontent.com/Guoyin-Wen/baicao-founding/main/baicao-founding.user.js
// ==/UserScript==

(function () {
  'use strict';

  const BIN_URL = 'https://ptseek.pages.dev/data/site-index.bin';
  const CACHE_KEY = 'ptseekFoundedSites.v2'; // v2：数据含 top12（十二大标签），旧 v1 缓存无此字段
  const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 小时
  const TAG = '[baicao-founding]';

  /* ---------- 数据层 ---------- */

  // site-index.bin 结构：32 字节头 + JSON 元数据 + 二进制向量。
  // 头部：偏移 0x00 魔数 "PTSI"，0x0C u32 站点数，0x10 u32 JSON 字节长度（小端）。
  // JSON 从 0x20 开始，sites[] 里每站含 name/aka/id 与 community_profile.founded_at。
  function extractJsonSlice(buf) {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let start = 0x20;
    let end = -1;
    if (buf.length > 0x20 &&
        buf[0] === 0x50 && buf[1] === 0x54 && buf[2] === 0x53 && buf[3] === 0x49) {
      end = start + dv.getUint32(0x10, true);
      if (end > buf.length) end = -1;
    }
    if (end === -1) {
      // 头部格式不符时的兜底：从 0x20 起做括号配平，找到首个完整 JSON 值的边界
      let depth = 0, inStr = false, esc = false;
      for (let i = start; i < buf.length; i++) {
        const b = buf[i];
        if (esc) { esc = false; continue; }
        if (inStr && b === 0x5c) { esc = true; continue; }
        if (b === 0x22) { inStr = !inStr; continue; }
        if (inStr) continue;
        if (b === 0x7b) depth++;
        else if (b === 0x7d) { depth--; if (depth === 0) { end = i + 1; break; } }
      }
    }
    if (end === -1) throw new Error('无法定位 site-index.bin 中的 JSON 边界');
    const text = new TextDecoder('utf-8').decode(buf.subarray(start, end));
    return JSON.parse(text);
  }

  function readCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj || !Array.isArray(obj.sites) || !obj.sites.length) return null;
      if (Date.now() - obj.ts > CACHE_TTL) return obj; // 过期仍返回，供后台刷新期间先行渲染
      return obj;
    } catch { return null; }
  }

  function writeCache(sites) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), sites })); } catch {}
  }

  function slimSites(meta) {
    const out = [];
    for (const s of meta.sites || []) {
      const founded = s && s.community_profile && s.community_profile.founded_at;
      const labels = Array.isArray(s.community_labels) ? s.community_labels : [];
      out.push({
        id: s.id || '',
        name: s.name || '',
        aka: Array.isArray(s.aka) ? s.aka : [],
        alias: s.alias || '',
        founded_at: founded || '',
        top12: labels.includes('十二大'),
      });
    }
    return out;
  }

  async function fetchSites() {
    const resp = await fetch(BIN_URL, { cache: 'no-cache' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const buf = new Uint8Array(await resp.arrayBuffer());
    return slimSites(extractJsonSlice(buf));
  }

  /* ---------- 匹配层 ---------- */

  const norm = (s) => (s || '').trim().toLowerCase();

  function buildIndex(sites) {
    // key -> founded_at；一个名字可能对应多站（取有建站日期者优先）
    const idx = new Map();
    const put = (key, site) => {
      if (!key) return;
      const k = norm(key);
      if (!k) return;
      const prev = idx.get(k);
      if (!prev || (!prev.founded_at && site.founded_at)) idx.set(k, site);
    };
    for (const s of sites) {
      put(s.id, s);
      put(s.name, s);
      for (const a of s.aka) put(a, s);
      // alias 形如 "馒头 / MT"，拆开收录
      for (const a of String(s.alias || '').split('/')) put(a.trim(), s);
      // "ZmPT (织梦)" 这类带括号别名的 name，把括号里的部分也收录
      const m = String(s.name || '').match(/^(.+?)\s*[（(](.+)[)）]\s*$/);
      if (m) { put(m[1].trim(), s); put(m[2].trim(), s); }
    }
    return idx;
  }

  /* ---------- 展示层 ---------- */

  const STYLE_ID = 'ptseek-founded-style';
  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = `
      .ptseek-founded{display:block;margin-top:2px;font-size:11px;line-height:1.4;
        opacity:.72;white-space:nowrap;cursor:default;}
      .ptseek-founded__date{font-variant-numeric:tabular-nums;}
      /* 站点样式会把 siteIdentity 内的 span 设为 display:block，
         胶囊必须用 !important 压回行内，才能与 slug 文字同处一行 */
      .ptseek-age-pill{display:inline-flex !important;align-items:center;
        margin-left:6px;padding:0 6px;border-radius:999px;font-size:10px !important;
        line-height:1.6;letter-spacing:normal;background:color-mix(in srgb,currentColor 10%,transparent);
        white-space:nowrap;}
      .ptseek-founded--anniv{opacity:1;color:#d97706;}
      .ptseek-founded--unknown{opacity:.45;font-style:italic;}
      @keyframes ptseek-top12-flow{0%{background-position:0% 50%}100%{background-position:200% 50%}}
      .ptseek-top12{background-image:linear-gradient(90deg,#b91c1c,#ef4444,#f97316,#ef4444,#b91c1c) !important;
        background-size:200% auto;-webkit-background-clip:text;background-clip:text;
        -webkit-text-fill-color:transparent;animation:ptseek-top12-flow 3s linear infinite;}
    `;
    document.head.appendChild(st);
  }

  function ageOf(foundedStr) {
    const m = foundedStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    const y = +m[1], mo = +m[2], d = +m[3];
    const now = new Date();
    const anniv = new Date(now.getFullYear(), mo - 1, d);
    const daysTo = Math.round((anniv - now) / 86400000);
    const years = Math.max(now.getFullYear() - y - (daysTo > 0 ? 1 : 0), 0);
    const annivSoon = daysTo === 0 ? 'today' : (daysTo > 0 && daysTo <= 7 ? daysTo : null);
    return { years, annivSoon };
  }

  function formatDate(foundedStr) {
    const m = foundedStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return foundedStr;
    return `${+m[1]}年${+m[2]}月${+m[3]}日`;
  }

  // 建站日期行：日期 + 站庆提示（年限胶囊单独产出，由 decorate 插到 slug 行内）
  function buildDateLine(foundedStr) {
    const el = document.createElement('div');
    el.className = 'ptseek-founded';
    el.dataset.ptseekFounded = '1';
    if (!foundedStr) {
      el.classList.add('ptseek-founded--unknown');
      el.textContent = '建站时间未知';
      el.title = 'ptseek.pages.dev 未收录该站建站日期';
      return el;
    }
    const info = ageOf(foundedStr) || { years: null, annivSoon: null };
    const date = document.createElement('span');
    date.className = 'ptseek-founded__date';
    date.textContent = `建站 ${formatDate(foundedStr)}`;
    el.appendChild(date);
    if (info.annivSoon === 'today') {
      el.classList.add('ptseek-founded--anniv');
      const cake = document.createElement('span');
      cake.textContent = '🎂 今天站庆';
      el.appendChild(cake);
    } else if (typeof info.annivSoon === 'number') {
      el.classList.add('ptseek-founded--anniv');
      const tip = document.createElement('span');
      tip.textContent = `${info.annivSoon} 天后站庆`;
      el.appendChild(tip);
    }
    el.title = `数据来源：ptseek.pages.dev（建站 ${foundedStr}）`;
    return el;
  }

  // 年限胶囊：插在 slug 之后，与 span 同行
  function buildAgePill(foundedStr) {
    const pill = document.createElement('span');
    pill.className = 'ptseek-age-pill';
    pill.dataset.ptseekAge = '1';
    const info = foundedStr ? ageOf(foundedStr) : null;
    pill.textContent = info && info.years != null && !Number.isNaN(info.years)
      ? `${info.years} 年`
      : '—';
    pill.title = foundedStr ? '站龄（数据来源：ptseek.pages.dev）' : 'ptseek 未收录建站日期';
    return pill;
  }

  /* ---------- 注入层 ---------- */

  // 每个 article 的站名容器：div[class*="siteIdentity"] 下包含 <p>站名</p><span>slug</span> 的 div
  function findHost(article) {
    const identity = article.querySelector('div[class*="siteIdentity"]');
    if (identity) {
      const host = identity.querySelector('div');
      if (host && host.querySelector('p') && host.querySelector('span')) return host;
    }
    // 兜底：article 内首个 p + span 相邻结构
    for (const p of article.querySelectorAll(':scope p')) {
      if (p.nextElementSibling && p.nextElementSibling.tagName === 'SPAN' &&
          p.parentElement.tagName === 'DIV' && !p.querySelector('svg')) {
        return p.parentElement;
      }
    }
    return null;
  }

  function decorate(article, index) {
    const host = findHost(article);
    if (!host || host.querySelector('.ptseek-founded, .ptseek-age-pill')) return;
    const nameEl = host.querySelector('p');
    const slugEl = host.querySelector('span');
    const displayName = nameEl ? nameEl.textContent.trim() : '';
    const slug = slugEl ? slugEl.textContent.trim() : '';
    const site = index.get(norm(slug)) || index.get(norm(displayName));
    const founded = site ? site.founded_at : '';

    // 十二大站点：站名做动态渐变红
    if (site && site.top12 && nameEl) {
      nameEl.classList.add('ptseek-top12');
      nameEl.title = '十二大站点（ptseek 圈内标签）';
    }

    // 年限胶囊放进 slug span 内部：slug span 是块级独行，胶囊作为其行内内容
    // 必然与 slug 文字同一行；建站日期行 append 在 host 末尾另起一行
    if (slugEl) {
      slugEl.appendChild(buildAgePill(founded));
    } else if (nameEl) {
      nameEl.appendChild(buildAgePill(founded));
    }
    host.appendChild(buildDateLine(founded));
    if (!site) {
      const last = host.lastElementChild;
      if (last) last.title = 'ptseek.pages.dev 未收录该站';
    }
  }

  function decorateAll(index) {
    document.querySelectorAll('article').forEach((a) => decorate(a, index));
  }

  /* ---------- 主流程 ---------- */

  let index = null;
  let started = false;
  let observer = null;

  function start() {
    if (started || !index) return;
    started = true;
    ensureStyle();
    decorateAll(index);
    if (!observer) {
      observer = new MutationObserver(() => decorateAll(index));
      observer.observe(document.body, { childList: true, subtree: true });
    }
  }

  (async function main() {
    // 1) 先用缓存即时渲染
    const cached = readCache();
    if (cached) {
      index = buildIndex(cached.sites);
      start();
    }
    // 2) 缓存缺失或过期则拉取最新（拉到后重刷一遍标注）
    const freshNeeded = !cached || (Date.now() - cached.ts > CACHE_TTL);
    if (!freshNeeded) return;
    try {
      const sites = await fetchSites();
      writeCache(sites);
      index = buildIndex(sites);
      if (started) {
        document.querySelectorAll('.ptseek-founded, .ptseek-age-pill').forEach((e) => e.remove());
        document.querySelectorAll('.ptseek-top12').forEach((e) => e.classList.remove('ptseek-top12'));
        decorateAll(index);
      } else {
        start();
      }
    } catch (e) {
      if (!cached) console.warn(TAG, '加载 ptseek 站点数据失败：', e);
    }
  })();
})();
