# Синхронизация с Aviasales

## Расписание и способы запуска

Sync запускается:

- cron каждые 10 минут;
- deployment-скриптом после production build;
- кнопкой в админке;
- вручную через `npm run sync` или `dist/entries/sync.js`.

Активные источники `UZS` автоматически создаются для поддерживаемых городов Узбекистана.

## Запрос к Aviasales

Используется endpoint:

```text
/v1/hot_offers/list.json?origin={UZBEKISTAN_ORIGIN}&currency=uzs
```

Конфигурация рынка фиксирована:

- market `uz`;
- language `ru`;
- passport country `UZ`.

Эти значения находятся в общей конфигурации приложения. Текущая реализация URL для `hot_offers` передаёт API только `origin` и `currency`; `market`, `language` и `passport country` пока не добавляются в query string.

HTTP timeout — 10 секунд. Для network/timeout и HTTP `429`, `500`, `502`, `503`, `504` выполняется до трёх попыток с задержками 250 и 500 мс.

## Валидация ответа

Ответ обязан содержать массив `directions`. Каждое направление преобразуется независимо. Некорректная отдельная запись логируется и пропускается, не отменяя весь корректный ответ.

Проверяются:

- IATA и currency;
- ISO-даты;
- положительная безопасная integer price;
- trip class 1/2;
- число пересадок;
- багаж;
- ticket URL и search code.

## Последовательность обработки

Для каждого билета:

1. upsert по `external_key`;
2. подсчёт inserted/updated;
3. запись ticket price history при первой вставке или изменении цены;
4. запись route price observation;
5. определение `new_ticket` или `price_drop`;
6. поиск подходящих подписок;
7. повторная проверка настроек пользователя;
8. dedup уведомления;
9. отправка Telegram-сообщения;
10. запись notification history.

После всех билетов:

1. пересчитываются дневные агрегаты замеченных маршрутов;
2. удаляются raw observations старше 30 дней;
3. отсутствующие в ответе билеты деактивируются;
4. обновляется destination cache;
5. `sync_runs` получает итоговые счётчики и время завершения.

## Locks

Application lock:

```text
sync:hot-tickets:TAS:UZS
```

TTL — 300 секунд. Lock освобождается в `finally`, включая ошибки.

Дополнительно cron использует:

```text
flock -n /run/lock/hot-ticket-bot-sync.lock
```

Это не позволяет cron запустить второй процесс, пока первый не завершён.

## Sync run status

В `sync_runs` сохраняются:

- source;
- status;
- fetched;
- inserted;
- updated;
- notifications;
- ошибка;
- started/finished time.

Admin dashboard показывает последнюю запись.

## Поведение при ошибке

- Ошибка отдельного route observation не останавливает ticket sync.
- Ошибка одного source логируется job-уровнем, после чего обрабатываются остальные sources.
- Текущая конфигурация имеет один source, поэтому `processedSources` обычно равен 1.
- Если основной pipeline source упал, sync run помечается failed.
