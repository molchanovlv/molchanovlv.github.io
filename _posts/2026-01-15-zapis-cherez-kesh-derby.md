---
layout: post
title: "Как сохранять данные во внешнюю БД без потерь"
date: 2026-06-01 12:00:00 +0300
categories: AggreGate
author: Молчанов Л.
description: "Надёжная схема буферизации данных через Apache Derby в AggreGate с пакетной записью в PostgreSQL."
image: /assets/images/posts/zapis-cherez-kesh-derby/cover.jpg
---

Когда вы собираете данные в AggreGate, рано или поздно встаёт вопрос: как надёжно сохранить их во внешней базе данных, например, в PostgreSQL. Прямая запись в PostgreSQL — это точка отказа. База может уйти на обслуживание, перезагрузиться, или просто «лечь» на пару минут. В этот момент вы рискуете потерять важные данные.

Давайте разберёмся, как построить надёжную схему, которая гарантирует сохранность каждого сообщения, даже если внешняя БД временно недоступна.

## С чем мы имеем дело и что не подходит

Казалось бы, можно использовать:

- Внешнюю Cassandra — но она тоже может быть недоступна на время обслуживания. Не вариант.
- Встроенную Cassandra (которая идёт с AggreGate) — но у неё нет механизма compact, и хранилище будет бесконтрольно разрастаться.

К тому же, работать с встроенной Cassandra как с буфером неудобно: variableHistory — медленная; нет возможности пометить запись как «обработанную»; нельзя нормально удалить запись. Механизмы вроде fireEvent, update, delete, get работают, но события нагружают процессор. Получить события по условию можно, но ценой выгрузки всего диапазона по времени с последующей фильтрацией в памяти.

В общем, Cassandra для этой задачи — не лучший выбор.

## Идея: Apache Derby как промежуточный буфер

Вместо того чтобы бороться с Cassandra, мы можем использовать встроенную Apache Derby. Она часть AggreGate, всегда под рукой и доступна, пока работает сам сервер. Никаких внешних зависимостей.

Рассмотрим пример с сохранением сообщений с MQTT устройства.

Суть простая:

1. Все сообщения с MQTT пишутся в Derby.
2. По расписанию (например, каждые 5 секунд) мы забираем из Derby новые сообщения и пачками вставляем их в PostgreSQL.
3. Если PostgreSQL недоступна — ничего страшного, сообщения остаются в Derby. Как только БД восстановится, данные будут доставлены.

- Данные не теряются при отключении PostgreSQL.
- Вставка в основную БД идёт пачками, что сильно облегчает ей жизнь.
- Derby всегда работает, потому что она встроена в AggreGate.

## Шаг 1: Создаём устройство для работы с Derby

Первым делом добавим в AggreGate устройство, которое будет работать с Apache Derby как с обычной SQL-базой. Идём в Devices, добавляем новое устройство, выбираем драйвер SQL Database.

Заполняем параметры подключения:

- Database URL: jdbc:derby:buffer;create=true
- Driver Class: org.apache.derby.jdbc.EmbeddedDriver

Остальное оставляем по умолчанию: логин и пароль пустые. При сохранении AggreGate сам создаст базу с именем buffer.

![Создание устройства для работы с Derby](/assets/images/posts/zapis-cherez-kesh-derby/derby_settings.jpg)

*Создание устройства для работы с Derby*

## Шаг 2: Создаём таблицу в Derby

Теперь создадим таблицу, где будем хранить сообщения до отправки в PostgreSQL. Выполнить запрос можно через контекстное меню созданного устройства — действие Execute Query.

```sql
CREATE TABLE buffer (
    id BIGINT NOT NULL GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    topic VARCHAR(255),
    message CLOB,
    is_saved BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
```

Поле created_at — для диагностики, чтобы видеть, когда сообщение попало в буфер. Флаг is_saved: FALSE — ещё не отправлено в PostgreSQL, TRUE — уже отправлено. Индексы создавать не будем, т.к. много данных в буфер не успеет накопиться, да и отстутвие индекса ускорит вставку.

## Шаг 3: Готовим таблицу в PostgreSQL

Параллельно создадим таблицу в основной БД, куда будем складывать данные на постоянное хранение.

```sql
CREATE TABLE mqtt_data (
    id BIGINT NOT NULL GENERATED ALWAYS AS IDENTITY,
    message_id BIGINT NOT NULL,
    topic TEXT,
    message TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT mqtt_data_pkey PRIMARY KEY (id),
    CONSTRAINT uq_message_id UNIQUE (message_id)
)
```

Обратите внимание на message_id и ограничение уникальности (UNIQUE). Если по какой-то причине мы не обновили флаг is_saved в буфере и попытаемся вставить те же данные повторно, уникальность предотвратит дубли.

## Шаг 4: Пишем логику записи в буфер (модель)

Создаём модель bufferProcessor, которая будет принимать сообщения из MQTT и складывать их в Derby.

### 4.1 Привязка на событие MQTT

В модели идём во вкладку Bindings и добавляем новый биндинг: Activator — событие MQTT-устройства, например users.admin.devices.mqttDevice:message@; Expression — callFunction(dc(), "rsSaveToBuffer", {env/value}).

### 4.2 Правило rsSaveToBuffer

Во вкладке Rule Sets создаём набор правил rsSaveToBuffer:

