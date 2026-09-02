// POST /api/contact
// 기존 서버는 문의 접수 시 Manus 자체 알림 서비스(forge.manus.ai)로 알림을 보냈습니다.
// Manus를 떠나므로 이 부분만 Resend 이메일 발송으로 대체했습니다 (이미 mddcalc.com 도메인이
// Resend에 인증되어 있으므로 RESEND_API_KEY만 Vercel에 넣으면 바로 동작합니다).
//
// 중요: 메일이 실제로 나가지 않았으면 성공이라고 답하지 않습니다.
// 예전에는 RESEND_API_KEY / CONTACT_NOTIFY_EMAIL 이 없어도, 또 발송이 실패해도 200 과
// "문의가 접수되었습니다" 를 돌려줬습니다. 사용자는 답변을 기다리는데 문의는 아무 데도
// 도착하지 않은 상태(함수 로그에만 남음)라, 조용히 실패하는 것 중 가장 나쁜 쪽이었습니다.
// 이제 보낼 수 없으면 그렇다고 말하고 직접 메일 보낼 주소를 안내합니다.

const FALLBACK_EMAIL = 'gktgkt2309@gmail.com';
const FALLBACK_MSG =
  `문의를 접수하지 못했습니다. 번거로우시겠지만 ${FALLBACK_EMAIL} 로 직접 보내주시면 확인하겠습니다.`;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { name, email, subject, message } = req.body || {};

    if (!name || !email || !subject || !message) {
      res.status(400).json({ error: '모든 항목을 입력해주세요.' });
      return;
    }
    if (!/^[^@]+@[^@]+\.[^@]+$/.test(email)) {
      res.status(400).json({ error: '올바른 이메일 주소를 입력해주세요.' });
      return;
    }
    // 폼 하나에 소설을 밀어 넣는 경우를 막습니다(메일 발송 실패로 이어집니다).
    if (String(message).length > 5000 || String(subject).length > 200 || String(name).length > 100) {
      res.status(400).json({ error: '입력이 너무 깁니다. 제목 200자, 내용 5000자 이내로 부탁드립니다.' });
      return;
    }

    const resendKey = process.env.RESEND_API_KEY;
    const notifyTo = process.env.CONTACT_NOTIFY_EMAIL;

    if (!resendKey || !notifyTo) {
      // 설정이 빠진 것은 서버 쪽 문제이므로 사용자에게 성공이라고 말하지 않습니다.
      console.error('[Contact] RESEND_API_KEY / CONTACT_NOTIFY_EMAIL 미설정 — 문의를 전달할 수 없습니다.');
      res.status(503).json({ error: FALLBACK_MSG });
      return;
    }

    try {
      const { Resend } = require('resend');
      const resend = new Resend(resendKey);
      const sent = await resend.emails.send({
        from: 'MDD 분석기 <alerts@mddcalc.com>',
        to: notifyTo,
        replyTo: email,
        subject: `[MDD 분석기] 새 문의: ${subject}`,
        text: `이름: ${name}\n이메일: ${email}\n제목: ${subject}\n\n내용:\n${message}`,
      });
      // Resend SDK 는 실패를 예외 대신 { error } 로 돌려주는 경우가 있습니다.
      if (sent && sent.error) throw new Error(sent.error.message || String(sent.error));
    } catch (mailErr) {
      console.error('[Contact] 이메일 발송 실패:', mailErr && mailErr.message);
      res.status(502).json({ error: FALLBACK_MSG });
      return;
    }

    res.status(200).json({ success: true, message: '문의가 접수되었습니다. 빠른 시일 내 답변 드리겠습니다.' });
  } catch (error) {
    console.error('Contact form error:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다. 다시 시도해주세요.' });
  }
};
