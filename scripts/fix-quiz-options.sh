#!/usr/bin/env bash
# LexPrep — прогон admin-quiz-fix по всей базе тестов пачками, пока не
# останется 0 подозрительных вопросов. Запускать на сервере (там, где есть
# сетевой доступ к api.lexprep.ru и учётка администратора сайта).
#
# Использование:
#   ./fix-quiz-options.sh
# Спросит email и пароль администратора (пароль не отображается при вводе),
# получит токен через Supabase Auth, затем будет вызывать admin-quiz-fix
# пачками по 30 вопросов с dryRun=false, пока remainingFlagged не станет 0.
#
# ВНИМАНИЕ: сразу пишет в базу (без предпросмотра) — если хочешь сначала
# посмотреть на выборке, прогони через админку (вкладка "Очевидность
# тестов" → "Предложить правки") на паре пачек вручную.

set -euo pipefail

API_BASE="https://api.lexprep.ru"

read -rp "Email администратора: " ADMIN_EMAIL
read -rsp "Пароль: " ADMIN_PASSWORD
echo

if [ -z "${SUPABASE_ANON_KEY:-}" ]; then
  read -rp "SUPABASE_ANON_KEY (anon key из .env): " SUPABASE_ANON_KEY
fi

echo "Авторизация..."
LOGIN_RESPONSE=$(curl -sS -X POST "${API_BASE}/auth/v1/token?grant_type=password" \
  -H "Content-Type: application/json" \
  -H "apikey: ${SUPABASE_ANON_KEY}" \
  -d "{\"email\":\"${ADMIN_EMAIL}\",\"password\":\"${ADMIN_PASSWORD}\"}")

ACCESS_TOKEN=$(echo "$LOGIN_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('access_token',''))")

if [ -z "$ACCESS_TOKEN" ]; then
  echo "Не удалось авторизоваться. Ответ сервера:"
  echo "$LOGIN_RESPONSE"
  exit 1
fi

echo "Авторизация успешна. Начинаю пачками по 30..."

TOTAL_PROCESSED=0
BATCH=1

while true; do
  RESPONSE=$(curl -sS -X POST "${API_BASE}/functions/v1/admin-quiz-fix" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    -H "apikey: ${SUPABASE_ANON_KEY}" \
    -d '{"dryRun": false, "limit": 30}')

  PROCESSED=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('processedCount', 0))" 2>/dev/null || echo "0")
  REMAINING=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('remainingFlagged', -1))" 2>/dev/null || echo "-1")
  ERROR=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('error',''))" 2>/dev/null || echo "")

  if [ -n "$ERROR" ]; then
    echo "Ошибка на пачке $BATCH: $ERROR"
    echo "$RESPONSE"
    exit 1
  fi

  TOTAL_PROCESSED=$((TOTAL_PROCESSED + PROCESSED))
  echo "Пачка $BATCH: обработано $PROCESSED, всего обработано $TOTAL_PROCESSED, осталось $REMAINING"

  if [ "$REMAINING" -le 0 ] || [ "$PROCESSED" -eq 0 ]; then
    echo "Готово."
    break
  fi

  BATCH=$((BATCH + 1))
  sleep 1
done
