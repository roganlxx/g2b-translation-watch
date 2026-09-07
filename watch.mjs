#!/usr/bin/env node
// 나라장터 번역 관련 공고 감시기 (GitHub Actions 버전)
// 신규 공고를 찾으면 Resend로 이메일 알림을 보낸다.
// 상태(seen.json)는 워크플로가 다시 커밋해 유지한다.

import fs from 'node:fs';
import dns from 'node:dns';

dns.setDefaultResultOrder('ipv4first');

const STATE = 'seen.json';
const LOG = 'hits.log';
const BASE = 'https://www.g2b.go.kr';
const API = BASE + '/pn/pnp/pnpe/BidPbac/selectBidPbacScrollTypeList.do';

const KEYWORDS = ['번역', '통역', '다국어', '자막', '현지화', '감수', '원어민'];
const NOISE = /감속기|변속기|가속기|외국어고|외국어대|교복|급식|현장체험|국외 현장|자매결연|어학연수|화상영어|언어치료|언어모델|GPU|조속기|결속기/;

const RESEND_KEY = process.env.RESEND_API_KEY;
const MAIL_TO = (process.env.ALERT_TO || 'hxngdabin@gmail.com').split(',').map((s) => s.trim());
const MAIL_FROM = process.env.ALERT_FROM || '우상번역 입찰감시 <trans@wooshang.com>';

const dec = (s) => String(s ?? '')
  .replace(/&#40;/g, '(').replace(/&#41;/g, ')')
  .replace(/&lt;br\/&gt;/g, ' | ').replace(/&amp;/g, '&')
  .replace(/&#39;/g, "'").replace(/&quot;/g, '"');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';

// GitHub Actions 러너는 UTC로 돈다. 한국시간(KST=UTC+9)으로 환산해서
// 날짜 계산과 시간대 게이팅을 한다.
function nowKST() {
  return new Date(Date.now() + 9 * 3600 * 1000);
}

async function bootstrap(tries = 4) {
  let last;
  for (let n = 1; n <= tries; n++) {
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 20000);
      const r = await fetch(BASE + '/', { headers: { 'User-Agent': UA }, redirect: 'follow', signal: ac.signal });
      clearTimeout(timer);
      const raw = r.headers.getSetCookie?.() ?? [];
      const jar = raw.map((c) => c.split(';')[0]).join('; ');
      if (!jar) throw new Error('세션 쿠키를 받지 못했습니다');
      return jar;
    } catch (e) {
      last = e;
      if (n < tries) await new Promise((r) => setTimeout(r, 3000 * n));
    }
  }
  throw new Error(`세션 준비 실패(${tries}회 시도): ${last?.message ?? last}`);
}

function body(kw, from, to) {
  return {
    dlBidPbancLstM: {
      untyBidPbancNo: '', bidPbancNo: '', bidPbancOrd: '', prcmBsneUntyNoOrd: '',
      prcmBsneSeCd: '0000 조070001 조070002 조070003 조070004 조070005 민079999',
      bidPbancNm: kw, pbancPstgDt: '', ldocNoVal: '', bidPrspPrce: '', ctrtDmndRcptNo: '',
      dmstcOvrsSeCd: '', pbancKndCd: '공440002', ctrtTyCd: '', bidCtrtMthdCd: '', scsbdMthdCd: '',
      fromBidDt: from, toBidDt: to, minBidPrspPrce: '', maxBidPrspPrce: '',
      bsneAllYn: 'Y', frcpYn: 'Y', rsrvYn: 'Y', laseYn: 'Y', untyGrpGb: '', dmstNm: '',
      pbancPicNm: '', odnLmtLgdngCd: '', odnLmtLgdngNm: '', intpCd: '', intpNm: '',
      dtlsPrnmNo: '', dtlsPrnmNm: '', slprRcptDdlnYn: '', lcrtTyCd: '', isMas: '', isElpdt: '',
      oderInstUntyGrpNo: '', instSearchRangeYn: '', esdacYn: '',
      infoSysCd: '정010029', contxtSeCd: '콘010006', bidDateType: 'R',
      brcoOrgnCd: '', deptOrgnCd: '', isShop: '', srchTy: '0', cangParmVal: '',
      currentPage: '', recordCountPerPage: '100', startIndex: 1, endIndex: 100,
    },
  };
}

async function search(jar, kw, from, to, tries = 3) {
  for (let n = 1; n <= tries; n++) {
    try {
      return await searchOnce(jar, kw, from, to);
    } catch (e) {
      if (n === tries) throw e;
      await new Promise((r) => setTimeout(r, 2000 * n));
    }
  }
}

async function searchOnce(jar, kw, from, to) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 25000);
  const r = await fetch(API, {
    signal: ac.signal,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json;charset=UTF-8',
      Accept: 'application/json',
      'User-Agent': UA,
      Referer: BASE + '/',
      Cookie: jar,
      submissionid: 'mf_wfm_container_tacBidPbancLst_contents_tab2_body_sbmPbancBidPbancLst',
      'Menu-Info': '{"menuNo":"01175","menuCangVal":"PNPE001_01","bsneClsfCd":"%EC%97%85130026","scrnNo":"00941"}',
    },
    body: JSON.stringify(body(kw, from, to)),
  });
  clearTimeout(timer);
  if (!r.ok) throw new Error(`API ${r.status} (${kw})`);
  const j = await r.json();
  return j.result ?? [];
}

