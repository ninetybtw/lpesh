#!/usr/bin/env bash
# LexPrep — прогон admin-quiz-fix по всей базе тестов пачками, пока не
# останется 0 подозрительных вопросов. Запускать на сервере (там, где есть
# сетевой доступ к api.lexprep.ru и учётка администратора сайта).
#
# Использование:
#   ./fix-quiz-options.sh
# Спросит access-токен уже залогиненной сессии администратора в браузере
# (получить: на сайте, залогинившись как админ, открыть консоль браузера —
# F12 → Console — и выполнить:
#   Object.keys(localStorage).filter(k => k.includes('auth-token')).map(k => JSON.parse(localStorage.getItem(k)).access_token)
# и скопировать полученную строку, она начинается на "eyJ") и anon key,
# затем будет вызывать admin-quiz-fix пачками по 30 вопросов с
# dryRun=false, пока remainingFlagged не станет 0.
#
# ВНИМАНИЕ: сразу пишет в базу (без предпросмотра) — если хочешь сначала
# посмотреть на выборке, прогони через админку (вкладка "Очевидность
# тестов" → "Предложить правки") на паре пачек вручную.
#
# Токен живёт ограниченное время (обычно ~1 час) — если скрипт на середине
# начнёт получать 401, просто получи новый токен и перезапусти: уже
# исправленные вопросы не попадут в выборку повторно.

set -euo pipefail

API_BASE="https://api.lexprep.ru"

read -rp "Access token администратора (из localStorage браузера): " ACCESS_TOKEN

if [ -z "${SUPABASE_ANON_KEY:-}" ]; then
  read -rp "SUPABASE_ANON_KEY (anon key из .env): " SUPABASE_ANON_KEY
fi

if [ -z "$ACCESS_TOKEN" ]; then
  echo "Токен не введён."
  exit 1
fi

echo "Начинаю пачками по 30..."

TOTAL_PROCESSED=0
BATCH=1

while true; do
  RESPONSE=$(curl -sS -X POST "${API_BASE}/functions/v1/admin-quiz-fix" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    -H "apikey: ${SUPABASE_ANON_KEY}" \
    -d '{"dryRun": false, "limit": 30}')

  RESOLVED=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('resolvedCount', 0))" 2>/dev/null || echo "0")
  REMAINING=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('remainingFlagged', -1))" 2>/dev/null || echo "-1")
  NEEDS_REVIEW=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('needsManualReview', 0))" 2>/dev/null || echo "0")
  ERROR=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('error',''))" 2>/dev/null || echo "")

  if [ -n "$ERROR" ]; then
    echo "Ошибка на пачке $BATCH: $ERROR"
    echo "$RESPONSE"
    exit 1
  fi

  TOTAL_PROCESSED=$((TOTAL_PROCESSED + RESOLVED))
  echo "Пачка $BATCH: исправлено $RESOLVED, всего исправлено $TOTAL_PROCESSED, осталось автопригодных $REMAINING, отложено на ручную проверку $NEEDS_REVIEW"

  if [ "$REMAINING" -le 0 ]; then
    echo "Готово. На ручную проверку в админке отложено вопросов: $NEEDS_REVIEW (там, где ИИ не смог безопасно подобрать замену)."
    break
  fi

  BATCH=$((BATCH + 1))
  sleep 1
done
