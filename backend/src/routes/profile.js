const express = require('express');
const prisma = require('../db');
const { requireAuth, clearSessionCookie } = require('../middleware/auth');
const { publicUser } = require('./auth');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

// Совпадает с ограничением, которое profile.js уже накладывает на
// загрузку аватара на фронтенде (см. initAvatarEditor) — держим то же
// значение и на сервере, раз аватар передаётся data URL в JSON-теле.
const MAX_AVATAR_BYTES = 1.5 * 1024 * 1024;

router.patch('/', requireAuth, asyncHandler(async (req, res) => {
  const { name, avatarUrl } = req.body || {};
  const data = {};

  if (name !== undefined) {
    if (!String(name).trim()) {
      return res.status(400).json({ error: 'invalid_name', message: 'Имя не может быть пустым.' });
    }
    data.name = String(name).trim();
  }

  if (avatarUrl !== undefined) {
    if (avatarUrl !== null && avatarUrl.length > MAX_AVATAR_BYTES) {
      return res.status(400).json({ error: 'avatar_too_large', message: 'Аватар слишком большой.' });
    }
    data.avatarUrl = avatarUrl;
  }

  const user = await prisma.user.update({ where: { id: req.user.id }, data });
  res.json({ user: publicUser(user) });
}));

router.delete('/', requireAuth, asyncHandler(async (req, res) => {
  await prisma.user.delete({ where: { id: req.user.id } });
  clearSessionCookie(res);
  res.status(204).end();
}));

module.exports = router;
