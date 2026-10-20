(() => {
'use strict';
const SH = window.SKShared;
const $ = (s, r = document) => r.querySelector(s);
const h = (tag, attrs, ...kids) => {
  const e = document.createElement(tag);
  for (const k in (attrs || {})) {
    const v = attrs[k];
    if (k === 'class') e.className = v; else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, ''); else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
};

/* ---------- i18n ---------- */
let lang = localStorage.getItem('sk-lang') || (navigator.language.startsWith('ru') ? 'ru' : 'en');
const tr = (x) => (x && typeof x === 'object') ? (x[lang] || x.en) : x;
const T = (ru, en) => ({ ru, en });

const UI = {
  open: T('Открыть проект', 'Open project'), save: T('Сохранить проект', 'Save project'),
  drop: T('Перетащите видео сюда', 'Drop a video here'), pick: T('Выбрать видео…', 'Choose video…'),
  touch: T('Эмуляция тача', 'Emulate touch'), scrub: T('Ручная прокрутка', 'Manual scrub'),
  desktop: T('ПК', 'Desktop'), tablet: T('Планшет', 'Tablet'), mobile: T('Телефон', 'Phone'),
  frame: T('кадр', 'frame'), building: T('Готовлю превью…', 'Building preview…'),
  change: T('Заменить…', 'Replace…'), noVideo: T('Видео не выбрано', 'No video selected')
};

/* ---------- state ---------- */
let S = SH.defaults();
let paths = null;
const live = { desktop: null, mobile: null, rid: 0, device: 'desktop' };

const get = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
const set = (o, p, v) => { const ks = p.split('.'); const l = ks.pop(); const t = ks.reduce((a, k) => a[k], o); t[l] = v; };

/* ---------- field schema ---------- */
const sel = (...pairs) => pairs.map(([v, ru, en]) => [v, T(ru, en || ru)]);
const trigOpts = sel(['scroll', 'Скролл', 'Scroll'], ['mouse-x', 'Мышь ←→', 'Mouse ←→'], ['mouse-y', 'Мышь ↑↓', 'Mouse ↑↓'], ['drag-x', 'Драг ←→', 'Drag ←→'], ['drag-y', 'Драг ↑↓', 'Drag ↑↓'], ['hover', 'Наведение', 'Hover'], ['autoplay', 'Автоплей', 'Autoplay']);
const isMouse = (S) => /^(mouse|hover)/.test(S.a.trigger);
const fmtOpts = sel(['webp', 'WebP (рекомендуется)', 'WebP (recommended)'], ['jpg', 'JPG'], ['avif', 'AVIF (мельче, долго)', 'AVIF (smaller, slow)']);
const modeOpts = sel(['count', 'Число кадров', 'Frame count'], ['fps', 'Кадров в секунду', 'Frames per second']);

const SECTIONS = [
  { id: 'source', title: T('1 · Видео', '1 · Video'), open: true, custom: 'source' },
  { id: 'opt', title: T('2 · Оптимизация (ПК)', '2 · Optimization (desktop)'), open: true, x: 'extract', fields: [
    { p: 'd.format', t: 'select', o: fmtOpts, l: T('Формат кадров', 'Frame format'), hint: T('WebP — лучший баланс. AVIF мельче на 30–50%, но кодируется долго. JPG — максимум совместимости.', 'WebP is the best balance. AVIF is 30–50% smaller but slow. JPG for max compatibility.') },
    { p: 'd.quality', t: 'rng', min: 30, max: 100, step: 1, l: T('Качество', 'Quality') },
    { p: 'd.width', t: 'num', min: 320, max: 3840, step: 10, l: T('Макс. ширина кадра, px', 'Max frame width, px') },
    { p: 'd.mode', t: 'select', o: modeOpts, l: T('Как задать плотность', 'Density mode') },
    { p: 'd.count', t: 'num', min: 8, max: 2000, step: 1, l: T('Количество кадров', 'Frame count'), if: (S) => S.d.mode === 'count', hint: T('Больше кадров — плавнее, но тяжелее и дороже по памяти. Для сайтов обычно 80–180.', 'More frames = smoother but heavier. 80–180 is typical for the web.') },
    { p: 'd.fps', t: 'num', min: 1, max: 60, step: 1, l: T('Кадров/сек', 'FPS'), if: (S) => S.d.mode === 'fps' },
    { custom: 'estimate' }
  ] },
  { id: 'mobile', title: T('3 · Мобильная версия', '3 · Mobile version'), x: 'extract', fields: [
    { p: 'm.enabled', t: 'chk', l: T('Отдельный набор кадров для телефонов', 'Separate frame set for phones'), hint: T('Лежит рядом в папке mobile/, рантайм сам выбирает по ширине экрана.', 'Stored in mobile/ next to desktop; the runtime picks by viewport width.') },
    { p: 'm.source', t: 'select', o: sel(['same', 'То же видео (кроп + меньше)', 'Same video (crop + smaller)'], ['file', 'Другое видео для мобилки', 'Different video for mobile']), l: T('Источник', 'Source'), if: (S) => S.m.enabled },
    { custom: 'mobileSrc' },
    { p: 'm.aspect', t: 'select', o: sel(['none', 'Без кропа', 'No crop'], ['9:16', '9:16 (вертикаль)', '9:16 (portrait)'], ['3:4', '3:4'], ['4:5', '4:5'], ['1:1', '1:1']), l: T('Пропорции кропа', 'Crop aspect'), if: (S) => S.m.enabled },
    { p: 'm.cropX', t: 'pct', l: T('Сдвиг кропа по X, %', 'Crop offset X, %'), if: (S) => S.m.enabled && S.m.aspect !== 'none' },
    { p: 'm.cropY', t: 'pct', l: T('Сдвиг кропа по Y, %', 'Crop offset Y, %'), if: (S) => S.m.enabled && S.m.aspect !== 'none' },
    { p: 'm.format', t: 'select', o: fmtOpts, l: T('Формат', 'Format'), if: (S) => S.m.enabled },
    { p: 'm.quality', t: 'rng', min: 30, max: 100, step: 1, l: T('Качество', 'Quality'), if: (S) => S.m.enabled },
    { p: 'm.width', t: 'num', min: 240, max: 2160, step: 10, l: T('Макс. ширина, px', 'Max width, px'), if: (S) => S.m.enabled },
    { p: 'm.mode', t: 'select', o: modeOpts, l: T('Плотность', 'Density'), if: (S) => S.m.enabled },
    { p: 'm.count', t: 'num', min: 8, max: 2000, step: 1, l: T('Количество кадров', 'Frame count'), if: (S) => S.m.enabled && S.m.mode === 'count' },
    { p: 'm.fps', t: 'num', min: 1, max: 60, step: 1, l: T('Кадров/сек', 'FPS'), if: (S) => S.m.enabled && S.m.mode === 'fps' },
    { p: 'm.breakpoint', t: 'num', min: 320, max: 1280, step: 1, l: T('Брейкпоинт, px (≤ → моб. кадры)', 'Breakpoint, px (≤ → mobile frames)'), if: (S) => S.m.enabled, x: 'cfg' },
    { custom: 'hr', l: T('Анимация на мобильных', 'Mobile animation'), if: (S) => S.m.enabled },
    { p: 'am.trigger', t: 'select', o: [['', T('Как на ПК', 'Same as desktop')], ...trigOpts], l: T('Триггер', 'Trigger'), if: (S) => S.m.enabled, x: 'cfg' },
    { p: 'am.pinHeight', t: 'num', min: 0, max: 2000, step: 10, l: T('Длина скролла, vh (0 = как на ПК)', 'Scroll length, vh (0 = same)'), if: (S) => S.m.enabled, x: 'cfg' },
    { p: 'am.smooth', t: 'num', min: -1, max: 3, step: 0.05, l: T('Инерция, с (−1 = как на ПК)', 'Inertia, s (−1 = same)'), if: (S) => S.m.enabled, x: 'cfg' },
    { p: 'am.fit', t: 'select', o: sel(['', 'Как на ПК', 'Same as desktop'], ['cover', 'Cover'], ['contain', 'Contain']), l: T('Вписывание', 'Fit'), if: (S) => S.m.enabled, x: 'cfg' }
  ] },
  { id: 'anim', title: T('4 · Анимация', '4 · Animation'), open: true, x: 'cfg', fields: [
    { custom: 'triggerCards' },
    // scroll
    { p: 'a.scroll.pin', t: 'chk', l: T('Закрепить блок на экране (pin)', 'Pin section on screen'), if: (S) => S.a.trigger === 'scroll', hint: T('Блок «залипает», пока кадры проигрываются. Нужно, чтобы у родителей не было overflow:hidden.', 'Section sticks while frames play. Parents must not have overflow:hidden.') },
    { p: 'a.scroll.pinHeight', t: 'num', min: 100, max: 2000, step: 25, l: T('Длина прокрутки, vh', 'Scroll length, vh'), if: (S) => S.a.trigger === 'scroll' && S.a.scroll.pin, hint: T('300–500 vh — комфортный скролл; больше — медленнее проигрывание.', '300–500 vh is comfortable; more = slower playback.') },
    { p: 'a.scroll.startAt', t: 'num', min: 0, max: 150, step: 5, l: T('Старт: верх блока на X% высоты экрана', 'Start: block top at X% of viewport'), if: (S) => S.a.trigger === 'scroll' && !S.a.scroll.pin },
    { p: 'a.scroll.endAt', t: 'num', min: -50, max: 100, step: 5, l: T('Финиш: низ блока на X% высоты экрана', 'End: block bottom at X% of viewport'), if: (S) => S.a.trigger === 'scroll' && !S.a.scroll.pin },
    { p: 'a.render.height', t: 'text', l: T('Высота блока (CSS)', 'Block height (CSS)'), if: (S) => !(S.a.trigger === 'scroll' && S.a.scroll.pin), hint: T('например 100vh, 80vh, 600px. Пусто — задаёте сами в CSS.', 'e.g. 100vh, 80vh, 600px. Empty — set it in your CSS.') },
    // mouse
    { p: 'a.mouse.area', t: 'select', o: sel(['section', 'Над блоком', 'Over the section'], ['window', 'По всему окну', 'Whole window']), l: T('Зона реакции мыши', 'Mouse area'), if: (S) => /^mouse/.test(S.a.trigger) },
    { p: 'a.mouse.rest', t: 'pct', l: T('Положение покоя, %', 'Rest position, %'), if: (S) => /^mouse/.test(S.a.trigger), hint: T('50% — мышь по центру = середина кадров. Влево — к 0%, вправо — к 100%.', '50% — mouse in the center = mid frame. Left → 0%, right → 100%.') },
    { p: 'a.mouse.returnToRest', t: 'chk', l: T('Возвращаться в покой, когда мышь ушла', 'Return to rest when mouse leaves'), if: (S) => /^mouse/.test(S.a.trigger) },
    { p: 'a.mouse.sensitivity', t: 'rng', min: 0.2, max: 3, step: 0.05, l: T('Чувствительность', 'Sensitivity'), if: (S) => /^mouse/.test(S.a.trigger) },
    // drag
    { p: 'a.drag.sensitivity', t: 'rng', min: 0.2, max: 4, step: 0.05, l: T('Чувствительность драга', 'Drag sensitivity'), if: (S) => /^drag/.test(S.a.trigger) },
    { p: 'a.drag.inertia', t: 'rng', min: 0, max: 0.99, step: 0.01, l: T('Инерция после отпускания', 'Release inertia'), if: (S) => /^drag/.test(S.a.trigger) },
    { p: 'a.drag.loop', t: 'chk', l: T('Зациклить (360° вращение)', 'Loop (360° spin)'), if: (S) => /^drag/.test(S.a.trigger) },
    // hover
    { p: 'a.hover.duration', t: 'rng', min: 0.2, max: 8, step: 0.1, l: T('Длительность проигрывания, с', 'Play duration, s'), if: (S) => S.a.trigger === 'hover' },
    // autoplay
    { p: 'a.autoplay.fps', t: 'num', min: 1, max: 120, step: 1, l: T('Скорость, кадров/сек', 'Speed, frames/s'), if: (S) => S.a.trigger === 'autoplay' },
    { p: 'a.autoplay.loop', t: 'chk', l: T('Зациклить', 'Loop'), if: (S) => S.a.trigger === 'autoplay' },
    { p: 'a.autoplay.pingpong', t: 'chk', l: T('Туда-обратно (ping-pong)', 'Ping-pong'), if: (S) => S.a.trigger === 'autoplay' },
    { p: 'a.autoplay.pauseOffscreen', t: 'chk', l: T('Пауза вне экрана', 'Pause off-screen'), if: (S) => S.a.trigger === 'autoplay' },
    { p: 'a.autoplay.delay', t: 'num', min: 0, max: 30, step: 0.1, l: T('Задержка старта, с', 'Start delay, s'), if: (S) => S.a.trigger === 'autoplay' },
    // common
    { custom: 'hr', l: T('Диапазон и характер', 'Range & feel') },
    { p: 'a.range.0', t: 'pct', l: T('Играть с кадра, %', 'Play from, %') },
    { p: 'a.range.1', t: 'pct', l: T('до кадра, %', 'to, %') },
    { p: 'a.reverse', t: 'chk', l: T('Реверс (играть задом наперёд)', 'Reverse') },
    { p: 'a.ease', t: 'select', o: sel(['linear', 'Линейно', 'Linear'], ['in', 'Ease in'], ['out', 'Ease out'], ['inOut', 'Ease in-out'], ['inCubic', 'Cubic in'], ['outCubic', 'Cubic out'], ['inOutCubic', 'Cubic in-out']), l: T('Ускорение', 'Easing') },
    { p: 'a.smooth', t: 'rng', min: 0, max: 2, step: 0.05, l: T('Инерция (плавность), с', 'Inertia (smoothing), s'), if: (S) => S.a.trigger !== 'autoplay' },
    { custom: 'curve' },
    { p: 'a.touchFallback', t: 'select', o: sel(['scroll', 'Скролл', 'Scroll'], ['drag-x', 'Драг ←→', 'Drag ←→'], ['autoplay', 'Автоплей', 'Autoplay'], ['poster', 'Статичный кадр', 'Static frame']), l: T('На тач-устройствах (нет мыши)', 'On touch devices (no mouse)'), if: isMouse, hint: T('Мышь/hover на телефоне не работают — рантайм переключится на это.', 'Mouse/hover do not exist on phones — the runtime falls back to this.') }
  ] },
  { id: 'render', title: T('5 · Отрисовка', '5 · Rendering'), x: 'cfg', fields: [
    { p: 'a.render.fit', t: 'select', o: sel(['cover', 'Cover (заполнить, обрезать)', 'Cover (fill, crop)'], ['contain', 'Contain (вписать целиком)', 'Contain (fit whole)'], ['fill', 'Fill (растянуть)', 'Fill (stretch)']), l: T('Вписывание', 'Fit') },
    { p: 'a.render.alignX', t: 'pct', l: T('Выравнивание X, %', 'Align X, %') },
    { p: 'a.render.alignY', t: 'pct', l: T('Выравнивание Y, %', 'Align Y, %') },
    { p: 'a.render.background', t: 'text', l: T('Фон (CSS-цвет)', 'Background (CSS colour)'), hint: T('transparent, #000, rgb()…', 'transparent, #000, rgb()…') },
    { p: 'a.render.blend', t: 'chk', l: T('Кроссфейд между кадрами', 'Cross-fade between frames'), hint: T('Сглаживает при малом числе кадров (чуть дороже по CPU).', 'Smooths low frame counts (slightly more CPU).') },
    { p: 'a.render.maxDpr', t: 'rng', min: 1, max: 3, step: 0.25, l: T('Макс. плотность пикселей (DPR)', 'Max device pixel ratio') },
    { p: 'a.render.fadeIn', t: 'chk', l: T('Плавное появление первого кадра', 'Fade in first frame') }
  ] },
  { id: 'load', title: T('6 · Загрузка и доступность', '6 · Loading & a11y'), x: 'cfg', fields: [
    { p: 'a.loading.strategy', t: 'select', o: sel(['progressive', 'Прогрессивная (грубо → точно)', 'Progressive (coarse → fine)'], ['sequential', 'Последовательная', 'Sequential']), l: T('Порядок загрузки кадров', 'Frame load order'), hint: T('Прогрессивная даёт рабочую анимацию, пока догружаются остальные кадры.', 'Progressive gives a working animation while the rest loads.') },
    { p: 'a.loading.concurrency', t: 'num', min: 1, max: 16, step: 1, l: T('Параллельных загрузок', 'Parallel downloads') },
    { p: 'a.loading.rootMargin', t: 'text', l: T('Начать грузить за … до экрана', 'Start loading … before viewport'), hint: T('например 300px или 100% — ленивая загрузка.', 'e.g. 300px or 100% — lazy loading.') },
    { p: 'a.loading.loader', t: 'select', o: sel(['bar', 'Полоса прогресса', 'Progress bar'], ['none', 'Нет', 'None']), l: T('Индикатор загрузки', 'Loader') },
    { p: 'a.a11y.reducedMotion', t: 'select', o: sel(['poster', 'Статичный кадр (prefers-reduced-motion)', 'Static frame (prefers-reduced-motion)'], ['ignore', 'Игнорировать', 'Ignore']), l: T('Если пользователь отключил анимации', 'If user disabled motion') },
    { p: 'a.a11y.posterFrame', t: 'num', min: 0, max: 2000, step: 1, l: T('Кадр-постер (№ с нуля)', 'Poster frame (0-based)') },
    { p: 'a.a11y.label', t: 'text', l: T('aria-label (описание для скринридеров)', 'aria-label (screen reader text)') }
  ] },
  { id: 'export', title: T('7 · Экспорт', '7 · Export'), open: true, custom: 'export' }
];

/* ---------- rendering of the side panel ---------- */
const side = $('#side');
const refs = { est: null };
let anyOpen = {};

function makeField(f) {
  if (f.custom) return makeCustom(f);
  const val = get(S, f.p);
  const wrap = h('div', { class: 'f' });
  const onset = (v) => { set(S, f.p, v); changed(f); };
  const label = h('label', { class: 'l' }, tr(f.l));
  let ctl;
  if (f.t === 'chk') {
    ctl = h('label', { class: 'chkrow' }, h('input', { type: 'checkbox', checked: !!val, onchange: (e) => { onset(e.target.checked); rerender(); } }), tr(f.l));
    wrap.append(ctl);
  } else if (f.t === 'select') {
    ctl = h('select', { onchange: (e) => { onset(e.target.value); rerender(); } }, f.o.map(([v, l]) => h('option', { value: v, selected: String(val) === String(v) }, tr(l))));
    wrap.append(h('div', { class: 'row' }, label, ctl));
  } else if (f.t === 'num') {
    ctl = h('input', { type: 'number', min: f.min, max: f.max, step: f.step, value: val, onchange: (e) => { let v = parseFloat(e.target.value); if (isNaN(v)) v = f.min; v = Math.max(f.min, Math.min(f.max, v)); e.target.value = v; onset(v); } });
    wrap.append(h('div', { class: 'row' }, label, ctl));
  } else if (f.t === 'rng' || f.t === 'pct') {
    const pct = f.t === 'pct';
    const min = pct ? 0 : f.min, max = pct ? 100 : f.max, step = pct ? 1 : f.step;
    const out = h('span', { class: 'val' });
    const show = (v) => { out.textContent = pct ? Math.round(v) + '%' : String(Math.round(v * 100) / 100); };
    const cur = pct ? val * 100 : val;
    ctl = h('input', { type: 'range', min, max, step, value: cur, oninput: (e) => { const v = parseFloat(e.target.value); show(v); set(S, f.p, pct ? v / 100 : v); changed(f, true); }, onchange: () => changed(f) });
    show(cur);
    wrap.append(label, h('div', { class: 'row' }, ctl, out));
  } else if (f.t === 'text') {
    ctl = h('input', { type: 'text', value: val == null ? '' : val, onchange: (e) => onset(e.target.value) });
    wrap.append(label, ctl);
  }
  if (f.hint) wrap.append(h('div', { class: 'h' }, tr(f.hint)));
  return wrap;
}

function makeCustom(f) {
  switch (f.custom) {
    case 'hr': return h('div', { class: 'f' }, h('div', { style: 'border-top:1px solid var(--line);padding-top:10px;color:var(--mut);text-transform:uppercase;font-size:11px;letter-spacing:.6px' }, tr(f.l)));
    case 'source': return sourceBlock();
    case 'mobileSrc': return S.m.enabled && S.m.source === 'file' ? mobileSrcBlock() : null;
    case 'estimate': refs.est = h('div', { class: 'est' }, '…'); updateEstimate(); return refs.est;
    case 'triggerCards': return triggerCards();
    case 'curve': return curveBlock();
    case 'export': return exportBlock();
  }
}

const PRESETS = [
  { id: 'scroll-pin', t: 'scroll', patch: { 'a.scroll.pin': true }, name: T('Скролл + pin', 'Scroll + pin'), d: T('Блок залипает, кадры по скроллу', 'Section pins, frames follow scroll') },
  { id: 'scroll-flow', t: 'scroll', patch: { 'a.scroll.pin': false }, name: T('Скролл в потоке', 'Scroll inline'), d: T('Без залипания, при проходе блока', 'No pin, plays as it passes') },
  { id: 'mouse-x', t: 'mouse-x', patch: { 'a.mouse.rest': 0.5 }, name: T('Мышь ←→', 'Mouse ←→'), d: T('Влево 50→0%, вправо 50→100%', 'Left 50→0%, right 50→100%') },
  { id: 'mouse-y', t: 'mouse-y', patch: { 'a.mouse.rest': 0.5 }, name: T('Мышь ↑↓', 'Mouse ↑↓'), d: T('Вверх/вниз по высоте блока', 'Up/down over the block') },
  { id: 'drag-x', t: 'drag-x', patch: {}, name: T('Драг / вращение', 'Drag / spin'), d: T('Тянуть пальцем или мышью', 'Drag with finger or mouse') },
  { id: 'hover', t: 'hover', patch: {}, name: T('Наведение', 'Hover'), d: T('Играет при ховере, назад при уходе', 'Plays on hover, reverses on leave') },
  { id: 'autoplay', t: 'autoplay', patch: {}, name: T('Автоплей', 'Autoplay'), d: T('Зацикленный «видео-фон»', 'Looped “video-like” background') }
];
function curPreset() {
  return PRESETS.find((p) => p.t === S.a.trigger && (p.t !== 'scroll' || p.patch['a.scroll.pin'] === S.a.scroll.pin)) || PRESETS[0];
}
function triggerCards() {
  const c = curPreset().id;
  return h('div', { class: 'cards' }, PRESETS.map((p) => h('button', {
    class: 'card' + (p.id === c ? ' on' : ''), onclick: () => {
      S.a.trigger = p.t; for (const k in p.patch) set(S, k, p.patch[k]);
      if (p.t === 'scroll') S.a.smooth = Math.max(S.a.smooth, 0.1);
      rerender(); changed({ x: 'cfg' });
    }
  }, h('b', null, tr(p.name)), h('small', null, tr(p.d)))));
}

/* curve editor: input (x) -> frame progress (y) */
function curveBlock() {
  const W = 330, H = 150, P = 14;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('class', 'curve'); svg.style.width = '100%';
  const X = (v) => P + v * (W - 2 * P), Y = (v) => H - P - v * (H - 2 * P);
  const draw = () => {
    svg.innerHTML = '';
    const pts = S.a.map;
    const mk = (n, a) => { const e = document.createElementNS(ns, n); for (const k in a) e.setAttribute(k, a[k]); svg.append(e); return e; };
    mk('rect', { x: X(0), y: Y(1), width: X(1) - X(0), height: Y(0) - Y(1), fill: 'none', stroke: '#2a2a30' });
    mk('line', { x1: X(0), y1: Y(0), x2: X(1), y2: Y(1), stroke: '#2a2a30', 'stroke-dasharray': '3 3' });
    mk('polyline', { points: pts.map((p) => X(p[0]) + ',' + Y(p[1])).join(' '), fill: 'none', stroke: '#8b7cff', 'stroke-width': 2 });
    pts.forEach((p, i) => {
      const c = mk('circle', { cx: X(p[0]), cy: Y(p[1]), r: 6, fill: '#8b7cff', stroke: '#0e0e10', 'stroke-width': 2, style: 'cursor:grab' });
      c.addEventListener('pointerdown', (e) => {
        e.stopPropagation(); c.setPointerCapture(e.pointerId);
        const mv = (ev) => {
          const r = svg.getBoundingClientRect();
          const sx = W / r.width;
          let nx = ((ev.clientX - r.left) * sx - P) / (W - 2 * P), ny = 1 - (((ev.clientY - r.top) * sx - P) / (H - 2 * P));
          nx = Math.max(0, Math.min(1, nx)); ny = Math.max(0, Math.min(1, ny));
          if (i === 0) nx = 0; else if (i === pts.length - 1) nx = 1;
          else nx = Math.max(pts[i - 1][0] + 0.01, Math.min(pts[i + 1][0] - 0.01, nx));
          pts[i] = [Math.round(nx * 1000) / 1000, Math.round(ny * 1000) / 1000];
          draw(); changed({ x: 'cfg' });
        };
        const up = () => { c.removeEventListener('pointermove', mv); c.removeEventListener('pointerup', up); changed({ x: 'cfg' }); };
        c.addEventListener('pointermove', mv); c.addEventListener('pointerup', up);
      });
      c.addEventListener('dblclick', (e) => { e.stopPropagation(); if (i > 0 && i < pts.length - 1) { pts.splice(i, 1); draw(); changed({ x: 'cfg' }); } });
    });
    const t1 = mk('text', { x: X(0), y: H - 2 }); t1.textContent = T('вход (скролл/мышь) →', 'input (scroll/mouse) →')[lang];
    const t2 = mk('text', { x: 2, y: 9 }); t2.textContent = T('↑ кадр', '↑ frame')[lang];
  };
  svg.addEventListener('dblclick', (e) => {
    const r = svg.getBoundingClientRect(), sx = W / r.width;
    const nx = ((e.clientX - r.left) * sx - P) / (W - 2 * P), ny = 1 - (((e.clientY - r.top) * sx - P) / (H - 2 * P));
    if (nx <= 0.02 || nx >= 0.98) return;
    S.a.map.push([Math.round(nx * 1000) / 1000, Math.max(0, Math.min(1, Math.round(ny * 1000) / 1000))]);
    S.a.map.sort((a, b) => a[0] - b[0]); draw(); changed({ x: 'cfg' });
  });
  draw();
  return h('div', { class: 'f' },
    h('div', { class: 'row' }, h('label', { class: 'l' }, T('Кривая соответствия', 'Mapping curve')[lang]),
      h('button', { class: 'ghost', onclick: () => { S.a.map = [[0, 0], [1, 1]]; rerender(); changed({ x: 'cfg' }); } }, T('Сбросить', 'Reset')[lang])),
    svg, h('div', { class: 'h' }, T('Двойной клик — добавить точку / удалить точку. Тяните точки: например, первая половина скролла проигрывает 0–20% кадров, вторая — 20–100%.', 'Double-click to add / remove a point. Drag points: e.g. the first half of the scroll plays 0–20% of frames, the second 20–100%.')[lang]));
}

function fmtDur(s) { return s ? s.toFixed(1) + 's' : ''; }
function infoLine(i) { return i ? `${i.width}×${i.height} · ${i.fps} fps · ${fmtDur(i.duration)} · ${i.codec}` : ''; }

function sourceBlock() {
  const i = S.info.desktop;
  const box = h('div', { class: 'src' + (S.src.desktop ? ' has' : '') },
    S.src.desktop ? [h('div', null, S.src.desktop.split(/[\\/]/).pop()), h('div', { class: 'meta' }, infoLine(i))] : tr(UI.noVideo),
    h('div', { style: 'margin-top:8px' }, h('button', { onclick: () => pickVideo('desktop') }, tr(S.src.desktop ? UI.change : UI.pick))));
  const out = [box];
  out.push(h('div', { class: 'f' }, h('label', { class: 'l' }, T('Имя секции (папка и ID)', 'Section name (folder & id)')[lang]),
    h('input', { type: 'text', value: S.name, onchange: (e) => { S.name = SH.slug(e.target.value); e.target.value = S.name; changed({ x: 'cfg' }); } })));
  if (i) {
    const dur = i.duration;
    const endShown = S.trim.end > 0 ? S.trim.end : dur;
    const lab = h('span', { class: 'val' });
    const upd = () => { lab.textContent = `${S.trim.start.toFixed(1)}s → ${(S.trim.end > 0 ? S.trim.end : dur).toFixed(1)}s`; };
    const a = h('input', { type: 'range', min: 0, max: dur, step: 0.1, value: S.trim.start, oninput: (e) => { S.trim.start = Math.min(parseFloat(e.target.value), (S.trim.end || dur) - 0.2); e.target.value = S.trim.start; upd(); }, onchange: () => changed({ x: 'extract' }) });
    const b = h('input', { type: 'range', min: 0, max: dur, step: 0.1, value: endShown, oninput: (e) => { let v = parseFloat(e.target.value); v = Math.max(v, S.trim.start + 0.2); e.target.value = v; S.trim.end = v >= dur - 0.05 ? 0 : v; upd(); }, onchange: () => changed({ x: 'extract' }) });
    upd();
    out.push(h('div', { class: 'f' }, h('div', { class: 'row' }, h('label', { class: 'l' }, T('Обрезка (старт — конец)', 'Trim (start — end)')[lang]), lab), a, b));
  }
  return h('div', { style: 'display:flex;flex-direction:column;gap:11px' }, out);
}

function mobileSrcBlock() {
  const i = S.info.mobile;
  return h('div', { class: 'src' + (S.src.mobile ? ' has' : '') },
    S.src.mobile ? [h('div', null, S.src.mobile.split(/[\\/]/).pop()), h('div', { class: 'meta' }, infoLine(i))] : T('Видео для мобильных не выбрано', 'No mobile video chosen')[lang],
    h('div', { style: 'margin-top:8px' }, h('button', { onclick: () => pickVideo('mobile') }, tr(S.src.mobile ? UI.change : UI.pick))));
}

/* ---------- export block ---------- */
let exportState = { busy: false, p: 0, stage: '', result: null, error: null };
function exportBlock() {
  const box = h('div', { style: 'display:flex;flex-direction:column;gap:11px' });
  box.append(h('div', { class: 'f' }, h('label', { class: 'l' }, T('Папка экспорта', 'Output folder')[lang]),
    h('div', { class: 'row' }, h('input', { type: 'text', value: S.x.outDir, placeholder: '…', onchange: (e) => { S.x.outDir = e.target.value; } }),
      h('button', { onclick: async () => { const d = await api.pickDir(); if (d) { S.x.outDir = d; rerender(); } } }, '…'))));
  box.append(h('div', { class: 'f' }, h('label', { class: 'l' }, T('Публичный путь на сайте', 'Public URL path on your site')[lang]),
    h('input', { type: 'text', value: S.x.publicPath, onchange: (e) => { S.x.publicPath = e.target.value; } }),
    h('div', { class: 'h' }, T('Куда зальёте папку на сервер, например /assets/scrollkit/. Внутри: scrollkit.min.js и папка секции с кадрами desktop/ и mobile/.', 'Where you upload the folder, e.g. /assets/scrollkit/. Inside: scrollkit.min.js and the section folder with desktop/ and mobile/ frames.')[lang])));
  const bar = h('div', { class: 'bar', hidden: !exportState.busy }, h('i', { id: 'expBar', style: `width:${exportState.p * 100}%` }));
  box.append(bar);
  const btn = h('button', { class: 'primary', disabled: !S.src.desktop || exportState.busy, onclick: doExport }, exportState.busy ? T('Экспорт…', 'Exporting…')[lang] : T('Экспортировать', 'Export')[lang]);
  const row = h('div', { class: 'btns' }, btn);
  if (exportState.busy) row.append(h('button', { onclick: () => api.exportCancel() }, T('Отмена', 'Cancel')[lang]));
  box.append(row);
  if (exportState.error) box.append(h('div', { class: 'err', style: 'white-space:pre-wrap' }, exportState.error));
  const r = exportState.result;
  if (r) {
    const fr = r.frames;
    box.append(h('div', { class: 'est' }, `✓ ${T('Готово', 'Done')[lang]}: ${fr.desktop.count} + ${fr.mobile ? fr.mobile.count : 0} ${T('кадров', 'frames')[lang]} · ${(r.bytes / 1048576).toFixed(1)} MB\n${r.dir}`));
    const copy = (t) => h('button', { onclick: (e) => { navigator.clipboard.writeText(t); e.target.textContent = '✓'; setTimeout(() => (e.target.textContent = T('Копировать', 'Copy')[lang]), 900); } }, T('Копировать', 'Copy')[lang]);
    box.append(h('div', { class: 'f' }, h('div', { class: 'row' }, h('label', { class: 'l' }, T('Код вставки (A — рекомендуется)', 'Embed code (A — recommended)')[lang]), copy(r.snippet)), h('textarea', { readonly: true }, r.snippet)));
    box.append(h('div', { class: 'f' }, h('div', { class: 'row' }, h('label', { class: 'l' }, T('Вариант B — конфиг внутри HTML', 'Variant B — inline config')[lang]), copy(r.snippetInline)), h('textarea', { readonly: true }, r.snippetInline)));
    box.append(h('div', { class: 'btns' },
      h('button', { onclick: () => api.reveal(r.dir) }, T('Показать в папке', 'Show in folder')[lang]),
      h('button', { onclick: () => api.open(r.dir + (r.dir.includes('\\') ? '\\' : '/') + 'demo.html') }, T('Открыть demo.html', 'Open demo.html')[lang])));
  }
  return box;
}

async function doExport() {
  if (!S.src.desktop) return;
  if (!S.x.outDir) {
    const d = await api.pickDir(); if (!d) return; S.x.outDir = d;
  }
  exportState = { busy: true, p: 0, result: null, error: null };
  rerender();
  const off = api.onExportProgress((m) => { exportState.p = m.p; const b = $('#expBar'); if (b) b.style.width = (m.p * 100) + '%'; });
  const r = await api.exportRun(JSON.parse(JSON.stringify(S)));
  off();
  exportState.busy = false;
  if (r.ok) exportState.result = r; else if (!r.cancelled) exportState.error = r.error;
  rerender();
}

/* ---------- estimate ---------- */
let estTimer = 0, estToken = 0;
function updateEstimate() {
  clearTimeout(estTimer);
  if (!S.src.desktop || !S.info.desktop) { if (refs.est) refs.est.textContent = '—'; return; }
  estTimer = setTimeout(async () => {
    const tok = ++estToken;
    const base = { start: S.trim.start, end: S.trim.end, srcDuration: S.info.desktop.duration };
    const dn = S.d.mode === 'count' ? S.d.count : Math.round(S.d.fps * ((S.trim.end || S.info.desktop.duration) - S.trim.start));
    const rd = await api.estimate({ ...base, input: S.src.desktop, width: S.d.width, format: S.d.format, quality: S.d.quality });
    let rm = null, mn = 0;
    if (S.m.enabled) {
      const own = S.m.source === 'file' && S.src.mobile;
      const dur = own ? (S.info.mobile && S.info.mobile.duration) || base.srcDuration : base.srcDuration;
      mn = S.m.mode === 'count' ? S.m.count : Math.round(S.m.fps * ((S.trim.end || dur) - S.trim.start));
      rm = await api.estimate({ ...base, srcDuration: dur, input: own ? S.src.mobile : S.src.desktop, width: S.m.width, format: S.m.format, quality: S.m.quality, crop: { aspect: S.m.aspect, x: S.m.cropX, y: S.m.cropY } });
    }
    if (tok !== estToken || !refs.est || !rd.ok) return;
    const mb = (b) => (b / 1048576).toFixed(1) + ' MB';
    let txt = `${T('ПК', 'Desktop')[lang]}: ≈ ${mb(rd.avg * dn)} · ${dn} ${T('кадров', 'frames')[lang]} · ${rd.width}×${rd.height}`;
    const ram = dn * rd.width * rd.height * 4;
    txt += `\n${T('Память после декодирования', 'Decoded memory')[lang]}: ≈ ${Math.round(ram / 1048576)} MB`;
    if (rm && rm.ok) txt += `\n${T('Моб.', 'Mobile')[lang]}: ≈ ${mb(rm.avg * mn)} · ${mn} ${T('кадров', 'frames')[lang]} · ${rm.width}×${rm.height} (${Math.round(mn * rm.width * rm.height * 4 / 1048576)} MB RAM)`;
    refs.est.textContent = txt;
    refs.est.classList.toggle('warn', ram > 900 * 1048576);
    if (ram > 900 * 1048576) refs.est.textContent += '\n⚠ ' + T('Много памяти: снизьте ширину или число кадров.', 'High memory: lower the width or frame count.')[lang];
  }, 700);
}

/* ---------- main render ---------- */
function rerender() {
  const scroll = side.scrollTop;
  side.querySelectorAll('details').forEach((d) => { anyOpen[d.dataset.id] = d.open; });
  side.innerHTML = '';
  for (const sec of SECTIONS) {
    const d = h('details', { 'data-id': sec.id });
    d.open = sec.id in anyOpen ? anyOpen[sec.id] : !!sec.open;
    d.append(h('summary', null, tr(sec.title)));
    const body = h('div', { class: 'body' });
    if (sec.custom) body.append(makeCustom({ custom: sec.custom }));
    else for (const f of sec.fields) { if (f.if && !f.if(S)) continue; const e = makeField({ x: sec.x, ...f }); if (e) body.append(e); }
    d.append(body); side.append(d);
  }
  side.scrollTop = scroll;
  $('#btnOpen').textContent = tr(UI.open); $('#btnSave').textContent = tr(UI.save);
  $('#touchLbl').textContent = tr(UI.touch); $('#scrubLbl').textContent = tr(UI.scrub);
  $('#dropTxt').textContent = tr(UI.drop); $('#btnPick').textContent = tr(UI.pick);
  $('#devSeg').innerHTML = '';
  for (const d of ['desktop', 'tablet', 'mobile']) $('#devSeg').append(h('button', { class: live.device === d ? 'on' : '', onclick: () => setDevice(d) }, tr(UI[d])));
  $('#pvEmpty').hidden = !!S.src.desktop;
  document.documentElement.lang = lang;
}

let pushT = 0, extT = 0;
function changed(f, soft) {
  f = f || {};
  if (f.x === 'extract') scheduleExtract();
  schedulePush();
  if (/^[dm]\./.test(f.p || '')) updateEstimate();
}
function schedulePush() { clearTimeout(pushT); pushT = setTimeout(pushConfig, 90); }
function scheduleExtract() { clearTimeout(extT); extT = setTimeout(buildPreview, 650); }

/* ---------- preview ---------- */
const pv = $('#pv');
let pvReady = false, lastMsg = null;
window.addEventListener('message', (e) => {
  const m = e.data || {};
  if (m.t === 'ready') { pvReady = true; if (lastMsg) post(lastMsg); }
  else if (m.t === 'progress') $('#pvInfo').textContent = `${tr(UI.frame)} ${m.frame + 1}/${m.n} · ${(m.p * 100).toFixed(0)}%`;
});
function post(m) { lastMsg = m.t === 'cfg' ? m : lastMsg; if (pvReady) pv.contentWindow.postMessage(m, '*'); }

function pushConfig() {
  if (!live.desktop) return;
  const fr = { desktop: { dir: live.desktop.dir, count: live.desktop.count, ext: 'jpg', pad: 4, start: 1 } };
  if (S.m.enabled && live.mobile) fr.mobile = { dir: live.mobile.dir, count: live.mobile.count, ext: 'jpg', pad: 4, start: 1 };
  const cfg = SH.buildConfig(S, fr);
  post({ t: 'cfg', cfg, base: live.desktop.base, touch: $('#touchEmu').checked });
}

async function buildPreview() {
  if (!S.src.desktop || !S.info.desktop) return;
  const rid = ++live.rid;
  $('#pvBusy').hidden = false; $('#pvBusyTxt').textContent = tr(UI.building);
  const common = { start: S.trim.start, end: S.trim.end, format: 'jpg' };
  const jobs = [];
  jobs.push(api.buildPreview({ kind: 'desktop', rid, o: { ...common, input: S.src.desktop, srcDuration: S.info.desktop.duration, mode: S.d.mode, count: S.d.count, fps: S.d.fps, width: Math.min(S.d.width, 1440) } }).then((r) => ['desktop', r]));
  if (S.m.enabled) {
    const own = S.m.source === 'file' && S.src.mobile && S.info.mobile;
    jobs.push(api.buildPreview({ kind: 'mobile', rid, o: { ...common, input: own ? S.src.mobile : S.src.desktop, srcDuration: own ? S.info.mobile.duration : S.info.desktop.duration, mode: S.m.mode, count: S.m.count, fps: S.m.fps, width: Math.min(S.m.width, 720), crop: { aspect: S.m.aspect, x: S.m.cropX, y: S.m.cropY } } }).then((r) => ['mobile', r]));
  } else live.mobile = null;
  const res = await Promise.all(jobs);
  if (rid !== live.rid) return;
  for (const [k, r] of res) {
    if (r.ok) live[k] = { base: r.base, dir: r.dir, count: r.count };
    else if (!r.cancelled) { $('#pvBusyTxt').textContent = r.error.slice(0, 120); return; }
  }
  $('#pvBusy').hidden = true;
  pushConfig();
}
api.onPreviewProgress((m) => { if (!$('#pvBusy').hidden) $('#pvBusyTxt').textContent = `${tr(UI.building)} ${Math.round(m.p * 100)}%`; });

function setDevice(d) {
  live.device = d;
  $('#pvBox').className = d === 'desktop' ? '' : d;
  $('#touchEmu').checked = d === 'mobile';
  rerender(); schedulePush();
}
$('#touchEmu').addEventListener('change', schedulePush);
$('#scrub').addEventListener('input', (e) => {
  const v = parseFloat(e.target.value) / 1000;
  post({ t: 'scrub', v });
});
$('#scrub').addEventListener('dblclick', () => post({ t: 'scrub', v: null }));
$('#scrub').title = 'double-click: release';

/* ---------- video ingest ---------- */
async function pickVideo(kind) {
  const f = await api.pickVideo(); if (f) await setVideo(kind, f);
}
async function setVideo(kind, file) {
  const r = await api.probe(file);
  if (!r.ok) { alert(r.error); return; }
  S.src[kind] = file; S.info[kind] = r.info;
  if (kind === 'desktop') {
    S.trim = { start: 0, end: 0 };
    const nm = file.split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
    if (S.name === 'hero' || !S.name) S.name = SH.slug(nm);
    S.d.width = Math.min(S.d.width, r.info.width);
    S.d.count = Math.max(24, Math.min(180, Math.round(r.info.duration * 24)));
    S.m.count = Math.max(16, Math.round(S.d.count / 2));
    if (!S.x.outDir && paths) S.x.outDir = paths.home + (paths.platform === 'win32' ? '\\' : '/') + 'ScrollKit';
  }
  rerender(); updateEstimate(); scheduleExtract();
}

const box = $('#pvBox');
['dragenter', 'dragover'].forEach((ev) => window.addEventListener(ev, (e) => { e.preventDefault(); box.classList.add('dragover'); }));
['dragleave', 'drop'].forEach((ev) => window.addEventListener(ev, (e) => { e.preventDefault(); box.classList.remove('dragover'); }));
window.addEventListener('drop', (e) => {
  const f = e.dataTransfer.files[0]; if (!f) return;
  setVideo('desktop', api.pathForFile(f));
});
$('#btnPick').addEventListener('click', () => pickVideo('desktop'));

/* ---------- project open/save ---------- */
$('#btnSave').addEventListener('click', () => api.saveProject(S));
$('#btnOpen').addEventListener('click', async () => {
  const p = await api.openProject(); if (!p) return;
  const d = SH.defaults();
  const merge = (a, b) => { for (const k in b) { if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k]) merge(a[k], b[k]); else a[k] = b[k]; } return a; };
  S = merge(d, p); live.desktop = live.mobile = null;
  rerender(); updateEstimate(); scheduleExtract();
});
$('#lang').addEventListener('change', (e) => { lang = e.target.value; localStorage.setItem('sk-lang', lang); rerender(); pv.contentWindow && post({ t: 'texts', top: lang === 'ru' ? '↓ Скролльте вниз ↓' : '↓ Scroll down ↓', bot: lang === 'ru' ? 'Конец страницы' : 'End of page' }); });

/* ---------- test hook (only used by test/smoke.js) ---------- */
window.__errs = [];
window.addEventListener('error', (e) => window.__errs.push(String(e.message)));
window.__test = { load: (f) => setVideo('desktop', f) };

/* ---------- boot ---------- */
(async () => {
  paths = await api.paths();
  if (paths.platform === 'darwin') document.body.classList.add('mac');
  $('#lang').value = lang;
  rerender();
  pv.addEventListener('load', () => { pvReady = true; post({ t: 'texts', top: lang === 'ru' ? '↓ Скролльте вниз ↓' : '↓ Scroll down ↓', bot: lang === 'ru' ? 'Конец страницы' : 'End of page' }); if (lastMsg) post(lastMsg); });
})();
})();
