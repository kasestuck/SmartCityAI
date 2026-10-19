# Ближайшая остановка: результат проверки

Проверено 19 октября 2026 года. Реализована информационная подсказка рядом с POI; построение транспортного маршрута отсутствует.

## Реальные данные Overpass

Использован настроенный в проекте Overpass API через существующий HTTP-клиент POI-сборщика. Область: south=50.95, west=71.20, north=51.30, east=71.75. Запрос с ограниченными повторными попытками занял 94,94 с.

| Показатель | Результат |
| --- | ---: |
| Получено OSM-объектов диагностическим запросом | 1 478 |
| Сохранено в отдельной таблице transit_stops | 1 365 |
| Автобусных объектов | 1 293 |
| Объектов ЛРТ | 72 |
| Трамвайных остановок | 0 |
| Исключено неподходящих объектов | 113 |
| С человеческим названием после нормализации | 655 |
| Без названия, name=null | 710 |
| С route_ref | 10 |
| POI до и после сбора | 601 |

Это количества объектов OSM, а не уникальных физических остановок: платформа, позиция остановки и станция могут описывать одну остановку. Названия есть примерно у 48%, сведения о маршрутах — менее чем у 1%. Координат достаточно для подсказки; для расписаний и маршрутизации данных недостаточно.

В исходном ответе реально присутствуют highway=bus_stop (965), public_transport=stop_position (366), platform (730), station (42). Значение public_transport=stop не найдено. Для ЛРТ обнаружены light_rail=yes (72), station=light_rail (38), railway=station/stop/platform вместе с транспортными тегами. railway=light_rail без признака остановки обозначает пути и не импортируется. Трамвайные теги не обнаружены.

Покрытие исходных 1 478 объектов: name=691, name:ru=235, name:kk=106, route_ref=10, network=113, operator=147, ref=71. Значения ref вроде 101 у станции «Әуежай» — идентификаторы станции; они не превращаются в номера маршрутов. В route_refs сохраняется только route_ref. Полный аудит и исходные примеры: [transit-data-audit.json](transit-data-audit.json).

