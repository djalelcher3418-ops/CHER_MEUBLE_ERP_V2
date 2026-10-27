/* محرك اللعبة: اللاعبون، الأندية، التكتيك، محاكاة المباريات، التطوير، الانتقالات والموسم.
   لا يلمس الواجهة: كل ما هنا دوال على كائن الحالة S، فيمكن تجربته في Node. */
(function (root) {
  'use strict';

  // ---------- العشوائية (قابلة للتثبيت في الاختبارات) ----------
  let seedState = (Date.now() ^ 0x5f3759df) | 0;
  function rand() {
    seedState = (seedState + 0x6d2b79f5) | 0;
    let t = Math.imul(seedState ^ (seedState >>> 15), 1 | seedState);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const setSeed = (s) => { seedState = s | 0; };
  const ri = (a, b) => a + Math.floor(rand() * (b - a + 1));
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const round1 = (v) => Math.round(v * 10) / 10;
  function gauss() {
    let u = 0, v = 0;
    while (!u) u = rand();
    while (!v) v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  function weighted(items, wfn) {
    let total = 0;
    const ws = items.map((it) => { const w = Math.max(0, wfn(it)); total += w; return w; });
    if (total <= 0) return items[0];
    let r = rand() * total;
    for (let i = 0; i < items.length; i++) { r -= ws[i]; if (r <= 0) return items[i]; }
    return items[items.length - 1];
  }
  const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

  // ---------- الثوابت ----------
  const ATTRS = ['pac', 'sho', 'pas', 'dri', 'def', 'phy', 'vis', 'gk'];
  const ATTR_AR = { pac: 'السرعة', sho: 'التسديد', pas: 'التمرير', dri: 'المراوغة', def: 'الدفاع', phy: 'البدنية', vis: 'الرؤية', gk: 'الحراسة' };
  const POS = ['GK', 'CB', 'LB', 'RB', 'DM', 'CM', 'AM', 'LW', 'RW', 'ST'];
  const POS_AR = { GK: 'حارس مرمى', CB: 'قلب دفاع', LB: 'ظهير أيسر', RB: 'ظهير أيمن', DM: 'وسط دفاعي', CM: 'وسط ميدان', AM: 'صانع ألعاب', LW: 'جناح أيسر', RW: 'جناح أيمن', ST: 'رأس حربة' };
  const W = {
    GK: { gk: 0.8, phy: 0.07, pas: 0.06, vis: 0.07 },
    CB: { def: 0.45, phy: 0.25, pac: 0.12, pas: 0.1, vis: 0.08 },
    LB: { def: 0.3, pac: 0.25, pas: 0.15, phy: 0.12, dri: 0.1, vis: 0.08 },
    RB: { def: 0.3, pac: 0.25, pas: 0.15, phy: 0.12, dri: 0.1, vis: 0.08 },
    DM: { def: 0.32, pas: 0.24, phy: 0.2, vis: 0.14, pac: 0.1 },
    CM: { pas: 0.3, vis: 0.24, phy: 0.13, dri: 0.12, def: 0.11, sho: 0.1 },
    AM: { vis: 0.28, pas: 0.2, dri: 0.25, sho: 0.2, pac: 0.07 },
    LW: { pac: 0.3, dri: 0.3, sho: 0.15, pas: 0.15, vis: 0.1 },
    RW: { pac: 0.3, dri: 0.3, sho: 0.15, pas: 0.15, vis: 0.1 },
    ST: { sho: 0.45, pac: 0.15, phy: 0.15, dri: 0.15, vis: 0.1 },
  };
  const RELATED = { GK: [], CB: ['DM'], LB: ['RB', 'LW'], RB: ['LB', 'RW'], DM: ['CM', 'CB'], CM: ['DM', 'AM'], AM: ['CM', 'ST', 'LW', 'RW'], LW: ['RW', 'AM', 'LB'], RW: ['LW', 'AM', 'RB'], ST: ['AM'] };
  // مساهمة كل مركز في خطوط الفريق
  const LINES = {
    GK: { gk: 1 }, CB: { def: 1 }, LB: { def: 0.65, mid: 0.25, att: 0.1 }, RB: { def: 0.65, mid: 0.25, att: 0.1 },
    DM: { def: 0.5, mid: 0.75 }, CM: { mid: 1, att: 0.25, def: 0.2 }, AM: { mid: 0.6, att: 0.75 },
    LW: { att: 0.85, mid: 0.3 }, RW: { att: 0.85, mid: 0.3 }, ST: { att: 1 },
  };
  // الخطط: [المركز، العمق 0..100 من مرمانا، العرض 0..100 من اليسار]
  const FORMATIONS = {
    '4-3-3': [['GK', 5, 50], ['LB', 25, 12], ['CB', 20, 37], ['CB', 20, 63], ['RB', 25, 88], ['CM', 46, 28], ['DM', 38, 50], ['CM', 46, 72], ['LW', 72, 15], ['ST', 80, 50], ['RW', 72, 85]],
    '4-4-2': [['GK', 5, 50], ['LB', 25, 12], ['CB', 20, 37], ['CB', 20, 63], ['RB', 25, 88], ['LW', 52, 12], ['CM', 46, 38], ['CM', 46, 62], ['RW', 52, 88], ['ST', 78, 38], ['ST', 78, 62]],
    '4-2-3-1': [['GK', 5, 50], ['LB', 25, 12], ['CB', 20, 37], ['CB', 20, 63], ['RB', 25, 88], ['DM', 38, 38], ['DM', 38, 62], ['LW', 64, 15], ['AM', 62, 50], ['RW', 64, 85], ['ST', 82, 50]],
    '4-1-4-1': [['GK', 5, 50], ['LB', 25, 12], ['CB', 20, 37], ['CB', 20, 63], ['RB', 25, 88], ['DM', 35, 50], ['LW', 58, 12], ['CM', 52, 36], ['CM', 52, 64], ['RW', 58, 88], ['ST', 80, 50]],
    '3-5-2': [['GK', 5, 50], ['CB', 20, 25], ['CB', 18, 50], ['CB', 20, 75], ['LB', 46, 8], ['DM', 38, 50], ['CM', 48, 32], ['CM', 48, 68], ['RB', 46, 92], ['ST', 78, 38], ['ST', 78, 62]],
    '3-4-3': [['GK', 5, 50], ['CB', 20, 25], ['CB', 18, 50], ['CB', 20, 75], ['LB', 46, 10], ['CM', 44, 38], ['CM', 44, 62], ['RB', 46, 90], ['LW', 72, 18], ['ST', 80, 50], ['RW', 72, 82]],
    '5-3-2': [['GK', 5, 50], ['LB', 30, 8], ['CB', 18, 28], ['CB', 16, 50], ['CB', 18, 72], ['RB', 30, 92], ['CM', 46, 28], ['DM', 40, 50], ['CM', 46, 72], ['ST', 76, 38], ['ST', 76, 62]],
  };
  const TACTIC_KEYS = {
    mentality: ['دفاعي جدًا', 'دفاعي', 'متوازن', 'هجومي', 'هجومي جدًا'],
    pressing: ['منخفض', 'متوسط', 'عالٍ'],
    tempo: ['بطيء', 'متوسط', 'سريع'],
    width: ['ضيق', 'متوازن', 'واسع'],
    line: ['متأخر', 'متوسط', 'متقدم'],
    passing: ['قصير', 'مختلط', 'مباشر'],
  };
  const TACTIC_AR = { mentality: 'العقلية', pressing: 'الضغط', tempo: 'الإيقاع', width: 'عرض اللعب', line: 'خط الدفاع', passing: 'أسلوب التمرير' };
  const PRESETS = {
    balanced: { name: 'متوازن', mentality: 2, pressing: 1, tempo: 1, width: 1, line: 1, passing: 1 },
    possession: { name: 'استحواذ وتمرير قصير', mentality: 2, pressing: 1, tempo: 0, width: 1, line: 2, passing: 0 },
    gegen: { name: 'ضغط عالٍ', mentality: 3, pressing: 2, tempo: 2, width: 1, line: 2, passing: 1 },
    counter: { name: 'هجمات مرتدة', mentality: 1, pressing: 0, tempo: 2, width: 1, line: 0, passing: 2 },
    wing: { name: 'لعب على الأطراف', mentality: 3, pressing: 1, tempo: 1, width: 2, line: 1, passing: 1 },
    park: { name: 'تكتل دفاعي', mentality: 0, pressing: 0, tempo: 0, width: 0, line: 0, passing: 2 },
  };
  const REGIONS = {
    dz: { name: 'الجزائر', cost: 20000, weeks: 2, talent: 0 },
    ma: { name: 'المغرب', cost: 45000, weeks: 3, talent: 1 },
    tn: { name: 'تونس', cost: 40000, weeks: 3, talent: 0 },
    eg: { name: 'مصر', cost: 55000, weeks: 3, talent: 1 },
    wa: { name: 'غرب أفريقيا', cost: 70000, weeks: 4, talent: 2, boost: ['pac', 'phy'] },
    sa: { name: 'أمريكا الجنوبية', cost: 120000, weeks: 4, talent: 4, boost: ['dri', 'sho'] },
    ee: { name: 'أوروبا الشرقية', cost: 90000, weeks: 4, talent: 2, boost: ['pas', 'def'] },
  };
  const NAMES = {
    maghreb: {
      first: ['محمد', 'أمين', 'ياسين', 'رياض', 'إسلام', 'عبد الرحمن', 'أيوب', 'سفيان', 'زكرياء', 'بلال', 'أنيس', 'وليد', 'هشام', 'كريم', 'سمير', 'نبيل', 'عادل', 'يونس', 'حمزة', 'إلياس', 'رامي', 'فارس', 'مهدي', 'عماد', 'صهيب', 'أسامة', 'طارق', 'مراد', 'نسيم', 'جمال', 'عبد النور', 'شمس الدين', 'لطفي', 'منير', 'خالد', 'سليم', 'بدر الدين', 'نذير'],
      last: ['بن علي', 'بوزيد', 'حداد', 'مسعودي', 'زروقي', 'بلعيد', 'شريف', 'عمراني', 'بوعلام', 'قاسمي', 'منصوري', 'بن يوسف', 'صالحي', 'حمادي', 'بلقاسم', 'دراجي', 'فرحات', 'زيتوني', 'سعيداني', 'مزيان', 'طالبي', 'قادري', 'بوخالفة', 'لعمارة', 'بن عيسى', 'رحماني', 'خليفي', 'بوقرة', 'مداني', 'تواتي', 'عزوز', 'بن ناصر', 'شيباني', 'لكحل', 'بن داود'],
    },
    eg: {
      first: ['أحمد', 'محمود', 'مصطفى', 'عمر', 'كريم', 'شريف', 'حازم', 'طارق', 'إسلام', 'يوسف', 'حسام', 'عمرو', 'زياد', 'مروان'],
      last: ['عبد العزيز', 'فتحي', 'سليمان', 'رجب', 'حسني', 'النجار', 'الشافعي', 'منصور', 'عبد الله', 'الجمال', 'رمضان', 'سالم'],
    },
    wa: {
      first: ['موسى', 'إبراهيما', 'سيكو', 'أمادو', 'باكاري', 'شيخ', 'عثمان', 'لامين', 'ممادو', 'عليو', 'إسماعيلا', 'كوفي'],
      last: ['ديالو', 'كوليبالي', 'تراوري', 'سيسيه', 'كوناتي', 'ديوب', 'ندياي', 'كامارا', 'سانغاري', 'بالدي', 'توريه', 'فوفانا'],
    },
    sa: {
      first: ['ماتياس', 'لوكاس', 'غابرييل', 'دييغو', 'تياغو', 'رودريغو', 'فيليبي', 'خوان', 'إنزو', 'نيكولاس', 'برونو', 'كايو'],
      last: ['سيلفا', 'فرنانديز', 'غوميز', 'بيريرا', 'مارتينيز', 'روشا', 'ألفيس', 'كوستا', 'أكونيا', 'ميراندا', 'سواريس', 'كاردوسو'],
    },
    ee: {
      first: ['ماركو', 'إيفان', 'لوكا', 'ستيفان', 'نيكولا', 'أندريه', 'ميلان', 'دوشان', 'بيتار', 'فلاديمير'],
      last: ['بيتروفيتش', 'كوفاتش', 'نوفاك', 'يوفانوفيتش', 'بوبوف', 'هورفات', 'ماركوفيتش', 'إيليتش', 'سافيتش', 'ستويانوف'],
    },
  };
  NAMES.en = {
    first: ['جاك', 'هاري', 'تشارلي', 'أوليفر', 'جورج', 'ألفي', 'ريس', 'كالوم', 'لويس', 'ماسون', 'توم', 'جوش', 'إيثان', 'رايان', 'دانيال', 'سام', 'ليام', 'ناثان', 'كونور', 'آرتشي'],
    last: ['سميث', 'جونز', 'ويليامز', 'براون', 'تايلور', 'ديفيز', 'إيفانز', 'توماس', 'جونسون', 'روبرتس', 'ووكر', 'رايت', 'طومسون', 'وايت', 'هيوز', 'إدواردز', 'غرين', 'هول', 'وود', 'هاريس', 'مارتن', 'كوك', 'كلارك', 'بيكر'],
  };
  const NAME_SET = { dz: 'maghreb', ma: 'maghreb', tn: 'maghreb', eg: 'eg', wa: 'wa', sa: 'sa', ee: 'ee', en: 'en' };
  // الحد الأدنى من كل مركز في التشكيلة
  const NEED = { GK: 3, CB: 4, LB: 2, RB: 2, DM: 2, CM: 3, AM: 2, LW: 2, RW: 2, ST: 3 };
  const MAX_SQUAD = 32;
  const MAX_SUBS = 5;
  const TRAIN_FOCUS = {
    balanced: { name: 'متوازن', attrs: null },
    attack: { name: 'الهجوم والإنهاء', attrs: ['sho', 'dri', 'vis'] },
    defense: { name: 'الدفاع والتمركز', attrs: ['def', 'phy'] },
    physical: { name: 'اللياقة والسرعة', attrs: ['pac', 'phy'] },
    technical: { name: 'التقنية والتمرير', attrs: ['pas', 'dri', 'vis'] },
    tactical: { name: 'الانسجام التكتيكي', attrs: null },
  };
  const FACILITY = {
    training: { name: 'مركز التدريب', desc: 'يسرّع تطور كل اللاعبين' },
    youth: { name: 'أكاديمية الشباب', desc: 'مواهب أكثر وأعلى إمكانات في دفعة نهاية الموسم' },
    scouting: { name: 'شبكة الكشافة', desc: 'كشافون أكثر، تقارير أدق ولاعبون أكثر في كل مهمة' },
  };
  const facilityCost = (lvl, S) => ([0, 1500000, 3500000, 7000000, 12000000][lvl] || Infinity) * (S ? userLeague(S).econ.fac : 1);

  // ---------- اللاعب ----------
  function familiarity(p, role) {
    if (p.pos === role) return 1;
    if (role === 'GK' || p.pos === 'GK') return 0.35;
    if (p.alt && p.alt.includes(role)) return 0.97;
    if (RELATED[p.pos].includes(role)) return 0.88;
    return 0.72;
  }
  function rawAt(p, role) {
    const w = W[role];
    let s = 0;
    for (const k in w) s += p.a[k] * w[k];
    return s;
  }
  const ovrAt = (p, role) => rawAt(p, role) * familiarity(p, role);
  const calcOvr = (p) => Math.round(rawAt(p, p.pos));

  // القيمة السوقية: تقييم 64 ≈ 0.7 مليون، 80 ≈ 15 مليون، 88 ≈ 70 مليون، 91 ≈ 120 مليون
  function playerValue(p) {
    const base = 300000 * Math.pow(1.21, p.ovr - 60);
    let af;
    if (p.age <= 21) af = 1.3; else if (p.age <= 27) af = 1.1; else if (p.age <= 30) af = 0.85; else if (p.age <= 33) af = 0.5; else af = 0.25;
    const potBonus = p.age < 24 ? 1 + Math.max(0, p.pot - p.ovr) * 0.035 : 1;
    const v = base * af * potBonus;
    return Math.max(5000, v >= 1e6 ? Math.round(v / 100000) * 100000 : Math.round(v / 5000) * 5000);
  }
  // الأجر الأسبوعي: جزء من القيمة + حد أدنى حسب اقتصاد الدوري
  const baseWage = (p, econ) => Math.max(300, Math.round((p.value * 0.0028 + (econ ? econ.wageMin : 600) * p.ovr / 70) / 100) * 100);

  function nameFor(region) {
    const set = NAMES[NAME_SET[region] || 'maghreb'];
    return pick(set.first) + ' ' + pick(set.last);
  }

  function genPlayer(S, opt) {
    const pos = opt.pos;
    const age = opt.age;
    const target = opt.target;
    const region = opt.region || 'dz';
    const w = W[pos];
    const a = {};
    for (const k of ATTRS) {
      const wk = w[k] || 0;
      let base;
      if (k === 'gk') base = pos === 'GK' ? target + 6 : 8;
      else if (pos === 'GK') base = target - 22 + wk * 40;
      else base = wk > 0 ? target + 2 + wk * 18 : target - 16;
      a[k] = clamp(Math.round(base + gauss() * 6), k === 'gk' && pos !== 'GK' ? 3 : 15, 97);
    }
    const reg = REGIONS[region];
    if (reg && reg.boost) for (const k of reg.boost) if (k !== 'gk') a[k] = clamp(a[k] + ri(1, 5), 15, 97);
    let name = opt.name;
    if (!name) {
      const used = new Set(Object.values(S.players).map((q) => q.name));
      for (let k = 0; k < 6 && (!name || used.has(name)); k++) name = nameFor(region);
    }
    const p = { id: 'p' + S.nextId++, name, real: !!opt.real, gen: false, num: 0, region, age, pos, alt: [], a, clubId: opt.clubId === undefined ? null : opt.clubId };
    // نصحح القيم حتى يقترب التقييم من الهدف
    for (let it = 0; it < 3; it++) {
      const diff = target - rawAt(p, pos);
      if (Math.abs(diff) < 0.5) break;
      for (const k in w) a[k] = clamp(Math.round(a[k] + diff), 15, 97);
    }
    if (pos !== 'GK' && rand() < 0.4) p.alt.push(pick(RELATED[pos]));
    p.ovr = calcOvr(p);
    const growth = opt.real ? Math.max(0, 24 - age) * (0.3 + rand() * 1.4) : Math.max(0, 26 - age) * (0.5 + rand() * 2.4) + (opt.potBoost || 0);
    p.pot = clamp(Math.round(p.ovr + growth), p.ovr, 96);
    p.morale = ri(60, 80);
    p.fit = ri(88, 100);
    p.form = [];
    p.value = playerValue(p);
    p.wage = baseWage(p, p.clubId ? clubLeague(S, p.clubId).econ : null);
    p.contract = opt.contract || ri(1, 4);
    p.inj = 0;
    p.susp = 0;
    p.yc = 0;
    p.st = { apps: 0, goals: 0, assists: 0, rsum: 0, motm: 0 };
    p.know = opt.know || 0;
    p.xp = 0;
    p.focus = null;
    S.players[p.id] = p;
    return p;
  }

  // نجوم الإمكانات (0.5..5) والمدى الظاهر حسب معرفة الكشافة
  const toStars = (v) => clamp(Math.round(((v - 40) / 11) * 2) / 2, 0.5, 5);
  function potRange(p, know) {
    const k = know === undefined ? p.know : know;
    const spread = Math.round(((100 - k) / 100) * 14);
    return [toStars(Math.max(p.ovr, p.pot - spread)), toStars(p.pot + spread)];
  }

  // ---------- الدوريات والأندية ----------
  const DAY = 86400000;
  const isoAdd = (iso, days) => new Date(Date.parse(iso + 'T12:00:00Z') + days * DAY).toISOString().slice(0, 10);
  const nextYear = (iso) => (+iso.slice(0, 4) + 1) + iso.slice(4);
  function roundDates(start, end, n) {
    const span = (Date.parse(end) - Date.parse(start)) / DAY;
    const out = [];
    for (let i = 0; i < n; i++) out.push(isoAdd(start, Math.round((i * span) / Math.max(1, n - 1))));
    return out;
  }
  // ذهاب وإياب بطريقة الدائرة؛ إن أُعطيت الجولة الأولى الحقيقية تُبنى بقية الجولات حولها
  function genFixtures(ids, md1) {
    const n = ids.length;
    const arr = md1 ? md1.map((p) => p[0]).concat(md1.map((p) => p[1]).reverse()) : shuffle(ids.slice());
    const rounds = [];
    for (let r = 0; r < n - 1; r++) {
      const ms = [];
      for (let i = 0; i < n / 2; i++) {
        const a = arr[i], b = arr[n - 1 - i];
        ms.push(r % 2 === 0 ? { h: a, a: b } : { h: b, a: a });
      }
      rounds.push(ms);
      arr.splice(1, 0, arr.pop());
    }
    const second = rounds.map((ms) => ms.map((m) => ({ h: m.a, a: m.h })));
    return rounds.concat(second).map((ms) => ms.map((m) => ({ h: m.h, a: m.a, hg: null, ag: null })));
  }

  function defaultTactic(c) {
    const pr = PRESETS[c.style];
    return { formation: c.formation, preset: c.style, mentality: pr.mentality, pressing: pr.pressing, tempo: pr.tempo, width: pr.width, line: pr.line, passing: pr.passing, lineup: [], bench: [] };
  }
  const levelFromRep = (lg, rep) => (lg === 'dz' ? 43 + rep * 0.33 : 36 + rep * 0.5);
  function clubLevel(S, clubId) {
    return Math.round(avg(squadOf(S, clubId).map((p) => p.ovr).sort((a, b) => b - a).slice(0, 14)));
  }
  const NUMS = { GK: [1, 13, 31, 40], CB: [4, 5, 6, 15, 24, 33, 35], LB: [3, 12, 21, 29], RB: [2, 22, 26, 27], DM: [6, 16, 25, 18], CM: [8, 14, 18, 20, 28, 30], AM: [10, 19, 21, 17], LW: [7, 11, 17, 23], RW: [7, 11, 20, 27], ST: [9, 19, 29, 18, 39] };
  function assignNumber(S, p) {
    if (!p.clubId) return;
    const taken = new Set(squadOf(S, p.clubId).filter((q) => q !== p).map((q) => q.num));
    let n = NUMS[p.pos].find((x) => !taken.has(x));
    for (let x = 41; !n && x < 99; x++) if (!taken.has(x)) n = x;
    p.num = n || 99;
  }
  // يكمل التشكيلة حتى الحد الأدنى في كل مركز بلاعبين مولَّدين (يُعلَّمون gen)
  function fillSquad(S, c, lvl) {
    const sq = squadOf(S, c.id);
    const backup = sq.filter((p) => !p.gen).length >= 14;
    const region = c.league === 'dz' ? 'dz' : 'en';
    for (const pos in NEED) {
      let have = sq.filter((p) => p.pos === pos).length;
      while (have < NEED[pos]) {
        const age = backup ? ri(17, 22) : clamp(Math.round(25 + gauss() * 4), 18, 34);
        const target = Math.round(backup ? lvl - 9 + gauss() * 3 : lvl - 1 + gauss() * 3);
        const p = genPlayer(S, { pos, age, target: clamp(target, 40, 86), region, clubId: c.id, potBoost: backup ? 6 : 0 });
        p.gen = true;
        assignNumber(S, p);
        have++;
      }
    }
  }

  function newGame(clubKey, managerName, seed) {
    if (seed !== undefined) setSeed(seed);
    const D = root.FM_DATA;
    const S = {
      v: 2, manager: managerName || 'المدرب', season: 1, year: 2026, week: 0, nextId: 1,
      leagues: [], clubs: [], players: {}, inbox: [], scouts: [], reports: [], shortlist: [], listed: [], offers: [], news: [],
      tactics: {}, fam: {}, facilities: { training: 1, youth: 1, scouting: 1 },
      training: { focus: 'balanced', intensity: 1 }, devLog: [], finance: { log: [], week: null },
      board: { conf: 60, target: 6 }, lastReport: null, history: [], formLine: [], gameOver: false, msgId: 1,
    };
    for (const L of D.LEAGUES) {
      const lg = { id: L.id, name: L.name, short: L.short, country: L.country, relegate: L.relegate, europe: L.europe, sim: L.sim, econ: L.econ, start: L.start, end: L.end, clubs: [], fixtures: [], dates: [], played: 0 };
      S.leagues.push(lg);
      for (const c of L.clubs) {
        const cl = { id: c.k, league: L.id, name: c.name, short: c.short, stadium: c.stadium, capacity: c.cap, color: c.c1, color2: c.c2, rep: c.rep, budget: c.budget, style: c.style, formation: c.form };
        S.clubs.push(cl);
        lg.clubs.push(cl.id);
        S.fam[cl.id] = {};
        for (const f in FORMATIONS) S.fam[cl.id][f] = f === cl.formation ? 85 : 35;
        for (const line of (c.sq || '').split('\n')) {
          const parts = line.trim().split('|');
          if (parts.length < 4) continue;
          genPlayer(S, { name: parts[0], pos: parts[1], age: +parts[2], target: +parts[3], region: L.id === 'dz' ? 'dz' : 'en', clubId: cl.id, real: true, know: 55 });
        }
        const lvl = squadOf(S, cl.id).length >= 14 ? clubLevel(S, cl.id) : Math.round(levelFromRep(L.id, cl.rep));
        fillSquad(S, cl, lvl);
        cl.level = clubLevel(S, cl.id);
        const sq = squadOf(S, cl.id);
        sq.forEach((p) => { p.num = 0; });
        sq.sort((a, b) => (a.gen - b.gen) || b.ovr - a.ovr).forEach((p) => assignNumber(S, p));
      }
      lg.fixtures = genFixtures(lg.clubs, L.md1);
      lg.dates = roundDates(L.start, L.end, lg.fixtures.length);
    }
    for (let i = 0; i < 30; i++) {
      const dz = i % 2 === 0;
      const p = genPlayer(S, { pos: pick(POS), age: ri(21, 33), target: dz ? ri(54, 64) : ri(64, 75), region: dz ? pick(['dz', 'dz', 'ma', 'tn', 'eg', 'wa']) : pick(['en', 'en', 'sa', 'ee', 'wa']), clubId: null, contract: 0 });
      p.gen = true;
    }
    const user = club(S, clubKey) || S.clubs[0];
    S.userClub = user.id;
    S.board.target = targetPosition(S, user.id);
    S.clubs.forEach((c) => { S.tactics[c.id] = defaultTactic(c); autoPick(S, c.id, S.tactics[c.id]); });
    squadOf(S, user.id).forEach((p) => { p.know = 80; });
    const lg = userLeague(S);
    sendMsg(S, 'رسالة من مجلس الإدارة', `مرحبًا ${S.manager}. يتوقع المجلس أن ينهي ${user.name} موسم ${D.season} في ${targetText(S)}. ميزانية الانتقالات: ${money(user.budget)}. أمامك ${lg.fixtures.length} جولة في ${lg.name}، أولاها يوم ${lg.dates[0]}.`, 'board');
    sendMsg(S, 'من المحلل', 'افتح «التحليل» قبل كل مباراة: تقرير الخصم ومختبر يحاكي المباراة مئات المرات لتجربة خطتك قبل اللعب.', 'tip');
    return S;
  }

  const leagueOf = (S, id) => S.leagues.find((l) => l.id === id);
  function userLeague(S) { return leagueOf(S, club(S, S.userClub).league); }
  const clubLeague = (S, clubId) => leagueOf(S, club(S, clubId).league);
  function targetPosition(S, clubId) {
    const lg = clubLeague(S, clubId);
    const sorted = lg.clubs.map((id) => club(S, id)).sort((a, b) => b.rep - a.rep);
    const rank = sorted.findIndex((x) => x.id === clubId) + 1;
    return Math.min(lg.clubs.length - lg.relegate, rank === 1 ? 1 : rank + 1);
  }
  function targetText(S) {
    const lg = userLeague(S);
    const t = S.board.target;
    if (t === 1) return 'المركز الأول (التتويج باللقب)';
    if (t >= lg.clubs.length - lg.relegate) return 'خارج مراكز الهبوط';
    return `المركز ${t} أو أفضل`;
  }

  const club = (S, id) => S.clubs.find((c) => c.id === id);
  const squadOf = (S, clubId) => Object.values(S.players).filter((p) => p.clubId === clubId);
  const available = (p) => p.inj === 0 && p.susp === 0;

  function sendMsg(S, title, body, kind) {
    S.inbox.unshift({ id: S.msgId++, season: S.season, week: S.week, title, body, kind: kind || 'info', read: false });
    if (S.inbox.length > 80) S.inbox.length = 80;
  }

  function money(v) {
    const s = v < 0 ? '-' : '';
    const a = Math.abs(v);
    if (a >= 1e6) return s + '€' + (a / 1e6).toFixed(a >= 1e7 ? 1 : 2).replace(/\.?0+$/, '') + 'M';
    if (a >= 1e3) return s + '€' + Math.round(a / 1e3) + 'K';
    return s + '€' + Math.round(a);
  }

  // ---------- اختيار التشكيلة ----------
  function autoPick(S, clubId, tactic) {
    const pool = squadOf(S, clubId).filter(available);
    const slots = FORMATIONS[tactic.formation];
    const used = new Set();
    const lineup = new Array(slots.length).fill(null);
    const order = slots.map((s, i) => i).sort((i, j) => scarcity(slots[i][0]) - scarcity(slots[j][0]));
    for (const i of order) {
      const role = slots[i][0];
      let best = null, bv = -1;
      for (const p of pool) {
        if (used.has(p.id)) continue;
        const v = ovrAt(p, role) * (0.75 + 0.25 * p.fit / 100);
        if (v > bv) { bv = v; best = p; }
      }
      if (best) { lineup[i] = best.id; used.add(best.id); }
    }
    const rest = pool.filter((p) => !used.has(p.id)).sort((a, b) => b.ovr - a.ovr);
    const bench = [];
    const gk = rest.find((p) => p.pos === 'GK');
    if (gk) bench.push(gk.id);
    for (const p of rest) { if (bench.length >= 7) break; if (!bench.includes(p.id)) bench.push(p.id); }
    tactic.lineup = lineup;
    tactic.bench = bench;
    return tactic;
  }
  function scarcity(role) { return { GK: 0, ST: 1, CB: 2, LB: 3, RB: 3, DM: 4, AM: 4, LW: 5, RW: 5, CM: 6 }[role]; }

  // يتأكد أن التشكيلة صالحة (لا مصابين ولا موقوفين ولا لاعبين غادروا)
  function validateLineup(S, clubId, tactic) {
    const ok = (id) => id && S.players[id] && S.players[id].clubId === clubId && available(S.players[id]);
    const slots = FORMATIONS[tactic.formation];
    if (!tactic.lineup || tactic.lineup.length !== slots.length) { autoPick(S, clubId, tactic); return []; }
    const problems = [];
    const used = new Set(tactic.lineup.filter(ok));
    tactic.bench = (tactic.bench || []).filter((id) => ok(id) && !used.has(id));
    tactic.lineup = tactic.lineup.map((id, i) => {
      if (ok(id)) return id;
      const role = slots[i][0];
      const pool = squadOf(S, clubId).filter((p) => available(p) && !used.has(p.id));
      pool.sort((a, b) => ovrAt(b, role) - ovrAt(a, role));
      const rep = pool[0];
      if (id && S.players[id]) problems.push(`${S.players[id].name} غير متاح، دخل مكانه ${rep ? rep.name : '—'}`);
      if (!rep) return null;
      used.add(rep.id);
      tactic.bench = tactic.bench.filter((b) => b !== rep.id);
      return rep.id;
    });
    return problems;
  }

  // ---------- قوة الفريق ----------
  // entries: [{p, role, fit}] — اللاعبون في الملعب
  function profile(entries, tactic, famVal) {
    const famF = 0.9 + 0.1 * (famVal === undefined ? 70 : famVal) / 100;
    const sum = { att: 0, mid: 0, def: 0, gk: 0 }, mass = { att: 0, mid: 0, def: 0, gk: 0 };
    const pace = [], defPace = [], passQ = [], wide = [], fullback = [], phyAtt = [], phyDef = [], fits = [], eff = [];
    let backs = 0;
    for (const e of entries) {
      const p = e.p;
      const fit = e.fit === undefined ? p.fit : e.fit;
      const v = ovrAt(p, e.role) * (0.72 + 0.28 * fit / 100) * (0.95 + 0.1 * p.morale / 100) * famF;
      eff.push(v);
      fits.push(fit);
      const ln = LINES[e.role];
      for (const k in ln) { sum[k] += v * ln[k]; mass[k] += ln[k]; }
      const r = e.role;
      if (r === 'ST' || r === 'LW' || r === 'RW' || r === 'AM') { pace.push(p.a.pac); phyAtt.push(p.a.phy); }
      if (r === 'CB' || r === 'LB' || r === 'RB') defPace.push(p.a.pac);
      if (r === 'CB') { phyDef.push(p.a.phy); backs++; }
      if (r !== 'GK' && r !== 'ST') passQ.push(p.a.pas * 0.6 + p.a.vis * 0.4);
      if (r === 'LW' || r === 'RW') wide.push(v);
      if (r === 'LB' || r === 'RB') { fullback.push(v); wide.push(v * 0.6 + p.a.pac * 0.4); }
    }
    const missing = Math.max(0, 11 - entries.length);
    const pen = 1 - 0.07 * missing;
    const line = (k) => (mass[k] ? sum[k] / mass[k] : 30) * pen;
    const out = {
      att: line('att') * Math.pow(Math.max(mass.att, 0.5) / 3.2, 0.18),
      mid: line('mid'),
      def: line('def') * Math.pow(Math.max(mass.def, 0.5) / 4.6, 0.22),
      gk: mass.gk ? sum.gk / mass.gk : 25,
      midMass: mass.mid, defMass: mass.def, attMass: mass.att,
      pace: avg(pace) || 50, defPace: avg(defPace) || 50, passQ: avg(passQ) || 50,
      wide: avg(wide) || 40, fullback: avg(fullback) || 40, phyAtt: avg(phyAtt) || 50, phyDef: avg(phyDef) || 50,
      backs, avgFit: avg(fits), avgEff: avg(eff), n: entries.length,
    };
    out.attRaw = line('att'); out.defRaw = line('def');
    return out;
  }

  // العوامل التكتيكية بين فريقين: كل عامل يعدّل هجوم الفريق att
  function tacticalFactors(P, T, names) {
    const out = [];
    for (const i of [0, 1]) {
      const j = 1 - i, a = P[i], b = P[j], ta = T[i], tb = T[j];
      const X = names[i], Y = names[j];
      const mb = tb.mentality - 2;
      if (tb.line === 2) {
        const d = a.pace - b.defPace;
        if (d > 2) out.push({ att: i, chance: 1 + Math.min(0.2, d * 0.018), big: 0.05, key: 'line', text: `سرعة مهاجمي ${X} (${Math.round(a.pace)}) تهدد خط ${Y} المتقدم (سرعة المدافعين ${Math.round(b.defPace)}): كرات في العمق وانفرادات` });
        else out.push({ att: i, chance: 0.92, key: 'line', text: `خط ${Y} المتقدم سريع بما يكفي (${Math.round(b.defPace)}) ويضيّق المساحات على ${X}` });
      }
      if (tb.line === 0 && !(mb <= -1)) out.push({ att: i, chance: 0.96, big: -0.03, poss: 0.03, key: 'deep', text: `${Y} يدافع بخط متأخر: مساحات أقل خلفه لكن ${X} يستحوذ أكثر` });
      if (mb <= -1 && tb.line === 0) out.push({ att: i, chance: 0.84, big: -0.04, poss: 0.05, key: 'block', text: `${Y} يغلق المساحات بتكتل دفاعي؛ ${X} يحتاج صبرًا أو تسديدات من بعيد` });
      if (ta.pressing === 2) {
        const q = b.passQ;
        if (q < 64) out.push({ att: i, chance: 1 + Math.min(0.18, (64 - q) * 0.012), big: 0.02, key: 'press', text: `ضغط ${X} العالي يربك بناء ${Y} من الخلف (جودة التمرير ${Math.round(q)})` });
        else if (q >= 70 && tb.passing === 0) out.push({ att: j, chance: 1.1, big: 0.03, key: 'press', text: `${Y} يكسر ضغط ${X} بالتمرير القصير الدقيق (${Math.round(q)}) ويجد المساحات خلفه` });
        else out.push({ att: i, chance: 1.05, poss: 0.02, key: 'press', text: `ضغط ${X} يستعيد الكرة في مناطق متقدمة` });
      }
      if ((ta.passing === 2 || ta.tempo === 2) && mb >= 1) out.push({ att: i, chance: 1.1, big: 0.04, key: 'counter', text: `${X} يضرب بالمرتدات في المساحات التي يتركها ${Y} المندفع للهجوم` });
      if (ta.width === 2) {
        const d = a.wide - b.fullback;
        if (b.backs >= 3 && b.fullback > 0 && tb.line < 2) out.push({ att: i, chance: 0.97, key: 'wing', text: `دفاع ${Y} الخماسي يغطي الأطراف أمام ${X}` });
        else if (d > 2) out.push({ att: i, chance: 1 + Math.min(0.15, d * 0.015), cross: 0.06, key: 'wing', text: `أطراف ${X} (${Math.round(a.wide)}) أقوى من ظهيري ${Y} (${Math.round(b.fullback)}): عرضيات وفرص من الجانبين` });
        else if (d < -2) out.push({ att: i, chance: 0.94, key: 'wing', text: `ظهيرا ${Y} يحدّان من لعب ${X} على الأطراف` });
      }
      if (ta.width === 0 && b.backs >= 3) out.push({ att: i, chance: 0.93, key: 'narrow', text: `${X} يهاجم من العمق أمام ثلاثة قلوب دفاع لـ${Y}` });
      const dm = a.midMass - b.midMass;
      if (dm > 0.5) out.push({ att: i, poss: Math.min(0.06, dm * 0.04), key: 'mid', text: `تفوق عددي لـ${X} في وسط الميدان (${round1(a.midMass)} مقابل ${round1(b.midMass)})` });
      if (ta.passing === 2) {
        if (a.phyAtt > b.phyDef + 3) out.push({ att: i, chance: 1.08, cross: 0.04, key: 'long', text: `الكرات الطويلة تناسب قوة مهاجمي ${X} البدنية (${Math.round(a.phyAtt)} مقابل ${Math.round(b.phyDef)})` });
        else if (b.phyDef > a.phyAtt + 3) out.push({ att: i, chance: 0.93, key: 'long', text: `مدافعو ${Y} يكسبون الكرات الطويلة (${Math.round(b.phyDef)} مقابل ${Math.round(a.phyAtt)})` });
      }
      if (ta.passing === 0) {
        const pq = (a.passQ - 64) * 0.003;
        if (Math.abs(pq) > 0.012) out.push({ att: i, poss: clamp(pq, -0.04, 0.04), chance: pq < 0 ? 0.95 : 1, key: 'short', text: pq > 0 ? `جودة تمرير ${X} (${Math.round(a.passQ)}) تخدم أسلوب التمرير القصير` : `لاعبو ${X} لا يملكون الجودة الكافية للتمرير القصير (${Math.round(a.passQ)})` });
      }
    }
    for (const f of out) {
      f.chance = f.chance || 1; f.big = f.big || 0; f.poss = f.poss || 0; f.cross = f.cross || 0;
      f.weight = (f.chance - 1) + f.big * 2 + f.poss * 2.5;
    }
    return out;
  }

  // المعاملات الأساسية للمباراة (تُعاد كل دقيقة لأن اللياقة والتبديلات تتغير)
  function coefficients(P, T, homeIdx, factors, sim) {
    const goalF = sim ? sim.goal : 1, homeF = sim ? sim.home : 1.04;
    const share = [0, 0], rate = [0, 0], big = [0, 0], xgm = [0, 0], cross = [0, 0];
    const x0 = P[0].mid * Math.pow(P[0].midMass / 3.4, 0.35);
    const x1 = P[1].mid * Math.pow(P[1].midMass / 3.4, 0.35);
    let s0 = Math.pow(x0, 2) / (Math.pow(x0, 2) + Math.pow(x1, 2));
    const style = (t) => (t.passing === 0 ? 0.03 : t.passing === 2 ? -0.03 : 0) + 0.012 * (t.mentality - 2);
    s0 += style(T[0]) - style(T[1]);
    if (homeIdx === 0) s0 += 0.02; else if (homeIdx === 1) s0 -= 0.02;
    for (const f of factors) s0 += f.att === 0 ? f.poss : -f.poss;
    share[0] = clamp(s0, 0.27, 0.73); share[1] = 1 - share[0];
    for (const i of [0, 1]) {
      const j = 1 - i, a = P[i], b = P[j], ta = T[i], tb = T[j];
      const ratio = a.att / b.def;
      let r = 0.235 * goalF * Math.pow(ratio, 1.2) * (1 + 0.07 * (ta.mentality - 2)) * (1 - 0.05 * (tb.mentality - 2)) * (1 + 0.06 * (ta.tempo - 1));
      let bg = 0.085, cr = 0.15;
      for (const f of factors) if (f.att === i) { r *= f.chance; bg += f.big; cr += f.cross; }
      if (homeIdx === i) r *= homeF;
      rate[i] = clamp(r, 0.05, 0.75);
      big[i] = clamp(bg, 0.03, 0.3);
      cross[i] = clamp(cr + (ta.width - 1) * 0.04, 0.05, 0.35);
      xgm[i] = Math.pow(ratio, 0.3) * (1 - 0.04 * (ta.tempo - 1));
    }
    return { share, rate, big, xgm, cross };
  }

  // ---------- المباراة ----------
  function sideFrom(S, clubId, tactic) {
    const t = JSON.parse(JSON.stringify(tactic));
    const slots = FORMATIONS[t.formation];
    const on = [];
    t.lineup.forEach((id, i) => { if (id && S.players[id]) on.push({ id, role: slots[i][0], slot: i }); });
    const fit = {}, rating = {}, mins = {};
    for (const id of t.lineup.concat(t.bench)) if (id && S.players[id]) { fit[id] = S.players[id].fit; rating[id] = 6.0; }
    for (const e of on) mins[e.id] = 0;
    const fam = (S.fam[clubId] && S.fam[clubId][t.formation]) || 50;
    return { clubId, tactic: t, on, bench: t.bench.filter((id) => S.players[id]), used: [], subs: 0, fit, rating, mins, fam, cards: {}, off: [], goals: 0, shots: 0, onT: 0, xg: 0, corners: 0, fouls: 0, yel: 0, red: 0, poss: 0, passes: 0, passOk: 0, saves: 0, big: 0, scorers: [], injuries: [] };
  }

  function createMatch(S, homeId, awayId, tH, tA, opts) {
    opts = opts || {};
    const m = {
      minute: 0, half: 1, finished: false, homeIdx: opts.neutral ? -1 : 0, added: [ri(1, 3), ri(2, 5)],
      sides: [sideFrom(S, homeId, tH), sideFrom(S, awayId, tA)],
      names: [club(S, homeId).short, club(S, awayId).short],
      events: [], tl: [], xgt: [[0], [0]], zones: [[0, 0, 0], [0, 0, 0], [0, 0, 0]], user: opts.userSide === undefined ? -1 : opts.userSide,
      ai: opts.ai || [opts.userSide !== 0, opts.userSide !== 1], mom: 0, quiet: !!opts.quiet, sim: clubLeague(S, homeId).sim, cur: null,
    };
    refresh(S, m);
    return m;
  }

  function refresh(S, m) {
    const P = m.sides.map((sd) => profile(sd.on.map((e) => ({ p: S.players[e.id], role: e.role, fit: sd.fit[e.id] })), sd.tactic, sd.fam));
    const T = m.sides.map((sd) => sd.tactic);
    m.P = P;
    m.factors = tacticalFactors(P, T, m.names);
    m.co = coefficients(P, T, m.homeIdx, m.factors, m.sim);
  }

  function ev(m, type, side, text, extra) {
    const e = Object.assign({ min: m.minute, type, side, text }, extra || {});
    m.events.push(e);
    return e;
  }
  const pname = (S, id) => (S.players[id] ? S.players[id].name : '');
  const sideName = (m, i) => m.names[i];

  function chooseShooter(S, sd, kind) {
    const wr = kind === 'header' ? { ST: 3, CB: 1.3, AM: 0.8, LW: 0.7, RW: 0.7, CM: 0.8, DM: 0.6, LB: 0.4, RB: 0.4, GK: 0 } : { ST: 4, LW: 3, RW: 3, AM: 3, CM: 1.6, DM: 0.6, LB: 0.5, RB: 0.5, CB: 0.4, GK: 0 };
    return weighted(sd.on, (e) => {
      const p = S.players[e.id];
      const sk = kind === 'header' ? (p.a.phy + p.a.sho) / 2 : p.a.sho;
      return wr[e.role] * Math.pow(sk / 60, 1.5);
    });
  }
  function chooseAssister(S, sd, exceptId) {
    const wr = { AM: 3, LW: 2.5, RW: 2.5, CM: 2, LB: 1.2, RB: 1.2, ST: 1, DM: 1, CB: 0.3, GK: 0.05 };
    const cand = sd.on.filter((e) => e.id !== exceptId);
    if (!cand.length) return null;
    return weighted(cand, (e) => { const p = S.players[e.id]; return wr[e.role] * Math.pow((p.a.pas + p.a.vis) / 120, 2); });
  }
  const bump = (sd, id, v) => { if (id && sd.rating[id] !== undefined) sd.rating[id] = clamp(sd.rating[id] + v, 3, 10); };
  const gkOf = (sd) => sd.on.find((e) => e.role === 'GK');

  function stepMinute(S, m) {
    if (m.finished) return;
    m.minute++;
    const t = m.minute;
    m.cur = { shots: [], foul: null, corner: false };
    const co = m.co;
    const i = rand() < co.share[0] ? 0 : 1;
    const j = 1 - i;
    const A = m.sides[i], B = m.sides[j];
    A.poss++;
    const pq = m.P[i].passQ, press = B.tactic.pressing;
    const npass = Math.round(9 + (A.tactic.passing === 0 ? 4 : A.tactic.passing === 2 ? -3 : 0) + rand() * 4);
    A.passes += npass;
    A.passOk += Math.round(npass * clamp(0.58 + pq * 0.004 - (press - 1) * 0.03 + (A.tactic.passing === 0 ? 0.04 : A.tactic.passing === 2 ? -0.06 : 0), 0.5, 0.94));
    for (const e of A.on) A.mins[e.id] = (A.mins[e.id] || 0) + 1;
    for (const e of B.on) B.mins[e.id] = (B.mins[e.id] || 0) + 1;
    let bx = 45 + rand() * 30, shot = false;
    const lane = A.tactic.width === 2 ? (rand() < 0.65 ? (rand() < 0.5 ? 0 : 2) : 1) : A.tactic.width === 0 ? (rand() < 0.6 ? 1 : (rand() < 0.5 ? 0 : 2)) : ri(0, 2);

    // ركلة جزاء نادرة
    if (rand() < 0.0024) {
      shot = true;
      bx = 89;
      const taker = A.on.slice().sort((a, b) => S.players[b.id].a.sho - S.players[a.id].a.sho)[0];
      if (taker) takeShot(S, m, i, taker, 0.76, 'pen', null);
    } else if (rand() < co.rate[i]) {
      shot = true;
      bx = 80 + rand() * 15;
      const r = rand();
      let kind, xg;
      if (r < co.big[i]) { kind = 'big'; xg = 0.28 + rand() * 0.25; }
      else if (r < co.big[i] + co.cross[i]) { kind = 'header'; xg = 0.04 + rand() * 0.07; }
      else if (r < co.big[i] + co.cross[i] + 0.2) { kind = 'long'; xg = 0.02 + rand() * 0.035; bx = 72 + rand() * 8; }
      else { kind = 'normal'; xg = 0.05 + rand() * 0.08; }
      xg = clamp(xg * co.xgm[i], 0.01, 0.8);
      const shooter = chooseShooter(S, A, kind);
      const assister = rand() < 0.78 ? chooseAssister(S, A, shooter.id) : null;
      takeShot(S, m, i, shooter, xg, kind, assister);
    }
    // الأخطاء والبطاقات
    if (rand() < 0.23 * (1 + 0.2 * (B.tactic.pressing - 1))) {
      B.fouls++;
      m.cur.foul = { side: j };
      if (rand() < 0.15) {
        const e = pick(B.on);
        B.cards[e.id] = (B.cards[e.id] || 0) + 1;
        bump(B, e.id, -0.3);
        if (B.cards[e.id] >= 2) { B.yel++; sendOff(S, m, j, e.id, 'إنذار ثانٍ'); }
        else { B.yel++; if (!m.quiet) ev(m, 'yellow', j, `بطاقة صفراء لـ${pname(S, e.id)} (${sideName(m, j)})`, { pid: e.id }); }
      } else if (rand() < 0.004) sendOff(S, m, j, pick(B.on).id, 'تدخل عنيف');
      else if (rand() < 0.09 && !shot) {
        // ركلة حرة خطيرة
        if (rand() < 0.3) { const tk = A.on.slice().sort((a, b) => (S.players[b.id].a.sho + S.players[b.id].a.vis) - (S.players[a.id].a.sho + S.players[a.id].a.vis))[0]; if (tk) { shot = true; bx = 78; takeShot(S, m, i, tk, 0.06 * co.xgm[i], 'fk', null); } }
      }
    }
    // الإصابات
    if (rand() < 0.0009 * 2) {
      const k = rand() < 0.5 ? 0 : 1;
      const sd = m.sides[k];
      const e = pick(sd.on.filter((x) => x.role !== 'GK'));
      if (e) {
        const wk = ri(1, 6);
        sd.injuries.push({ id: e.id, weeks: wk });
        if (!m.quiet) ev(m, 'injury', k, `إصابة ${pname(S, e.id)} (${sideName(m, k)})، يغيب قرابة ${wk} ${wk > 2 ? 'أسابيع' : 'أسبوع'}`, { pid: e.id });
        if (!autoSub(S, m, k, e)) { sd.on = sd.on.filter((x) => x.id !== e.id); sd.off.push(e.id); }
      }
    }
    // التعب
    for (const sd of m.sides) {
      const rateF = 0.2 + 0.06 * sd.tactic.pressing + 0.04 * sd.tactic.tempo;
      for (const e of sd.on) {
        const p = S.players[e.id];
        const k = e.role === 'GK' ? 0.25 : 1;
        sd.fit[e.id] = Math.max(20, sd.fit[e.id] - rateF * k * (1.35 - p.a.phy / 110));
      }
    }
    // المناطق والخط الزمني
    const hx = i === 0 ? bx : 100 - bx;
    const lnY = i === 0 ? lane : 2 - lane;
    m.zones[Math.min(2, Math.floor(hx / 33.4))][lnY]++;
    m.tl.push({ t, s: i, x: hx, y: lnY * 33 + 8 + rand() * 18, shot, ev: m.quiet ? null : m.cur });
    m.mom = m.mom * 0.85 + (i === 0 ? 1 : -1) * (shot ? 3 : 0.6);
    m.xgt[0].push(m.sides[0].xg); m.xgt[1].push(m.sides[1].xg);
    // الذكاء الاصطناعي للمدرب
    for (const k of [0, 1]) if (m.ai[k]) aiManage(S, m, k);
    if (t === 45) { m.half = 2; if (!m.quiet) ev(m, 'half', -1, `نهاية الشوط الأول: ${m.names[0]} ${m.sides[0].goals} - ${m.sides[1].goals} ${m.names[1]}`); }
    if (t >= 90 + m.added[1]) finish(S, m);
    refresh(S, m);
  }

  function takeShot(S, m, i, e, xg, kind, assister) {
    const A = m.sides[i], B = m.sides[1 - i];
    const sh = S.players[e.id];
    const gk = gkOf(B);
    const gkv = gk ? S.players[gk.id].a.gk * (0.8 + 0.2 * B.fit[gk.id] / 100) : 30;
    A.shots++;
    A.xg += xg;
    if (kind === 'big') A.big++;
    const pGoal = clamp(xg * (0.55 + sh.a.sho / 150) * (1.3 - gkv / 230) * (0.85 + 0.15 * A.fit[e.id] / 100), 0.005, 0.95);
    const X = sideName(m, i), nm = sh.name;
    const kindTxt = { big: 'ينفرد بالحارس', header: 'برأسية بعد عرضية', long: 'يسدد من بعيد', normal: 'يسدد من داخل المنطقة', pen: 'ينفذ ركلة الجزاء', fk: 'ينفذ ركلة حرة مباشرة' }[kind];
    if (rand() < pGoal) {
      A.goals++; A.onT++;
      bump(A, e.id, kind === 'pen' ? 0.7 : 1.0);
      if (assister) { bump(A, assister.id, 0.6); }
      A.scorers.push({ id: e.id, min: m.minute, as: assister ? assister.id : null, pen: kind === 'pen' });
      if (gk) bump(B, gk.id, -0.25);
      for (const d of B.on) if (d.role === 'CB' || d.role === 'LB' || d.role === 'RB') bump(B, d.id, -0.12);
      m.mom += i === 0 ? 6 : -6;
      m.cur.shots.push({ side: i, id: e.id, kind, xg, out: 'goal', as: assister ? assister.id : null });
      ev(m, 'goal', i, `هدف! ${nm} ${kindTxt} ويسجل لـ${X}${assister ? ` بتمريرة من ${pname(S, assister.id)}` : ''}`, { pid: e.id, as: assister ? assister.id : null, xg });
      return true;
    }
    const onTarget = rand() < (kind === 'long' ? 0.22 : 0.33);
    m.cur.shots.push({ side: i, id: e.id, kind, xg, out: onTarget ? 'save' : 'miss', as: assister ? assister.id : null, gk: gk ? gk.id : null });
    bump(A, e.id, onTarget ? 0.05 : -0.04);
    if (assister) bump(A, assister.id, 0.08);
    if (onTarget) {
      A.onT++; B.saves++;
      if (gk) bump(B, gk.id, 0.22 + xg * 0.8);
      if (!m.quiet && (xg > 0.12 || rand() < 0.35)) ev(m, 'save', i, `${nm} ${kindTxt}… ويتصدى ${gk ? pname(S, gk.id) : 'الحارس'}!`, { pid: e.id, xg });
    } else {
      const blocker = B.on.find((d) => d.role === 'CB');
      if (blocker && rand() < 0.4) bump(B, blocker.id, 0.08);
      if (!m.quiet && (xg > 0.2 || rand() < 0.2)) ev(m, 'miss', i, `${nm} ${kindTxt}… ${xg > 0.25 ? 'ويهدر فرصة محققة!' : 'والكرة خارج المرمى'}`, { pid: e.id, xg });
    }
    if (rand() < 0.45) {
      A.corners++;
      m.cur.corner = true;
      if (rand() < 0.22) {
        const hd = chooseShooter(S, A, 'header');
        const xs = clamp(0.07 * m.co.xgm[i], 0.02, 0.2);
        A.shots++; A.xg += xs;
        const hshot = { side: i, id: hd.id, kind: 'corner', xg: xs, out: rand() < 0.4 ? 'save' : 'miss', gk: gk ? gk.id : null };
        m.cur.shots.push(hshot);
        if (rand() < xs * (0.6 + S.players[hd.id].a.phy / 160)) {
          A.goals++; A.onT++; bump(A, hd.id, 1.0);
          hshot.out = 'goal';
          const tk = chooseAssister(S, A, hd.id);
          if (tk) bump(A, tk.id, 0.5);
          A.scorers.push({ id: hd.id, min: m.minute, as: tk ? tk.id : null });
          if (gk) bump(B, gk.id, -0.25);
          ev(m, 'goal', i, `هدف من ركنية! ${S.players[hd.id].name} يرتقي ويسكنها الشباك لـ${X}`, { pid: hd.id, as: tk ? tk.id : null, xg: xs });
        }
      }
    }
    return false;
  }

  function sendOff(S, m, k, id, why) {
    const sd = m.sides[k];
    if (!sd.on.find((e) => e.id === id)) return;
    sd.red++;
    sd.on = sd.on.filter((e) => e.id !== id);
    sd.off.push(id);
    sd.cards[id] = 9;
    bump(sd, id, -1.5);
    ev(m, 'red', k, `بطاقة حمراء! طرد ${pname(S, id)} (${sideName(m, k)}) بسبب ${why}`, { pid: id });
  }

  function substitute(S, m, k, outId, inId, silent) {
    const sd = m.sides[k];
    if (sd.subs >= MAX_SUBS) return 'استنفدت التبديلات الخمسة';
    const idx = sd.on.findIndex((e) => e.id === outId);
    if (idx < 0) return 'اللاعب ليس في الملعب';
    if (!sd.bench.includes(inId)) return 'اللاعب ليس على الدكة';
    const role = sd.on[idx].role;
    sd.on[idx] = { id: inId, role, slot: sd.on[idx].slot };
    sd.bench = sd.bench.filter((b) => b !== inId);
    sd.used.push(outId);
    sd.subs++;
    sd.mins[inId] = sd.mins[inId] || 0;
    if (!m.quiet && !silent) ev(m, 'sub', k, `تبديل لـ${sideName(m, k)}: يخرج ${pname(S, outId)} ويدخل ${pname(S, inId)}`, { pid: inId, out: outId });
    refresh(S, m);
    return null;
  }

  function bestBench(S, sd, role) {
    let best = null, bv = -1;
    for (const id of sd.bench) {
      const p = S.players[id];
      if (!p) continue;
      const v = ovrAt(p, role);
      if (v > bv) { bv = v; best = id; }
    }
    return best;
  }

  function autoSub(S, m, k, out) {
    const sd = m.sides[k];
    const e = sd.on.find((x) => x.id === out.id);
    if (!e || sd.subs >= MAX_SUBS) return false;
    const inId = bestBench(S, sd, e.role);
    if (!inId) return false;
    substitute(S, m, k, e.id, inId);
    return true;
  }

  function aiManage(S, m, k) {
    const sd = m.sides[k];
    const t = m.minute;
    if (t >= 58 && t <= 85 && sd.subs < 4 && t % 4 === 0) {
      const tired = sd.on.filter((e) => e.role !== 'GK' && sd.fit[e.id] < 64).sort((a, b) => sd.fit[a.id] - sd.fit[b.id])[0];
      if (tired) autoSub(S, m, k, tired);
    }
    const diff = sd.goals - m.sides[1 - k].goals;
    if (t === 68 && diff < 0 && sd.tactic.mentality < 4) { sd.tactic.mentality = Math.min(4, sd.tactic.mentality + (diff <= -2 ? 2 : 1)); if (!m.quiet) ev(m, 'tactic', k, `${sideName(m, k)} يتحول إلى الهجوم بحثًا عن التعديل`); }
    if (t === 78 && diff === 1 && sd.tactic.mentality > 1) { sd.tactic.mentality = 1; sd.tactic.line = 0; if (!m.quiet) ev(m, 'tactic', k, `${sideName(m, k)} يتراجع لحماية تقدمه`); }
  }

  function finish(S, m) {
    m.finished = true;
    const [a, b] = m.sides;
    const res = [Math.sign(a.goals - b.goals), Math.sign(b.goals - a.goals)];
    m.sides.forEach((sd, k) => {
      const other = m.sides[1 - k];
      for (const id in sd.rating) {
        if (!sd.mins[id]) continue;
        let r = sd.rating[id] + res[k] * 0.3;
        const e = sd.on.find((x) => x.id === id);
        const role = e ? e.role : null;
        if ((role === 'GK' || role === 'CB' || role === 'LB' || role === 'RB') && other.goals === 0) r += 0.5;
        r += (sd.poss / Math.max(1, m.minute) - 0.5) * 0.6;
        sd.rating[id] = clamp(round1(r + (rand() - 0.5) * 0.4), 3, 10);
      }
    });
    let motm = null, mv = -1;
    m.sides.forEach((sd, k) => { for (const id in sd.rating) if (sd.mins[id] && sd.rating[id] > mv) { mv = sd.rating[id]; motm = { id, side: k }; } });
    m.motm = motm;
    if (!m.quiet) ev(m, 'end', -1, `صافرة النهاية: ${m.names[0]} ${a.goals} - ${b.goals} ${m.names[1]}`);
  }

  function simulate(S, m) { while (!m.finished) stepMinute(S, m); return m; }

  // يكتب نتيجة المباراة في اللاعبين والجدول
  function applyMatch(S, m, fixture) {
    fixture.hg = m.sides[0].goals;
    fixture.ag = m.sides[1].goals;
    fixture.xg = [round1(m.sides[0].xg), round1(m.sides[1].xg)];
    m.sides.forEach((sd, k) => {
      const res = Math.sign(sd.goals - m.sides[1 - k].goals);
      for (const id in sd.mins) {
        const p = S.players[id];
        if (!p || !sd.mins[id]) continue;
        p.fit = Math.round(sd.fit[id]);
        p.st.apps++;
        p.st.rsum += sd.rating[id];
        p.form.push(sd.rating[id]);
        if (p.form.length > 5) p.form.shift();
        p.morale = clamp(p.morale + res * 5 + (sd.rating[id] - 6.5) * 2, 10, 100);
        p.played = 2;
        if (sd.cards[id] === 1) { p.yc++; if (p.yc >= 5) { p.susp = 1; p.yc = 0; } }
        if (sd.cards[id] >= 2) p.susp = 1;
      }
      for (const g of sd.scorers) { S.players[g.id].st.goals++; if (g.as && S.players[g.as]) S.players[g.as].st.assists++; }
      for (const inj of sd.injuries) if (S.players[inj.id]) S.players[inj.id].inj = inj.weeks;
      const fam = S.fam[sd.clubId];
      fam[sd.tactic.formation] = clamp((fam[sd.tactic.formation] || 30) + 4, 0, 100);
    });
    if (m.motm && S.players[m.motm.id]) S.players[m.motm.id].st.motm++;
  }

  // تقرير مفصل للمباراة (يُحفظ لآخر مباراة للمستخدم)
  function report(S, m) {
    const sides = m.sides.map((sd) => ({
      clubId: sd.clubId, goals: sd.goals, shots: sd.shots, onT: sd.onT, xg: round1(sd.xg), corners: sd.corners, fouls: sd.fouls, yel: sd.yel, red: sd.red,
      poss: Math.round((sd.poss / Math.max(1, m.minute)) * 100), passes: sd.passes, passPct: Math.round((sd.passOk / Math.max(1, sd.passes)) * 100), saves: sd.saves, big: sd.big,
      formation: sd.tactic.formation, scorers: sd.scorers,
      ratings: Object.keys(sd.mins).filter((id) => sd.mins[id] > 0).map((id) => ({ id, r: sd.rating[id], min: sd.mins[id], role: (sd.on.find((e) => e.id === id) || {}).role || (S.players[id] ? S.players[id].pos : '') })).sort((a, b) => b.r - a.r),
    }));
    return { season: S.season, week: S.week, names: m.names, sides, events: m.events, xgt: m.xgt, zones: m.zones, factors: m.factors.map((f) => ({ att: f.att, text: f.text, weight: f.weight })), motm: m.motm, user: m.user, notes: analystNotes(S, m) };
  }

  function analystNotes(S, m) {
    const u = m.user >= 0 ? m.user : 0, o = 1 - u;
    const U = m.sides[u], O = m.sides[o];
    const notes = [];
    const poss = Math.round((U.poss / Math.max(1, m.minute)) * 100);
    if (poss >= 58) notes.push({ good: true, text: `سيطرنا على الكرة (${poss}%)${U.xg < O.xg ? ' لكن دون خطورة كافية: الاستحواذ لم يتحول إلى فرص' : ''}` });
    else if (poss <= 42) notes.push({ good: U.xg >= O.xg, text: `خسرنا معركة الاستحواذ (${poss}%)${U.xg >= O.xg ? '، ومع ذلك صنعنا فرصًا أخطر بالمرتدات' : '. فكّر في لاعب وسط إضافي أو تمرير أقصر'}` });
    const dxg = U.xg - O.xg;
    if (Math.abs(dxg) > 0.6) notes.push({ good: dxg > 0, text: `الأهداف المتوقعة ${round1(U.xg)} مقابل ${round1(O.xg)}: ${dxg > 0 ? 'كنا الأخطر' : 'الخصم صنع فرصًا أخطر'}` });
    if (U.goals < U.xg - 1) notes.push({ good: false, text: `أهدرنا كثيرًا: ${U.goals} أهداف من ${round1(U.xg)} متوقعة. مهاجم أفضل في الإنهاء قد يصنع الفارق` });
    if (O.goals < O.xg - 1) notes.push({ good: true, text: `حارسنا ودفاعنا أنقذا الموقف: الخصم سجل ${O.goals} من ${round1(O.xg)} متوقعة` });
    if (O.big >= 3) notes.push({ good: false, text: `سمحنا بـ${O.big} فرص محققة. راجع خط الدفاع وسرعة المدافعين` });
    const tired = U.on.filter((e) => U.fit[e.id] < 55).length;
    if (tired >= 3) notes.push({ good: false, text: `${tired} لاعبين أنهوا المباراة بلياقة أقل من 55%. الضغط والإيقاع العالي يستنزفان الفريق` });
    for (const f of m.factors) {
      const good = (f.att === u) === (f.weight > 0);
      if (Math.abs(f.weight) >= 0.06) notes.push({ good, text: f.text });
    }
    return notes.slice(0, 7);
  }

  // ---------- التحليل المسبق ----------
  function previewProfile(S, clubId, tactic) {
    const slots = FORMATIONS[tactic.formation];
    const entries = [];
    tactic.lineup.forEach((id, i) => { if (id && S.players[id]) entries.push({ p: S.players[id], role: slots[i][0] }); });
    return profile(entries, tactic, (S.fam[clubId] || {})[tactic.formation]);
  }

  // تقدير سريع بلا عشوائية: الأهداف المتوقعة لكل فريق
  function expected(S, homeId, tH, awayId, tA) {
    const P = [previewProfile(S, homeId, tH), previewProfile(S, awayId, tA)];
    const T = [tH, tA];
    const f = tacticalFactors(P, T, [club(S, homeId).short, club(S, awayId).short]);
    const co = coefficients(P, T, 0, f, clubLeague(S, homeId).sim);
    const xg = [0, 1].map((i) => {
      const avgXg = (co.big[i] * 0.4 + co.cross[i] * 0.075 + 0.2 * 0.037 + (1 - co.big[i] - co.cross[i] - 0.2) * 0.09) * co.xgm[i];
      return 90 * co.share[i] * co.rate[i] * avgXg * 1.12 + 0.1;
    });
    return { xg, share: co.share, factors: f, P };
  }

  // مختبر: يحاكي المباراة n مرة بنسخة من الحالة دون تعديلها
  function monteCarlo(S, homeId, tH, awayId, tA, n) {
    const saved = seedState;
    const res = { w: 0, d: 0, l: 0, gf: 0, ga: 0, xgf: 0, xga: 0, scores: {} };
    for (let k = 0; k < n; k++) {
      const m = createMatch(S, homeId, awayId, tH, tA, { quiet: true, ai: [true, true] });
      simulate(S, m);
      const g0 = m.sides[0].goals, g1 = m.sides[1].goals;
      if (g0 > g1) res.w++; else if (g0 === g1) res.d++; else res.l++;
      res.gf += g0; res.ga += g1; res.xgf += m.sides[0].xg; res.xga += m.sides[1].xg;
      const key = g0 + '-' + g1;
      res.scores[key] = (res.scores[key] || 0) + 1;
    }
    seedState = saved ^ 0x9e3779b9;
    for (const k of ['gf', 'ga', 'xgf', 'xga']) res[k] = round1(res[k] / n);
    res.n = n;
    res.top = Object.entries(res.scores).sort((a, b) => b[1] - a[1]).slice(0, 4);
    return res;
  }

  // يقترح أفضل أسلوب ضد خصم معيّن
  function recommend(S, myId, myTactic, oppId, oppTactic, home) {
    const out = [];
    for (const key in PRESETS) {
      for (const form of [myTactic.formation].concat(Object.keys(FORMATIONS).filter((f) => f !== myTactic.formation))) {
        const t = Object.assign({}, myTactic, PRESETS[key], { preset: key, formation: form });
        delete t.name;
        if (form !== myTactic.formation) autoPick(S, myId, t);
        const e = home ? expected(S, myId, t, oppId, oppTactic) : expected(S, oppId, oppTactic, myId, t);
        const mine = home ? 0 : 1;
        out.push({ preset: key, formation: form, xgf: e.xg[mine], xga: e.xg[1 - mine], diff: e.xg[mine] - e.xg[1 - mine], fam: (S.fam[myId] || {})[form] || 0 });
      }
    }
    out.sort((a, b) => b.diff - a.diff);
    return out;
  }

  // ---------- الجدول والرزنامة ----------
  function table(S, leagueId) {
    const lg = leagueId ? leagueOf(S, leagueId) : userLeague(S);
    const rows = {};
    for (const id of lg.clubs) rows[id] = { id, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0, form: [] };
    for (const round of lg.fixtures) for (const f of round) {
      if (f.hg === null) continue;
      const h = rows[f.h], a = rows[f.a];
      h.p++; a.p++; h.gf += f.hg; h.ga += f.ag; a.gf += f.ag; a.ga += f.hg;
      if (f.hg > f.ag) { h.w++; a.l++; h.pts += 3; h.form.push('W'); a.form.push('L'); }
      else if (f.hg < f.ag) { a.w++; h.l++; a.pts += 3; h.form.push('L'); a.form.push('W'); }
      else { h.d++; a.d++; h.pts++; a.pts++; h.form.push('D'); a.form.push('D'); }
    }
    return Object.values(rows).sort((x, y) => y.pts - x.pts || (y.gf - y.ga) - (x.gf - x.ga) || y.gf - x.gf);
  }
  const position = (S, clubId) => table(S, club(S, clubId).league).findIndex((r) => r.id === clubId) + 1;

  function userFixture(S, week) {
    const round = userLeague(S).fixtures[week === undefined ? S.week : week];
    if (!round) return null;
    return round.find((f) => f.h === S.userClub || f.a === S.userClub) || null;
  }
  const fixtureDate = (S, week) => userLeague(S).dates[week === undefined ? S.week : week];

  // ---------- الجولة ----------
  function playLeagueRound(S, lg, userMatch) {
    const round = lg.fixtures[lg.played];
    if (!round) return;
    const uf = round.find((f) => f.h === S.userClub || f.a === S.userClub) || null;
    for (const f of round) {
      let m;
      if (f === uf && userMatch) m = userMatch;
      else {
        for (const id of [f.h, f.a]) {
          if (id === S.userClub) validateLineup(S, id, S.tactics[id]);
          else prepareAI(S, id, id === f.h ? f.a : f.h);
        }
        m = createMatch(S, f.h, f.a, S.tactics[f.h], S.tactics[f.a], { quiet: f !== uf, userSide: f === uf ? (f.h === S.userClub ? 0 : 1) : -1, ai: [true, true] });
        simulate(S, m);
      }
      applyMatch(S, m, f);
      if (f === uf) {
        S.lastReport = report(S, m);
        S.lastReport.date = lg.dates[lg.played];
        afterUserMatch(S, m, f);
      }
    }
    lg.played++;
  }

  // userMatch: مباراة المستخدم بعد انتهائها. قبلها تُلعب جولات الدوري الآخر التي حل موعدها
  function playRound(S, userMatch) {
    const ul = userLeague(S);
    const date = ul.dates[S.week];
    for (const lg of S.leagues) if (lg !== ul) while (lg.played < lg.fixtures.length && lg.dates[lg.played] <= date) playLeagueRound(S, lg, null);
    playLeagueRound(S, ul, userMatch);
    weekly(S);
    S.week = ul.played;
    if (S.week >= ul.fixtures.length) {
      for (const lg of S.leagues) while (lg.played < lg.fixtures.length) playLeagueRound(S, lg, null);
      endSeason(S);
    }
  }

  function prepareAI(S, clubId, oppId) {
    const t = S.tactics[clubId];
    const c = club(S, clubId);
    const opp = club(S, oppId);
    const pr = PRESETS[c.style];
    Object.assign(t, { mentality: pr.mentality, pressing: pr.pressing, tempo: pr.tempo, width: pr.width, line: pr.line, passing: pr.passing });
    // الفرق الضعيفة تتراجع أمام الكبار
    if (opp.rep - c.rep > 12) { t.mentality = Math.max(0, t.mentality - 1); t.line = Math.min(t.line, 1); }
    if (c.rep - opp.rep > 12) t.mentality = Math.min(4, t.mentality + 1);
    autoPick(S, clubId, t);
  }

  function afterUserMatch(S, m, f) {
    const u = f.h === S.userClub ? 0 : 1;
    const gf = m.sides[u].goals, ga = m.sides[1 - u].goals;
    const opp = club(S, u === 0 ? f.a : f.h);
    const me = club(S, S.userClub);
    const expect = (me.rep - opp.rep) / 25;
    const r = Math.sign(gf - ga);
    S.board.conf = clamp(Math.round(S.board.conf + r * 3 - expect * 1.5 + (r < 0 && opp.rep > me.rep ? 1.5 : 0)), 0, 100);
    S.formLine.push({ week: S.week, gf, ga, pos: 0 });
    const ratings = Object.keys(m.sides[u].mins);
    const top14 = squadOf(S, S.userClub).sort((a, b) => b.ovr - a.ovr).slice(0, 14).map((p) => p.id);
    for (const id of top14) if (!ratings.includes(id) && available(S.players[id])) S.players[id].morale = clamp(S.players[id].morale - 4, 10, 100);
  }

  function weekly(S) {
    const user = S.userClub;
    const ul = userLeague(S);
    const fin = { wages: 0, tickets: 0, sponsor: 0, tv: 0, opex: 0 };
    const wageBy = {};
    S.devLog = [];
    const uf = userFixture(S);
    for (const p of Object.values(S.players)) {
      const isUser = p.clubId === user;
      const c = p.clubId ? club(S, p.clubId) : null;
      if (p.inj > 0) { p.inj--; p.fit = Math.min(p.fit, 70); }
      // من أُوقف في مباراة هذه الجولة يغيب الجولة القادمة، ومن غاب يقضي عقوبته
      if (p.susp > 0 && p.played !== 2) p.susp--;
      const inten = isUser ? S.training.intensity : 1;
      p.fit = clamp(p.fit + [30, 24, 17][inten], 0, 100);
      if (!p.clubId) { p.fit = 90; p.played = 0; continue; }
      const fac = isUser ? S.facilities.training : clamp(Math.round(c.rep / 25), 1, 4);
      const before = p.ovr;
      develop(S, p, fac, isUser ? S.training : { focus: 'balanced', intensity: 1 });
      if (isUser && p.ovr !== before) S.devLog.push({ id: p.id, from: before, to: p.ovr });
      if (isUser && inten === 2 && p.inj === 0 && rand() < 0.012) { p.inj = ri(1, 3); sendMsg(S, 'إصابة في التدريب', `${p.name} أصيب في حصة تدريبية مكثفة ويغيب ${p.inj} ${p.inj > 2 ? 'أسابيع' : 'أسبوع'}.`, 'injury'); }
      p.value = playerValue(p);
      if (p.played) p.played--;
      p.morale = clamp(p.morale + (70 - p.morale) * 0.05, 10, 100);
      wageBy[p.clubId] = (wageBy[p.clubId] || 0) + p.wage;
    }
    fin.wages = wageBy[user] || 0;
    if (S.training.focus === 'tactical') { const t = S.tactics[user]; S.fam[user][t.formation] = clamp(S.fam[user][t.formation] + 6, 0, 100); }
    for (const c of S.clubs) for (const f in S.fam[c.id]) if (f !== S.tactics[c.id].formation) S.fam[c.id][f] = Math.max(20, S.fam[c.id][f] - 0.5);
    // المالية: حقوق البث، الرعاية، التذاكر، الأجور والمصاريف التشغيلية
    const me = club(S, user);
    const E = ul.econ;
    fin.tv = E.tv;
    fin.sponsor = Math.round(me.rep * me.rep * E.sponsor);
    if (uf && uf.h === user) {
      const opp = club(S, uf.a);
      const fill = clamp(0.5 + me.rep / 250 + opp.rep / 500 + (S.board.conf - 50) / 400, 0.3, 1);
      fin.tickets = Math.round(me.capacity * fill * E.ticket);
    }
    fin.opex = Math.round((fin.tv + fin.sponsor + fin.tickets) * E.opex);
    me.budget += fin.tv + fin.sponsor + fin.tickets - fin.opex - fin.wages;
    for (const c of S.clubs) {
      if (c.id === user) continue;
      const e = clubLeague(S, c.id).econ;
      c.budget += Math.round((e.tv + c.rep * c.rep * e.sponsor + c.capacity * 0.75 * e.ticket * 0.5) * (1 - e.opex) - (wageBy[c.id] || 0));
    }
    for (const sc of S.scouts) { sc.left--; if (sc.left <= 0) completeScout(S, sc); }
    S.scouts = S.scouts.filter((sc) => sc.left > 0);
    S.offers = S.offers.filter((o) => S.week - o.week < 2 && S.players[o.pid] && S.players[o.pid].clubId === user);
    for (const pid of S.listed) {
      const p = S.players[pid];
      if (!p || p.clubId !== user) continue;
      if (rand() < 0.45) makeAIOffer(S, p, 0.8 + rand() * 0.35);
    }
    S.listed = S.listed.filter((pid) => S.players[pid] && S.players[pid].clubId === user);
    if (rand() < 0.08) {
      const stars = squadOf(S, user).filter((p) => p.age <= 23 && p.pot >= me.level + 6 && !S.listed.includes(p.id));
      if (stars.length) makeAIOffer(S, pick(stars), 1.2 + rand() * 0.4);
    }
    if (rand() < 0.4) aiTransfer(S);
    if (S.week === ul.fixtures.length - 6) {
      const ending = squadOf(S, user).filter((p) => p.contract <= 1);
      if (ending.length) sendMsg(S, 'عقود تنتهي', `عقود هؤلاء تنتهي هذا الموسم: ${ending.map((p) => p.name).join('، ')}. جددها من بطاقة اللاعب أو سيرحلون مجانًا.`, 'contract');
    }
    if (S.board.conf < 25 && S.week % 4 === 0) sendMsg(S, 'تحذير من المجلس', `ثقة المجلس منخفضة (${S.board.conf}%). نحتاج نتائج أفضل وإلا ستكون مهمتك في خطر.`, 'board');
    if (me.budget < 0) sendMsg(S, 'رصيد سلبي', `رصيد النادي ${money(me.budget)}. بِع لاعبين أو خفّض الأجور.`, 'finance');
    S.finance.week = fin;
    S.finance.log.push({ s: S.season, w: S.week, bal: me.budget });
    if (S.finance.log.length > 120) S.finance.log.shift();
    const pos = position(S, user);
    if (S.formLine.length && S.formLine[S.formLine.length - 1].week === S.week) S.formLine[S.formLine.length - 1].pos = pos;
  }

  function develop(S, p, fac, plan) {
    const gap = p.pot - p.ovr;
    let g;
    if (p.age <= 21) g = gap > 0 ? 0.09 + gap * 0.013 : 0;
    else if (p.age <= 24) g = gap > 0 ? 0.06 + gap * 0.01 : 0;
    else if (p.age <= 28) g = gap > 0 ? 0.03 + gap * 0.006 : 0;
    else if (p.age <= 30) g = 0;
    else g = -(p.age - 30) * 0.035 - 0.02;
    const inten = [0.75, 1, 1.3][plan.intensity];
    if (g > 0) g *= (0.75 + fac * 0.12) * inten * (p.played ? 1.2 : 0.85) * (plan.focus === 'tactical' ? 0.7 : 1);
    p.xp = (p.xp || 0) + g * 3.4 + (rand() - 0.5) * 0.3;
    const focusAttrs = TRAIN_FOCUS[plan.focus] && TRAIN_FOCUS[plan.focus].attrs;
    let guard = 0;
    while (p.xp >= 1 && guard++ < 8) {
      p.xp -= 1;
      let k;
      if (p.focus && rand() < 0.5) k = p.focus;
      else if (focusAttrs && rand() < 0.6) k = pick(focusAttrs);
      else k = weighted(Object.keys(W[p.pos]), (x) => W[p.pos][x]);
      if (k === 'gk' && p.pos !== 'GK') k = 'phy';
      if (p.a[k] < 97) p.a[k]++;
    }
    while (p.xp <= -1 && guard++ < 8) {
      p.xp += 1;
      const k = rand() < 0.6 ? pick(['pac', 'phy']) : weighted(Object.keys(W[p.pos]), (x) => W[p.pos][x]);
      if (p.a[k] > 20) p.a[k]--;
    }
    const before = p.ovr;
    p.ovr = calcOvr(p);
    if (p.ovr > p.pot + 1 && p.ovr > before) { p.pot = p.ovr; }
  }

  // ---------- الانتقالات ----------
  function isKey(S, p) {
    if (!p.clubId) return false;
    const sq = squadOf(S, p.clubId).sort((a, b) => b.ovr - a.ovr);
    return sq.indexOf(p) < 11;
  }
  function askingPrice(S, p) {
    if (!p.clubId) return p.discovered ? Math.round((p.value * 0.25) / 10000) * 10000 : 0;
    const me = club(S, S.userClub);
    const c = club(S, p.clubId);
    let f = isKey(S, p) ? 1.35 : 1.08;
    if (c.rep > me.rep + 10) f *= 1.1;
    if (p.contract <= 1) f *= 0.75;
    return Math.round((p.value * f) / 10000) * 10000;
  }
  function wageDemand(S, p, clubId) {
    const c = club(S, clubId || S.userClub);
    const f = 1 + Math.max(0, p.ovr - c.level) * 0.04 + (p.clubId ? 0.12 : 0.05);
    return Math.round((baseWage(p, clubLeague(S, c.id).econ) * f) / 100) * 100;
  }
  const maxAttract = (S) => club(S, S.userClub).level + 8;

  function makeOffer(S, pid, fee, wage, years) {
    const p = S.players[pid];
    const me = club(S, S.userClub);
    if (!p || p.clubId === S.userClub) return { ok: false, msg: 'اللاعب غير متاح' };
    if (squadOf(S, S.userClub).length >= MAX_SQUAD) return { ok: false, msg: `القائمة ممتلئة (${MAX_SQUAD} لاعبًا). بِع أو سرّح لاعبًا أولًا.` };
    if (fee > me.budget) return { ok: false, msg: `الميزانية لا تكفي: المتاح ${money(me.budget)}` };
    if (p.ovr > maxAttract(S) + 3 && p.age > 21) return { ok: false, msg: `${p.name} لا يرى ${me.name} في مستوى طموحاته حاليًا. ارفع سمعة النادي بالنتائج.` };
    const ask = askingPrice(S, p);
    if (p.clubId) {
      const tol = ask * (0.93 + rand() * 0.06);
      if (fee < tol) {
        if (fee >= ask * 0.75) return { ok: false, counter: ask, msg: `${club(S, p.clubId).name} يرفض العرض ويطلب ${money(ask)}` };
        return { ok: false, msg: `${club(S, p.clubId).name} يرفض العرض بشدة: بعيد جدًا عن قيمة اللاعب` };
      }
    }
    const demand = wageDemand(S, p);
    if (wage < demand * 0.95) return { ok: false, wageCounter: demand, msg: `النادي وافق${p.clubId ? '' : ' (لاعب حر)'}، لكن ${p.name} يطلب أجرًا أسبوعيًا قدره ${money(demand)}` };
    // تمت الصفقة
    if (p.clubId) {
      const seller = club(S, p.clubId);
      seller.budget += fee;
      removeFromTactic(S, p.clubId, pid);
    }
    me.budget -= fee;
    p.clubId = S.userClub;
    p.wage = Math.round(wage);
    p.contract = years;
    p.morale = 78;
    p.discovered = false;
    p.know = Math.max(p.know, 70);
    assignNumber(S, p);
    S.shortlist = S.shortlist.filter((x) => x !== pid);
    S.reports.forEach((r) => { r.players = r.players.filter((x) => x !== pid); });
    const t = S.tactics[S.userClub];
    if (t.bench.length < 7) t.bench.push(pid);
    sendMsg(S, 'صفقة جديدة', `${p.name} (${POS_AR[p.pos]}، ${p.age} سنة، تقييم ${p.ovr}) ينضم إلى ${me.name} مقابل ${money(fee)} وأجر ${money(p.wage)} أسبوعيًا لمدة ${years} ${years > 2 ? 'سنوات' : 'سنة'}.`, 'transfer');
    return { ok: true, msg: `تمت الصفقة! ${p.name} لاعب في ${me.name}` };
  }

  function removeFromTactic(S, clubId, pid) {
    const t = S.tactics[clubId];
    if (!t) return;
    t.lineup = t.lineup.map((id) => (id === pid ? null : id));
    t.bench = t.bench.filter((id) => id !== pid);
  }

  function makeAIOffer(S, p, mult) {
    const buyers = S.clubs.filter((c) => c.id !== S.userClub && c.budget > p.value * mult && c.level + 5 >= p.ovr);
    if (!buyers.length) return;
    const b = pick(buyers);
    if (S.offers.find((o) => o.pid === p.id && o.club === b.id)) return;
    const fee = Math.round((p.value * mult) / 10000) * 10000;
    S.offers.push({ id: 'o' + S.nextId++, pid: p.id, club: b.id, fee, week: S.week });
    sendMsg(S, 'عرض لشراء لاعب', `${b.name} يعرض ${money(fee)} لضم ${p.name} (القيمة ${money(p.value)}). العرض صالح أسبوعين في «الانتقالات».`, 'offer');
  }

  function acceptOffer(S, oid) {
    const o = S.offers.find((x) => x.id === oid);
    if (!o) return 'العرض لم يعد صالحًا';
    const p = S.players[o.pid];
    const b = club(S, o.club);
    if (b.budget < o.fee) { S.offers = S.offers.filter((x) => x !== o); return `${b.name} لم يعد يملك المال`; }
    b.budget -= o.fee;
    club(S, S.userClub).budget += o.fee;
    removeFromTactic(S, S.userClub, p.id);
    p.clubId = b.id;
    assignNumber(S, p);
    p.wage = Math.max(p.wage, wageDemand(S, p, b.id));
    p.contract = ri(2, 4);
    S.listed = S.listed.filter((x) => x !== p.id);
    S.offers = S.offers.filter((x) => x.pid !== p.id);
    sendMsg(S, 'بيع لاعب', `${p.name} انتقل إلى ${b.name} مقابل ${money(o.fee)}.`, 'transfer');
    return null;
  }
  const rejectOffer = (S, oid) => { S.offers = S.offers.filter((x) => x.id !== oid); };

  const releaseCost = (p) => Math.round(p.wage * 26 * Math.max(1, p.contract) * 0.5);
  function release(S, pid) {
    const p = S.players[pid];
    if (!p || p.clubId !== S.userClub) return 'غير ممكن';
    const cost = releaseCost(p);
    club(S, S.userClub).budget -= cost;
    removeFromTactic(S, S.userClub, pid);
    p.clubId = null;
    p.contract = 0;
    S.listed = S.listed.filter((x) => x !== pid);
    sendMsg(S, 'تسريح لاعب', `سُرّح ${p.name}. كلّف فسخ العقد ${money(cost)}.`, 'transfer');
    return null;
  }

  function renewDemand(S, p) {
    const d = wageDemand(S, p) * (p.age >= 31 ? 0.9 : 1.05);
    return Math.round(Math.max(p.wage * 1.05, d) / 100) * 100;
  }
  function renew(S, pid, years) {
    const p = S.players[pid];
    if (!p || p.clubId !== S.userClub) return 'غير ممكن';
    if (p.morale < 30) return `${p.name} غير راضٍ ويرفض التجديد حاليًا (المعنويات ${Math.round(p.morale)})`;
    p.wage = renewDemand(S, p);
    p.contract = years;
    p.morale = clamp(p.morale + 8, 10, 100);
    return null;
  }

  function aiTransfer(S) {
    const buyers = S.clubs.filter((c) => c.id !== S.userClub && c.budget > 500000);
    if (!buyers.length) return;
    const b = pick(buyers);
    const sq = squadOf(S, b.id);
    const pos = pick(POS);
    const weakest = sq.filter((p) => p.pos === pos).sort((x, y) => x.ovr - y.ovr)[0];
    const bar = weakest ? weakest.ovr + 3 : 50;
    const cands = Object.values(S.players).filter((p) => p.pos === pos && p.clubId !== b.id && p.clubId !== S.userClub && !p.discovered && p.ovr >= bar && p.ovr <= b.level + 4 && (p.clubId ? askingPrice(S, p) : 0) <= b.budget * 0.6);
    if (!cands.length) return;
    const p = pick(cands);
    const fee = p.clubId ? Math.round(p.value * 1.1 / 10000) * 10000 : 0;
    if (p.clubId) { club(S, p.clubId).budget += fee; removeFromTactic(S, p.clubId, p.id); }
    const from = p.clubId ? club(S, p.clubId).name : 'لاعب حر';
    b.budget -= fee;
    p.clubId = b.id;
    assignNumber(S, p);
    p.contract = ri(2, 4);
    if (sq.length >= 28 && weakest) { removeFromTactic(S, b.id, weakest.id); weakest.clubId = null; weakest.contract = 0; }
    S.news = S.news || [];
    S.news.unshift(`${b.name} يضم ${p.name} (${p.ovr}) من ${from}${fee ? ` مقابل ${money(fee)}` : ''}`);
    if (S.news.length > 12) S.news.length = 12;
  }

  // ---------- الكشافة ----------
  const maxScouts = (S) => S.facilities.scouting + 1;
  function startScout(S, region, pos, age) {
    if (S.scouts.length >= maxScouts(S)) return `كل الكشافين في مهام (${maxScouts(S)}). طوّر شبكة الكشافة لكشاف إضافي.`;
    const r = REGIONS[region];
    const me = club(S, S.userClub);
    if (me.budget < r.cost) return 'الميزانية لا تكفي لتكلفة المهمة';
    me.budget -= r.cost;
    S.scouts.push({ id: 's' + S.nextId++, region, pos, age, left: r.weeks, total: r.weeks });
    return null;
  }
  function completeScout(S, sc) {
    const r = REGIONS[sc.region];
    const lvl = S.facilities.scouting;
    const me = club(S, S.userClub);
    const level = me.level;
    const n = 2 + lvl;
    const found = [];
    for (let k = 0; k < n; k++) {
      const pos = sc.pos === 'any' ? pick(POS) : sc.pos;
      let age, target, boost;
      if (sc.age === 'young') { age = ri(16, 19); target = Math.round(level - 14 + gauss() * 5); boost = 4 + r.talent * 2 + lvl * 2 + (rand() < 0.15 ? 10 : 0); }
      else { age = ri(20, 29); target = Math.round(level - 2 + r.talent + gauss() * 5); boost = r.talent; }
      const p = genPlayer(S, { pos, age, target: clamp(target, 38, 85), region: sc.region, clubId: null, potBoost: boost, know: 45 + lvl * 10, contract: 0 });
      p.discovered = true;
      found.push(p.id);
    }
    S.reports.unshift({ id: sc.id, region: sc.region, pos: sc.pos, age: sc.age, season: S.season, week: S.week, players: found });
    if (S.reports.length > 10) {
      const old = S.reports.pop();
      for (const id of old.players) { const p = S.players[id]; if (p && !p.clubId && p.discovered && !S.shortlist.includes(id)) delete S.players[id]; }
    }
    const best = found.map((id) => S.players[id]).sort((a, b) => b.pot - a.pot)[0];
    sendMsg(S, `تقرير الكشافة: ${r.name}`, `اكتشف كشافنا ${found.length} لاعبين. الأبرز: ${best.name} (${POS_AR[best.pos]}، ${best.age} سنة). التفاصيل في «الكشافة».`, 'scout');
  }
  function scoutPlayer(S, pid) {
    const p = S.players[pid];
    const me = club(S, S.userClub);
    const cost = 15000;
    if (me.budget < cost) return 'الميزانية لا تكفي';
    me.budget -= cost;
    p.know = clamp(p.know + 30 + S.facilities.scouting * 5, 0, 100);
    return null;
  }

  function upgradeFacility(S, key) {
    const lvl = S.facilities[key];
    if (lvl >= 5) return 'المستوى الأعلى';
    const cost = facilityCost(lvl, S);
    const me = club(S, S.userClub);
    if (me.budget < cost) return `تحتاج ${money(cost)}`;
    me.budget -= cost;
    S.facilities[key]++;
    sendMsg(S, 'تطوير المنشآت', `${FACILITY[key].name} أصبح في المستوى ${S.facilities[key]}.`, 'finance');
    return null;
  }

  // ---------- نهاية الموسم ----------
  function endSeason(S) {
    const user = S.userClub;
    const ul = userLeague(S);
    const me = club(S, user);
    const tb = table(S, ul.id);
    const n = tb.length;
    const pos = tb.findIndex((r) => r.id === user) + 1;
    const champ = club(S, tb[0].id);
    const players = Object.values(S.players).filter((p) => p.clubId && club(S, p.clubId).league === ul.id);
    const scorer = players.slice().sort((a, b) => b.st.goals - a.st.goals)[0];
    const best = players.filter((p) => p.st.apps >= 10).sort((a, b) => b.st.rsum / b.st.apps - a.st.rsum / a.st.apps)[0];
    const prize = ul.econ.prize * (n - pos + 1) + (pos === 1 ? ul.econ.champ : 0);
    const target = S.board.target;
    const relegated = pos > n - ul.relegate;
    let verdict;
    if (relegated) { verdict = 'هبط الفريق: المجلس قرر إنهاء مهمتك'; S.board.conf = 0; }
    else if (pos <= target - 2) { verdict = 'المجلس سعيد جدًا: تجاوزت التوقعات بكثير'; S.board.conf = clamp(S.board.conf + 25, 0, 100); }
    else if (pos <= target) { verdict = 'المجلس راضٍ: حققت الهدف'; S.board.conf = clamp(S.board.conf + 12, 0, 100); }
    else if (pos <= target + 2) { verdict = 'المجلس قلق: أخفقت قليلًا في بلوغ الهدف'; S.board.conf = clamp(S.board.conf - 12, 0, 100); }
    else { verdict = 'المجلس غاضب: النتائج بعيدة عن المطلوب'; S.board.conf = clamp(S.board.conf - 25, 0, 100); }
    const others = [];
    for (const lg of S.leagues) {
      const t = table(S, lg.id);
      t.forEach((r, i) => { club(S, r.id).budget += lg.econ.prize * (t.length - i) + (i === 0 ? lg.econ.champ : 0); });
      if (lg !== ul) others.push({ league: lg.name, champ: club(S, t[0].id).name });
      t.forEach((r, i) => { const c = club(S, r.id); c.rep = clamp(Math.round(c.rep + (targetPosition(S, c.id) - (i + 1)) * 0.6), 30, 96); });
    }
    const label = `${S.year}/${S.year + 1}`;
    S.history.push({ season: S.season, year: label, league: ul.short, pos, pts: tb[pos - 1].pts, champ: champ.name, scorer: scorer ? `${scorer.name} (${scorer.st.goals})` : '—', best: best ? best.name : '—', verdict, target });
    S.seasonEnd = { label, pos, champ: champ.name, scorer: scorer ? { name: scorer.name, goals: scorer.st.goals, club: club(S, scorer.clubId).name } : null, best: best ? { name: best.name, avg: round1(best.st.rsum / best.st.apps) } : null, prize, verdict, target, others, relegated };
    if (relegated || S.board.conf < 15) { S.gameOver = true; sendMsg(S, 'إقالة', `قرر مجلس الإدارة إنهاء عقدك بعد المركز ${pos}.`, 'board'); return; }
    const retired = [], left = [];
    for (const p of Object.values(S.players)) {
      p.age++;
      p.st = { apps: 0, goals: 0, assists: 0, rsum: 0, motm: 0 };
      p.yc = 0; p.susp = 0; p.form = [];
      if (p.age >= 34 && rand() < 0.3 + (p.age - 34) * 0.25) {
        if (p.clubId === user) retired.push(p.name);
        if (p.clubId) removeFromTactic(S, p.clubId, p.id);
        delete S.players[p.id];
        continue;
      }
      if (!p.clubId) { if (p.discovered && !S.shortlist.includes(p.id)) delete S.players[p.id]; continue; }
      p.contract--;
      if (p.contract <= 0) {
        if (p.clubId === user) { left.push(p.name); removeFromTactic(S, user, p.id); p.clubId = null; }
        else if (rand() < 0.8) p.contract = ri(1, 3);
        else { removeFromTactic(S, p.clubId, p.id); p.clubId = null; }
      }
      p.value = playerValue(p);
    }
    const youth = [];
    const yl = S.facilities.youth;
    for (let k = 0; k < 2 + yl; k++) {
      const p = genPlayer(S, { pos: pick(POS), age: ri(16, 18), target: Math.round(me.level - 24 + yl * 2 + gauss() * 3), region: me.league === 'dz' ? 'dz' : 'en', clubId: user, potBoost: 8 + yl * 4 + (rand() < 0.12 * yl ? 12 : 0), contract: 3, know: 70 + yl * 5 });
      p.gen = true;
      p.wage = Math.round(ul.econ.wageMin * 0.4);
      assignNumber(S, p);
      youth.push(p);
    }
    for (const c of S.clubs) {
      if (c.id === user) continue;
      for (let k = 0; k < 2; k++) { const p = genPlayer(S, { pos: pick(POS), age: ri(17, 19), target: Math.round(c.level - 20 + gauss() * 3), region: c.league === 'dz' ? 'dz' : 'en', clubId: c.id, potBoost: 10 }); p.gen = true; assignNumber(S, p); }
      fillSquad(S, c, c.level);
    }
    for (let i = 0; i < 12; i++) { const dz = i % 2 === 0; const p = genPlayer(S, { pos: pick(POS), age: ri(21, 33), target: dz ? ri(54, 64) : ri(64, 75), region: dz ? pick(['dz', 'ma', 'tn', 'eg', 'wa']) : pick(['en', 'sa', 'ee', 'wa']), clubId: null, contract: 0 }); p.gen = true; }
    S.seasonEnd.retired = retired;
    S.seasonEnd.left = left;
    S.seasonEnd.youth = youth.map((p) => p.id);
    S.season++;
    S.year++;
    S.week = 0;
    S.formLine = [];
    for (const lg of S.leagues) {
      lg.start = nextYear(lg.start);
      lg.end = nextYear(lg.end);
      lg.fixtures = genFixtures(lg.clubs.slice());
      lg.dates = roundDates(lg.start, lg.end, lg.fixtures.length);
      lg.played = 0;
    }
    for (const c of S.clubs) { c.level = clubLevel(S, c.id); validateLineup(S, c.id, S.tactics[c.id]); if (c.id !== user) autoPick(S, c.id, S.tactics[c.id]); }
    S.board.target = targetPosition(S, user);
    sendMsg(S, `انطلاق موسم ${S.year}/${S.year + 1}`, `هدف المجلس: ${targetText(S)}. انضم ${youth.length} لاعبين من أكاديمية الشباب.${retired.length ? ` اعتزل: ${retired.join('، ')}.` : ''}${left.length ? ` غادر بنهاية العقد: ${left.join('، ')}.` : ''}`, 'board');
  }
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  const FM = {
    ATTRS, ATTR_AR, POS, POS_AR, W, FORMATIONS, TACTIC_KEYS, TACTIC_AR, PRESETS, REGIONS, TRAIN_FOCUS, FACILITY, MAX_SUBS, MAX_SQUAD,
    setSeed, rand, clamp, round1, money, toStars, potRange, facilityCost,
    newGame, club, squadOf, available, ovrAt, familiarity, autoPick, validateLineup, profile, previewProfile, tacticalFactors,
    createMatch, stepMinute, simulate, substitute, refresh, applyMatch, report, expected, monteCarlo, recommend,
    table, position, userFixture, playRound, prepareAI, askingPrice, wageDemand, makeOffer, acceptOffer, rejectOffer, release, releaseCost,
    renew, renewDemand, leagueOf, userLeague, clubLeague, fixtureDate, targetText, startScout, scoutPlayer, maxScouts, upgradeFacility, sendMsg, isKey, maxAttract,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = FM;
  else root.FM = FM;
})(typeof window !== 'undefined' ? window : globalThis);
