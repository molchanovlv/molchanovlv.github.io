---
layout: post
title: "Альтернативный драйвер SQL Database для AggreGate: пул соединений, batch-записи и упрощённая архитектура"
date: 2026-07-06 12:00:00 +0300
categories: AggreGate
author: Молчанов Л.
description: "Недавно этот драйвер прошёл существенный рефакторинг. Ниже — обзор того, что изменилось и зачем это сделано."
image: /assets/images/posts/alternativny-drayver-sql-database/cover.jpg
---

## Главные изменения в новой версии

### 1. c3p0 заменён на HikariCP

Раньше пул соединений строился на c3p0. Теперь используется HikariCP — более современная и компактная библиотека, которую активно применяют в Java-экосистеме.


| Параметр | Назначение |  |
| --- | --- | --- |
| `minimumIdle` | Минимум простаивающих соединений |  |
| `maximumPoolSize` | Максимум соединений в пуле |  |
| `idleTimeout` | Таймаут простоя неиспользуемого соединения |  |
| `keepaliveTime` | Интервал keepalive для поддержания соединений |  |
| `maxLifetime` | Максимальное время жизни соединения |  |
| `connectionTimeout` | Ожидание свободного соединения из пула |  |

### 2. Удалён Storage API

В прежней версии драйвер экспонировал полный набор функций Storage API — `storageOpen`, `storageGet`, `storageUpdate`, `storageInsert`, `storageDelete`, `storageTables`, `storageColumns` и другие. Через них AggreGate SQL Views и storage-клиенты работали с таблицами БД «как с хранилищем».


В новой версии этот слой полностью убран. Осталась одна функция — `executeQuery`.


### 3. Batch-вставка и пакетное обновление через `executeQuery`

Новая возможность, которой не было в прежнем драйвере: пакетное выполнение модифицирующих запросов.

Пример логики:

```sql
callFunction("users.app.devices.database", "executeQuery"
	, "INSERT INTO events (device_id, value, ts) VALUES (?, ?, ?)"
	, true
	, table("<<device_id><I>><<value><I>><<ts><S>>"
		, 1, 1, "data1"
		, 2, 2, "data2"
		, 3, 3, "data3"
		, 4, 4, "data4"
	)
)
```

![](/assets/images/posts/alternativny-drayver-sql-database/affected_rows.png)

Для одной строки параметров выполняется обычный `executeUpdate`; для нескольких — batch. SELECT по-прежнему возвращает таблицу данных.

## Итог

- HikariCP вместо c3p0;
- batch через `executeQuery` ;
- удаление Storage API;

