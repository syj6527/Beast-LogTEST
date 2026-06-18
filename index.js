// 🐾 비스트로그 (Beast Log) v0.2.0 — 상황맞춤 선택지 + 양쪽 주입 + 랜덤이벤트 + 텀(쿨다운)
// 버전 3곳 동시 갱신: (1) 이 주석, (2) BEASTLOG_VERSION, (3) manifest.json
//
// 제1원칙: 재밌음 + RP에 긍정적. (방해되면 게이트하거나 컷)
// 구조: 세계가 사건을 던지고 → 유저가 고르고 → 비스트로그는 중계한다.
//   - 세계/캐릭터 = 사건 발생원,  유저 = 활성화+선택,  확장 = 감지/기록/중계.
// OFF-SCREEN: 절대 유저 행동·속마음을 RP에 대신 쓰지 않음. 유저 속마음은 패널 전용.

const BEASTLOG_VERSION = '0.2.0';
const MODULE = 'beast_log';

function getCtx() {
    try {
        if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) return SillyTavern.getContext();
    } catch (e) { /* noop */ }
    return (typeof window !== 'undefined' && window.SillyTavern && window.SillyTavern.getContext)
        ? window.SillyTavern.getContext()
        : null;
}
function blDebug(...a) { if (window.__beastlogDebug) console.log('[비스트로그]', ...a); }
function cryptoId() {
    try { return crypto.randomUUID(); }
    catch (e) { return 'bl-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
}

// ── 상태 (chat_metadata UUID 격리) ──
const STATE_KEY = 'beast_log_state';

function defaultState() {
    return {
        uuid: cryptoId(),
        level: 1, xp: 0, title: '갓 들어온 손님', power: 0,
        items: [],         // {id,name,emoji,tier,price,verdict}
        encounters: [],    // {id,no,emoji,title,desc,result,exp,drop,inner:{foe,user}}  ← 양면 속마음(패널 전용)
        events: [],        // 랜덤이벤트 로그 {id,emoji,title,desc}
        seenFoes: [],
        lastInjectTurn: -99,   // 텀 계산용 (마지막 주입 시점의 채팅 길이)
        settings: {
            injectDefault: true,  // 📤 선택을 챗에 반영 (켜도 이벤트당 0~1건)
            autoDetect: false,    // 입구: 수동 기본 + 자동 옵션
            cooldownTurns: 3,     // 텀: 주입 사이 최소 채팅 간격 (마구잡이 방지)
        },
    };
}

function loadState() {
    const ctx = getCtx();
    if (!ctx || !ctx.chatMetadata) return defaultState();
    const e = ctx.chatMetadata[STATE_KEY];
    if (e && typeof e === 'object') {
        const m = Object.assign(defaultState(), e);
        m.settings = Object.assign(defaultState().settings, e.settings || {});
        return m;
    }
    const fresh = defaultState();
    ctx.chatMetadata[STATE_KEY] = fresh;
    return fresh;
}
function saveState(s) {
    const ctx = getCtx();
    if (!ctx || !ctx.chatMetadata) return;
    ctx.chatMetadata[STATE_KEY] = s;
    if (ctx.saveMetadataDebounced) ctx.saveMetadataDebounced();
    else if (ctx.saveMetadata) ctx.saveMetadata();
}
let STATE = defaultState();

// ── 채팅 길이 / 텀(쿨다운) ──
function getChatLen() { const c = getCtx(); return (c && Array.isArray(c.chat)) ? c.chat.length : 0; }
function injectRemaining() {
    const gap = getChatLen() - STATE.lastInjectTurn;
    return Math.max(0, (STATE.settings.cooldownTurns || 0) - gap);
}
function canInject() { return injectRemaining() <= 0; }
function markInject() { STATE.lastInjectTurn = getChatLen(); saveState(STATE); renderConsole(); }

function getLastMessageText() {
    const ctx = getCtx();
    if (!ctx || !Array.isArray(ctx.chat) || ctx.chat.length === 0) return '';
    const m = ctx.chat[ctx.chat.length - 1];
    return (m && (m.mes || (m.extra && m.extra.display_text))) || '';
}

// ── [STUB] 감지: 상황 + 상황맞춤 선택지 ────────────────────────
// TODO(3단계): generateQuietPrompt 로 현재 장면 읽고 type/choices 동적 생성.
//   choices = [{label, kind}]  kind: attack|flee|loot|interact|help
//   톤 인지: 무거운 씬이면 null 반환(안 끼어듦).
function detectEncounterStub(_scene) {
    const pool = [
        { type: '전투', emoji: '🪳', title: '야생의 바퀴벌레가 나타났다', foe: '바퀴벌레', difficulty: 2,
          choices: [{ label: '신문지로 내려친다', kind: 'attack' }, { label: '슬리퍼를 던진다', kind: 'attack' }, { label: '못 본 척한다', kind: 'flee' }] },
        { type: '전투', emoji: '🧑‍💼', title: '옆자리 동료와 조우', foe: '옆자리 동료', difficulty: 3,
          choices: [{ label: '눈을 안 피한다', kind: 'attack' }, { label: '먼저 인사한다', kind: 'help' }, { label: '자리를 뜬다', kind: 'flee' }] },
        { type: '루팅', emoji: '🥄', title: '길바닥에서 무언가 빛났다', foe: null, difficulty: 0,
          choices: [{ label: '줍는다', kind: 'loot' }, { label: '발로 차본다', kind: 'interact' }, { label: '그냥 지나친다', kind: 'flee' }] },
    ];
    return pool[Math.floor(Math.random() * pool.length)];
}

// ── [STUB] 랜덤이벤트: 채팅 맥락에 맞게 ───────────────────────
// TODO(3단계): generateQuietPrompt 로 현재 장면 맥락 읽고 생성.
function generateRandomEventStub(_scene) {
    const pool = [
        { emoji: '📦', title: '택배가 도착했다', desc: '아무도 시킨 적 없는 택배다.' },
        { emoji: '💡', title: '갑자기 정전이 됐다', desc: '세상이 잠깐 공평하게 어두워졌다.' },
        { emoji: '☎️', title: '모르는 번호로 전화가 왔다', desc: '받을지 말지, 그것이 문제로다.' },
    ];
    return pool[Math.floor(Math.random() * pool.length)];
}

// ── [STUB] 판정 + 양면 속마음 (kind 기반) ─────────────────────
// TODO(3단계): 전투력 판정 + LLM 속마음 생성으로 교체. foe=단정 / user=추측형(may/can).
function resolveByKind(encounter, kind) {
    if (kind === 'flee') return { result: '회피', exp: 1, drop: null, inner: {
        foe: '상대는 떠나는 뒷모습을 멀뚱히 바라봤다.',
        user: '당신은 현명한 판단이었다고... 아마 스스로 우겼을 것이다.' } };
    if (kind === 'help') return { result: '협동', exp: 3, drop: null, inner: {
        foe: '아무도 안 도와줬다. 다들 자기 일로 바빴다.',
        user: '당신은 살짝 민망했을지도 모른다.' } };
    if (kind === 'loot') return { result: '획득', exp: 2,
        drop: { name: '녹슨 숟가락', emoji: '🥄', tier: '쓰레기', price: 0 }, inner: {
        foe: '아무도 그걸 줍지 않은 데는 이유가 있었다.',
        user: '당신은 왜 주웠는지 스스로도 몰랐을 것이다.' } };
    if (kind === 'interact') return { result: '상호작용', exp: 1, drop: null, inner: {
        foe: '그것은 별 반응이 없었다.',
        user: '당신은 괜히 건드렸다고 생각했을지도 모른다.' } };
    // attack
    const win = STATE.power + 5 >= (encounter.difficulty || 0);
    return {
        result: win ? '승리' : '패배',
        exp: win ? 8 : 2,
        drop: win ? { name: '눅눅한 쿠폰', emoji: '🎟️', tier: '쓰레기', price: 0 } : null,
        inner: win
            ? { foe: '상대는 어딘가 뿌듯해 보였다.', user: '당신은... 내심 조금 미안했을지도 모른다.' }
            : { foe: '상대도 별로 안 진지했다.', user: '당신은 그게 더 아팠을 것이다.' },
    };
}

function applyOutcome(encounter, choiceLabel, outcome) {
    STATE.xp += outcome.exp || 0;
    const entry = {
        id: cryptoId(), no: STATE.encounters.length + 1,
        emoji: encounter.emoji, title: encounter.title,
        desc: `${choiceLabel} — ${outcome.result}`,
        result: outcome.result, exp: outcome.exp,
        drop: outcome.drop ? outcome.drop.name : null,
        inner: outcome.inner,   // {foe, user} — user는 패널 전용
    };
    STATE.encounters.unshift(entry);
    if (outcome.drop) { STATE.items.unshift(Object.assign({ id: cryptoId(), verdict: '' }, outcome.drop)); STATE.power += 1; }
    if (encounter.foe && !STATE.seenFoes.includes(encounter.foe)) STATE.seenFoes.push(encounter.foe);
    levelCheck();
    saveState(STATE);
    renderConsole();

    // 결투창 → 챗: 📤 기본값 ON일 때 1건. (텀 통과 시)  OFF-SCREEN: 상대 반응만.
    if (STATE.settings.injectDefault) {
        const foeBeat = entry.inner && entry.inner.foe ? ' ' + entry.inner.foe : '';
        injectProse(`(${entry.desc}.${foeBeat})`);
    }
}

function levelCheck() {
    const need = STATE.level * 100;
    if (STATE.xp >= need) { STATE.xp -= need; STATE.level += 1; /* TODO(4): 칭호 갱신 + RP반영 */ }
}

// ── 주입 (텀 게이트 통과 시에만 챗에 닿음) ─────────────────────
// TODO(2~3): ctx.sendMessageAsUser / addOneMessage 1개로 확정.
function injectProse(prose) {
    if (!canInject()) { flash(`아직 텀 — ${injectRemaining()}턴 후 (패널엔 기록됨)`); return false; }
    const ctx = getCtx();
    blDebug('주입 stub:', prose);
    // if (ctx?.sendMessageAsUser) await ctx.sendMessageAsUser(prose);
    markInject();
    flash('챗에 반영됨');
    return true;
}

// 템창 → 챗 (유저가 버튼 눌러 자기 의지로 꺼냄 = 유저 agency, OFF-SCREEN 안전)
function injectItems() {
    const top = STATE.items[0];
    if (!top) { flash('주울 게 없다'); return; }
    injectProse(`(가방에서 ${top.name}이(가) 굴러나왔다.)`);
}
// 결투창 → 챗 (직전 조우 수동 재반영)
function injectCombat() {
    const e = STATE.encounters[0];
    if (!e) { flash('아직 조우가 없다'); return; }
    const foeBeat = e.inner && e.inner.foe ? ' ' + e.inner.foe : '';
    injectProse(`(${e.desc}.${foeBeat})`);
}

// ── UI ──
let consoleEl = null;

function buildConsole() {
    if (consoleEl) return;
    consoleEl = document.createElement('div');
    consoleEl.id = 'beastlog-console';
    consoleEl.innerHTML = `
      <div class="bl-topbar">
        <span class="bl-paw">🐾</span>
        <span class="bl-lv num"></span>
        <span class="bl-xmini"><i></i></span>
        <span class="bl-spacer"></span>
        <span class="bl-inject">
          <span class="bl-lab">📤 챗주입</span>
          <span class="bl-sw" data-on="true"></span>
        </span>
        <span class="bl-up" title="펼치기">⌃</span>
      </div>
      <div class="bl-panes">
        <div class="bl-pane bl-left">
          <div class="bl-pane-h">📦 템창 <span class="bl-cnt bl-itemcnt num"></span>
            <button class="bl-pane-inject" data-src="items" title="챗에 반영">📤</button></div>
          <div class="bl-items"></div>
          <div class="bl-pwr">⚔️ 전투력 <b class="num bl-power"></b></div>
        </div>
        <div class="bl-pane bl-right">
          <div class="bl-pane-h">⚔️ 결투창
            <button class="bl-pane-inject" data-src="combat" title="챗에 반영">📤</button></div>
          <div class="bl-last"></div>
          <button class="bl-roll">🎲 조우 굴리기</button>
        </div>
      </div>
      <div class="bl-eventbar">
        <button class="bl-randevent">🎲 랜덤 이벤트</button>
        <span class="bl-cooldown num"></span>
      </div>`;
    document.body.appendChild(consoleEl);

    consoleEl.querySelector('.bl-sw').addEventListener('click', (e) => {
        STATE.settings.injectDefault = !STATE.settings.injectDefault;
        e.currentTarget.dataset.on = STATE.settings.injectDefault ? 'true' : 'false';
        saveState(STATE);
    });
    consoleEl.querySelector('.bl-roll').addEventListener('click', onDetect);
    consoleEl.querySelector('.bl-randevent').addEventListener('click', onRandomEvent);
    consoleEl.querySelectorAll('.bl-pane-inject').forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.dataset.src === 'items') injectItems();
            else injectCombat();
        });
    });
    consoleEl.querySelector('.bl-up').addEventListener('click', () => blDebug('펼치기 — 미구현(4단계)'));
}

