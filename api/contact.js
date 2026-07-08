// POST /api/contact
// 기존 서버는 문의 접수 시 Manus 자체 알림 서비스(forge.manus.ai)로 알림을 보냈습니다.
// Manus를 떠나므로 이 부분만 Resend 이메일 발송으로 대체했습니다 (이미 mddcalc.com 도메인이
// Resend에 인증되어 있으므로 RESEND_API_KEY만 Vercel에 넣으면 바로 동작합니다).
// RESEND_API_KEY가 없으면 이메일 발송은 건너뛰고 Vercel 함수 로그에만 남깁니다(사이트는 안 깨짐).

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

    const resendKey = process.env.RESEND_API_KEY;
    const notifyTo = process.env.CONTACT_NOTIFY_EMAIL;

    if (resendKey && notifyTo) {
      try {
        const { Resend } = require('resend');
        const resend = new Resend(resendKey);
        await resend.emails.send({
          from: 'MDD 분석기 <alerts@mddcalc.com>',
          to: notifyTo,
          subject: `[MDD 분석기] 새 문의: ${subject}`,
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
