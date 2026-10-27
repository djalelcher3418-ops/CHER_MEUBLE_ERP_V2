/* واجهة دكّة المدرب: كل شاشة دالة ترجع HTML، والأحداث تمر عبر data-a (نقر) و data-c (تغيير). */
(function () {
  'use strict';
  const FM = window.FM;
  const SAVE_KEY = 'dakka-save-v1';
  const esc = (s) => String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = FM.money;
  const num = (v) => `<span class="num ltr">${v}</span>`;
  const $m = (v) => `<span class="num ltr">${money(v)}</span>`;
  // زوج أرقام (نتيجة، أهداف متوقعة): الأول يظهر يمينًا ليوافق مكان صاحب الأرض أو فريقنا في الصفحة العربية
  const pair = (a, b, sep) => `<span class="pair num"><span>${a}</span><span class="sep">${sep || '–'}</span><span>${b}</span></span>`;

  let S = null;
  const UI = {
    view: 'start', tab: { analysis: 'next', transfers: 'market', league: 'table' }, sel: null, modal: null, toast: null,
    sort: { key: 'role', dir: 1 }, start: { club: 5, name: '' }, filters: { pos: 'all', age: 40, ovr: 0, price: 0, free: false, q: '' },
    round: null, lab: null, recCache: null, match: null, confirm: null, offerMsg: null,
  };

  // ---------- الحفظ ----------
  function save() {
    if (!S) return;
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch { /* التخزين غير متاح: نكمل دون حفظ */ }
  }
  function loadSave() {
    try { const raw = localStorage.getItem(SAVE_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
  }
  function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch { /* لا شيء */ } }

  // ---------- أدوات عرض ----------
  const me = () => FM.club(S, S.userClub);
  const myT = () => S.tactics[S.userClub];
  const tier = (v) => (v >= 80 ? 't5' : v >= 72 ? 't4' : v >= 64 ? 't3' : v >= 56 ? 't2' : 't1');
  const ovr = (v) => `<span class="ovr ${tier(v)}">${Math.round(v)}</span>`;
  const pos = (p) => `<span class="pos ${p}">${p}</span>`;
  function shortName(n) {
    const parts = n.split(' ');
    const k = ['عبد', 'بدر', 'شمس'].includes(parts[0]) && parts.length > 2 ? 2 : 1;
    return parts.slice(k).join(' ') || n;
  }
  function stars(lo, hi) {
    let s = '<span class="stars" aria-label="الإمكانات">';
    for (let i = 1; i <= 5; i++) {
      let c = '';
      if (lo >= i) c = 'f'; else if (lo >= i - 0.5) c = 'h'; else if (hi >= i - 0.5) c = 'r';
      s += `<i class="${c}">★</i>`;
    }
    return s + '</span>';
  }
  const potStars = (p) => { const r = FM.potRange(p); return stars(r[0], r[1]); };
  function bar(v, max) {
    const pct = Math.max(0, Math.min(100, (v / (max || 100)) * 100));
    const cls = pct < 55 ? 'low' : pct < 75 ? 'warn' : '';
    return `<div class="bar ${cls}"><span style="width:${pct}%"></span></div>`;
  }
  function crest(c, size) {
    const s = size || 36;
    const letter = esc(c.short.replace(/^ال/, '').charAt(0));
    return `<svg width="${s}" height="${s * 1.15}" viewBox="0 0 40 46" aria-hidden="true" style="flex:none"><path d="M20 1 L38 7 V22 C38 34 30 41 20 45 C10 41 2 34 2 22 V7 Z" fill="${c.color}" stroke="rgba(0,0,0,.4)" stroke-width="1.2"/><path d="M20 1 L38 7 V22 C38 34 30 41 20 45 Z" fill="${c.color2}" opacity=".22"/><text x="20" y="25" text-anchor="middle" dominant-baseline="central" font-family="Reem Kufi, sans-serif" font-size="17" font-weight="700" fill="${c.color2}">${letter}</text></svg>`;
  }
  const formChips = (arr) => `<span class="form">${arr.slice(-5).map((r) => `<b class="${r}">${{ W: 'ف', D: 'ت', L: 'خ' }[r]}</b>`).join('')}</span>`;
  const avgForm = (p) => (p.form.length ? (p.form.reduce((a, b) => a + b, 0) / p.form.length).toFixed(1) : '—');
  function statusPills(p) {
    const out = [];
    if (p.inj) out.push(`<span class="pill bad">مصاب ${p.inj}أ</span>`);
    if (p.susp) out.push('<span class="pill bad">موقوف</span>');
    if (S.listed.includes(p.id)) out.push('<span class="pill acc">معروض للبيع</span>');
    if (p.contract <= 1 && p.clubId === S.userClub) out.push('<span class="pill">عقد ينتهي</span>');
    if (p.morale < 35) out.push('<span class="pill bad">غير راضٍ</span>');
    return out.join(' ');
  }
  function toast(text, bad) {
    UI.toast = { text, bad };
    render();
    clearTimeout(toast.t);
    toast.t = setTimeout(() => { UI.toast = null; render(); }, 3200);
  }

  // ---------- الملعب العمودي (أبعاد حقيقية 68×105 م) ----------
  function pitchLines(w, h, vertical) {
    const L = (x1, y1, x2, y2) => `<line class="pl" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
    let s = `<rect class="grass" x="0" y="0" width="${w}" height="${h}"/>`;
    const n = 10;
    for (let i = 0; i < n; i += 2) s += vertical ? `<rect class="stripe" x="0" y="${(h / n) * i}" width="${w}" height="${h / n}"/>` : `<rect class="stripe" x="${(w / n) * i}" y="0" width="${w / n}" height="${h}"/>`;
    s += `<rect class="pl" x="1" y="1" width="${w - 2}" height="${h - 2}"/>`;
    if (vertical) {
      s += L(1, h / 2, w - 1, h / 2) + `<circle class="pl" cx="${w / 2}" cy="${h / 2}" r="9.15"/>`;
      s += `<rect class="pl" x="${w / 2 - 20.16}" y="1" width="40.32" height="16.5"/><rect class="pl" x="${w / 2 - 9.16}" y="1" width="18.32" height="5.5"/>`;
      s += `<rect class="pl" x="${w / 2 - 20.16}" y="${h - 17.5}" width="40.32" height="16.5"/><rect class="pl" x="${w / 2 - 9.16}" y="${h - 6.5}" width="18.32" height="5.5"/>`;
    } else {
      s += L(w / 2, 1, w / 2, h - 1) + `<circle class="pl" cx="${w / 2}" cy="${h / 2}" r="9.15"/>`;
      s += `<rect class="pl" x="1" y="${h / 2 - 20.16}" width="16.5" height="40.32"/><rect class="pl" x="1" y="${h / 2 - 9.16}" width="5.5" height="18.32"/>`;
      s += `<rect class="pl" x="${w - 17.5}" y="${h / 2 - 20.16}" width="16.5" height="40.32"/><rect class="pl" x="${w - 6.5}" y="${h / 2 - 9.16}" width="5.5" height="18.32"/>`;
    }
    return s;
  }
  function tacticPitch(tactic, clubObj, interactive) {
    const slots = FM.FORMATIONS[tactic.formation];
    const W = 68, H = 105;
    let s = `<svg class="pitch" viewBox="0 0 ${W} ${H}" role="img" aria-label="التشكيلة على الملعب">${pitchLines(W, H, true)}`;
    slots.forEach((sl, i) => {
      const id = tactic.lineup[i];
      const p = id ? S.players[id] : null;
      const x = (sl[2] / 100) * (W - 10) + 5;
      const y = H - ((sl[1] / 100) * (H - 12) + 6);
      const v = p ? FM.ovrAt(p, sl[0]) : 0;
      const oop = p && FM.familiarity(p, sl[0]) < 0.9;
      const sel = interactive && UI.sel && UI.sel.slot === i;
      const fill = clubObj.color, ink = clubObj.color2;
      s += `<g class="tok${sel ? ' sel' : ''}${oop ? ' oop' : ''}" ${interactive ? `data-a="slot" data-i="${i}" tabindex="0" role="button" aria-label="${esc(p ? p.name : 'مركز فارغ')}"` : ''}>`;
      s += `<circle class="ring" cx="${x}" cy="${y}" r="4.6"/><circle class="body" cx="${x}" cy="${y}" r="3.7" fill="${p ? fill : 'rgba(0,0,0,.35)'}"/>`;
      s += `<text x="${x}" y="${y}" font-size="2.6" font-weight="700" fill="${ink}">${p ? Math.round(v) : '+'}</text>`;
      s += `<text class="role" x="${x}" y="${y - 5.4}">${sl[0]}</text>`;
      if (p) {
        s += `<text class="nmt" x="${x}" y="${y + 5.6}">${esc(shortName(p.name))}</text>`;
        const fw = 7 * (p.fit / 100);
        s += `<rect class="fitbar" x="${x - 3.5}" y="${y + 7.4}" width="7" height="0.8" rx="0.4"/><rect x="${x - 3.5}" y="${y + 7.4}" width="${fw}" height="0.8" rx="0.4" fill="${p.fit < 60 ? 'var(--bad)' : p.fit < 80 ? 'var(--accent)' : 'var(--good)'}"/>`;
      }
      s += '</g>';
    });
    return s + '</svg>';
  }

  // ---------- الرأس والتبويبات ----------
  const VIEWS = [['home', 'الرئيسية'], ['squad', 'الفريق'], ['tactics', 'التكتيك'], ['analysis', 'التحليل'], ['transfers', 'الانتقالات'], ['scouting', 'الكشافة'], ['training', 'التدريب'], ['league', 'الدوري'], ['finance', 'المالية'], ['inbox', 'البريد']];
  function header() {
    const c = me();
    const unread = S.inbox.filter((x) => !x.read).length;
    const offers = S.offers.length;
    const total = S.fixtures.length;
    const live = UI.view === 'match';
    return `<header class="top"><div class="wrap">
      <div class="brand">${crest(c, 34)}<div><div class="nm">${esc(c.name)}</div><div class="sub">${esc(S.manager)} · الموسم ${num(S.season)} · الجولة ${num(Math.min(S.week + 1, total))}/${num(total)}</div></div></div>
      <div class="meta">
        <div><div class="k">الرصيد</div><div class="v ${c.budget < 0 ? 'bad' : ''}">${$m(c.budget)}</div></div>
        <div><div class="k">المركز</div><div class="v">${num(FM.position(S, c.id))} <span class="muted" style="font-weight:400">/ الهدف ${num(S.board.target)}</span></div></div>
        <div><div class="k">ثقة المجلس</div><div class="v ${S.board.conf < 30 ? 'bad' : S.board.conf > 65 ? 'good' : ''}">${num(S.board.conf + '%')}</div></div>
        ${live ? '' : `<button class="btn pri" data-a="next">${S.gameOver ? 'انتهت المسيرة' : 'إلى المباراة ◂'}</button>`}
      </div></div>
      ${live ? '' : `<nav class="nav wrap" aria-label="الأقسام">${VIEWS.map(([k, t]) => `<button class="${UI.view === k ? 'on' : ''}" data-a="nav" data-v="${k}">${t}${k === 'inbox' && unread ? `<span class="badge">${unread}</span>` : ''}${k === 'transfers' && offers ? `<span class="badge">${offers}</span>` : ''}</button>`).join('')}</nav>`}
    </header>`;
  }

  // ---------- شاشة البداية ----------
  function startView() {
    const saved = loadSave();
    const sel = UI.start.club;
    const clubs = FM.newGame ? previewClubs() : [];
    return `<div class="wrap hero">
      <div class="eyebrow">لعبة إدارة وتحليل كرة القدم</div>
      <h1>دكّة <em>المدرب</em></h1>
      <p>أنت المدير الفني: ترسم الخطة، تحلل الخصم، تكتشف المواهب وتطورها، تشتري وتبيع، ثم تقود فريقك من على الخط خلال المباراة. كل قرار تكتيكي يُحسب في محرك المحاكاة.</p>
      ${saved && !saved.gameOver ? `<div class="row" style="margin-top:8px"><button class="btn pri" data-a="continue">متابعة المسيرة: ${esc(saved.clubs.find((c) => c.id === saved.userClub).name)} · الموسم ${num(saved.season)}</button><span class="muted">أو اختر ناديًا لمسيرة جديدة</span></div>` : ''}
    </div>
    <main class="wrap" style="padding-block:10px 20px">
      <h3>اختر ناديك</h3>
      <div class="clubs">${clubs.map((c, i) => `<button class="clubc ${sel === i ? 'on' : ''}" data-a="pickClub" data-i="${i}">
        ${crest(c, 38)}<div><div class="nm">${esc(c.name)}</div>${stars(FM.toStars(42 + c.rep * 0.45), FM.toStars(42 + c.rep * 0.45))}</div>
        <div class="d"><span>الميزانية ${$m(c.budget)}</span><span>${c.rep >= 80 ? 'منافس على اللقب' : c.rep >= 65 ? 'وسط الترتيب العلوي' : c.rep >= 52 ? 'وسط الترتيب' : 'صراع البقاء'}</span><span>${esc(FM.PRESETS[c.style].name)} · ${c.formation}</span></div>
      </button>`).join('')}</div>
    </main>
    <div class="startbar"><div class="wrap">
      <div class="field" style="flex:1;min-width:200px"><label for="mgr">اسم المدرب</label><input type="text" id="mgr" data-c="mgrName" value="${esc(UI.start.name)}" placeholder="مثال: جلال" maxlength="30"></div>
      <button class="btn pri" data-a="newGame">ابدأ المسيرة مع ${esc(clubs[sel] ? clubs[sel].name : '')}</button>
    </div></div>`;
  }
  let clubPreview = null;
  function previewClubs() {
    if (!clubPreview) {
      const tmp = FM.newGame(0, 'x', 7);
      clubPreview = tmp.clubs.map((c) => ({ name: c.name, short: c.short, color: c.color, color2: c.color2, rep: c.rep, budget: Math.max(c.budget, 4000000), style: c.style, formation: c.formation }));
      FM.setSeed(Date.now() | 0);
    }
    return clubPreview;
  }

  // ---------- الرئيسية ----------
  function homeView() {
    const f = FM.userFixture(S);
    const tb = FM.table(S);
    const myPos = tb.findIndex((r) => r.id === S.userClub);
    let next = '<div class="empty">لا مباراة هذا الأسبوع</div>';
    if (f) {
      const h = FM.club(S, f.h), a = FM.club(S, f.a);
      const oppId = f.h === S.userClub ? f.a : f.h;
      const rows = Object.fromEntries(tb.map((r, i) => [r.id, Object.assign({ pos: i + 1 }, r)]));
      FM.validateLineup(S, S.userClub, myT());
      FM.prepareAI(S, oppId, S.userClub);
      const e = FM.expected(S, f.h, S.tactics[f.h], f.a, S.tactics[f.a]);
      next = `<div class="fixture">
        <div class="side">${crest(h, 54)}<div class="nm">${esc(h.name)}</div><div class="row" style="justify-content:center">${formChips(rows[h.id].form)}</div><div class="muted" style="font-size:.8rem">المركز ${num(rows[h.id].pos)}</div></div>
        <div><div class="vs">الجولة ${num(S.week + 1)}</div><div class="score muted">ضد</div><div class="vs">أرض ${esc(h.short)}</div></div>
        <div class="side">${crest(a, 54)}<div class="nm">${esc(a.name)}</div><div class="row" style="justify-content:center">${formChips(rows[a.id].form)}</div><div class="muted" style="font-size:.8rem">المركز ${num(rows[a.id].pos)}</div></div>
      </div>
      <div class="row sp" style="margin-top:14px;border-top:1px solid var(--line);padding-top:12px">
        <div><div class="eyebrow">توقع المحلل (أهداف متوقعة)</div><div style="font-size:1.2rem">${pair(e.xg[0].toFixed(1), e.xg[1].toFixed(1))}</div></div>
        <div class="row"><button class="btn" data-a="nav" data-v="analysis">تقرير الخصم</button><button class="btn pri" data-a="next">إلى المباراة ◂</button></div>
      </div>`;
    }
    const around = tb.slice(Math.max(0, Math.min(myPos - 2, tb.length - 5)), Math.max(0, Math.min(myPos - 2, tb.length - 5)) + 5);
    const squad = FM.squadOf(S, S.userClub);
    const alerts = [];
    for (const p of squad) {
      if (p.inj) alerts.push(`<li class="bad">${esc(p.name)} مصاب، يغيب ${num(p.inj)} ${p.inj > 2 ? 'أسابيع' : 'أسبوع'}</li>`);
      if (p.susp) alerts.push(`<li class="bad">${esc(p.name)} موقوف الجولة القادمة</li>`);
      if (p.morale < 35) alerts.push(`<li class="acc">${esc(p.name)} غير راضٍ (المعنويات ${num(Math.round(p.morale))})</li>`);
    }
    const lowFit = squad.filter((p) => myT().lineup.includes(p.id) && p.fit < 75);
    if (lowFit.length) alerts.push(`<li class="acc">لياقة منخفضة في التشكيلة: ${lowFit.map((p) => `${esc(shortName(p.name))} ${num(p.fit + '%')}`).join('، ')}</li>`);
    if (S.offers.length) alerts.push(`<li class="good">لديك ${num(S.offers.length)} عروض لشراء لاعبين في «الانتقالات»</li>`);
    const ready = S.reports.length && S.reports[0].week === S.week - 1 && S.reports[0].season === S.season;
    if (ready) alerts.push('<li class="good">تقرير كشافة جديد في «الكشافة»</li>');
    if (S.scouts.length < FM.maxScouts(S)) alerts.push(`<li>لديك ${num(FM.maxScouts(S) - S.scouts.length)} كشاف بلا مهمة</li>`);
    return `<div class="grid g-side">
      <div class="stack">
        <section class="panel"><h3>المباراة القادمة</h3>${next}</section>
        <div class="grid g2">
          <section class="panel"><h3>تنبيهات الفريق</h3>${alerts.length ? `<ul class="warn-list">${alerts.slice(0, 8).join('')}</ul>` : '<div class="empty">الفريق جاهز، لا تنبيهات</div>'}</section>
          <section class="panel"><h3>مجلس الإدارة</h3>
            <div class="row sp"><span class="muted">الهدف</span><b>المركز ${num(S.board.target)} أو أفضل</b></div>
            <div class="row sp" style="margin-top:8px"><span class="muted">الثقة</span><b class="num">${S.board.conf}%</b></div>
            <div class="meter" style="margin-top:6px"><span style="width:${S.board.conf}%"></span></div>
            <div class="muted" style="font-size:.82rem;margin-top:10px">${S.board.conf >= 65 ? 'المجلس يثق بمشروعك.' : S.board.conf >= 35 ? 'المجلس يراقب النتائج.' : 'مهمتك في خطر. تحتاج انتصارات.'}</div>
            ${S.formLine.length ? `<div style="margin-top:12px">${posChart(170)}</div>` : ''}
          </section>
        </div>
      </div>
      <div class="stack">
        <section class="panel"><h3>الترتيب</h3>${miniTable(around, tb)}<button class="btn sm ghost" data-a="nav" data-v="league" style="margin-top:8px">الجدول كاملًا</button></section>
        <section class="panel"><h3>البريد</h3>${S.inbox.slice(0, 3).map(msgHTML).join('') || '<div class="empty">لا رسائل</div>'}</section>
        ${S.news && S.news.length ? `<section class="panel"><h3>سوق الانتقالات</h3><div class="news">${S.news.slice(0, 5).map((n) => `<div>${esc(n)}</div>`).join('')}</div></section>` : ''}
      </div>
    </div>`;
  }
  function miniTable(rows, full) {
    return `<div class="tbl-wrap"><table class="tbl"><thead><tr><th class="n">#</th><th>النادي</th><th class="n">لعب</th><th class="n">±</th><th class="n">نقاط</th></tr></thead><tbody>${rows.map((r) => {
      const c = FM.club(S, r.id);
      return `<tr class="${r.id === S.userClub ? 'me' : ''}"><td class="n">${full.indexOf(r) + 1}</td><td>${esc(c.name)}</td><td class="n">${r.p}</td><td class="n"><span class="ltr">${r.gf - r.ga > 0 ? '+' : ''}${r.gf - r.ga}</span></td><td class="n"><b>${r.pts}</b></td></tr>`;
    }).join('')}</tbody></table></div>`;
  }
  function msgHTML(m) {
    const open = UI.openMsg === m.id;
    return `<div class="msg ${m.read ? '' : 'unread'}" data-a="msg" data-id="${m.id}"><div class="t">${esc(m.title)}<span class="muted num" style="font-weight:400;font-size:.74rem;margin-inline-start:auto">م${m.season} · ج${m.week + 1}</span></div>${open || !m.read ? `<div class="b">${esc(m.body)}</div>` : ''}</div>`;
  }

  // ---------- الفريق ----------
  const ROLE_ORDER = { GK: 0, CB: 1, LB: 2, RB: 3, DM: 4, CM: 5, AM: 6, LW: 7, RW: 8, ST: 9 };
  function squadView() {
    const sq = FM.squadOf(S, S.userClub);
    const k = UI.sort.key, d = UI.sort.dir;
    const val = (p) => ({ role: ROLE_ORDER[p.pos] * 100 - p.ovr, name: p.name, age: p.age, ovr: p.ovr, pot: FM.potRange(p)[1], fit: p.fit, morale: p.morale, form: p.form.length ? avgForm(p) * 1 : 0, value: p.value, wage: p.wage, contract: p.contract, goals: p.st.goals }[k]);
    sq.sort((a, b) => { const x = val(a), y = val(b); return (typeof x === 'string' ? x.localeCompare(y, 'ar') : x - y) * d * (k === 'role' || k === 'name' ? 1 : -1); });
    const t = myT();
    const th = (key, label, n) => `<th class="${n ? 'n' : ''} ${k === key ? 'on' : ''}" data-a="sort" data-k="${key}">${label}${k === key ? (d > 0 ? ' ▾' : ' ▴') : ''}</th>`;
    const wages = sq.reduce((a, p) => a + p.wage, 0);
    const value = sq.reduce((a, p) => a + p.value, 0);
    return `<section class="panel"><div class="row sp" style="margin-bottom:12px"><h2>الفريق الأول</h2><div class="row muted" style="font-size:.86rem"><span>${num(sq.length)}/${FM.MAX_SQUAD} لاعبًا</span><span>القيمة ${$m(value)}</span><span>الأجور ${$m(wages)}/أسبوع</span></div></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr>${th('role', 'المركز')}${th('name', 'اللاعب')}${th('age', 'العمر', 1)}${th('ovr', 'التقييم', 1)}${th('pot', 'الإمكانات')}${th('fit', 'اللياقة')}${th('morale', 'المعنويات', 1)}${th('form', 'الأداء', 1)}${th('goals', 'أهداف', 1)}${th('value', 'القيمة', 1)}${th('wage', 'الأجر', 1)}${th('contract', 'العقد', 1)}<th></th></tr></thead><tbody>
    ${sq.map((p) => `<tr class="click" data-a="player" data-id="${p.id}"><td>${pos(p.pos)}${p.alt.length ? ` <span class="muted" style="font-size:.7rem">${p.alt.join(' ')}</span>` : ''}</td><td class="nm">${esc(p.name)} ${t.lineup.includes(p.id) ? '<span class="pill acc">أساسي</span>' : t.bench.includes(p.id) ? '<span class="pill">احتياط</span>' : ''}</td><td class="n">${p.age}</td><td class="n">${ovr(p.ovr)}</td><td>${potStars(p)}</td><td style="min-width:70px">${bar(p.fit)}</td><td class="n">${Math.round(p.morale)}</td><td class="n">${avgForm(p)}</td><td class="n">${p.st.goals}</td><td class="n">${money(p.value)}</td><td class="n">${money(p.wage)}</td><td class="n">${p.contract}س</td><td>${statusPills(p)}</td></tr>`).join('')}
    </tbody></table></div></section>`;
  }

  // ---------- نافذة اللاعب ----------
  function playerModal(id) {
    const p = S.players[id];
    if (!p) return '';
    const mine = p.clubId === S.userClub;
    const c = p.clubId ? FM.club(S, p.clubId) : null;
    const roles = FM.POS.filter((r) => r !== 'GK' || p.pos === 'GK').map((r) => [r, FM.ovrAt(p, r)]).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const pr = FM.potRange(p);
    let actions = '';
    if (mine) {
      const renewD = FM.renewDemand(S, p);
      const confirming = UI.confirm === 'release-' + p.id;
      actions = `<div class="grid g2">
        <div class="stack"><h3>التدريب الفردي</h3><div class="field"><label for="pf">الصفة التي يركز عليها</label><select id="pf" data-c="pfocus" data-id="${p.id}"><option value="">حسب برنامج الفريق</option>${FM.ATTRS.filter((k) => k !== 'gk' || p.pos === 'GK').map((k) => `<option value="${k}" ${p.focus === k ? 'selected' : ''}>${FM.ATTR_AR[k]} (${p.a[k]})</option>`).join('')}</select></div>
          <div class="muted" style="font-size:.82rem">نصف نقاط التطور تذهب للصفة المختارة. الشباب تحت 22 سنة يتطورون أسرع، ومن يلعب المباريات يتطور أكثر.</div></div>
        <div class="stack"><h3>العقد</h3><dl class="kv"><dt>الأجر</dt><dd>${$m(p.wage)} / أسبوع</dd><dt>المدة المتبقية</dt><dd>${num(p.contract)} سنة</dd><dt>طلب التجديد</dt><dd>${$m(renewD)} / أسبوع</dd></dl>
          <div class="row"><button class="btn sm" data-a="renew" data-id="${p.id}" data-y="2">تجديد سنتين</button><button class="btn sm" data-a="renew" data-id="${p.id}" data-y="4">تجديد 4 سنوات</button></div></div>
      </div>
      <div class="row" style="border-top:1px solid var(--line);padding-top:14px">
        <button class="btn ${S.listed.includes(p.id) ? 'pri' : ''}" data-a="listToggle" data-id="${p.id}">${S.listed.includes(p.id) ? 'إلغاء عرضه للبيع' : 'عرضه للبيع'}</button>
        ${confirming ? `<span class="bad">فسخ العقد يكلف ${$m(FM.releaseCost(p))}. متأكد؟</span><button class="btn danger" data-a="releaseDo" data-id="${p.id}">نعم، سرّحه</button><button class="btn ghost" data-a="releaseAsk" data-id="">تراجع</button>` : `<button class="btn ghost danger" data-a="releaseAsk" data-id="${p.id}">تسريح اللاعب</button>`}
      </div>`;
    } else {
      const ask = FM.askingPrice(S, p);
      const wd = FM.wageDemand(S, p);
      const short = S.shortlist.includes(p.id);
      const o = UI.offerMsg && UI.offerMsg.id === p.id ? UI.offerMsg : null;
      const tooGood = p.ovr > FM.maxAttract(S) + 3 && p.age > 21;
      actions = `<div class="stack"><h3>التفاوض</h3>
        <div class="row muted" style="font-size:.86rem"><span>${c ? `سعر ${esc(c.name)} المتوقع: ${$m(ask)}` : p.discovered ? `تعويض التكوين: ${$m(ask)}` : 'لاعب حر: بلا رسوم انتقال'}</span><span>الأجر المطلوب تقريبًا: ${$m(wd)}/أسبوع</span><span>ميزانيتك: ${$m(me().budget)}</span></div>
        ${tooGood ? '<div class="pill bad" style="justify-self:start">قد يرفض الانتقال: مستواه أعلى من سمعة ناديك</div>' : ''}
        <div class="row" style="align-items:end">
          <div class="field"><label for="ofee">قيمة العرض €</label><input type="number" id="ofee" step="10000" min="0" value="${o && o.counter ? o.counter : ask}" style="width:150px"></div>
          <div class="field"><label for="owage">الأجر الأسبوعي €</label><input type="number" id="owage" step="100" min="0" value="${o && o.wageCounter ? o.wageCounter : wd}" style="width:120px"></div>
          <div class="field"><label for="oyrs">المدة</label><select id="oyrs">${[1, 2, 3, 4, 5].map((y) => `<option value="${y}" ${y === 3 ? 'selected' : ''}>${y} ${y > 2 ? 'سنوات' : 'سنة'}</option>`).join('')}</select></div>
          <button class="btn pri" data-a="offer" data-id="${p.id}">قدّم العرض</button>
        </div>
        ${o ? `<div class="pill ${o.ok ? 'good' : 'bad'}" style="justify-self:start;white-space:normal">${esc(o.msg)}</div>` : ''}
        <div class="row"><button class="btn sm" data-a="shortlist" data-id="${p.id}">${short ? 'إزالة من القائمة المختصرة' : 'إضافة للقائمة المختصرة'}</button>${p.know < 100 ? `<button class="btn sm" data-a="scoutP" data-id="${p.id}">تقرير كشاف مفصل (${money(15000)})</button>` : ''}<span class="muted" style="font-size:.8rem">معرفتنا باللاعب ${num(p.know + '%')}</span></div>
      </div>`;
    }
    const st = p.st;
    return `<div class="overlay" data-a="closeBg"><div class="modal" role="dialog" aria-modal="true" aria-label="${esc(p.name)}">
      <div class="mh">${c ? crest(c, 34) : ''}<div><h2>${esc(p.name)}</h2><div class="muted" style="font-size:.84rem">${esc(FM.POS_AR[p.pos])}${p.alt.length ? ` · يلعب أيضًا ${p.alt.map((r) => FM.POS_AR[r]).join('، ')}` : ''} · ${num(p.age)} سنة · ${esc(FM.REGIONS[p.region] ? FM.REGIONS[p.region].name : '')} · ${c ? esc(c.name) : p.discovered ? 'موهبة اكتشفها كشافونا' : 'لاعب حر'}</div></div><button class="btn ghost x" data-a="close" aria-label="إغلاق">✕</button></div>
      <div class="mb">
        <div class="grid g3">
          <div><div class="eyebrow">التقييم</div><div class="big">${ovr(p.ovr)}</div></div>
          <div><div class="eyebrow">الإمكانات</div><div style="font-size:1.3rem">${stars(pr[0], pr[1])}</div><div class="muted" style="font-size:.76rem">${p.know >= 90 ? 'تقدير دقيق' : p.know >= 60 ? 'تقدير تقريبي' : 'تقدير غير مؤكد: أرسل كشافًا'}</div></div>
          <div><div class="eyebrow">القيمة السوقية</div><div class="big" style="font-size:1.5rem">${$m(p.value)}</div><div>${statusPills(p)}</div></div>
        </div>
        <div class="grid g2">
          <div class="stack"><h3>الصفات</h3>${FM.ATTRS.filter((k) => k !== 'gk' || p.pos === 'GK').map((k) => `<div class="attr"><span>${FM.ATTR_AR[k]}</span>${bar(p.a[k], 99)}<span class="num">${p.a[k]}</span></div>`).join('')}</div>
          <div class="stack"><h3>أفضل المراكز</h3>${roles.map(([r, v]) => `<div class="row sp"><span>${pos(r)} ${esc(FM.POS_AR[r])}</span>${ovr(v)}</div>`).join('')}
            <h3 style="margin-top:6px">الموسم</h3><dl class="kv"><dt>مباريات</dt><dd class="num">${st.apps}</dd><dt>أهداف / تمريرات حاسمة</dt><dd class="num ltr">${st.goals} / ${st.assists}</dd><dt>متوسط التقييم</dt><dd class="num">${st.apps ? (st.rsum / st.apps).toFixed(2) : '—'}</dd><dt>رجل المباراة</dt><dd class="num">${st.motm}</dd><dt>اللياقة / المعنويات</dt><dd class="num ltr">${p.fit}% / ${Math.round(p.morale)}</dd></dl></div>
        </div>
        ${actions}
      </div></div></div>`;
  }

  // ---------- التكتيك ----------
  function tacticWarnings(t) {
    const out = [];
    const slots = FM.FORMATIONS[t.formation];
    const prof = FM.previewProfile(S, S.userClub, t);
    t.lineup.forEach((id, i) => {
      const p = S.players[id];
      if (!p) { out.push({ c: 'bad', t: `المركز ${slots[i][0]} فارغ` }); return; }
      const f = FM.familiarity(p, slots[i][0]);
      if (f < 0.9) out.push({ c: 'bad', t: `${p.name} يلعب خارج مركزه (${slots[i][0]} بدل ${p.pos}): يفقد ${Math.round((1 - f) * 100)}% من مستواه` });
      if (!FM.available(p)) out.push({ c: 'bad', t: `${p.name} ${p.inj ? 'مصاب' : 'موقوف'}` });
    });
    if (t.line === 2 && prof.defPace < 66) out.push({ c: 'bad', t: `خط دفاع متقدم مع مدافعين بطيئين (سرعة ${Math.round(prof.defPace)}): خطر الكرات خلف الدفاع` });
    if (t.pressing === 2 && prof.avgFit < 85) out.push({ c: 'acc', t: `الضغط العالي يستنزف اللياقة، ومتوسط لياقة التشكيلة ${Math.round(prof.avgFit)}%` });
    if (t.passing === 0 && prof.passQ < 62) out.push({ c: 'acc', t: `التمرير القصير يحتاج لاعبين متقنين؛ جودة التمرير ${Math.round(prof.passQ)}` });
    if (t.width === 2 && prof.wide < 64) out.push({ c: 'acc', t: `اللعب الواسع مع أطراف متوسطة المستوى (${Math.round(prof.wide)})` });
    if (t.passing === 2 && prof.phyAtt >= 66) out.push({ c: 'good', t: `مهاجموك أقوياء بدنيًا (${Math.round(prof.phyAtt)}): الكرات الطويلة خيار جيد` });
    if (t.line === 2 && prof.defPace >= 72) out.push({ c: 'good', t: `مدافعوك سريعون (${Math.round(prof.defPace)}): يمكنهم اللعب بخط متقدم` });
    const fam = S.fam[S.userClub][t.formation];
    if (fam < 50) out.push({ c: 'acc', t: `الانسجام مع خطة ${t.formation} ضعيف (${Math.round(fam)}%). اختر «الانسجام التكتيكي» في التدريب أو العب بها أكثر` });
    return { list: out, prof };
  }
  function segRow(key, val, act) {
    return `<div class="tac-row"><span class="lbl">${FM.TACTIC_AR[key]}</span><div class="seg" role="group" aria-label="${FM.TACTIC_AR[key]}">${FM.TACTIC_KEYS[key].map((l, i) => `<button class="${val === i ? 'on' : ''}" data-a="${act}" data-k="${key}" data-v="${i}">${l}</button>`).join('')}</div></div>`;
  }
  function tacticsView() {
    const t = myT();
    FM.validateLineup(S, S.userClub, t);
    const c = me();
    const w = tacticWarnings(t);
    const fam = S.fam[S.userClub][t.formation];
    const slots = FM.FORMATIONS[t.formation];
    const sel = UI.sel;
    const role = sel && sel.slot !== undefined ? slots[sel.slot][0] : null;
    const sq = FM.squadOf(S, S.userClub).sort((a, b) => (role ? FM.ovrAt(b, role) - FM.ovrAt(a, role) : ROLE_ORDER[a.pos] - ROLE_ORDER[b.pos] || b.ovr - a.ovr));
    const prof = w.prof;
    const profBars = [['الهجوم', prof.att], ['الوسط', prof.mid], ['الدفاع', prof.def], ['الحارس', prof.gk], ['السرعة', prof.pace], ['التمرير', prof.passQ]];
    return `<div class="grid g-tac">
      <section class="panel stack">
        <h3>الخطة</h3>
        <div class="chips">${Object.keys(FM.FORMATIONS).map((f) => `<button class="chip ${t.formation === f ? 'on' : ''}" data-a="formation" data-v="${f}">${f}</button>`).join('')}</div>
        <div><div class="row sp" style="font-size:.8rem"><span class="muted">الانسجام مع ${t.formation}</span><span class="num">${Math.round(fam)}%</span></div>${bar(fam)}</div>
        <h3>أسلوب جاهز</h3>
        <div class="chips">${Object.keys(FM.PRESETS).map((k) => `<button class="chip txt ${t.preset === k ? 'on' : ''}" data-a="preset" data-v="${k}">${FM.PRESETS[k].name}</button>`).join('')}</div>
        <h3>التعليمات</h3>
        ${Object.keys(FM.TACTIC_KEYS).map((k) => segRow(k, t[k], 'tset')).join('')}
      </section>
      <section class="panel board">
        <div class="row sp" style="margin-bottom:10px"><h3 style="margin:0">التشكيلة</h3><button class="btn sm" data-a="autoPick">اختيار تلقائي لأفضل تشكيلة</button></div>
        ${tacticPitch(t, c, true)}
        <div class="board-tools"><span class="hint">${sel ? (sel.slot !== undefined ? `اخترت مركز ${role}: انقر لاعبًا من القائمة أو مركزًا آخر للتبديل` : 'انقر مركزًا على الملعب لوضع اللاعب فيه') : 'انقر مركزًا ثم لاعبًا لتغييره. الرقم هو تقييم اللاعب في ذلك المركز.'}</span>${sel ? '<button class="btn sm ghost" data-a="unsel">إلغاء</button>' : ''}</div>
        <div class="stack" style="margin-top:14px"><h3>قوة الخطوط</h3>${profBars.map(([l, v]) => `<div class="attr"><span>${l}</span>${bar(v, 90)}<span class="num">${Math.round(v)}</span></div>`).join('')}</div>
      </section>
      <section class="panel stack">
        <h3>${role ? `الأنسب لمركز ${role}` : 'اللاعبون'} <span class="muted">د = الدكة (${t.bench.length}/7)</span></h3>
        <div class="squad-list">${sq.map((p) => {
          const inXI = t.lineup.includes(p.id), onB = t.bench.includes(p.id);
          const v = role ? FM.ovrAt(p, role) : p.ovr;
          const selP = sel && sel.pid === p.id;
          return `<div class="sq ${inXI ? 'in' : ''} ${selP ? 'sel' : ''}" data-a="pickP" data-id="${p.id}">${pos(p.pos)}<span class="nm">${esc(p.name)}${!FM.available(p) ? ' <span class="pill bad">غائب</span>' : ''}</span>${ovr(v)}<span class="tag num">${p.fit}%</span>${inXI ? '<span class="tag">أساسي</span>' : `<button class="ibtn ${onB ? 'on' : ''}" data-a="benchToggle" data-id="${p.id}" aria-label="الدكة">د</button>`}</div>`;
        }).join('')}</div>
        <h3>ملاحظات المحلل</h3>
        ${w.list.length ? `<ul class="warn-list">${w.list.map((x) => `<li class="${x.c}">${esc(x.t)}</li>`).join('')}</ul>` : '<div class="empty">التشكيلة سليمة تكتيكيًا</div>'}
      </section>
    </div>`;
  }

  // ---------- التحليل ----------
  function analysisView() {
    const tab = UI.tab.analysis;
    const tabs = [['next', 'الخصم القادم'], ['last', 'آخر مباراة'], ['season', 'الموسم']];
    let body = '';
    if (tab === 'next') body = nextOppView();
    else if (tab === 'last') body = S.lastReport ? reportView(S.lastReport) : '<div class="empty">لم تلعب أي مباراة بعد هذا الموسم</div>';
    else body = seasonView();
    return `<div class="row sp"><h2>مركز التحليل</h2><div class="tabs">${tabs.map(([k, l]) => `<button class="${tab === k ? 'on' : ''}" data-a="tab" data-k="analysis" data-v="${k}">${l}</button>`).join('')}</div></div>${body}`;
  }
  function cmpRow(label, a, b, max) {
    const pa = Math.min(100, (a / max) * 100), pb = Math.min(100, (b / max) * 100);
    return `<div class="cmp"><span class="num">${Math.round(a)}</span><div class="l"><span style="width:${pa}%"></span></div><span class="lbl">${label}</span><div class="r"><span style="width:${pb}%"></span></div><span class="num">${Math.round(b)}</span></div>`;
  }
  function nextOppView() {
    const f = FM.userFixture(S);
    if (!f) return '<div class="empty">لا مباراة قادمة</div>';
    const home = f.h === S.userClub;
    const oppId = home ? f.a : f.h;
    const opp = FM.club(S, oppId);
    FM.validateLineup(S, S.userClub, myT());
    FM.prepareAI(S, oppId, S.userClub);
    const ot = S.tactics[oppId];
    const e = home ? FM.expected(S, S.userClub, myT(), oppId, ot) : FM.expected(S, oppId, ot, S.userClub, myT());
    const u = home ? 0 : 1;
    const P = e.P[u], O = e.P[1 - u];
    const key = `${S.season}-${S.week}-${JSON.stringify([myT().formation, myT().lineup])}`;
    if (!UI.recCache || UI.recCache.key !== key) UI.recCache = { key, list: FM.recommend(S, S.userClub, myT(), oppId, ot, home) };
    const recs = UI.recCache.list;
    const seen = new Set();
    const top = recs.filter((r) => { const k = r.preset; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 4);
    const current = recs.find((r) => r.formation === myT().formation && r.preset === myT().preset);
    const sq = FM.squadOf(S, oppId).sort((a, b) => b.ovr - a.ovr);
    const keyP = sq.slice(0, 3);
    const tb = FM.table(S);
    const orow = tb.find((r) => r.id === oppId);
    const lab = UI.lab && UI.lab.key === key + JSON.stringify(myT()) ? UI.lab : null;
    const factors = e.factors.slice().sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
    const style = Object.keys(FM.PRESETS).find((k) => k === opp.style);
    return `<div class="grid g-side">
      <div class="stack">
        <section class="panel">
          <div class="row" style="gap:14px">${crest(opp, 48)}<div><div class="eyebrow">${home ? 'نستقبل' : 'نحل ضيفًا على'}</div><h2>${esc(opp.name)}</h2><div class="row muted" style="font-size:.84rem"><span>المركز ${num(tb.indexOf(orow) + 1)}</span>${formChips(orow.form)}<span>أهداف ${num(orow.gf)} له · ${num(orow.ga)} عليه</span></div></div></div>
          <div class="grid g2" style="margin-top:16px">
            <div>${tacticPitch(ot, opp, false)}</div>
            <div class="stack">
              <dl class="kv"><dt>الخطة المتوقعة</dt><dd class="num">${ot.formation}</dd><dt>الأسلوب</dt><dd>${esc(FM.PRESETS[style].name)}</dd>${Object.keys(FM.TACTIC_KEYS).map((k) => `<dt>${FM.TACTIC_AR[k]}</dt><dd>${FM.TACTIC_KEYS[k][ot[k]]}</dd>`).join('')}</dl>
              <h3>أخطر لاعبيه</h3>${keyP.map((p) => `<div class="row sp" data-a="player" data-id="${p.id}" style="cursor:pointer"><span>${pos(p.pos)} ${esc(p.name)}</span><span class="row">${p.st.goals ? `<span class="muted num">${p.st.goals} هدف</span>` : ''}${ovr(p.ovr)}</span></div>`).join('')}
            </div>
          </div>
        </section>
        <section class="panel"><h3>مقارنة القوى <span class="muted">نحن (كهرماني) مقابل ${esc(opp.short)} (أزرق)</span></h3>
          <div class="stack" style="gap:8px">${cmpRow('الهجوم', P.att, O.att, 90)}${cmpRow('الوسط', P.mid, O.mid, 90)}${cmpRow('الدفاع', P.def, O.def, 90)}${cmpRow('الحارس', P.gk, O.gk, 90)}${cmpRow('سرعة الهجوم', P.pace, O.pace, 90)}${cmpRow('سرعة الدفاع', P.defPace, O.defPace, 90)}${cmpRow('التمرير', P.passQ, O.passQ, 90)}${cmpRow('بدنية الهجوم', P.phyAtt, O.phyAtt, 90)}</div>
          <div class="row sp" style="margin-top:14px;border-top:1px solid var(--line);padding-top:12px"><span class="muted">الاستحواذ المتوقع</span><b class="num">${Math.round(e.share[u] * 100)}%</b><span class="muted">الأهداف المتوقعة</span><b>${pair(e.xg[u].toFixed(2), e.xg[1 - u].toFixed(2))}</b></div>
        </section>
        <section class="panel"><h3>مفاتيح المباراة <span class="muted">كيف تتفاعل خطتك الحالية مع خطته</span></h3>
          ${factors.length ? `<ul class="warn-list">${factors.map((x) => { const good = (x.att === u) === (x.weight > 0); return `<li class="${good ? 'good' : 'bad'}">${esc(x.text)}</li>`; }).join('')}</ul>` : '<div class="empty">لا عوامل تكتيكية بارزة: المباراة ستحسمها جودة اللاعبين</div>'}
        </section>
      </div>
      <div class="stack">
        <section class="panel"><h3>مختبر المحاكاة</h3>
          <p class="muted" style="margin:0 0 10px;font-size:.86rem">نلعب المباراة 200 مرة بخطتك وتشكيلتك الحاليتين ضد الخطة المتوقعة للخصم.</p>
          ${lab ? labResult(lab.res) : ''}
          <button class="btn ${lab ? '' : 'pri'}" data-a="runLab" ${UI.labBusy ? 'disabled' : ''}>${UI.labBusy ? 'جارٍ المحاكاة…' : lab ? 'أعد المحاكاة' : 'حاكِ 200 مباراة'}</button>
        </section>
        <section class="panel"><h3>توصيات المحلل</h3>
          ${current ? `<div class="muted" style="font-size:.84rem;margin-bottom:10px">خطتك الحالية: فارق أهداف متوقع <b class="num ltr ${current.diff >= 0 ? 'good' : 'bad'}">${current.diff >= 0 ? '+' : ''}${current.diff.toFixed(2)}</b></div>` : ''}
          <div class="stack" style="gap:8px">${top.map((r) => `<div class="rec"><div class="t">${esc(FM.PRESETS[r.preset].name)} · <span class="num">${r.formation}</span></div><button class="btn sm" data-a="applyRec" data-p="${r.preset}" data-f="${r.formation}">طبّق</button><div class="d">متوقع ${pair(r.xgf.toFixed(1), r.xga.toFixed(1))}${r.fam < 50 ? ` · انسجام ضعيف ${Math.round(r.fam)}%` : ''}</div></div>`).join('')}</div>
          <p class="muted" style="font-size:.78rem;margin:10px 0 0">التوصية تحسب التشكيلة الأنسب لكل خطة تلقائيًا. الانسجام الضعيف مع خطة جديدة يخصم من الأداء.</p>
        </section>
      </div>
    </div>`;
  }
  function labResult(r) {
    const pw = Math.round((r.w / r.n) * 100), pd = Math.round((r.d / r.n) * 100), pl = 100 - pw - pd;
    return `<div class="stack" style="margin-bottom:12px">
      <div class="wdl" role="img" aria-label="فوز ${pw}% تعادل ${pd}% خسارة ${pl}%"><span class="w" style="width:${pw}%">${pw > 8 ? pw + '%' : ''}</span><span class="d" style="width:${pd}%">${pd > 8 ? pd + '%' : ''}</span><span class="l" style="width:${pl}%">${pl > 8 ? pl + '%' : ''}</span></div>
      <div class="legend"><span><i style="background:var(--good)"></i>فوز</span><span><i style="background:var(--panel-3)"></i>تعادل</span><span><i style="background:var(--bad)"></i>خسارة</span></div>
      <dl class="kv"><dt>متوسط النتيجة</dt><dd>${pair(r.gf, r.ga)}</dd><dt>الأهداف المتوقعة</dt><dd>${pair(r.xgf, r.xga)}</dd><dt>النتائج الأكثر تكرارًا</dt><dd class="num">${r.top.map(([s, n]) => `${pair(...s.split('-'))} <span class="muted">(${Math.round((n / r.n) * 100)}%)</span>`).join(' · ')}</dd></dl>
    </div>`;
  }
  function reportView(R) {
    const u = R.user >= 0 ? R.user : 0, o = 1 - u;
    const A = R.sides[u], B = R.sides[o];
    const ca = FM.club(S, A.clubId), cb = FM.club(S, B.clubId);
    const rows = [['الاستحواذ', A.poss + '%', B.poss + '%'], ['التسديدات', A.shots, B.shots], ['على المرمى', A.onT, B.onT], ['الأهداف المتوقعة xG', A.xg.toFixed(1), B.xg.toFixed(1)], ['فرص محققة', A.big, B.big], ['التمريرات', A.passes, B.passes], ['دقة التمرير', A.passPct + '%', B.passPct + '%'], ['الركنيات', A.corners, B.corners], ['التصديات', A.saves, B.saves], ['الأخطاء', A.fouls, B.fouls], ['بطاقات صفراء / حمراء', `${A.yel}/${A.red}`, `${B.yel}/${B.red}`]];
    const keyEv = R.events.filter((e) => ['goal', 'red', 'injury', 'sub', 'tactic'].includes(e.type));
    const homeFirst = R.sides[0].clubId === S.userClub;
    return `<div class="grid g-side">
      <div class="stack">
        <section class="panel"><div class="fixture">
          <div class="side">${crest(FM.club(S, R.sides[0].clubId), 46)}<div class="nm">${esc(FM.club(S, R.sides[0].clubId).name)}</div></div>
          <div><div class="score">${pair(R.sides[0].goals, R.sides[1].goals)}</div><div class="vs">الجولة ${R.week + 1}</div></div>
          <div class="side">${crest(FM.club(S, R.sides[1].clubId), 46)}<div class="nm">${esc(FM.club(S, R.sides[1].clubId).name)}</div></div>
        </div>
        <div class="row" style="justify-content:center;margin-top:10px;gap:20px;font-size:.84rem">${[0, 1].map((k) => `<div class="muted">${R.sides[k].scorers.map((g) => `${esc(shortName(S.players[g.id] ? S.players[g.id].name : '؟'))} ${num(g.min + "'")}${g.pen ? ' (ج)' : ''}`).join('، ') || '—'}</div>`).join('')}</div>
        ${R.motm && S.players[R.motm.id] ? `<div style="text-align:center;margin-top:8px"><span class="pill acc">رجل المباراة: ${esc(S.players[R.motm.id].name)}</span></div>` : ''}</section>
        <section class="panel"><h3>تطور الأهداف المتوقعة <span class="muted">xG تراكمي دقيقة بدقيقة</span></h3>${xgChart(R, u)}<div class="legend" style="margin-top:6px"><span><i style="background:var(--accent)"></i>${esc(ca.short)}</span><span><i style="background:var(--info)"></i>${esc(cb.short)}</span><span>● هدف</span></div></section>
        <section class="panel"><h3>تقييمات اللاعبين</h3><div class="grid g2">${[A, B].map((sd) => `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>${esc(FM.club(S, sd.clubId).short)}</th><th class="n">دق</th><th class="n">تقييم</th></tr></thead><tbody>${sd.ratings.map((r) => `<tr class="click" data-a="player" data-id="${r.id}"><td>${pos(r.role)} ${esc(S.players[r.id] ? shortName(S.players[r.id].name) : '—')}</td><td class="n">${r.min}</td><td class="n"><b class="${r.r >= 7.5 ? 'good' : r.r < 6 ? 'bad' : ''}">${r.r.toFixed(1)}</b></td></tr>`).join('')}</tbody></table></div>`).join('')}</div></section>
      </div>
      <div class="stack">
        <section class="panel"><h3>ملاحظات المحلل</h3>${R.notes.length ? `<ul class="warn-list">${R.notes.map((n) => `<li class="${n.good ? 'good' : 'bad'}">${esc(n.text)}</li>`).join('')}</ul>` : '<div class="empty">مباراة متكافئة بلا ملاحظات بارزة</div>'}</section>
        <section class="panel"><h3>الإحصاءات</h3><div class="stat-row" style="font-weight:600"><span class="num">${esc(ca.short)}</span><span></span><span class="num">${esc(cb.short)}</span></div>${rows.map(([l, a, b]) => `<div class="stat-row"><span class="num">${a}</span><span class="lbl">${l}</span><span class="num">${b}</span></div>`).join('')}</section>
        <section class="panel"><h3>مناطق اللعب <span class="muted">أين كانت الكرة؟ (اتجاه هجومنا ◂)</span></h3>${heatmap(R.zones, homeFirst)}</section>
        <section class="panel"><h3>الأحداث</h3><div class="feed">${keyEv.map((e) => `<div class="e ${e.type}"><span class="m">${e.min}'</span><span>${esc(e.text)}</span></div>`).join('') || '<div class="muted">—</div>'}</div></section>
      </div>
    </div>`;
  }
  function xgChart(R, u) {
    const W = 520, H = 180, pl = 30, pr = 10, pt = 10, pb = 22;
    const a = R.xgt[u], b = R.xgt[1 - u];
    const n = Math.max(a.length, b.length) - 1;
    const max = Math.max(1, Math.ceil(Math.max(a[a.length - 1], b[b.length - 1]) * 2) / 2);
    const X = (i) => pl + (i / Math.max(n, 90)) * (W - pl - pr);
    const Y = (v) => pt + (1 - v / max) * (H - pt - pb);
    const step = (arr) => arr.map((v, i) => `${i ? 'H' : 'M'}${X(i).toFixed(1)}${i ? '' : ',' + Y(0).toFixed(1)} V${Y(v).toFixed(1)}`).join(' ');
    let grid = '';
    for (let v = 0; v <= max + 0.001; v += max > 2 ? 1 : 0.5) grid += `<line class="gr" x1="${pl}" x2="${W - pr}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${pl - 6}" y="${Y(v) + 3}" text-anchor="end">${v}</text>`;
    for (const m of [0, 15, 30, 45, 60, 75, 90]) grid += `<text x="${X(m)}" y="${H - 6}" text-anchor="middle">${m}'</text>`;
    const goals = R.events.filter((e) => e.type === 'goal').map((e) => { const arr = e.side === u ? a : b; const v = arr[Math.min(e.min, arr.length - 1)]; return `<circle cx="${X(e.min)}" cy="${Y(v)}" r="4" class="${e.side === u ? 'usf' : 'themf'}" stroke="var(--panel)" stroke-width="1.5"/>`; }).join('');
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="منحنى الأهداف المتوقعة" style="direction:ltr">${grid}<line class="ax" x1="${pl}" x2="${W - pr}" y1="${Y(0)}" y2="${Y(0)}"/><line class="gr" x1="${X(45)}" x2="${X(45)}" y1="${pt}" y2="${Y(0)}"/><path class="them" d="${step(b)}"/><path class="us" d="${step(a)}"/>${goals}</svg>`;
  }
  function heatmap(z, homeFirst) {
    // z[ثلث من مرمى صاحب الأرض][ممر]؛ نعرضها من منظورنا: هجومنا نحو اليسار في الصفحة العربية
    const W = 105, H = 68;
    let max = 1;
    for (const r of z) for (const v of r) max = Math.max(max, v);
    let s = `<svg class="pitch" viewBox="0 0 ${W} ${H}" role="img" aria-label="خريطة مناطق اللعب">${pitchLines(W, H, false)}`;
    for (let t = 0; t < 3; t++) for (let l = 0; l < 3; l++) {
      const v = z[t][l];
      const ourT = homeFirst ? t : 2 - t, ourL = homeFirst ? l : 2 - l;
      const x = W - (ourT + 1) * (W / 3);
      const y = (2 - ourL) * (H / 3);
      s += `<rect x="${x}" y="${y}" width="${W / 3}" height="${H / 3}" fill="var(--accent)" opacity="${(0.08 + (v / max) * 0.6).toFixed(2)}"/><text x="${x + W / 6}" y="${y + H / 6}" text-anchor="middle" dominant-baseline="central" font-family="IBM Plex Mono, monospace" font-size="5" fill="var(--chalk)">${v}</text>`;
    }
    return s + '</svg>';
  }
  function posChart(h) {
    const L = S.formLine;
    const W = 320, H = h || 140, pl = 22, pr = 8, pt = 8, pb = 16;
    const n = S.fixtures.length;
    const N = S.clubs.length;
    const X = (i) => pl + (i / Math.max(1, n - 1)) * (W - pl - pr);
    const Y = (p) => pt + ((p - 1) / (N - 1)) * (H - pt - pb);
    let g = '';
    for (const p of [1, 4, 8, 12]) g += `<line class="gr" x1="${pl}" x2="${W - pr}" y1="${Y(p)}" y2="${Y(p)}"/><text x="${pl - 5}" y="${Y(p) + 3}" text-anchor="end">${p}</text>`;
    g += `<line class="gr" x1="${pl}" x2="${W - pr}" y1="${Y(S.board.target)}" y2="${Y(S.board.target)}" style="stroke:var(--accent);opacity:.5"/>`;
    const pts = L.map((r, i) => `${X(i).toFixed(1)},${Y(r.pos || N).toFixed(1)}`).join(' ');
    const last = L[L.length - 1];
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="تطور المركز" style="direction:ltr">${g}<polyline class="us" points="${pts}"/>${last ? `<circle cx="${X(L.length - 1)}" cy="${Y(last.pos || N)}" r="3.5" class="usf"/>` : ''}</svg>`;
  }
  function seasonView() {
    const L = S.formLine;
    const sq = FM.squadOf(S, S.userClub);
    const top = (fn, label) => sq.filter((p) => fn(p) > 0).sort((a, b) => fn(b) - fn(a)).slice(0, 5).map((p) => `<div class="row sp" data-a="player" data-id="${p.id}" style="cursor:pointer"><span>${pos(p.pos)} ${esc(p.name)}</span><b class="num">${label(p)}</b></div>`).join('') || '<div class="muted">—</div>';
    const W = 520, H = 150, pl = 24, pb = 18, pt = 8;
    const maxG = Math.max(3, ...L.map((r) => Math.max(r.gf, r.ga)));
    const bw = (W - pl - 10) / Math.max(L.length, 10);
    const Y = (v) => pt + (1 - v / maxG) * (H - pt - pb);
    let bars = '';
    L.forEach((r, i) => { const x = pl + i * bw; bars += `<rect x="${x + 1}" y="${Y(r.gf)}" width="${bw / 2 - 1.5}" height="${Y(0) - Y(r.gf)}" class="usf"/><rect x="${x + bw / 2}" y="${Y(r.ga)}" width="${bw / 2 - 1.5}" height="${Y(0) - Y(r.ga)}" class="themf" opacity=".8"/>`; });
    let g = '';
    for (let v = 0; v <= maxG; v++) g += `<line class="gr" x1="${pl}" x2="${W - 10}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${pl - 6}" y="${Y(v) + 3}" text-anchor="end">${v}</text>`;
    const tot = L.reduce((a, r) => ({ gf: a.gf + r.gf, ga: a.ga + r.ga, w: a.w + (r.gf > r.ga), d: a.d + (r.gf === r.ga) }), { gf: 0, ga: 0, w: 0, d: 0 });
    return `<div class="grid g-side">
      <div class="stack">
        <section class="panel"><h3>تطور المركز <span class="muted">الخط الكهرماني = هدف المجلس</span></h3>${L.length ? posChart(170) : '<div class="empty">ستظهر هنا بعد أول جولة</div>'}</section>
        <section class="panel"><h3>الأهداف لكل جولة</h3>${L.length ? `<svg class="chart" viewBox="0 0 ${W} ${H}" style="direction:ltr" role="img" aria-label="الأهداف لنا وعلينا">${g}${bars}<line class="ax" x1="${pl}" x2="${W - 10}" y1="${Y(0)}" y2="${Y(0)}"/></svg><div class="legend"><span><i style="background:var(--accent)"></i>لنا ${num(tot.gf)}</span><span><i style="background:var(--info)"></i>علينا ${num(tot.ga)}</span><span>${num(tot.w)} فوز · ${num(tot.d)} تعادل · ${num(L.length - tot.w - tot.d)} خسارة</span></div>` : '<div class="empty">لا مباريات بعد</div>'}</section>
        ${S.history.length ? `<section class="panel"><h3>المواسم السابقة</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>الموسم</th><th class="n">مركزنا</th><th class="n">الهدف</th><th class="n">نقاط</th><th>البطل</th><th>الهداف</th></tr></thead><tbody>${S.history.map((h) => `<tr><td class="num">${h.year}</td><td class="n"><b class="${h.pos <= h.target ? 'good' : 'bad'}">${h.pos}</b></td><td class="n">${h.target}</td><td class="n">${h.pts}</td><td>${esc(h.champ)}</td><td>${esc(h.scorer)}</td></tr>`).join('')}</tbody></table></div></section>` : ''}
      </div>
      <div class="stack">
        <section class="panel"><h3>الهدافون</h3>${top((p) => p.st.goals, (p) => p.st.goals)}</section>
        <section class="panel"><h3>صناع اللعب</h3>${top((p) => p.st.assists, (p) => p.st.assists)}</section>
        <section class="panel"><h3>أعلى متوسط تقييم <span class="muted">3 مباريات فأكثر</span></h3>${top((p) => (p.st.apps >= 3 ? p.st.rsum / p.st.apps : 0), (p) => (p.st.rsum / p.st.apps).toFixed(2))}</section>
      </div>
    </div>`;
  }

  // ---------- الانتقالات ----------
  function transfersView() {
    const tab = UI.tab.transfers;
    const tabs = [['market', 'السوق'], ['short', `القائمة المختصرة (${S.shortlist.length})`], ['offers', `العروض الواردة (${S.offers.length})`], ['listed', `معروضون للبيع (${S.listed.length})`]];
    let body;
    if (tab === 'market') body = marketView();
    else if (tab === 'short') body = playerTable(S.shortlist.map((id) => S.players[id]).filter((p) => p && p.clubId !== S.userClub), 'أضف لاعبين من السوق أو تقارير الكشافة لمتابعتهم هنا');
    else if (tab === 'offers') body = `<section class="panel">${S.offers.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>اللاعب</th><th>النادي المشتري</th><th class="n">العرض</th><th class="n">القيمة</th><th></th></tr></thead><tbody>${S.offers.map((o) => { const p = S.players[o.pid]; const c = FM.club(S, o.club); return `<tr><td>${pos(p.pos)} <a href="#" data-a="player" data-id="${p.id}" style="color:inherit">${esc(p.name)}</a> ${ovr(p.ovr)}</td><td>${esc(c.name)}</td><td class="n"><b>${money(o.fee)}</b></td><td class="n">${money(p.value)}</td><td><div class="row"><button class="btn sm pri" data-a="acceptOffer" data-id="${o.id}">قبول</button><button class="btn sm" data-a="rejectOffer" data-id="${o.id}">رفض</button></div></td></tr>`; }).join('')}</tbody></table></div>` : '<div class="empty">لا عروض. اعرض لاعبين للبيع من بطاقاتهم لتصلك عروض.</div>'}</section>`;
    else body = playerTable(S.listed.map((id) => S.players[id]).filter(Boolean), 'لم تعرض أي لاعب للبيع. افتح بطاقة لاعب واختر «عرضه للبيع».');
    return `<div class="row sp"><h2>الانتقالات</h2><div class="tabs">${tabs.map(([k, l]) => `<button class="${tab === k ? 'on' : ''}" data-a="tab" data-k="transfers" data-v="${k}">${l}</button>`).join('')}</div></div>${body}`;
  }
  function marketView() {
    const F = UI.filters;
    const list = Object.values(S.players).filter((p) => p.clubId !== S.userClub && (!p.discovered || S.shortlist.includes(p.id)) && (F.pos === 'all' || p.pos === F.pos) && p.age <= F.age && p.ovr >= F.ovr && (!F.free || !p.clubId) && (!F.price || FM.askingPrice(S, p) <= F.price) && (!F.q || p.name.includes(F.q)));
    list.sort((a, b) => b.ovr - a.ovr || a.age - b.age);
    return `<section class="panel stack">
      <div class="chips">${['all'].concat(FM.POS).map((p) => `<button class="chip ${F.pos === p ? 'on' : ''}" data-a="fpos" data-v="${p}">${p === 'all' ? 'الكل' : p}</button>`).join('')}</div>
      <div class="row" style="align-items:end">
        <div class="field"><label for="fq">بحث بالاسم</label><input type="text" id="fq" data-c="fq" value="${esc(F.q)}" placeholder="اسم اللاعب"></div>
        <div class="field"><label for="fage">العمر الأقصى</label><select id="fage" data-c="fage">${[40, 30, 25, 23, 21, 19].map((v) => `<option value="${v}" ${F.age === v ? 'selected' : ''}>${v === 40 ? 'أي عمر' : v}</option>`).join('')}</select></div>
        <div class="field"><label for="fovr">التقييم الأدنى</label><select id="fovr" data-c="fovr">${[0, 55, 60, 65, 70, 75, 80].map((v) => `<option value="${v}" ${F.ovr === v ? 'selected' : ''}>${v || 'أي تقييم'}</option>`).join('')}</select></div>
        <div class="field"><label for="fprice">السعر الأقصى</label><select id="fprice" data-c="fprice">${[0, 500000, 1000000, 2000000, 5000000, 10000000].map((v) => `<option value="${v}" ${F.price === v ? 'selected' : ''}>${v ? money(v) : 'أي سعر'}</option>`).join('')}</select></div>
        <button class="btn ${F.free ? 'pri' : ''}" data-a="ffree">لاعبون أحرار فقط</button>
      </div>
      <div class="muted" style="font-size:.82rem">${num(list.length)} لاعبًا · الإمكانات تقدير يتضح أكثر كلما زادت معرفة كشافينا باللاعب</div>
    </section>${playerTable(list.slice(0, 80), 'لا لاعبين بهذه المعايير')}`;
  }
  function playerTable(list, emptyText) {
    if (!list.length) return `<div class="empty">${emptyText}</div>`;
    return `<section class="panel"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>المركز</th><th>اللاعب</th><th class="n">العمر</th><th class="n">التقييم</th><th>الإمكانات</th><th>النادي</th><th class="n">القيمة</th><th class="n">السعر المطلوب</th></tr></thead><tbody>${list.map((p) => {
      const c = p.clubId ? FM.club(S, p.clubId) : null;
      return `<tr class="click" data-a="player" data-id="${p.id}"><td>${pos(p.pos)}</td><td class="nm">${esc(p.name)} ${statusPills(p)}</td><td class="n">${p.age}</td><td class="n">${ovr(p.ovr)}</td><td>${potStars(p)}</td><td>${c ? esc(c.name) : p.discovered ? '<span class="pill info">اكتشاف</span>' : '<span class="pill good">حر</span>'}</td><td class="n">${money(p.value)}</td><td class="n">${p.clubId === S.userClub ? '—' : money(FM.askingPrice(S, p))}</td></tr>`;
    }).join('')}</tbody></table></div></section>`;
  }

  // ---------- الكشافة ----------
  function scoutingView() {
    const free = FM.maxScouts(S) - S.scouts.length;
    const sf = UI.scoutForm || { region: 'dz', pos: 'any', age: 'young' };
    const r = FM.REGIONS[sf.region];
    return `<div class="row sp"><h2>شبكة الكشافة</h2><span class="muted">${num(S.scouts.length)}/${num(FM.maxScouts(S))} كشافين في مهام · مستوى الشبكة ${num(S.facilities.scouting)}</span></div>
    <div class="grid g-side">
      <div class="stack">
        ${S.reports.length ? S.reports.map((rep) => `<section class="panel"><h3>${esc(FM.REGIONS[rep.region].name)} <span class="muted">${rep.pos === 'any' ? 'كل المراكز' : FM.POS_AR[rep.pos]} · ${rep.age === 'young' ? 'مواهب شابة' : 'لاعبون جاهزون'} · الموسم ${rep.season} الجولة ${rep.week + 1}</span></h3>
          ${rep.players.filter((id) => S.players[id]).length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>المركز</th><th>اللاعب</th><th class="n">العمر</th><th class="n">التقييم</th><th>الإمكانات</th><th class="n">التعويض</th><th class="n">الأجر</th><th></th></tr></thead><tbody>${rep.players.map((id) => S.players[id]).filter(Boolean).map((p) => `<tr class="click" data-a="player" data-id="${p.id}"><td>${pos(p.pos)}</td><td class="nm">${esc(p.name)}</td><td class="n">${p.age}</td><td class="n">${ovr(p.ovr)}</td><td>${potStars(p)}</td><td class="n">${money(FM.askingPrice(S, p))}</td><td class="n">${money(FM.wageDemand(S, p))}</td><td>${S.shortlist.includes(p.id) ? '<span class="pill acc">مختصرة</span>' : ''}</td></tr>`).join('')}</tbody></table></div>` : '<div class="muted">انضم كل لاعبي هذا التقرير إلى أندية.</div>'}</section>`).join('') : '<div class="empty">لا تقارير بعد. أرسل كشافًا إلى منطقة واختر المركز والفئة العمرية.</div>'}
      </div>
      <div class="stack">
        <section class="panel stack"><h3>مهمة جديدة</h3>
          <div class="field"><label for="sreg">المنطقة</label><select id="sreg" data-c="sreg">${Object.keys(FM.REGIONS).map((k) => `<option value="${k}" ${sf.region === k ? 'selected' : ''}>${FM.REGIONS[k].name}</option>`).join('')}</select></div>
          <div class="field"><label for="spos">المركز</label><select id="spos" data-c="spos"><option value="any">كل المراكز</option>${FM.POS.map((p) => `<option value="${p}" ${sf.pos === p ? 'selected' : ''}>${FM.POS_AR[p]}</option>`).join('')}</select></div>
          <div class="field"><label for="sage">الفئة</label><select id="sage" data-c="sage"><option value="young" ${sf.age === 'young' ? 'selected' : ''}>مواهب شابة (16–19)</option><option value="any" ${sf.age === 'any' ? 'selected' : ''}>لاعبون جاهزون (20–29)</option></select></div>
          <dl class="kv"><dt>التكلفة</dt><dd>${$m(r.cost)}</dd><dt>المدة</dt><dd>${num(r.weeks)} أسابيع</dd><dt>عدد اللاعبين</dt><dd>${num(2 + S.facilities.scouting)}</dd><dt>جودة المواهب</dt><dd>${stars(1 + r.talent, 1 + r.talent)}</dd></dl>
          ${r.boost ? `<div class="muted" style="font-size:.82rem">لاعبو المنطقة يتميزون في: ${r.boost.map((k) => FM.ATTR_AR[k]).join(' و')}</div>` : ''}
          <button class="btn pri" data-a="startScout" ${free <= 0 ? 'disabled' : ''}>${free > 0 ? 'أرسل الكشاف' : 'لا كشاف متاح'}</button>
        </section>
        <section class="panel"><h3>مهام جارية</h3>${S.scouts.length ? S.scouts.map((sc) => `<div class="stack" style="gap:4px;margin-bottom:12px"><div class="row sp"><span>${esc(FM.REGIONS[sc.region].name)} · ${sc.pos === 'any' ? 'كل المراكز' : sc.pos} · ${sc.age === 'young' ? 'شباب' : 'جاهزون'}</span><span class="muted num">${sc.left} أسبوع</span></div>${bar(((sc.total - sc.left) / sc.total) * 100)}</div>`).join('') : '<div class="empty">لا مهام</div>'}</section>
        <section class="panel"><h3>كيف تعمل الكشافة</h3><p class="muted" style="margin:0;font-size:.86rem">كل تقرير يكشف لاعبين لا يعرفهم بقية الأندية. الإمكانات تظهر كمدى من النجوم: كلما ارتفعت معرفة الكشاف ضاق المدى. طوّر «شبكة الكشافة» في التدريب لكشاف إضافي وتقارير أدق ومواهب أكثر.</p></section>
      </div>
    </div>`;
  }

  // ---------- التدريب ----------
  function trainingView() {
    const tr = S.training;
    const sq = FM.squadOf(S, S.userClub);
    const youth = sq.filter((p) => p.age <= 21).sort((a, b) => b.pot - a.pot);
    const log = S.devLog.map((d) => ({ d, p: S.players[d.id] })).filter((x) => x.p);
    const intensity = [['خفيفة', 'لياقة +30 أسبوعيًا، تطور أبطأ'], ['عادية', 'لياقة +24، تطور عادي'], ['مكثفة', 'لياقة +17، تطور أسرع، خطر إصابات']];
    return `<div class="row sp"><h2>التدريب والتطوير</h2></div>
    <div class="grid g-side">
      <div class="stack">
        <section class="panel stack"><h3>برنامج الفريق الأسبوعي</h3>
          <div class="chips">${Object.keys(FM.TRAIN_FOCUS).map((k) => `<button class="chip txt ${tr.focus === k ? 'on' : ''}" data-a="tfocus" data-v="${k}">${FM.TRAIN_FOCUS[k].name}</button>`).join('')}</div>
          <div class="muted" style="font-size:.84rem">${tr.focus === 'tactical' ? 'يرفع الانسجام مع خطتك الحالية 6% كل أسبوع، والتطور الفردي أبطأ.' : FM.TRAIN_FOCUS[tr.focus].attrs ? `60% من التطور يذهب إلى: ${FM.TRAIN_FOCUS[tr.focus].attrs.map((k) => FM.ATTR_AR[k]).join('، ')}` : 'التطور يتوزع حسب أهمية كل صفة لمركز اللاعب.'}</div>
          <div class="tac-row"><span class="lbl">الشدة</span><div class="seg">${intensity.map(([l], i) => `<button class="${tr.intensity === i ? 'on' : ''}" data-a="tint" data-v="${i}">${l}</button>`).join('')}</div><span class="muted" style="font-size:.82rem">${intensity[tr.intensity][1]}</span></div>
        </section>
        <section class="panel"><h3>المواهب الشابة <span class="muted">21 سنة فأقل</span></h3>${youth.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>المركز</th><th>اللاعب</th><th class="n">العمر</th><th class="n">التقييم</th><th>الإمكانات</th><th>التركيز الفردي</th></tr></thead><tbody>${youth.map((p) => `<tr><td>${pos(p.pos)}</td><td class="nm"><a href="#" data-a="player" data-id="${p.id}" style="color:inherit">${esc(p.name)}</a></td><td class="n">${p.age}</td><td class="n">${ovr(p.ovr)}</td><td>${potStars(p)}</td><td><select data-c="pfocus" data-id="${p.id}" aria-label="التركيز الفردي"><option value="">برنامج الفريق</option>${FM.ATTRS.filter((k) => k !== 'gk' || p.pos === 'GK').map((k) => `<option value="${k}" ${p.focus === k ? 'selected' : ''}>${FM.ATTR_AR[k]}</option>`).join('')}</select></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">لا لاعبين شبابًا. اكتشفهم عبر الكشافة أو أكاديمية الشباب.</div>'}</section>
        <section class="panel"><h3>تطور الأسبوع الماضي</h3>${log.length ? `<div class="chips">${log.map(({ d, p }) => `<span class="pill ${d.to > d.from ? 'good' : 'bad'}">${esc(shortName(p.name))} <span class="num ltr">${d.from}→${d.to}</span></span>`).join('')}</div>` : '<div class="muted">لا تغير في التقييمات الأسبوع الماضي.</div>'}</section>
      </div>
      <div class="stack">
        ${Object.keys(FM.FACILITY).map((k) => { const lvl = S.facilities[k]; const cost = FM.facilityCost(lvl); return `<section class="panel stack"><div class="row sp"><h3 style="margin:0">${FM.FACILITY[k].name}</h3><span class="num">${'■'.repeat(lvl)}<span class="muted">${'□'.repeat(5 - lvl)}</span></span></div><div class="muted" style="font-size:.84rem">${FM.FACILITY[k].desc}</div>${lvl < 5 ? `<button class="btn" data-a="upgrade" data-k="${k}" ${me().budget < cost ? 'disabled' : ''}>طوّر إلى المستوى ${lvl + 1} · ${money(cost)}</button>` : '<span class="pill good">المستوى الأعلى</span>'}</section>`; }).join('')}
      </div>
    </div>`;
  }

  // ---------- الدوري ----------
  function leagueView() {
    const tb = FM.table(S);
    const r = UI.round === null ? Math.min(S.week, S.fixtures.length - 1) : UI.round;
    const round = S.fixtures[r];
    const players = Object.values(S.players).filter((p) => p.clubId);
    const scorers = players.filter((p) => p.st.goals).sort((a, b) => b.st.goals - a.st.goals).slice(0, 10);
    const assists = players.filter((p) => p.st.assists).sort((a, b) => b.st.assists - a.st.assists).slice(0, 6);
    return `<div class="grid g-side">
      <section class="panel"><h3>جدول الترتيب</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th class="n">#</th><th>النادي</th><th class="n">لعب</th><th class="n">ف</th><th class="n">ت</th><th class="n">خ</th><th class="n">له</th><th class="n">عليه</th><th class="n">±</th><th class="n">نقاط</th><th>آخر 5</th></tr></thead><tbody>${tb.map((row, i) => { const c = FM.club(S, row.id); return `<tr class="${row.id === S.userClub ? 'me' : ''}"><td class="n">${i + 1}</td><td><span class="row" style="gap:8px;flex-wrap:nowrap">${crest(c, 18)}${esc(c.name)}</span></td><td class="n">${row.p}</td><td class="n">${row.w}</td><td class="n">${row.d}</td><td class="n">${row.l}</td><td class="n">${row.gf}</td><td class="n">${row.ga}</td><td class="n"><span class="ltr">${row.gf - row.ga > 0 ? '+' : ''}${row.gf - row.ga}</span></td><td class="n"><b>${row.pts}</b></td><td>${formChips(row.form)}</td></tr>`; }).join('')}</tbody></table></div>
        <div class="muted" style="font-size:.8rem;margin-top:8px">الأول بطل ويحصل على مكافأة إضافية ${money(4000000)}. كل مركز أعلى يرفع جائزة نهاية الموسم.</div></section>
      <div class="stack">
        <section class="panel"><div class="row sp" style="margin-bottom:10px"><button class="btn sm" data-a="round" data-v="${r - 1}" ${r <= 0 ? 'disabled' : ''}>▸ السابقة</button><h3 style="margin:0">الجولة ${num(r + 1)}</h3><button class="btn sm" data-a="round" data-v="${r + 1}" ${r >= S.fixtures.length - 1 ? 'disabled' : ''}>التالية ◂</button></div>
          ${round.map((f) => { const h = FM.club(S, f.h), a = FM.club(S, f.a); const mine = f.h === S.userClub || f.a === S.userClub; return `<div class="row sp" style="padding:6px 0;border-bottom:1px solid var(--line);${mine ? 'color:var(--accent)' : ''}"><span style="flex:1">${esc(h.short)}</span><b>${f.hg === null ? '–' : pair(f.hg, f.ag, ':')}</b><span style="flex:1;text-align:left">${esc(a.short)}</span></div>`; }).join('')}</section>
        <section class="panel"><h3>الهدافون</h3>${scorers.map((p, i) => `<div class="row sp" data-a="player" data-id="${p.id}" style="cursor:pointer;font-size:.88rem"><span>${i + 1}. ${esc(p.name)} <span class="muted">${esc(FM.club(S, p.clubId).short)}</span></span><b class="num">${p.st.goals}</b></div>`).join('') || '<div class="muted">—</div>'}</section>
        <section class="panel"><h3>التمريرات الحاسمة</h3>${assists.map((p, i) => `<div class="row sp" data-a="player" data-id="${p.id}" style="cursor:pointer;font-size:.88rem"><span>${i + 1}. ${esc(p.name)} <span class="muted">${esc(FM.club(S, p.clubId).short)}</span></span><b class="num">${p.st.assists}</b></div>`).join('') || '<div class="muted">—</div>'}</section>
      </div>
    </div>`;
  }

  // ---------- المالية ----------
  function financeView() {
    const c = me();
    const sq = FM.squadOf(S, S.userClub);
    const wages = sq.reduce((a, p) => a + p.wage, 0);
    const fw = S.finance.week;
    const log = S.finance.log;
    const W = 520, H = 170, pl = 46, pb = 18, pt = 8;
    let chart = '<div class="empty">يظهر الرسم بعد أول جولة</div>';
    if (log.length > 1) {
      const vals = log.map((x) => x.bal);
      const mn = Math.min(0, ...vals), mx = Math.max(...vals);
      const X = (i) => pl + (i / (log.length - 1)) * (W - pl - 10);
      const Y = (v) => pt + (1 - (v - mn) / (mx - mn || 1)) * (H - pt - pb);
      let g = '';
      for (let k = 0; k <= 3; k++) { const v = mn + ((mx - mn) * k) / 3; g += `<line class="gr" x1="${pl}" x2="${W - 10}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${pl - 6}" y="${Y(v) + 3}" text-anchor="end">${money(v)}</text>`; }
      const pts = vals.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
      chart = `<svg class="chart" viewBox="0 0 ${W} ${H}" style="direction:ltr" role="img" aria-label="تطور الرصيد">${g}<polygon class="area" points="${X(0)},${Y(mn)} ${pts} ${X(vals.length - 1)},${Y(mn)}"/><polyline class="us" points="${pts}"/><circle cx="${X(vals.length - 1)}" cy="${Y(vals[vals.length - 1])}" r="3.5" class="usf"/></svg>`;
    }
    const pos = FM.position(S, S.userClub);
    return `<div class="row sp"><h2>المالية</h2></div>
    <div class="grid g3">
      <section class="panel"><div class="eyebrow">الرصيد الحالي</div><div class="big ${c.budget < 0 ? 'bad' : ''}">${$m(c.budget)}</div></section>
      <section class="panel"><div class="eyebrow">فاتورة الأجور الأسبوعية</div><div class="big">${$m(wages)}</div><div class="muted" style="font-size:.8rem">${num(sq.length)} لاعبًا</div></section>
      <section class="panel"><div class="eyebrow">جائزة المركز الحالي (${pos})</div><div class="big">${$m((S.clubs.length - pos + 1) * 900000 + (pos === 1 ? 4000000 : 0))}</div><div class="muted" style="font-size:.8rem">تُصرف في نهاية الموسم</div></section>
    </div>
    <div class="grid g-side">
      <section class="panel"><h3>تطور الرصيد</h3>${chart}</section>
      <section class="panel"><h3>الأسبوع الماضي</h3>${fw ? `<dl class="kv"><dt>الرعاية</dt><dd class="good">${$m(fw.sponsor)}</dd><dt>التذاكر</dt><dd class="good">${fw.tickets ? $m(fw.tickets) : '<span class="muted">مباراة خارج الأرض</span>'}</dd><dt>الأجور</dt><dd class="bad">${$m(-fw.wages)}</dd><dt>الصافي</dt><dd><b>${$m(fw.sponsor + fw.tickets - fw.wages)}</b></dd></dl>` : '<div class="muted">لا حركة بعد</div>'}
        <p class="muted" style="font-size:.82rem;margin:12px 0 0">الملعب يتسع لـ${num(c.capacity.toLocaleString('en'))} متفرج. الحضور يرتفع مع سمعة النادي وثقة الجماهير وقوة الخصم.</p></section>
    </div>`;
  }

  function inboxView() {
    return `<section class="panel"><div class="row sp" style="margin-bottom:6px"><h2>البريد</h2><button class="btn sm" data-a="readAll">تعليم الكل كمقروء</button></div>${S.inbox.map(msgHTML).join('') || '<div class="empty">لا رسائل</div>'}</section>`;
  }

  // ---------- قبل المباراة ----------
  function prematchModal() {
    const f = FM.userFixture(S);
    const home = f.h === S.userClub;
    const oppId = home ? f.a : f.h;
    const t = myT();
    const problems = FM.validateLineup(S, S.userClub, t);
    FM.prepareAI(S, oppId, S.userClub);
    const w = tacticWarnings(t).list.filter((x) => x.c === 'bad');
    const h = FM.club(S, f.h), a = FM.club(S, f.a);
    return `<div class="overlay" data-a="closeBg"><div class="modal" role="dialog" aria-modal="true" aria-label="يوم المباراة">
      <div class="mh"><h2>يوم المباراة</h2><button class="btn ghost x" data-a="close" aria-label="إغلاق">✕</button></div>
      <div class="mb">
        <div class="fixture"><div class="side">${crest(h, 50)}<div class="nm">${esc(h.name)}</div></div><div class="score muted">ضد</div><div class="side">${crest(a, 50)}<div class="nm">${esc(a.name)}</div></div></div>
        <div class="grid g2">
          <div>${tacticPitch(t, me(), false)}</div>
          <div class="stack"><dl class="kv"><dt>الخطة</dt><dd class="num">${t.formation}</dd><dt>الأسلوب</dt><dd>${esc(t.preset && FM.PRESETS[t.preset] ? FM.PRESETS[t.preset].name : 'مخصص')}</dd>${Object.keys(FM.TACTIC_KEYS).map((k) => `<dt>${FM.TACTIC_AR[k]}</dt><dd>${FM.TACTIC_KEYS[k][t[k]]}</dd>`).join('')}<dt>الاحتياط</dt><dd>${t.bench.length} لاعبين</dd></dl>
            ${problems.length || w.length ? `<ul class="warn-list">${problems.map((x) => `<li class="acc">${esc(x)}</li>`).join('')}${w.map((x) => `<li class="bad">${esc(x.t)}</li>`).join('')}</ul>` : '<div class="pill good" style="justify-self:start">التشكيلة جاهزة</div>'}
          </div>
        </div>
        <div class="row" style="justify-content:flex-end;border-top:1px solid var(--line);padding-top:14px">
          <button class="btn ghost" data-a="goTactics">عدّل التكتيك</button>
          <button class="btn" data-a="playInstant">النتيجة مباشرة</button>
          <button class="btn pri" data-a="playLive">قُد المباراة من الخط ◂</button>
        </div>
      </div></div></div>`;
  }

  // ---------- المباراة المباشرة ----------
  function startLive(instant) {
    const f = FM.userFixture(S);
    const us = f.h === S.userClub ? 0 : 1;
    const oppId = us === 0 ? f.a : f.h;
    FM.validateLineup(S, S.userClub, myT());
    FM.prepareAI(S, oppId, S.userClub);
    const m = FM.createMatch(S, f.h, f.a, S.tactics[f.h], S.tactics[f.a], { userSide: us, ai: instant ? [true, true] : [us !== 0, us !== 1] });
    UI.modal = null;
    if (instant) { FM.simulate(S, m); finishRound(m); return; }
    UI.match = { m, us, speed: 1, paused: false, out: null, inn: null, shown: 0, flash: false, panel: 'tac' };
    UI.view = 'match';
    render();
    tick();
  }
  function tick() {
    const L = UI.match;
    if (!L) return;
    clearTimeout(L.timer);
    if (L.paused || L.m.finished) return;
    const goalsBefore = L.m.sides[0].goals + L.m.sides[1].goals;
    FM.stepMinute(S, L.m);
    const scored = L.m.sides[0].goals + L.m.sides[1].goals > goalsBefore;
    if (L.m.minute === 45) { L.paused = true; L.note = 'استراحة ما بين الشوطين: راجع الخطة والتبديلات ثم استأنف'; }
    updateLive(scored);
    if (L.m.finished) { renderMatchControls(); return; }
    const delay = [0, 650, 320, 120][L.speed] + (scored ? 1300 : 0);
    L.timer = setTimeout(tick, delay);
  }
  function dotPositions(m) {
    // الإحداثيات بالأمتار على ملعب أفقي 105×68
    const last = m.tl[m.tl.length - 1];
    const bx = last ? last.x : 50;
    const out = [];
    m.sides.forEach((sd, k) => {
      const slots = FM.FORMATIONS[sd.tactic.formation];
      const poss = last && last.s === k;
      for (const e of sd.on) {
        const sl = slots[e.slot] || slots[0];
        let depth = sl[1];
        if (e.role !== 'GK') depth += (k === 0 ? bx - 50 : 50 - bx) * 0.35 + (poss ? 7 : -4) + (sd.tactic.line - 1) * 5;
        depth = Math.max(3, Math.min(e.role === 'GK' ? 12 : 92, depth));
        // صاحب الأرض يدافع عن المرمى الأيمن ويهاجم نحو اليسار، مثل مكانه في لوحة النتيجة
        const x = k === 0 ? 100 - depth : depth;
        const y = k === 0 ? 100 - sl[2] : sl[2];
        out.push({ id: e.id, k, x: (x / 100) * 101 + 2, y: (y / 100) * 62 + 3 });
      }
    });
    return { dots: out, ball: last ? { x: ((100 - last.x) / 100) * 101 + 2, y: ((100 - last.y) / 100) * 62 + 3 } : { x: 52.5, y: 34 } };
  }
  function matchView() {
    const L = UI.match;
    const m = L.m;
    const h = FM.club(S, m.sides[0].clubId), a = FM.club(S, m.sides[1].clubId);
    const pos0 = dotPositions(m);
    let dots = '';
    for (const d of pos0.dots) {
      const c = d.k === 0 ? h : a;
      const p = S.players[d.id];
      dots += `<g class="dot" id="d-${d.id}" style="transform:translate(${d.x}px,${d.y}px)"><circle r="2" fill="${c.color}" stroke="${c.color2}" stroke-width="0.4"/><text fill="${c.color2}" y="0.1">${p ? Math.min(99, Math.round(p.ovr)) : ''}</text></g>`;
    }
    return `<div class="stack">
      <div class="scoreboard">
        <div class="tm">${crest(h, 40)}<span class="nm">${esc(h.name)}</span></div>
        <div class="sc"><div class="g" id="lv-score">${pair(m.sides[0].goals, m.sides[1].goals)}</div><div class="clock" id="lv-clock">${m.minute}'</div></div>
        <div class="tm away">${crest(a, 40)}<span class="nm">${esc(a.name)}</span></div>
      </div>
      <div class="live-grid">
        <div class="stack">
          <div class="panel" style="padding:10px"><div class="pitch-wrap"><svg class="pitch" viewBox="0 0 105 68" role="img" aria-label="الملعب المباشر" style="direction:ltr">${pitchLines(105, 68, false)}<g id="lv-dots">${dots}</g><g class="ball" id="lv-ball" style="transform:translate(${pos0.ball.x}px,${pos0.ball.y}px)"><circle r="1.1" fill="#fff" stroke="#000" stroke-width="0.25"/></g></svg><div id="lv-flash"></div></div>
            <div class="row sp" style="margin-top:8px;font-size:.8rem"><span class="muted">${esc(h.short)} ◂ يهاجم نحو اليسار</span><span class="muted">الزخم</span><span class="muted">${esc(a.short)}</span></div>
            <div class="mom" id="lv-mom"></div>
          </div>
          <div class="panel" id="lv-controls"></div>
        </div>
        <div class="stack">
          <section class="panel" id="lv-stats"></section>
          <section class="panel"><h3>التعليق</h3><div class="feed" id="lv-feed"></div></section>
        </div>
      </div>
    </div>`;
  }
  function updateLive(scored) {
    const L = UI.match;
    if (!L || UI.view !== 'match') return;
    const m = L.m;
    const sc = document.getElementById('lv-score');
    if (!sc) return;
    sc.innerHTML = pair(m.sides[0].goals, m.sides[1].goals);
    document.getElementById('lv-clock').textContent = m.finished ? 'نهاية المباراة' : `${m.minute > 90 ? '90+' + (m.minute - 90) : m.minute}'${m.minute <= 45 ? ' · الشوط 1' : ' · الشوط 2'}`;
    const P = dotPositions(m);
    const g = document.getElementById('lv-dots');
    const present = new Set(P.dots.map((d) => d.id));
    for (const el of Array.from(g.children)) if (!present.has(el.id.slice(2))) el.remove();
    for (const d of P.dots) {
      let el = document.getElementById('d-' + d.id);
      if (!el) {
        const c = FM.club(S, m.sides[d.k].clubId);
        const p = S.players[d.id];
        g.insertAdjacentHTML('beforeend', `<g class="dot" id="d-${d.id}" style="transform:translate(${d.x}px,${d.y}px)"><circle r="2" fill="${c.color}" stroke="${c.color2}" stroke-width="0.4"/><text fill="${c.color2}" y="0.1">${p ? Math.round(p.ovr) : ''}</text></g>`);
        el = document.getElementById('d-' + d.id);
      }
      el.style.transform = `translate(${d.x}px,${d.y}px)`;
    }
    document.getElementById('lv-ball').style.transform = `translate(${P.ball.x}px,${P.ball.y}px)`;
    const mom = Math.max(-20, Math.min(20, m.mom)) / 20;
    document.getElementById('lv-mom').innerHTML = mom >= 0 ? `<span style="left:50%;width:${mom * 50}%;background:${FM.club(S, m.sides[0].clubId).color}"></span>` : `<span style="right:50%;width:${-mom * 50}%;background:${FM.club(S, m.sides[1].clubId).color}"></span>`;
    if (scored) {
      const fl = document.getElementById('lv-flash');
      fl.innerHTML = '<div class="goal-flash">هدف!</div>';
      setTimeout(() => { if (fl) fl.innerHTML = ''; }, 1500);
    }
    const [A, B] = m.sides;
    const mins = Math.max(1, m.minute);
    const rows = [['الاستحواذ', Math.round((A.poss / mins) * 100) + '%', Math.round((B.poss / mins) * 100) + '%'], ['التسديدات', A.shots, B.shots], ['على المرمى', A.onT, B.onT], ['xG', A.xg.toFixed(2), B.xg.toFixed(2)], ['الركنيات', A.corners, B.corners], ['البطاقات', `${A.yel}/${A.red}`, `${B.yel}/${B.red}`], ['التبديلات', `${A.subs}/5`, `${B.subs}/5`]];
    document.getElementById('lv-stats').innerHTML = `<h3>الإحصاءات</h3>${rows.map(([l, x, y]) => `<div class="stat-row"><span class="num">${x}</span><span class="lbl">${l}</span><span class="num">${y}</span></div>`).join('')}`;
    if (m.events.length !== L.shown) {
      L.shown = m.events.length;
      document.getElementById('lv-feed').innerHTML = m.events.slice().reverse().map((e) => `<div class="e ${e.type}"><span class="m">${e.min}'</span><span>${esc(e.text)}</span></div>`).join('');
    }
    if (m.minute === 45 || m.finished || scored || L.dirty) { L.dirty = false; renderMatchControls(); }
  }
  function renderMatchControls() {
    const L = UI.match;
    const box = document.getElementById('lv-controls');
    if (!box) return;
    const m = L.m, sd = m.sides[L.us];
    if (m.finished) {
      box.innerHTML = `<div class="row sp"><div><h3>انتهت المباراة</h3><div class="muted">${esc(m.names[0])} ${m.sides[0].goals} – ${m.sides[1].goals} ${esc(m.names[1])}</div></div><button class="btn pri" data-a="mFinish">تقرير المباراة ونتائج الجولة ◂</button></div>`;
      return;
    }
    const speedBtns = [['1', '×1'], ['2', '×2'], ['3', '×4']].map(([v, l]) => `<button class="${L.speed === +v ? 'on' : ''}" data-a="mSpeed" data-v="${v}">${l}</button>`).join('');
    const t = sd.tactic;
    let panel = '';
    if (L.paused) {
      if (L.panel === 'tac') panel = `<div class="stack" style="margin-top:12px">${Object.keys(FM.TACTIC_KEYS).map((k) => segRow(k, t[k], 'mTac')).join('')}</div>`;
      else {
        panel = `<div class="grid g2" style="margin-top:12px">
          <div><div class="eyebrow" style="margin-bottom:6px">في الملعب: اختر من يخرج</div><div class="sub-list">${sd.on.map((e) => { const p = S.players[e.id]; return `<div class="sq ${L.out === e.id ? 'sel' : ''}" data-a="mOut" data-id="${e.id}">${pos(e.role)}<span class="nm">${esc(shortName(p.name))}</span>${bar(sd.fit[e.id])}<span class="num">${sd.rating[e.id].toFixed(1)}</span></div>`; }).join('')}</div></div>
          <div><div class="eyebrow" style="margin-bottom:6px">الدكة: اختر من يدخل</div><div class="sub-list">${sd.bench.map((id) => { const p = S.players[id]; const role = L.out ? (sd.on.find((e) => e.id === L.out) || {}).role : null; return `<div class="sq ${L.inn === id ? 'sel' : ''}" data-a="mIn" data-id="${id}">${pos(p.pos)}<span class="nm">${esc(shortName(p.name))}</span>${ovr(role ? FM.ovrAt(p, role) : p.ovr)}<span></span></div>`; }).join('') || '<div class="muted">لا أحد على الدكة</div>'}</div>
          <button class="btn pri" data-a="mSub" style="margin-top:10px;width:100%" ${L.out && L.inn && sd.subs < FM.MAX_SUBS ? '' : 'disabled'}>نفّذ التبديل (${sd.subs}/${FM.MAX_SUBS})</button></div>
        </div>`;
      }
    }
    box.innerHTML = `<div class="row sp"><div class="row"><button class="btn ${L.paused ? 'pri' : ''}" data-a="mPause">${L.paused ? '▸ استئناف' : '❚❚ إيقاف وتعديل'}</button><div class="seg" aria-label="السرعة">${speedBtns}</div></div><button class="btn ghost sm" data-a="mSkip">أكمل المباراة فورًا</button></div>
      ${L.note && L.paused ? `<div class="pill acc" style="margin-top:10px;white-space:normal">${esc(L.note)}</div>` : ''}
      ${L.paused ? `<div class="tabs" style="margin-top:12px"><button class="${L.panel === 'tac' ? 'on' : ''}" data-a="mPanel" data-v="tac">التعليمات</button><button class="${L.panel === 'sub' ? 'on' : ''}" data-a="mPanel" data-v="sub">التبديلات</button></div>${panel}` : '<div class="hint" style="margin-top:8px">أوقف المباراة لتغيير التعليمات أو إجراء تبديل. نسبة اللياقة تظهر عند التبديل.</div>'}`;
  }
  function finishRound(m) {
    FM.playRound(S, m);
    UI.match = null;
    UI.lab = null;
    UI.recCache = null;
    UI.round = null;
    if (S.seasonEnd && (S.week === 0 || S.gameOver)) UI.modal = { type: 'season' };
    UI.view = 'analysis';
    UI.tab.analysis = 'last';
    save();
    render();
    window.scrollTo(0, 0);
  }

  function seasonModal() {
    const E = S.seasonEnd;
    const youth = (E.youth || []).map((id) => S.players[id]).filter(Boolean);
    return `<div class="overlay"><div class="modal" role="dialog" aria-modal="true" aria-label="نهاية الموسم">
      <div class="mh"><h2>${S.gameOver ? 'نهاية المسيرة' : 'نهاية الموسم'}</h2></div>
      <div class="mb">
        <div class="grid g3"><div><div class="eyebrow">مركزنا</div><div class="big">${E.pos}</div><div class="muted">الهدف كان ${E.target}</div></div><div><div class="eyebrow">البطل</div><h3>${esc(E.champ)}</h3></div><div><div class="eyebrow">جائزة المركز</div><div class="big" style="font-size:1.5rem">${$m(E.prize)}</div></div></div>
        <div class="pill ${E.pos <= E.target ? 'good' : 'bad'}" style="justify-self:start;white-space:normal">${esc(E.verdict)}</div>
        <dl class="kv"><dt>هدّاف الدوري</dt><dd>${E.scorer ? `${esc(E.scorer.name)} (${esc(E.scorer.club)}) · ${num(E.scorer.goals)} هدفًا` : '—'}</dd><dt>أفضل لاعب</dt><dd>${E.best ? `${esc(E.best.name)} · ${num(E.best.avg)}` : '—'}</dd>${E.retired && E.retired.length ? `<dt>اعتزلوا</dt><dd>${esc(E.retired.join('، '))}</dd>` : ''}${E.left && E.left.length ? `<dt>غادروا بنهاية العقد</dt><dd>${esc(E.left.join('، '))}</dd>` : ''}</dl>
        ${youth.length ? `<div class="stack"><h3>دفعة أكاديمية الشباب</h3>${youth.map((p) => `<div class="row sp" data-a="player" data-id="${p.id}" style="cursor:pointer"><span>${pos(p.pos)} ${esc(p.name)} <span class="muted">${p.age} سنة</span></span><span class="row">${ovr(p.ovr)}${potStars(p)}</span></div>`).join('')}</div>` : ''}
        <div class="row" style="justify-content:flex-end">${S.gameOver ? '<button class="btn pri" data-a="newCareer">مسيرة جديدة</button>' : `<button class="btn pri" data-a="seasonGo">ابدأ الموسم ${S.season}</button>`}</div>
      </div></div></div>`;
  }

  // ---------- الرسم ----------
  function render() {
    const app = document.getElementById('app');
    const active = document.activeElement;
    const fid = active && active.id && active.tagName === 'INPUT' ? active.id : null;
    const caret = fid ? active.selectionStart : null;
    let html;
    if (!S || UI.view === 'start') html = startView();
    else {
      let body;
      switch (UI.view) {
        case 'squad': body = squadView(); break;
        case 'tactics': body = tacticsView(); break;
        case 'analysis': body = analysisView(); break;
        case 'transfers': body = transfersView(); break;
        case 'scouting': body = scoutingView(); break;
        case 'training': body = trainingView(); break;
        case 'league': body = leagueView(); break;
        case 'finance': body = financeView(); break;
        case 'inbox': body = inboxView(); break;
        case 'match': body = matchView(); break;
        default: body = homeView();
      }
      html = header() + `<main class="wrap">${body}</main>`;
      if (UI.modal) {
        if (UI.modal.type === 'player') html += playerModal(UI.modal.id);
        else if (UI.modal.type === 'prematch') html += prematchModal();
        else if (UI.modal.type === 'season') html += seasonModal();
      }
    }
    if (UI.toast) html += `<div class="toast ${UI.toast.bad ? 'bad' : ''}" role="status">${esc(UI.toast.text)}</div>`;
    app.innerHTML = html;
    if (UI.view === 'match' && UI.match) { UI.match.shown = -1; updateLive(false); renderMatchControls(); }
    if (fid) { const el = document.getElementById(fid); if (el) { el.focus(); try { el.setSelectionRange(caret, caret); } catch { /* حقل رقمي */ } } }
  }

  // ---------- الأفعال ----------
  const A = {
    nav: (d) => { UI.view = d.v; UI.sel = null; UI.modal = null; render(); window.scrollTo(0, 0); },
    tab: (d) => { UI.tab[d.k] = d.v; render(); },
    pickClub: (d) => { UI.start.club = +d.i; render(); },
    newGame: () => {
      const nm = (document.getElementById('mgr') || {}).value || UI.start.name || 'المدرب';
      S = FM.newGame(UI.start.club, nm.trim() || 'المدرب');
      UI.view = 'home';
      save();
      render();
      window.scrollTo(0, 0);
    },
    continue: () => { S = loadSave(); if (S) { UI.view = 'home'; render(); } },
    next: () => {
      if (S.gameOver) { UI.modal = { type: 'season' }; render(); return; }
      if (!FM.userFixture(S)) return;
      UI.modal = { type: 'prematch' };
      render();
    },
    goTactics: () => { UI.modal = null; UI.view = 'tactics'; render(); },
    playLive: () => startLive(false),
    playInstant: () => startLive(true),
    close: () => { UI.modal = null; UI.confirm = null; UI.offerMsg = null; render(); },
    closeBg: (d, el, e) => { if (e.target === el) A.close(); },
    player: (d) => { UI.modal = { type: 'player', id: d.id }; UI.confirm = null; UI.offerMsg = null; render(); },
    sort: (d) => { if (UI.sort.key === d.k) UI.sort.dir *= -1; else UI.sort = { key: d.k, dir: 1 }; render(); },
    msg: (d) => { const m = S.inbox.find((x) => x.id === +d.id); if (m) { if (m.read) UI.openMsg = UI.openMsg === m.id ? null : m.id; m.read = true; save(); render(); } },
    readAll: () => { S.inbox.forEach((m) => { m.read = true; }); save(); render(); },
    // التكتيك
    formation: (d) => {
      const t = myT();
      t.formation = d.v;
      FM.autoPick(S, S.userClub, t);
      UI.sel = null; save(); render();
    },
    preset: (d) => { const t = myT(); const p = FM.PRESETS[d.v]; for (const k of Object.keys(FM.TACTIC_KEYS)) t[k] = p[k]; t.preset = d.v; save(); render(); },
    tset: (d) => { const t = myT(); t[d.k] = +d.v; t.preset = matchPreset(t); save(); render(); },
    autoPick: () => { FM.autoPick(S, S.userClub, myT()); UI.sel = null; save(); render(); },
    unsel: () => { UI.sel = null; render(); },
    slot: (d) => {
      const i = +d.i, t = myT();
      if (UI.sel && UI.sel.slot !== undefined) {
        const j = UI.sel.slot;
        if (i !== j) { const tmp = t.lineup[i]; t.lineup[i] = t.lineup[j]; t.lineup[j] = tmp; }
        UI.sel = null; save();
      } else if (UI.sel && UI.sel.pid) { placePlayer(UI.sel.pid, i); UI.sel = null; save(); }
      else UI.sel = { slot: i };
      render();
    },
    pickP: (d) => {
      const p = S.players[d.id];
      if (!p) return;
      if (UI.sel && UI.sel.slot !== undefined) { placePlayer(d.id, UI.sel.slot); UI.sel = null; save(); }
      else UI.sel = UI.sel && UI.sel.pid === d.id ? null : { pid: d.id };
      render();
    },
    benchToggle: (d, el, e) => {
      e.stopPropagation();
      const t = myT();
      if (t.bench.includes(d.id)) t.bench = t.bench.filter((x) => x !== d.id);
      else if (t.bench.length >= 7) { toast('الدكة ممتلئة (7 لاعبين)', true); return; }
      else if (!FM.available(S.players[d.id])) { toast('اللاعب غير متاح', true); return; }
      else t.bench.push(d.id);
      save(); render();
    },
    // اللاعب
    listToggle: (d) => { if (S.listed.includes(d.id)) S.listed = S.listed.filter((x) => x !== d.id); else S.listed.push(d.id); save(); render(); },
    renew: (d) => { const err = FM.renew(S, d.id, +d.y); if (err) toast(err, true); else { save(); toast('تم تجديد العقد'); } },
    releaseAsk: (d) => { UI.confirm = d.id ? 'release-' + d.id : null; render(); },
    releaseDo: (d) => { const err = FM.release(S, d.id); UI.confirm = null; if (err) toast(err, true); else { UI.modal = null; save(); toast('سُرّح اللاعب'); } },
    shortlist: (d) => { if (S.shortlist.includes(d.id)) S.shortlist = S.shortlist.filter((x) => x !== d.id); else S.shortlist.push(d.id); save(); render(); },
    scoutP: (d) => { const err = FM.scoutPlayer(S, d.id); if (err) toast(err, true); else { save(); toast('وصل تقرير الكشاف: الإمكانات أوضح الآن'); } },
    offer: (d) => {
      const fee = Math.max(0, Math.round(+document.getElementById('ofee').value || 0));
      const wage = Math.max(0, Math.round(+document.getElementById('owage').value || 0));
      const yrs = +document.getElementById('oyrs').value || 3;
      const r = FM.makeOffer(S, d.id, fee, wage, yrs);
      UI.offerMsg = Object.assign({ id: d.id }, r);
      if (r.ok) { UI.modal = null; save(); toast(r.msg); } else render();
    },
    // الانتقالات
    fpos: (d) => { UI.filters.pos = d.v; render(); },
    ffree: () => { UI.filters.free = !UI.filters.free; render(); },
    acceptOffer: (d) => { const err = FM.acceptOffer(S, d.id); if (err) toast(err, true); else { save(); toast('تم البيع'); } },
    rejectOffer: (d) => { FM.rejectOffer(S, d.id); save(); render(); },
    // الكشافة والتدريب
    startScout: () => { const f = UI.scoutForm || { region: 'dz', pos: 'any', age: 'young' }; const err = FM.startScout(S, f.region, f.pos, f.age); if (err) toast(err, true); else { save(); toast(`انطلق الكشاف إلى ${FM.REGIONS[f.region].name}`); } },
    tfocus: (d) => { S.training.focus = d.v; save(); render(); },
    tint: (d) => { S.training.intensity = +d.v; save(); render(); },
    upgrade: (d) => { const err = FM.upgradeFacility(S, d.k); if (err) toast(err, true); else { save(); toast('تم التطوير'); } },
    round: (d) => { UI.round = Math.max(0, Math.min(S.fixtures.length - 1, +d.v)); render(); },
    // التحليل
    runLab: () => {
      const f = FM.userFixture(S);
      if (!f) return;
      UI.labBusy = true; render();
      setTimeout(() => {
        const home = f.h === S.userClub;
        const oppId = home ? f.a : f.h;
        const key = `${S.season}-${S.week}-${JSON.stringify([myT().formation, myT().lineup])}` + JSON.stringify(myT());
        const r = home ? FM.monteCarlo(S, S.userClub, myT(), oppId, S.tactics[oppId], 200) : FM.monteCarlo(S, oppId, S.tactics[oppId], S.userClub, myT(), 200);
        if (!home) { const t = r.w; r.w = r.l; r.l = t; [r.gf, r.ga] = [r.ga, r.gf]; [r.xgf, r.xga] = [r.xga, r.xgf]; r.top = r.top.map(([s, n]) => [s.split('-').reverse().join('-'), n]); }
        UI.lab = { key, res: r };
        UI.labBusy = false;
        render();
      }, 30);
    },
    applyRec: (d) => {
      const t = myT();
      const p = FM.PRESETS[d.p];
      for (const k of Object.keys(FM.TACTIC_KEYS)) t[k] = p[k];
      t.preset = d.p;
      if (t.formation !== d.f) { t.formation = d.f; FM.autoPick(S, S.userClub, t); }
      save(); toast(`طُبّقت خطة ${p.name} · ${d.f}`);
    },
    // المباراة
    mPause: () => { const L = UI.match; L.paused = !L.paused; if (!L.paused) { L.note = null; tick(); } renderMatchControls(); },
    mSpeed: (d) => { UI.match.speed = +d.v; renderMatchControls(); },
    mPanel: (d) => { UI.match.panel = d.v; renderMatchControls(); },
    mTac: (d) => { const L = UI.match; L.m.sides[L.us].tactic[d.k] = +d.v; FM.refresh(S, L.m); L.m.events.push({ min: L.m.minute, type: 'tactic', side: L.us, text: `${L.m.names[L.us]}: ${FM.TACTIC_AR[d.k]} ← ${FM.TACTIC_KEYS[d.k][+d.v]}` }); updateLive(false); renderMatchControls(); },
    mOut: (d) => { UI.match.out = d.id; renderMatchControls(); },
    mIn: (d) => { UI.match.inn = d.id; renderMatchControls(); },
    mSub: () => { const L = UI.match; const err = FM.substitute(S, L.m, L.us, L.out, L.inn); if (err) toast(err, true); L.out = null; L.inn = null; render(); },
    mSkip: () => { const L = UI.match; clearTimeout(L.timer); L.m.ai[L.us] = true; FM.simulate(S, L.m); L.paused = false; updateLive(false); renderMatchControls(); },
    mFinish: () => { finishRound(UI.match.m); },
    seasonGo: () => { S.seasonEnd = null; UI.modal = null; UI.view = 'home'; save(); render(); },
    newCareer: () => { clearSave(); S = null; UI.modal = null; UI.view = 'start'; render(); },
  };
  function matchPreset(t) {
    for (const k in FM.PRESETS) { const p = FM.PRESETS[k]; if (Object.keys(FM.TACTIC_KEYS).every((x) => p[x] === t[x])) return k; }
    return null;
  }
  function placePlayer(pid, slot) {
    const t = myT();
    const p = S.players[pid];
    if (!FM.available(p)) { toast(`${p.name} غير متاح`, true); return; }
    const old = t.lineup[slot];
    const at = t.lineup.indexOf(pid);
    if (at >= 0) { t.lineup[at] = old; t.lineup[slot] = pid; return; }
    const b = t.bench.indexOf(pid);
    if (b >= 0) { if (old) t.bench[b] = old; else t.bench.splice(b, 1); }
    t.lineup[slot] = pid;
  }

  const C = {
    mgrName: (v) => { UI.start.name = v; },
    pfocus: (v, el) => { const p = S.players[el.dataset.id]; if (p) { p.focus = v || null; save(); } },
    fq: (v) => { UI.filters.q = v.trim(); render(); },
    fage: (v) => { UI.filters.age = +v; render(); },
    fovr: (v) => { UI.filters.ovr = +v; render(); },
    fprice: (v) => { UI.filters.price = +v; render(); },
    sreg: (v) => { UI.scoutForm = Object.assign({ region: 'dz', pos: 'any', age: 'young' }, UI.scoutForm, { region: v }); render(); },
    spos: (v) => { UI.scoutForm = Object.assign({ region: 'dz', pos: 'any', age: 'young' }, UI.scoutForm, { pos: v }); render(); },
    sage: (v) => { UI.scoutForm = Object.assign({ region: 'dz', pos: 'any', age: 'young' }, UI.scoutForm, { age: v }); render(); },
  };

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-a]');
    if (!el) return;
    const fn = A[el.dataset.a];
    if (!fn) return;
    if (el.tagName === 'A') e.preventDefault();
    if (el.dataset.a !== 'closeBg') e.stopPropagation();
    fn(el.dataset, el, e);
  });
  document.addEventListener('change', (e) => {
    const el = e.target.closest('[data-c]');
    if (el && C[el.dataset.c]) C[el.dataset.c](el.value, el);
  });
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (el.dataset && el.dataset.c === 'mgrName') UI.start.name = el.value;
    if (el.dataset && el.dataset.c === 'fq') { clearTimeout(C.fqT); C.fqT = setTimeout(() => C.fq(el.value), 250); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && UI.modal && UI.modal.type !== 'season') A.close();
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('g.tok')) { e.preventDefault(); A.slot(e.target.dataset); }
  });

  // ---------- الإقلاع ----------
  function start(data) {
    if (data && data.S) { S = data.S; UI.view = data.view && data.view !== 'match' ? data.view : 'home'; }
    render();
  }
  const hot = window.claude && window.claude.hot;
  if (hot && hot.snapshot) hot.snapshot(() => ({ S, view: UI.view }));
  if (hot && hot.ready) hot.ready(start); else start((hot && hot.data) || {});
})();
