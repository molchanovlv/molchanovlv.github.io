---
layout: post
title: "Делаем правильный REST API "
date: 2026-07-06 12:00:00 +0300
categories: AggreGate
author: Молчанов Л.
description: "Разработка полноценного (нет) REST API."
image: /assets/images/posts/alternativny-drayver-sql-database/cover.jpg
---

## Вступление

Для использования AggreGate в качестве источника данных обычно используется встроенный REST сервер.
Рассмотрим отличие классического REST от AggreGate

# REST API в AggreGate: Отличия от классического REST



## 1. **Структура URL и Resource-модель**

### Классический REST:
- Ресурсы обычно соответствуют бизнес-сущностям (users, products, orders)
- URL строятся по принципу `/resource/{id}`

### AggreGate REST API:
- Ресурсы напрямую соответствуют **контекстам AggreGate**:
  - `/contexts/{contextPath}` — работа с контекстом
  - `/contexts/{contextPath}/variables/{variable}` — переменные
  - `/contexts/{contextPath}/functions/{function}` — функции
- Контексты имеют иерархическую структуру, это отражает внутреннюю модель данных платформы, а не просто бизнес-логику

## 2. **Гибридная модель работы с данными**

### Классический REST:
- GET — чтение, POST — создание, PUT — полное обновление, PATCH — частичное обновление, DELETE — удаление

### AggreGate REST API:
- **GET** — получение информации (контекста, переменных, событий, функций)
- **PUT** — полная замена переменной
- **PATCH** — частичное обновление записи с параметром `record`
- **POST** — только для аутентификации и вызова функций (не для создания)
- **Нет стандартных операций создания и удаления** через REST — они выполняются через вызовы функций

GET, PUT, PATCH работают только с переменными. Отсюда получается несколько недостатков:
 - нет возможности классически вызывать функции для получения, замены и обновления данных
 - доступ ко всем моделям по прямой ссылке (решается внедрением nginx как реверс прокси с ограниченной настройкой).

## 3. **Выполнение функций как основной паттерн**

### Классический REST:
- Операции обычно соответствуют CRUD
- Действия выполняются через POST на специализированные endpoints

### AggreGate REST API:
- Вызов функций — ключевой механизм:
  ```
  POST /contexts/{contextPath}/functions/{function}
  ```
- Функции могут выполнять любые операции (создание, удаление, управление)
- Это отражает архитектуру AggreGate, где **функции контекстов** — основной способ взаимодействия

## 4. **Структура данных**

### Классический REST:
- JSON-объекты с плоской или вложенной структурой
- Стандартные типы данных

### AggreGate REST API:
- Данные передаются так же в формате JSON, но корневой объект всегда должен быть массивом.
- Возможность валидации входящих данных.
- Нет возможности отдать просто готовый JSON, приходится формировать подобную таблицу, которая уже самостоятельно развернётся в JSON, либо оборачивать JSON в текстовую переменную.

## 5. **Особенности запросов**

### Классический REST:
- Пагинация через `limit` и `offset` для коллекций

### AggreGate REST API:
- GET пагинация поддерживается только для переменных (`limit`, `offset`)
- Поддержка CORS через настройку `Allowed Request Origins`

## Практические последствия

1. **Для интеграции** нужно понимать концепцию контекстов AggreGate
2. **Любое действие** может быть выполнено через вызов функции, а не только через REST-ресурсы

Отсюда делается вывод:

1. Невозможно работать с ресурсами по произвольным URL типа /api/v1/resource/id, для этого нужно настраивать промежуточный реверс-прокси
2. Вся работа сводится к вызову функций через POST, что нарушает стандартный REST подход.
3. При прямом доступе к REST без использования промежуточного реверс-прокси, становятся доступны все контексты пользователя, из под которого получен токен.
4. Отсутствует возможность самостоятельно формировать заголовки и коды ответов.
5. Нет универсального формата ответов.


Формат ответа полученного токена
200
```JSON
{
    "code": "A",
    "message": "OK",
    "token": "eyJhbGciOiJIUzI1NiJ9.eyJqdGkiOiI3YTA2NmYwNi02YTE1LTQ2NWQtYmEzNC1hMjBmMjQ3MjhlNGEiLCJzdWIiOiJhZG1pbiIsImF1ZCI6InJlZnJlc2giLCJpYXQiOjE3ODQzODczMjAsImV4cCI6MTc4NDQ3MzcyMH0.hp7nQM6lADJab8L1AZ10gigmxud6wK7RKcA8x84Uwiw"
}
```
Формат ответа неуспешной авторизации
401
```JSON
{
    "code": "E",
    "message": "Invalid username and/or password",
    "token": ""
}
```
Формат ответа при неправильном JSON
400
при этом нет никаких сообщений об ошибке, сообщения появляются в логе сервера