function renderConsole() {
    if (!consoleEl) return;
    consoleEl.querySelector('.bl-lv').textContent = 'Lv.' + String(STATE.level).padStart(2, '0');
    const need = STATE.level * 100;
    consoleEl.querySelector('.bl-xmini i').style.width = Math.min(100, (STATE.xp / need) * 100) + '%';
    consoleEl.querySelector('.bl-sw').dataset.on = STATE.settings.injectDefault ? 'true' : 'false';
    consoleEl.querySelector('.bl-itemcnt').textContent = STATE.items.length;
    consoleEl.querySelector('.bl-power').textContent = STATE.power;

    consoleEl.querySelector('.bl-items').innerHTML = STATE.items.slice(0, 3).map(it =>
        `<div class="bl-item"><span>${it.emoji || '📦'}</span><span class="nm">${escapeHtml(it.name)}</span><span class="pr num">${it.price || 0}원</span></div>`
    ).join('') || '<div class="bl-empty">아직 주운 게 없다</div>';

    const last = STATE.encounters[0];
    consoleEl.querySelector('.bl-last').innerHTML = last
        ? `<div class="bl-foe"><div class="nm">${last.emoji} ${escapeHtml(last.title)}</div><div class="sub">직전 · ${escapeHtml(last.result)} · EXP +${last.exp}</div></div>`
        : `<div class="bl-foe"><div class="sub">조용하다.</div></div>`;

    // 텀 표시 + 주입 버튼 잠금
    const rem = injectRemaining();
    consoleEl.querySelector('.bl-cooldown').textContent = rem > 0 ? `💉 ${rem}턴 후` : '💉 준비됨';
    consoleEl.querySelectorAll('.bl-pane-inject').forEach(b => b.classList.toggle('locked', rem > 0));
}

