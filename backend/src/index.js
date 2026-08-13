require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const { router: authRouter } = require('./routes/auth');
const profileRouter = require('./routes/profile');

const app = express();

const allowedOrigins = (process.env.FRONTEND_ORIGIN || 'http://localhost:8971').split(',');
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/auth', authRouter);
app.use('/api/profile', profileRouter);

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'server_error', message: 'Что-то пошло не так на сервере.' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`LexPrep API listening on http://localhost:${PORT}`);
});