При ошибке вызова функции
400
```JSON
{
"timestamp": "2026-07-18T18:16:46.526",
"status": 400,
"error": "Bad Request",
"message": "Field 'locationId1' not found in data record",
"path": "/rest/v1/contexts/users.app.models.api/functions/stations"
}
```
При неуспешной валидации
400
```JSON
{
"timestamp": "2026-07-18T18:23:30.019",
"status": 400,
"error": "Bad Request",
"message": "Illegal value '10' for field 'locationId, Integer':Value too big (current: 10, max: 5)",
"path": "/rest/v1/contexts/users.app.models.test/functions/test"
}
```
Ошибки с кодом 400 нигде не отражаются в системе, кроме как в логах сервера (и то не все), поэтому нет возможности их хранить и обрабатывать.

К тому же при ошибке мы раскрываем внутренние пути и механизмы. Можно обернуть все вызовы в catch, но тогда любой запрос будет считаться успешным (200 ок), а формировать собственный заголовок мы не можем, т.к. нет такого механизма. Поэтому вся логика переезжает внутрь ответа. Такой подход является антипаттерном (хоть и имеет право на жизнь).

**Пример такой обертки (JSON):**

```json
{
  "status": "success",        // или "error"
  "code": 0,                  // внутренний код ошибки (0 = успех)
  "message": "OK",
  "data": {
    "userId": 123,
    "name": "Ivan"
  }
}
```

При ошибке:
```json
{
  "status": "error",
  "code": 4001,
  "message": "Недостаточно средств",
  "data": null
}
```

---

**Почему так делают:**
- Упрощается обработка на клиенте (не надо перехватывать разные HTTP-статусы).
- Легче передавать дополнительные метаданные об ошибке (валидация полей, локализация).

**Почему критикуют:**
- Нарушает семантику HTTP (коды 4xx/5xx созданы именно для ошибок).
- Ломает кеширование и работу прокси-серверов.
- Усложняет мониторинг (в логах все запросы выглядят успешными).


## Делаем правильный REST API

В AggreGate существует встроенный http сервер, позволяющий гибко манипулировать кодами ответов и содержимым, но у него есть недостаток - эндпоинты доступны всем без авторизации.

Чтобы прикрутить авторизацию у нас есть два пути:
1. Выдавать токен с помощью готового метода из REST API и самостоятельно при обращении к эндпоинту проверять наличие токена в шаголовке и его валидность.
2. Самостоятельно выдавать токены. В таком случае REST API можно вообще отключить.

В первом варианте полученный токен будет валиден для REST API и нашего API.

Во втором варианте полученный токен будет валиден только для нашего API.

Будем реализовывать вариант 2.

Выдавать токен мы будем только после удачной авторизации.

Для этого сначала напишем функцию, проверяющую логин и пароль при запросе. Принцим оставим такой же, как в REST API.

Проверять мы будем попыткой залогиниться в систему по предоставленным кредам. Если логин удачный, то получим true, если нет, то false.

Чтобы токены переставали действовать после перезагрузки сервера, как это сделано для REST API, можно в качестве secretKey использовать ключ из настройки плагина REST API.

Последовательность получения токена такая:
1. Фронт делает POST запрос на /api/auth с телом {"username":"name", "password":"pass"}
2. Бэк получает креды и делает попытку авторизации
2.1 Если креды верны, то идем в п.3
2.2 Если креды не верны, то бэк отдаёт 401
3. Бэк создаёт пару токенов (access и refresh) для пользователя "name"
4. Бэк отдаёт токены 200

Последовательность работы с данными такая:
1. Фронт в каждом запросе в заголовке добавляет Bearer access_token
2. Бэк из каждого запроса достаёт токен и проверяет на валидность (подпись, срок действия)
3. Если токен валидный, то бэк отдаёт данные 200
4. Если токен не валидный, то бэк отдаёт 401

Обновление токена

5. Фронт видит, что токен не валидный и идёт на /api/refresh с refresh токеном в заголовке
6. Бэк проверяет валидность refresh токена (подпись, срок действия, был ли уже использован, отозван или нет)
7. Если токен валидный, то отдаём новую пару access и refresh токенов
8. Если токен не валидный, то бэк отдаёт 401
8. Предыдущий refresh токен помечаем как использованный

Для хранения refresh токенов будем использовать историю переменной с максимальным сроком хранения, равным сроку жизни refresh токена. Для этого также нужно, чтобы в конфигурации сервера было включено сохранение истории.