// ── 루프 ──
function onDetect() {
    const enc = detectEncounterStub(getLastMessageText());
    if (!enc) return;
    showEncounterPopup(enc);
}

function showEncounterPopup(encounter) {
    closePopup();
    const choices = (encounter.choices && encounter.choices.length) ? encounter.choices
        : [{ label: '대응한다', kind: 'attack' }, { label: '지나친다', kind: 'flee' }];
    const pop = document.createElement('div');
    pop.id = 'beastlog-popup';
    pop.innerHTML = `
      <div class="bl-pop-card">
        <div class="bl-pop-title">${encounter.emoji} ${escapeHtml(encounter.title)}!</div>
        <div class="bl-pop-choices">
          ${choices.map((c, i) => `<button data-i="${i}">${escapeHtml(c.label)}</button>`).join('')}
        </div>
        <button class="bl-pop-ignore" data-i="-1">무시</button>
      </div>`;
    document.body.appendChild(pop);
    pop.querySelectorAll('button').forEach(btn => btn.addEventListener('click', () => {
        const i = parseInt(btn.dataset.i, 10);
        closePopup();
        if (i < 0) return; // 무시 = 0건
        const c = choices[i];
        applyOutcome(encounter, c.label, resolveByKind(encounter, c.kind));
    }));
}