Семантика тегов сверена с документацией OSM: [bus_stop](https://wiki.openstreetmap.org/wiki/Tag:highway%3Dbus_stop), [stop_position](https://wiki.openstreetmap.org/wiki/Tag:public_transport%3Dstop_position), [station=light_rail](https://wiki.openstreetmap.org/wiki/Tag:station%3Dlight_rail).

## Что изменено

- Отдельная таблица transit_stops и транзакционный upsert по ID OSM; таблица POI не изменяется этой задачей.
- Сборщик [transit_collector.py](../backend/services/transit_collector.py) и команда [collect_transit.py](../backend/scripts/collect_transit.py) повторно используют HTTP, ограниченные повторы, TTL и атомарную запись кэша POI-сборщика. Кэш остановок отдельный: TRANSIT_CACHE_PATH.
- Реальный скачанный ответ передан в стандартный кэш, после чего команда сборщика дважды выполнена. Оба запуска: received=1478 saved=1365 skipped=113, источник cache. После повторного запуска в таблице остаётся 1365 строк. Перед импортом сохранена локальная резервная копия SQLite в игнорируемом cache.
- [transit.py](../backend/services/transit.py) добавляет ближайшую остановку к уже ранжированным кандидатам. Используется существующий Haversine, радиус 500 м включительно от координат POI. Порядок, score и оценка посещения сохраняются. Расстояние округлено до 0,1 м; это расстояние по прямой, а не доступный пеший путь.
- Необязательное поле nearest_transit_stop содержит name, stop_type, distance_meters, route_refs; при отсутствии остановки в радиусе возвращается null. Название и маршруты могут быть null; технические коды не подставляются вместо имени.
- Gemini получает только найденные факты об остановке. Добавлен запрет расписаний, ожидания, интервалов, времени поездки, пересадок и обещаний «быстрее». Дополнительная проверка reason/suggested_action отбрасывает очевидные неподтверждённые транспортные утверждения и использует существующий fallback. Старые проверки ID и текста сохранены.
- [API-контракт](api-contract.md) дополнен новым полем, примером и ограничениями. После замечания о невидимой остановке frontend дополнен: поле показывается в карточке и деталях в реальном режиме.

## Запуск сбора

Из корня репозитория, после установки существующих зависимостей:

```powershell
python -m backend.scripts.collect_transit
```

Для принудительного обновления из Overpass:

```powershell
python -m backend.scripts.collect_transit --force
```

SQLite и кэш игнорируются Git. На другой машине после получения кода нужно выполнить сбор; одного переноса кода для появления данных недостаточно.

## Автоматические проверки

Финальная команда: python -m pytest backend/tests -q -p no:cacheprovider с отдельным временным каталогом через --basetemp.

```text
597 passed, 8 skipped in 41.86s
```

Падений: 0. Восемь существующих тестов файлового сервера пропущены из-за WinError 1314: процесс Windows не имеет права создавать симлинки. Эти сценарии нельзя объявлять проверенными на данной машине.

Добавлено 101 тестовый случай: 50 в [test_transit_collector.py](../backend/tests/test_transit_collector.py), 51 в [test_transit_api.py](../backend/tests/test_transit_api.py). Проверены наблюдаемые OSM-теги, отдельная таблица, кэш и ошибки, повторный импорт, остановка Бәйтерек с реальными OSM-координатами (111,2 м от синтетического POI), граница 500 м, пустая таблица, удалённая остановка, расстояние от POI, неизменность порядка и прежних полей, передача данных модели и fallback для неподтверждённых транспортных фраз RU/KK/EN.

Независимый обзор выявил обходы через второй номер маршрута и сокращение «5 мин.». Для них сначала воспроизведены падающие тесты, затем исправлена проверка; дополнительно проверено ожидание без слова «автобус». Все эти случаи вошли в финальный успешный прогон.

Frontend: node --test tests/frontend-contract.test.cjs → 29 passed, 0 failed. Ruff: All checks passed! Форматирование пяти новых Python-файлов проверено. git diff --check — без ошибок (есть прежнее предупреждение LF/CRLF для docs/limitations.md).

## Реальный HTTP-запрос

Временный локальный Uvicorn запущен с текущими SQLite и настройками Gemini из .env; после проверки остановлен. Использованы публичные синтетические координаты центра Астаны, query="Хочу кофе", duration_minutes=60, categories=["cafe"].

Ответ: HTTP 200 за 0,707 с, три рекомендации, у всех заполнена ближайшая остановка. Фрагмент реального ответа:

```json
{
  "name": "CrepeCafe",
  "generated_by": "fallback_template",
  "nearest_transit_stop": {
    "name": "Национальная компания Казахстан Темир Жолы",
    "stop_type": "bus",
    "distance_meters": 239.6,
    "route_refs": null
  }
}
```

Полный запрос и ответ: [transit-demo-results.json](transit-demo-results.json).

В этой проверке объяснения сгенерированы fallback, не Gemini. Один дополнительный ограниченный диагностический запрос с неизменными ключом и моделью получил от Gemini HTTP 429 RESOURCE_EXHAUSTED. Это ограничение квоты/ресурса со стороны сервиса; успешную живую генерацию в данной сессии подтвердить не удалось. Ключ, модель и базовая интеграция не изменялись. Заполнение остановок от Gemini не зависит. Передачу остановок и обработку модельного текста проверили автоматическими тестами с подставленным HTTP-ответом.

## Минимальная реализация и ограничения

- Поиск перебирает локальные 1365 строк; отдельный пространственный индекс/новый поисковый движок не добавлялся.
- Дедупликации физических остановок нет. Может выбираться платформа или позиция остановки; наличие OSM-объекта, включая ЛРТ, не подтверждает фактическую работу транспорта.
- Остановки без названия остаются с name=null. Маршруты почти везде неизвестны; их нельзя додумывать.
- Как у существующего POI-сборщика, upsert не удаляет ранее собранные объекты, отсутствующие в очередной выгрузке. Полнота и актуальность OSM не гарантируются.
- Нет расписаний, GTFS, пересадок, оценки ожидания/поездки или проверки доступного прохода до остановки.
- Текстовый фильтр консервативный: проверяет известные признаки, цифровые номера и формулировки, но не является доказательством достоверности любого произвольного текста. Возможен лишний fallback для сложной безопасной фразы.
- Frontend отображает остановку только при реальном API-ответе с ненулевым полем; в mock-файлах остановок нет.

## Отображение во frontend после проверки пользователем

Первоначально API отдавал поле nearest_transit_stop, но js/api.js отбрасывал его при разборе ответа, поэтому карточки не показывали остановки. Теперь js/api.js проверяет и сохраняет поле; js/render.js и js/main.js показывают остановку в карточке и деталях. Для bus/lrt/tram есть подписи RU/KK/EN. При name=null интерфейс показывает тип остановки, а route_refs показываются только если тег есть. При null блок скрыт.

Три новых frontend-теста сначала упали на прежнем коде, затем итоговый прогон: 29 passed, 0 failed. Локальный backend запущен на 127.0.0.1:8001, frontend — на 127.0.0.1:5173; оба ответили успешно. Повторный реальный POST к работающему API вернул три кафе с остановками (239,6 м; 179,1 м; 189,0 м). Сервер frontend отдаёт обновлённые js/api.js и js/render.js. В mock-режиме остановки отсутствуют в фикстурах; для просмотра нужен обычный адрес без ?mock=1.

## Время и Git

Backend-часть от проверки Overpass до первого отчёта заняла примерно 12 минут; вывод во frontend добавлен после замечания пользователя. Работа выполнена в main без git commit и git push. Предшествующие незакоммиченные изменения мультиязычного поиска сохранены. Существующие README, .env и ключ не менялись. Полный git status и git diff --stat приведены ниже; они включают и изменения предыдущей задачи.

```text
$ git status --short
 M backend/.env.example
 M backend/config.py
 M backend/database/db.py
 M backend/database/models.py
 M backend/routes/recommendations.py
 M backend/schemas.py
 M backend/services/gemini.py
 M backend/services/geo_search.py
 M backend/services/rag.py
 M backend/tests/test_api_rag.py
 M backend/tests/test_geo_search.py
 M backend/tests/test_rag.py
 M docs/api-contract.md
 M docs/limitations.md
 M js/api.js
 M js/i18n.js
 M js/main.js
 M js/render.js
 M tests/frontend-contract.test.cjs
?? backend/scripts/collect_transit.py
?? backend/services/query_intent.py
?? backend/services/transit.py
?? backend/services/transit_collector.py
?? backend/tests/test_query_intent.py
?? backend/tests/test_transit_api.py
?? backend/tests/test_transit_collector.py
?? docs/query-intent-validation.md
?? docs/transit-data-audit.json
?? docs/transit-demo-results.json
?? docs/transit-results.md

$ git diff --stat
 backend/.env.example              |  1 +
 backend/config.py                 |  3 ++-
 backend/database/db.py            | 30 ++++++++++++++++++++++++-
 backend/database/models.py        | 13 +++++++++++
 backend/routes/recommendations.py |  2 ++
 backend/schemas.py                |  8 +++++++
 backend/services/gemini.py        | 19 +++++++++++++++-
 backend/services/geo_search.py    | 34 ++++++++--------------------
 backend/services/rag.py           | 10 +++++++--
 backend/tests/test_api_rag.py     | 18 ++++++++-------
 backend/tests/test_geo_search.py  |  5 +++--
 backend/tests/test_rag.py         | 12 ++++------
 docs/api-contract.md              | 47 ++++++++++++++++++++++++++++++++++-----
 docs/limitations.md               | 10 +++++++--
 js/api.js                         | 12 ++++++++++
 js/i18n.js                        |  6 +++++
 js/main.js                        |  1 +
 js/render.js                      | 14 ++++++++++++
 tests/frontend-contract.test.cjs  | 41 ++++++++++++++++++++++++++++++++++
 19 files changed, 230 insertions(+), 56 deletions(-)
```

git diff --stat не включает новые untracked-файлы, перечисленные со знаком ??. Index пуст; commit и push не выполнялись.