Напишем функцию проверки кредов:

|Name|Input format|Output format|
|---|---|---|
|checkUser|username, password|result|

```java
import com.tibbo.aggregate.common.context.*;
import com.tibbo.aggregate.common.datatable.*;
import com.tibbo.aggregate.common.server.*;
import com.tibbo.linkserver.context.*;

public class %ScriptClassNamePattern% implements FunctionImplementation
{
  public DataTable execute(Context con, FunctionDefinition def, CallerController caller,
      RequestController request, DataTable parameters) throws ContextException
  {
    String username = parameters.rec().getString("username");
    String password = parameters.rec().getString("password");

    DataRecord rec = new DataRecord(CommonServerFormats.FIFT_LOGIN);
    rec.setValue(RootContextConstants.FIF_LOGIN_USERNAME, username);
    rec.setValue(RootContextConstants.FIF_LOGIN_PASSWORD, password);
    rec.setValue(RootContextConstants.FIF_LOGIN_COUNT_ATTEMPTS, false);

    DefaultCallerController loginCaller = new DefaultCallerController(new ServerCallerData());
    loginCaller.logout();

    DataTable output = new SimpleDataTable(def.getOutputFormat());
    try {
      con.getRoot().callFunction(RootContextConstants.F_LOGIN, loginCaller, rec.wrap());
      output.addRecord(true);
    } catch (ContextException e) {
      output.addRecord(false);
    }
    return output;
  }
}
```

Для начала разберёмся как же нам сгенерировать токен не прибегая к полноценной реализации этого механизма.

В AggreGate нет пользовательской функции выдачи токенов, однако реализация всё же спрятана где-то в коде. И это где-то - com.tibbo.aggregate.common.web.security.JwtTokenGenerator в котором есть все нужные нам методы.

Напишем функцию выдачи токена:

|Name|Input format|Output format|
|---|---|---|
|createToken|username, secretKey, accessTtlMs, refreshTtlMs|accessToken, refreshToken|
```java
import com.tibbo.aggregate.common.context.*;
import com.tibbo.aggregate.common.datatable.*;
import com.tibbo.aggregate.common.server.*;

import com.tibbo.aggregate.common.web.security.JwtTokenGenerator;

import java.util.UUID;

public class %ScriptClassNamePattern% implements FunctionImplementation
{
  public DataTable execute(Context con, FunctionDefinition def, CallerController caller,
      RequestController request, DataTable parameters) throws ContextException
  {
    String username = parameters.rec().getString("username");
    String secretKey = parameters.rec().getString("secretKey");
    long accessTtlMs = parameters.rec().getLong("accessToken").longValue();
    long refreshTtlMs = parameters.rec().getLong("refreshToken").longValue();

    JwtTokenGenerator generator = new JwtTokenGenerator(secretKey, accessTtlMs, refreshTtlMs);

    String accessToken = generator
        .generateAccessToken(username, UUID.randomUUID().toString(), null)
        .getData();
    String refreshToken = generator
        .generateRefreshToken(username, UUID.randomUUID().toString(), null)
        .getData();

    DataTable output = new SimpleDataTable(def.getOutputFormat());
    DataRecord row = output.addRecord();
    row.setValue("accessToken", accessToken);
    row.setValue("refreshToken", refreshToken);
    return output;
  }
}
```
Напишем функцию проверки токена:

