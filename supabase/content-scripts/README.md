# content-scripts/

Импорт markdown-конспектов (в формате `topic-NN.md` с YAML front matter,
как прислали для Гражданского права) в `public.disciplines`/`public.topics`.

```bash
cd supabase/content-scripts
npm install @supabase/supabase-js@2
node import-topics.js <путь-к-каталогу-с-topic-NN.md> <discipline-id> "<Название дисциплины>"
```

`structure-text.js` — эвристическая структуризация: разбивает "сплошной"
текст источника на абзацы, инлайн-буллеты (`•`) превращает в markdown-список,
инлайн-нумерацию (`1.`/`1)`) — в жирный номер перед абзацем (специально не в
настоящий `<ol>`, иначе commonmark иногда склеивает подряд идущие, но
семантически разные перечисления, которые оба начинаются с "1.", в один
список). Ничего не меняет по содержанию, только расставляет разрывы.

Скрипт логинится тестовым админ-аккаунтом (`admin.sql`) — обычный
пользователь писать в `topics`/`disciplines` не может (RLS).

## Библиотека (library.html) — сборники билетов

Схема и защита описаны в шапке `supabase/library.sql` — его нужно один раз
выполнить в SQL Editor до импорта. Коротко, куда что класть (импорт тем же
админ-аккаунтом, обычными upsert):

| Таблица | Что | Кто видит |
|---|---|---|
| `library_collections` | сборник: `id`, `discipline_id` (как в `disciplines`), `discipline_title`, `title`, `author`, `description`, `kind` (`tickets`/`lectures`/`course`/`other`), `actualized`, `sort_order` | все (витрина) |
| `library_items` | оглавление: `id`, `collection_id`, `number`, `title`, `part`, `sections` (`[{id, title}]`), `word_count`, `sort_order` | все (витрина) |
| `library_item_content` | текст билета: `item_id`, `content_html` и/или `content_md`, `footnotes` (`[{n, md}]`), `images` (пути схем) | только через RPC `library_read_item` («Про»/«Максимум») |
| `library_assets` | схемы: `collection_id`, `path`, `mime_type`, `data_base64` | только через RPC вместе с билетом |

- Файлы (PDF и т.п.) в библиотеку не кладём — их можно было бы скачать.
  PDF-сборники переводим в текст по билетам (`content_html` или `content_md`).
- В `content_html` понимаются классы экспорта УП: `b`/`i`/`u`, `c-red`,
  `c-green`, `c-blue`, `c-link`, врезки `callout law|note|warn`, `li` с
  `margin-left:calc(Npt + 1.6em)`, таблицы `tb` (ячейки `g`, `yl`), сноски
  `fn`. В `content_md` — GitHub-alerts `[!NOTE]`/`[!TIP]`/`[!WARNING]` и
  сноски `[^n]`.
- `<img src>` в тексте сопоставляется со схемой из `library_assets` по имени
  файла, так что путь в `src` может быть любым.
- `item_count`/`word_count` сборника заполнять не нужно — страница считает сама по `library_items`.