const ymd = (d) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;

// pbancPstgDt = "2026/08/18 14:06 | (2026/08/31 17:00)" 형태. 괄호 안이 마감일시(KST).
function deadlineKST(s) {
  const m = String(s).match(/\((\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2})\)/);
  if (!m) return null;
  // KST 벽시계를 UTC epoch로: Date.UTC(...) - 9h
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 9, +m[5]));
}

async function sendMail(subject, text) {
  if (!RESEND_KEY) { console.error('RESEND_API_KEY 없음 - 메일 생략'); return; }
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: MAIL_FROM, to: MAIL_TO, reply_to: 'trans@wooshang.com', subject, text }),
  });
  if (!r.ok) throw new Error(`메일 발송 실패 ${r.status}: ${(await r.text()).slice(0, 200)}`);
  console.log(`메일 발송 완료 → ${MAIL_TO.join(', ')}`);
}

async function main() {
  const now = nowKST();
  const nowEpoch = Date.now();
  const from = ymd(new Date(nowEpoch + 9 * 3600e3 - 14 * 864e5));
  const to = ymd(new Date(nowEpoch + 9 * 3600e3));

  const seen = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : {};
  const jar = await bootstrap();

  const found = new Map();
  for (const kw of KEYWORDS) {
    let rows = [];
    try { rows = await search(jar, kw, from, to); }
    catch (e) { console.error(`[경고] ${kw}: ${e.message}`); continue; }
    for (const x of rows) {
      const id = `${x.untyBidPbancNo}-${x.untyBidPbancOrd}`;
      if (!found.has(id)) found.set(id, x);
    }
  }

  const hits = [];
  for (const [id, x] of found) {
    const nm = dec(x.bidPbancNm);
    if (NOISE.test(nm)) continue;
    const dl = deadlineKST(dec(x.pbancPstgDt));
    if (!dl || dl.getTime() <= nowEpoch) continue;
    if (seen[id]) continue;
    const mthd = dec(x.scsbdMthdNm ?? '');
    const urgent = /수의/.test(mthd);
    const hoursLeft = (dl.getTime() - nowEpoch) / 36e5;
    hits.push({ id, nm, inst: dec(x.dmstNm) || dec(x.oderInstUntyGrpNm) || '', se: x.prcmBsneSeCdNm ?? '', mthd, deadline: dl, hoursLeft, urgent });
  }
  hits.sort((a, b) => (b.urgent - a.urgent) || (a.hoursLeft - b.hoursLeft));

  for (const h of hits) seen[h.id] = { nm: h.nm, at: now.toISOString() };
  const cutoff = nowEpoch - 60 * 864e5;
  for (const [k, v] of Object.entries(seen)) {
    if (v?.at && new Date(v.at).getTime() - 9 * 3600e3 < cutoff) delete seen[k];
  }
  fs.writeFileSync(STATE, JSON.stringify(seen, null, 0));

  const stamp = now.toISOString().replace('T', ' ').slice(0, 16) + ' KST';
  if (!hits.length) {
    console.log(`[${stamp}] 신규 없음 (감시대상 ${found.size}건)`);
    return;
  }

  const fmt = (h) => {
    const d = h.deadline; // UTC epoch, KST로 표기
    const k = new Date(d.getTime() + 9 * 3600e3);
    const dl = `${k.getUTCMonth() + 1}/${String(k.getUTCDate()).padStart(2, '0')} ${String(k.getUTCHours()).padStart(2, '0')}:${String(k.getUTCMinutes()).padStart(2, '0')}`;
    const left = h.hoursLeft < 24 ? `${h.hoursLeft.toFixed(1)}시간 남음` : `${Math.floor(h.hoursLeft / 24)}일 남음`;
    return `${h.urgent ? '[수의] ' : ''}${h.nm}\n  ${h.inst} | ${h.se} | ${h.mthd}\n  마감 ${dl} (${left}) | 공고번호 ${h.id}\n  https://www.g2b.go.kr/`;
  };

  const out = `\n===== ${stamp} 신규 ${hits.length}건 =====\n` + hits.map(fmt).join('\n\n');
  console.log(out);
  fs.appendFileSync(LOG, out + '\n');

  const urgentCount = hits.filter((h) => h.urgent).length;
  const subject = urgentCount
    ? `[나라장터] 번역 수의계약 ${urgentCount}건 발견`
    : `[나라장터] 번역 공고 신규 ${hits.length}건`;
  const body = `우상번역 나라장터 감시기\n${stamp}\n\n` + hits.map(fmt).join('\n\n') +
    `\n\n----\n입찰 > 입찰진행 > 입찰진행/참가 에서 공고번호로 조회하세요.`;
  await sendMail(subject, body);
}

async function runWithRetry(tries = 3) {
  let last;
  for (let n = 1; n <= tries; n++) {
    try { await main(); return; }
    catch (e) { last = e; if (n < tries) { console.error(`[재시도 ${n}/${tries}] ${e.message}`); await new Promise((r) => setTimeout(r, 5000 * n)); } }
  }
  throw last;
}

runWithRetry().catch((e) => {
  console.error(`[오류] ${e.message}`);
  process.exit(1);
});