|Name|Input format|Output format|
|---|---|---|
|checkToken|secretKey, token|valid, expired, username, tokenId, error|
```java
import com.tibbo.aggregate.common.context.*;
import com.tibbo.aggregate.common.datatable.*;
import com.tibbo.aggregate.common.server.*;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class %ScriptClassNamePattern% implements FunctionImplementation
{
  public DataTable execute(Context con, FunctionDefinition def, CallerController caller,
      RequestController request, DataTable parameters) throws ContextException
  {
    String secretKey = parameters.rec().getString("secretKey");
    String tokenStr = parameters.rec().getString("token");

    if (tokenStr != null) {
      String t = tokenStr.trim();
      if (t.length() >= 7 && t.regionMatches(true, 0, "Bearer ", 0, 7)) {
        tokenStr = t.substring(7).trim();
      }
    }

    DataTable output = new SimpleDataTable(def.getOutputFormat());
    DataRecord row = output.addRecord();

    try {
      String[] parts = tokenStr.split("\\.");
      if (parts.length != 3) {
        throw new IllegalArgumentException("Invalid JWT format");
      }

      String signed = parts[0] + "." + parts[1];

      javax.crypto.Mac mac = javax.crypto.Mac.getInstance("HmacSHA256");
      mac.init(new javax.crypto.spec.SecretKeySpec(
          secretKey.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
      byte[] hash = mac.doFinal(signed.getBytes(StandardCharsets.UTF_8));
      String computed = Base64.getUrlEncoder().withoutPadding().encodeToString(hash);

      if (!computed.equals(parts[2])) {
        throw new SecurityException("Invalid signature");
      }

      String payload = new String(base64UrlDecode(parts[1]), StandardCharsets.UTF_8);
      String username = jsonString(payload, "sub");
      String tokenId = jsonString(payload, "jti");
      long exp = jsonLong(payload, "exp");

      boolean expired = exp > 0 && exp * 1000L <= System.currentTimeMillis();

      row.setValue("valid", Boolean.valueOf(!expired));
      row.setValue("expired", Boolean.valueOf(expired));
      row.setValue("username", username);
      row.setValue("tokenId", tokenId);
      row.setValue("error", null);
    }
    catch (Exception e) {
      row.setValue("valid", Boolean.FALSE);
      row.setValue("expired", Boolean.TRUE);
      row.setValue("username", null);
      row.setValue("tokenId", null);
      row.setValue("error", e.getMessage());
    }

    return output;
  }

  private static byte[] base64UrlDecode(String s) {
    int mod = s.length() % 4;
    if (mod > 0) {
      s = s + "====".substring(mod);
    }
    return Base64.getUrlDecoder().decode(s);
  }

  private static String jsonString(String json, String field) {
    Matcher m = Pattern.compile("\"" + field + "\"\\s*:\\s*\"([^\"]+)\"").matcher(json);
    return m.find() ? m.group(1) : null;
  }

  private static long jsonLong(String json, String field) {
    Matcher m = Pattern.compile("\"" + field + "\"\\s*:\\s*(\\d+)").matcher(json);
    return m.find() ? Long.parseLong(m.group(1)) : 0L;
  }
}
```

Основные функции готовы, теперь нужно написать правила.

Создаём модель apiRouter. Модель будет заниматься роутингом вызовов исходя из URI.

Используем принцип разработки, описанный в статье ххх.

Напишем функции:

|Name|Input format|Output format|Expression|
|---|---|---|---|
|apiRouter|||callFunction(dc(), "rsApiRouter", dt())|

rsApiRouter

|Target|Expression|Condition|Comment|
|---|---|---|---|
|data|dt()|||
|uriTable|split(replace(cell(dt(), "requestURI"), "/hd/api/", ""), "/")|||
|uri|lower(cell({env/uriTable}))||
|authModel|"users.admin.models.auth"|||
|Final Rule Set Result|callFunction({env/authModel}, "getToken", dt())|{env/uri} == "auth"|
|Final Rule Set Result|callFunction({env/authModel}, "refreshToken", dt())|{env/uri} == "refresh"|
|isValid|cell(callFunction({env/authModel}, "checkAuth", dt()))||
|Final Rule Set Result|set(<br>&emsp;set(<br>&emsp;&emsp;set(dt(), "responseStatus", 0, 401)<br>&emsp;&emsp;, "responseContentType", 0, "application/json"<br>&emsp;)<br>&emsp;, "responseBody", 0, '{"result":"token is not valid"}'<br>)|||
|Final Rule Set Result|set(<br>&emsp;callFunction("users.admin.models.api", {env/uri}, dt())<br>&emsp;, "responseContentType", 0, "application/json"<br>)|functionAvailable("users.admin.models.api", {env/uri})||
|Final Rule Set Result|set(<br>&emsp;set(<br>&emsp;&emsp;set(dt(), "responseStatus", 0, 404)<br>&emsp;&emsp;, "responseContentType", 0, "application/json"<br>&emsp;)<br>&emsp;, "responseBody", 0, ""<br>)|||

Создаём модель api. Модель будет содержать в себе точки вызова всех апи функций, кроме функций работы с токенами.

|Name|Input format|Output format|Expression|
|---|---|---|---|
|location|||callFunction(dc(), "rsLocation", dt())|

rsLocation

|Target|Expression|Condition|Comment|
|---|---|---|---|
|Final Rule Set Result|callFunction("users.admin.models.location", "location", dt())|||

```mermaid
flowchart LR
    http --> apiRouter 
    subgraph api
        function1
        function2
        function3
        functionN
    end
    apiRouter <--> auth
    apiRouter --> function1 --> model1
    apiRouter --> function2 --> model1
    apiRouter --> function3 --> model2
    apiRouter --> functionN --> modelN
```

rateLimiter