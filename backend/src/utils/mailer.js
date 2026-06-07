const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.qq.com',
  port: parseInt(process.env.SMTP_PORT) || 465,
  secure: true, // 465端口强制使用 SSL 安全连接
  auth: {
    user: process.env.SMTP_USER, // 自动读取 3110627216@qq.com
    pass: process.env.SMTP_PASS  // 自动读取 16位授权码
  }
});

/**
 * 发送验证码邮件
 */
const sendCodeEmail = async (to, code, type) => {
  const subject = type === 'register' ? '【鉴真数据】注册验证码' : '【鉴真数据】密码重置验证码';
  const text = `您好，您的验证码是：${code}。验证码将在 5 分钟后失效，请勿向他人泄露。`;

  await transporter.sendMail({
    from: `"鉴真数据系统" <${process.env.SMTP_USER}>`, // 自动使用 3110627216@qq.com 发送
    to,
    subject,
    text
  });
};

module.exports = { sendCodeEmail };