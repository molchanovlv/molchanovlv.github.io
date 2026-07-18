---
layout: post
title: "Драйвер MQTT с поддержкой версии 5"
date: 2026-07-06 12:00:00 +0300
categories: AggreGate
author: Молчанов Л.
description: "Ниже — только отличия новой реализации от штатного драйвера MQTT в AggreGate. Базовая модель (подписка на топики, событие `message`, функция `publishTextMessage`, учётные данные, QoS) сохранена."
image: /assets/images/posts/drayver-mqtt-5-s-podderzhkoy-versii-5/cover.jpg
---

## Протокол



- Клиент переведён на MQTT 5.0 (HiveMQ MQTT Client 1.3.5).
- Параметр `cleanSession` заменён на `cleanStart` и `sessionExpiryInterval` — управление сессией по спецификации MQTT 5
- В CONNECT добавлены `requestResponseInfo`, `requestProblemInfo`, `receiveMaximum` — согласование ограничений и диагностика на уровне протокола.

## User Properties

Поддержка пользовательских свойств MQTT 5:

- `connectUserProperties` — свойства пакета CONNECT;
- `userProperties` — параметр функций `publishTextMessage` и `publishDataMessage`.

## Поддерживаемые версии

Требуется AggreGate 6.3x.x