function onRandomEvent() {
    const ev = generateRandomEventStub(getLastMessageText());
    STATE.events.unshift(Object.assign({ id: cryptoId() }, ev));
    saveState(STATE);
    closePopup();
    const pop = document.createElement('div');
    pop.id = 'beastlog-popup';
    pop.innerHTML = `
      <div class="bl-pop-card">
        <div class="bl-pop-title">${ev.emoji} ${escapeHtml(ev.title)}</div>
        <div class="bl-pop-desc">${escapeHtml(ev.desc)}</div>
        <div class="bl-pop-choices">
          <button data-act="inject">📤 채팅에 반영</button>
          <button data-act="ignore">그냥 둔다</button>
        </div>
      </div>`;
    document.body.appendChild(pop);
    pop.querySelectorAll('button').forEach(btn => btn.addEventListener('click', () => {
        const act = btn.dataset.act;
        closePopup();
        if (act === 'inject') injectProse(`(${ev.title}. ${ev.desc})`);
    }));
}

function closePopup() { const p = document.getElementById('beastlog-popup'); if (p) p.remove(); }

let flashTimer = null;
function flash(msg) {
    if (!consoleEl) return;
    let f = consoleEl.querySelector('.bl-flash');
    if (!f) { f = document.createElement('div'); f.className = 'bl-flash'; consoleEl.appendChild(f); }
    f.textContent = msg; f.classList.add('show');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => f.classList.remove('show'), 1800);
}

function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function registerEvents() {
    const ctx = getCtx();
    if (!ctx || !ctx.eventSource) return;
    const types = ctx.eventTypes || ctx.event_types || {};
    if (types.CHAT_CHANGED) ctx.eventSource.on(types.CHAT_CHANGED, () => { STATE = loadState(); renderConsole(); });
    // TODO(자동 옵션): types.MESSAGE_RECEIVED 구독 → 텀 통과 시 onDetect()
}

function init() {
    STATE = loadState();
    buildConsole();
    renderConsole();
    registerEvents();
    blDebug('비스트로그', BEASTLOG_VERSION, '로드됨');
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
}
