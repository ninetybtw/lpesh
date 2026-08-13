const { verifyToken, COOKIE_MAX_AGE_MS } = require('../utils/jwt');
const prisma = require('../db');
const asyncHandler = require('../utils/asyncHandler');

const COOKIE_NAME = 'lexprep_session';

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  maxAge: COOKIE_MAX_AGE_MS
};

function setSessionCookie(res, token) {
  res.cookie(COOKIE_NAME, token, COOKIE_OPTIONS);
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, { ...COOKIE_OPTIONS, maxAge: undefined });
}

const requireAuth = asyncHandler(async (req, res, next) => {
  const token = req.cookies[COOKIE_NAME];
  const payload = token && verifyToken(token);
  if (!payload) {
    return res.status(401).json({ error: 'not_authenticated' });
  }

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user) {
    return res.status(401).json({ error: 'not_authenticated' });
  }

  req.user = user;
  next();
});

module.exports = { requireAuth, COOKIE_NAME, setSessionCookie, clearSessionCookie };
