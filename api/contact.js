// POST /api/contact
// 기존 서버는 문의 접수 시 Manus 자체 알림 서비스(forge.manus.ai)로 알림을 보냈습니다.
// Manus를 떠나므로 이 부분만 Resend 이메일 발송으로 대체했습니다 (이미 mddcalc.com 도메인이
// Resend에 인증되어 있으므로 RESEND_API_KEY만 Vercel에 넣으면 바로 동작합니다).
// RESEND_API_KEY가 없으면 이메일 발송은 건너뛰고 Vercel 함수 로그에만 남깁니다(사이트는 안 깨짐).
//
// 이 주소는 "아무나 우리 이름으로 메일을 보내게 하는" 창구이기도 합니다. 막지 않으면
// 스팸봇이 하루에도 수천 건을 밀어넣어 Resend 발송 한도와 받는 편지함을 태웁니다.
// 그래서 길이 제한 + IP별 속도제한 + 헤더 인젝션 차단을 겁니다.

// 각 항목의 최대 길이. 사람이 쓰는 문의는 이 안에 다 들어갑니다.
const LIMITS = { name: 100, email: 254, subject: 200, message: 5000 };

// 한 IP가 이 시간창 안에 보낼 수 있는 문의 수.
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX_PER_WINDOW = 5;

const _rateBuckets = new Map();

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}

function isRateLimited(ip) {
  const now = Date.now();
  const hits = (_rateBuckets.get(ip) || []).filter(t => now - t < RATE_WINDOW_MS);
  hits.push(now);
  _rateBuckets.set(ip, hits);

  if (_rateBuckets.size > 5000) {
    for (const [k, v] of _rateBuckets) {
      if (!v.length || now - v[v.length - 1] > RATE_WINDOW_MS) _rateBuckets.delete(k);
    }
  }
  return hits.length > RATE_MAX_PER_WINDOW;
}

// 우리 사이트의 문의 폼에서 온 요청만 받습니다 (time-series.js 와 같은 방식).
// 도메인을 하드코딩하지 않고 요청이 들어온 호스트와 Origin 이 같은지만 봅니다.
function isAllowedOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const selfHost = String(req.headers.host || '').split(':')[0];
  if (!selfHost) return true; // 비교 기준이 없으면 막지 않는다 (사이트가 멈추는 쪽이 더 나쁘다)
  try {
    const originHost = new URL(origin).hostname;
    const bare = h => h.replace(/^www\./, '');
    return bare(originHost) === bare(selfHost);
  } catch {
    return false;
  }
}

// 메일 제목에 줄바꿈이 들어가면 헤더가 조작될 수 있습니다
// (Subject 값 뒤에 CR/LF 를 넣고 임의의 메일 헤더를 덧붙이는 수법).
// 제목으로 쓰는 값에서는 제어문자를 전부 공백으로 바꿉니다.
function sanitizeHeaderValue(str) {
  let out = '';
  for (const ch of String(str)) {
    const code = ch.codePointAt(0);
    out += (code < 0x20 || code === 0x7f) ? ' ' : ch;
  }
  return out.replace(/\s+/g, ' ').trim();
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (!isAllowedOrigin(req)) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  if (isRateLimited(getClientIp(req))) {
    res.setHeader('Retry-After', '600');
    res.status(429).json({ error: '문의가 너무 잦습니다. 잠시 후 다시 시도해주세요.' });
    return;
  }

  try {
    const body = req.body || {};
    const str = v => (typeof v === 'string' ? v.trim() : '');
    const fields = {
      name: str(body.name),
      email: str(body.email),
      subject: str(body.subject),
      message: str(body.message),
    };
    const { name, email, subject, message } = fields;

    if (!name || !email || !subject || !message) {
      res.status(400).json({ error: '모든 항목을 입력해주세요.' });
      return;
    }
    for (const [field, max] of Object.entries(LIMITS)) {
      if (fields[field].length > max) {
        res.status(400).json({ error: `입력이 너무 깁니다. (${field} 최대 ${max}자)` });
        return;
      }
    }
    // 공백/줄바꿈이 없는 한 덩어리여야 이메일 주소입니다. 기존 정규식([^@]+)은 공백과
    // 줄바꿈을 허용해서 "a b@c.d" 같은 값이 그대로 통과해 메일 본문에 실렸습니다.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ error: '올바른 이메일 주소를 입력해주세요.' });
      return;
    }

    const resendKey = process.env.RESEND_API_KEY;
    const notifyTo = process.env.CONTACT_NOTIFY_EMAIL;

    if (resendKey && notifyTo) {
      try {
        const { Resend } = require('resend');
        const resend = new Resend(resendKey);
        await resend.emails.send({
          from: 'MDD 분석기 <alerts@mddcalc.com>',
          to: notifyTo,
          subject: `[MDD 분석기] 새 문의: ${sanitizeHeaderValue(subject)}`,
          text: `이름: ${name}\n이메일: ${email}\n제목: ${subject}\n\n내용:\n${message}`,
        });
      } catch (mailErr) {
        console.warn('[Contact] 이메일 발송 실패 (문의 자체는 정상 접수됨):', mailErr.message);
      }
    } else {
      console.log('[Contact] 새 문의 (RESEND_API_KEY/CONTACT_NOTIFY_EMAIL 미설정):', { name, email, subject, message });
    }

    res.status(200).json({ success: true, message: '문의가 접수되었습니다. 빠른 시일 내 답변 드리겠습니다.' });
  } catch (error) {
    console.error('Contact form error:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다. 다시 시도해주세요.' });
  }
};
