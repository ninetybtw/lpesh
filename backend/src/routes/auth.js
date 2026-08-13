const express = require('express');
const bcrypt = require('bcryptjs');
const prisma = require('../db');
const { signToken } = require('../utils/jwt');
const { generateReferralCode } = require('../utils/referralCode');
const { requireAuth, setSessionCookie, clearSessionCookie } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

function isValidEmail(value) {
  const email = String(value || '').trim();
  const shape = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!shape.test(email)) return false;
  const domain = email.split('@')[1];
  const labels = domain.split('.');
  if (labels.some(label => label.length === 0)) return false;
  const tld = labels[labels.length - 1];
  return tld.length >= 2 && /^[a-zA-Zа-яёА-ЯЁ]+$/.test(tld);
}

// Те же правила, что фронтенд показывает в чек-листе под полем пароля
// (validation.js/getPasswordRuleStatus) — сервер обязан перепроверить их
// сам, а не доверять клиентской валидации.
function isValidPassword(password) {
  const value = String(password || '');
  return (
    value.length >= 8 &&
    /[a-zA-Zа-яёА-ЯЁ]/.test(value) &&
    /\d/.test(value) &&
    /[a-zа-яё]/.test(value) &&
    /[A-ZА-ЯЁ]/.test(value)
  );
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    referralCode: user.referralCode
  };
}

async function uniqueReferralCode() {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = generateReferralCode();
    const existing = await prisma.user.findUnique({ where: { referralCode: code } });
    if (!existing) return code;
  }
  throw new Error('Could not generate a unique referral code');
}

router.post('/register', asyncHandler(async (req, res) => {
  const { name, email, password } = req.body || {};

  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'invalid_name', message: 'Укажи имя.' });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'invalid_email', message: 'Похоже, это не настоящий email.' });
  }
  if (!isValidPassword(password)) {
    return res.status(400).json({ error: 'invalid_password', message: 'Пароль не соответствует требованиям.' });
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (existing) {
    return res.status(409).json({ error: 'email_taken', message: 'Аккаунт с таким email уже существует.' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const referralCode = await uniqueReferralCode();

  const user = await prisma.user.create({
    data: {
      name: String(name).trim(),
      email: normalizedEmail,
      passwordHash,
      referralCode
    }
  });

  const token = signToken(user.id);
  setSessionCookie(res, token);
  res.status(201).json({ user: publicUser(user) });
}));

router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'missing_credentials', message: 'Укажи email и пароль.' });
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  const valid = user && (await bcrypt.compare(password, user.passwordHash));
  if (!valid) {
    return res.status(401).json({ error: 'invalid_credentials', message: 'Неверный email или пароль.' });
  }

  const token = signToken(user.id);
  setSessionCookie(res, token);
  res.json({ user: publicUser(user) });
}));

router.post('/logout', (req, res) => {
  clearSessionCookie(res);
  res.status(204).end();
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

module.exports = { router, publicUser };