| Target | Expression | Condition |
| --- | --- | --- |
| topic | cell({0}, "topic") |  |
| message | cell(cell({0}, "message"), "textMessage") |  |
| Final Rule Set Result | callFunction("users.admin.devices.buffer", "executeQuery", <br>	"INSERT INTO buffer (topic, message) VALUES (?, ?)"<br>	, true<br>	, table("&lt;&lt;topic&gt;&lt;S&gt;&gt;&lt;&lt;message&gt;&lt;S&gt;&gt;", {env/topic}, {env/message})<br>) |  |

Из данных события извлекаем topic и текст сообщения, затем вызываем executeQuery у Derby-устройства для вставки записи с флагом is_saved = FALSE.

## Шаг 5: Перенос данных в PostgreSQL

Периодически (каждые 5 секунд) выгружаем данные из Derby в основную БД. Вставка идёт пачками — это сильно разгружает PostgreSQL. В AggreGate нет нативного способа делать batch insert. Рассмотрим, какие возможности у нас есть.

### Вариант 1: Java-скрипт

В Java есть JDBC Batch API, который позволяет отправить все записи одной транзакцией.

```java
PreparedStatement ps = connection.prepareStatement(
    "INSERT INTO mqtt_data (topic, message) VALUES (?, ?)");
for (DataRecord record : dataTable) {
    ps.setString(1, record.getString("topic"));
    ps.setString(2, record.getString("message"));
    ps.addBatch();
}
ps.executeBatch();
```

Плюсы: производительность. Минусы: нужно писать Java-скрипт, каждый вызов скрипта это новое соединение к БД

### Вариант 2: JSON (самый быстрый)

Используем функцию PostgreSQL jsonb_to_recordset.

```sql
INSERT INTO mqtt_data(topic, message)
SELECT topic, message
FROM jsonb_to_recordset(?::jsonb) AS t(topic TEXT, message TEXT)
```

Плюсы: всё в одном запросе, без скриптов; нет проблем с длиной запроса. Минусы: чуть больше нагрузки на базу (парсинг JSON), но для большинства сценариев это незаметно.

### Вариант 3: Конкатенация VALUES (не рекомендую)

Сбор одного огромного запроса INSERT INTO ... VALUES (...), (...), (...); это анти-паттерн: проблемы с памятью, экранированием, ограничениями длины запроса и отладкой. Никогда не используйте такой подход.

> Мы выбираем вариант 2 — с JSON.

### Алгоритм работы

1. Забираем из Derby все записи с is_saved = FALSE.
2. Превращаем результат в JSON.
3. Вставляем JSON в PostgreSQL через jsonb_to_recordset.
4. Обновляем в Derby флаг is_saved = TRUE для успешно отправленных записей.
5. Раз в минуту удаляем из Derby записи с is_saved = TRUE, чтобы буфер не разрастался. Можно сразу удалять записи после успешной вставки, но я предпочитаю подход - одна функция - одно действие.

## Шаг 6: Реализуем правила в модели

### 6.1 Биндинг на периодический вызов

Добавляем биндинг с Periodically: true, Period: 5000 мс, Expression: callFunction(dc(), "rsSaveToDB").

Добавляем биндинг с Periodically: true, Period: 60000 мс, Expression: callFunction(dc(), "rsDeleteFromBuffer").

### 6.2 Правило rsSaveToDB

| Target | Expression | Condition |
| --- | --- | --- |
| bufferedData | callFunction("users.admin.devices.buffer", "executeQuery", <br>	"SELECT id, topic, message FROM buffer WHERE is_saved = FALSE"<br>	, false<br>) |  |
| jsonData | tableToJSON({env/bufferedData}) |  |
| savedData | catch(<br>	callFunction("users.admin.devices.postgres", <br>		"INSERT INTO mqtt_data(topic, message)" +<br>		"SELECT topic, message " +<br>		"FROM jsonb_to_recordset(?::jsonb) AS x(topic TEXT, value TEXT) " +<br>		"ON CONFLICT (message_id) DO NOTHING"<br>	, table("&lt;&lt;jsonData&gt;&lt;S&gt;&gt;", {env/jsonData})<br>	)<br>	, null<br>) |  |
| Final Rule Set Result |  |  |

Если вставка в PostgreSQL упала с ошибкой, выходим из правила и не трогаем буфер — данные останутся в Derby до следующей попытки. При успехе обновляем is_saved = TRUE для отправленных записей.

### 6.3 Периодическая очистка буфера (правило rsDeleteFromBuffer)

Раз в минуту вызываем rsDeleteFromBuffer — правило удаляет записи с is_saved = TRUE.

| Target | Expression | Condition |
| --- | --- | --- |
| updateBuffer | callFunction("users.admin.devices.buffer",\n\t"DELETE FROM buffer " +\n\t"WHERE is_saved = TRUE"\n\t, true\n) |  |

## Итог

- Все сообщения с MQTT сначала пишутся во встроенную Derby — быстро, надёжно и без внешних зависимостей.
- По расписанию данные пачками переносятся в PostgreSQL через JSON.
- Если PostgreSQL недоступна — сообщения остаются в буфере и никуда не пропадают.
- Буфер периодически чистится, чтобы не разрастаться.

Всё реализовано на стандартных инструментах AggreGate: SQL Database, модель, выражения и правила. Никаких внешних скриптов, никакой лишней сложности. И данные под защитой.
