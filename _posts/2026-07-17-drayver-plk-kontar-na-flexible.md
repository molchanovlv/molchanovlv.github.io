---
layout: post
title: "Драйвер ПЛК Контар на flexible"
date: 2026-07-17 12:00:00 +0300
categories: AggreGate
author: Молчанов Л.
description: "Пример разработки драйвера на flexible."
image: /assets/images/posts/drayver-plk-kontar-na-flexible/cover.jpg
---

# Вступление

В этой статье мы создадим драйвер для ПЛК Контар MC8 Московского Завода Тепловой автоматики на базе flexible драйвера с использованием динамических переменных.


Контроллеры МС8 и МС12 входят в состав программно-аппаратного комплекса КОНТАР и предназначены для автоматического управления и контроля разнообразных технологических процессов:

- на объектах ЖКХ;
- в системах HVAC (отопление, вентиляция и кондиционирование) ресторанов, офисных зданий, спортивных сооружений, образовательных и медицинских центров;
- в установках для производства стройматериалов, пищевой промышленности и т.п.;
- в системах с питанием от автономных источников (аккумуляторов), например, рефрижераторы, объекты водораспределения.

Контроллеры позволяют осуществлять сбор информации от любых источников (датчики температуры, давления, расхода, тепло-, водо-, электросчетчики и т.п.) и передавать ее на верхний уровень с использованием различных каналов связи, в том числе по интернету. Контроллеры могут использоваться автономно или быть включенными в сеть приборов КОНТАР в составе распределенной системы управления.

В нашем случаем Контар используется в качестве ПАЗ на объектах АЗС.

Контар МС8 (далее просто Контар) может общаться через интерфейсы - RS-232 и Ethernet. Через Ethernet с использованием модуля ModBus или по собственному протоколу.

Мы будем создавать драйвер для собственного протокола.

На сайте mzta.ru находим описание протокола и приступаем к изучению (полный документ можно прочитать [здесь](https://www.mzta.ru/images/304/kontar-tcp-final5.pdf)).

## Обмен данными
Обмен данными между сервером и контроллером происходит по схеме «запрос-ответ». Сервер является ведущим, т.е. он посылает запросы, а контроллер ведомым, т.е. отвечает. Обращение к контроллеру производится по сетевому номеру в данной сети контроллеров. Т.к. сетевой номер занимает 1 байт, то 3 старших байта в поле адреса должны быть нулями.

Шифрование данных
Для обеспечения защиты от несанкционированного доступа к информации, команды и данные передаваемые между сервером и контроллером, шифруются 64-битным ключом при помощи алгоритма RC5. Роль ключа играет 8-символьная текстовая
строка. Она является паролем доступа к контроллеру и по умолчанию имеет значение «12345678».

## Структура команды

| Заголовок| Код команды | Аргументы | Данные |
|---|---|---|---|
|(17 байт)|(1 байт)|(от 1 до 6 байт)|(от 0 до 4 байт)|


## Заголовок пакета

| Смещение | Размер | Описание | Примечание |
|----------|--------|----------|------------|
|0|4|IP-адрес сервера|
|4|8|Пароль|Текстовая строка, по умолчанию «12345678»|
|12|1|Не используется|
|13|4|Сетевой номер контроллера|Старшие 3 байта равны 0|

Заголовок является общим для всех типов команд.

## Считать память

| Смещение | Размер | Описание | Примечание |
|----------|--------|----------|------------|
| 0 | 1 | Код команды = 67h||
| 1 | 1 | Тип памяти = 4 (PARAMETER)||
| 2 | 1 | Нулевое значение||
| 3 | 2 | Адрес|Представлен в порядке от старшего к младшему|
| 5 | 2 | Размер|Представлен в порядке от старшего к младшему|

## Записать значение параметра в контроллер

|Смещение|Размер|Описание|Примечание|
|---|---|---|---|
|0|1|Код команды = 54h||
|1|1|Тип данных = 7 (PARAMETER)||
|2|1|Нулевое значение||
|3|2|Адрес|Представлен в порядке от старшего к младшему|
|5|2|Длина|Для параметров типа:<br>FLOAT = 4<br>INT, DATE, TIME = 2<br>BOOL = 1|
|7|N|Данные|


## Ответы TCP

| Смещение | Размер | Описание | Примечание |
|----------|--------|----------|------------|
|0|4|Серийный номер мастер-контроллера|Передаются в незашифрованном виде|
|4|1|Код ответа:<br>A0h - Выполнено<br>E0h - Ошибка<br>E1h – Неизвестная команда <br>E2h – Неверный формат команды<br>E5h – Ошибка чтения из ведомого контроллера<br>E6h – Идет процесс обновления состава сети<br>C0h - Пароль (зашифрован Мастер-ключом)<br>D0h – Данные (зашифрованы паролем доступа)||
|5|N|Данные|Передаются в зашифрованном виде|

Мы будем реализовывать только две команды - чтение данных и запись данных.<br>
Список параметров ПЛК мы получим через программу Контар-Консоль, чтобы не реализовывать ещё и этот момент.

Для начала просто попробуем подключиться к ПЛК.<br>
Создаём устройство flexible, выбираем исходящее соединение, протокол TCP, вводим адрес и порт 26482.

![Создаём устройство flexible](/assets/images/posts/drayver-plk-kontar-na-flexible/1.jpg)

Сохранем и видим, что устройство находится в статусе:<br>
Not synchronized, synchronizing, or no settings available

Подключение есть, теперь начинаем реализацию протокола.<br>
Вводим в поле
Input Stream Splitter Expression<br>
length({env/command})

Input Stream Splitter Mode<br>
Attempt to split in the end of block

Encode Expression<br>
{env/command}

Decode Expression<br>
{env/command}

Encoding<br>
ISO-8859-1

![Создаём устройство flexible](/assets/images/posts/drayver-plk-kontar-na-flexible/2.jpg)

Таким образом мы настраиваем разбивать входящие данные по блокам.

Во вкладке Operations настраиваем:

Asynchronous Command Detector Expression<br>
False - означает, что мы не будем ожидать асинхронные сообщения (те, которые мы не запрашивали)

Event/Variable Update Qualifier Expression<br>
1 - означает, что приходящие данные будут интерпретироваться как переменная, а не как событие

Command ID Expression<br>
"1234" - метка, которая присваивается исходящему сообщению

Reply ID Expression<br>
"1234" - метка, которая ожидается в ответ на исходящее сообщение

![Создаём устройство flexible](/assets/images/posts/drayver-plk-kontar-na-flexible/3.jpg)

После установления соединения сервер должен получить серийный номер мастер-контроллера, который в дальнейшем будет служить идентификатором сети контроллеров. Для этого нужно послать контроллеру нулевой байт. На него контроллер ответит 4-байтным пакетом, представляющим собой его уникальный серийный номер.

Для отправки команды получения серийного номера не нужно реализовывать структуру команды и шифрование/дешифрование, достаточно просто послать нулевой байт. Но для расшифровки ответа нужно написать обработчик.

Создадим статическую переменную netid<br>
Group: remote

Read Request Expression<br>
"\u0000"

Read Result Processing Expression
```table("<<value><S>>", {env/command})```
выражение должно возвращать данные в формате переменной, если оставить только {env/command}, то ничего в переменную записано не будет

![Создаём устройство flexible](/assets/images/posts/drayver-plk-kontar-na-flexible/4.jpg)

Получаем номер сети в нечитаемом виде. Теперь нам нужно его преобразовать в читаемый вид.

![Получаем номер сети](/assets/images/posts/drayver-plk-kontar-na-flexible/5.jpg)

Воспользуемся программой Wireshark и посмотрим ответ от ПЛК<br>
b3 69 00 50 c0 80 40 03

Расшифруем ответ:<br>
b3 69 00 50 - серийный номер мастер контроллера<br>
c0 - Пароль (зашифрован Мастер-ключом)<br>
80 40 03 - зашифрованные данные

Создаём Relative модель kontarHelper, в которой будем писать обработку.<br>
{.:#type} == "device.flexible"

![Создаём Relative модель kontarHelper](/assets/images/posts/drayver-plk-kontar-na-flexible/6.jpg)

Создаём правило decodeRule с обработчиком ошибок.

![Создаём правило decodeRule](/assets/images/posts/drayver-plk-kontar-na-flexible/7.jpg)

Условие substring({env/command}, 4, 5) == "\u00C0" говорит нам о том, что ответ мы получаем на команду "\u0000", а значит расшифровывать будем только первые 4 байта.

Переводим ответ в HEX:
```
cell(
  callFunction(dc(), "byteArrayToHex"
      , substring({env/command}, 0, 4)
  )
)
```

Для этого нужно написать функцию byteArrayToHex:
```java
import com.tibbo.aggregate.common.context.*;
import com.tibbo.aggregate.common.datatable.*;
import com.tibbo.aggregate.common.server.*;

import com.tibbo.linkserver.*;
import com.tibbo.linkserver.context.*;
import java.nio.charset.StandardCharsets;

public class %ScriptClassNamePattern% implements FunctionImplementation
{ 

  private static final char[] HEX_ARRAY = "0123456789ABCDEF".toCharArray();

 public DataTable execute(Context con, FunctionDefinition def, CallerController caller, RequestController request, DataTable parameters) throws ContextException {
        String arg = parameters.rec().getString("value");
        byte[] bytes = null;
        try {
             bytes = arg.getBytes(StandardCharsets.ISO_8859_1);
        } catch(Exception e){
        
        }
        String result = bytesToHex(bytes);
    return new DataRecord(def.getOutputFormat()).addString(result).wrap();
}  
  public static String bytesToHex(byte[] bytes) {
      char[] hexChars = new char[bytes.length * 2];
      for (int j = 0; j < bytes.length; j++) {
          int v = bytes[j] & 0xFF;
          hexChars[j * 2] = HEX_ARRAY[v >>> 4];
          hexChars[j * 2 + 1] = HEX_ARRAY[v & 0x0F];
      }
      return new String(hexChars);
  }
}
```
Это более производительный вариант, чем использование String.format.

Меняем в настройках flexible драйвера Decode Expression на<br>
```cell(callFunction(dc(), "decodeRule", {env/command}))```

Таким образом заворачиваем все ответы от ПЛК в правило decodeRule.<br>
Теперь в netid видим B3690050. Уже лучше, но это ещё не номер сети в явном виде. Нужно преобразовать HEX в DEC. На самом деле можно не делать двойных преобразований, а сразу приходящий массив байтов преобразовывать в нужный формат. Но так нагляднее и удобнее для отладки.

Пишем правило parseLongRule

![Пишем правило parseLongRule](/assets/images/posts/drayver-plk-kontar-na-flexible/8.jpg)

Меняем в flexible Read Result Processing Expression<br>
````callFunction(dc(), "parseLongRule", {env/command})````

Теперь номер сети мы видим как 3010003024. Это уже правильно.

Итого, получившийся пайплайн обработки таков:

Read Request Expression -> Encode Expression -> PLC -> Decode Expression -> decodeRule -> byteArrayToHex -> Read Result Processing Expression -> parseLongRule -> netid

Это было самое простое. Далее нам нужно научиться формировать команды на чтение и запись, шифровать их, отправлять, получать ответ, расшифровывать, декодировать и отображать в драйвере.

Как было сказано выше, мы не будем реализовывать чтение памяти ПЛК для получения списка всех тэгов. Вместо этого мы выгрузим тэги из ПЛК с помошью программы Контар-Консоль и будем пользоваться этим списком для построения набора переменных. Переменные будут настраиваться динамически.

Выгрузим тэги. Получаем файл в формате csv (пример нескольких строк):

1_Температура процессора @ADC,KONTAR (Ethernet),XRAM_FLOT,1#0025<br>
1_Заземление АЦ@Параметры,KONTAR (Ethernet),XRAM_BOOL,1#0C1C<br>
1_Аварийная кнопка@Параметры,KONTAR (Ethernet),XRAM_BOOL,1#0C1D<br>
1_Авария@Параметры,KONTAR (Ethernet),XRAM_BOOL,1#0C1E<br>
1_Время хода очис.задв.@Пульт,KONTAR (Ethernet),XRAM,1#017F<br>

Что мы видим:<br>
Имя тэга@группа тэга, тип ПЛК, тип переменной, адрес ПЛК#адрес переменной

Имя тэга это наше имя переменной, но переменная не может называться по-русски. Здесь есть два варианта:
1. Вручную скорректировать имена на английские
2. Автоматически транслитерировать имена на английский язык

Мы будем использовать второй вариант, хотя в продакшене при наличии десятков ПЛК одинаковые тэги обычно называются по-разному, т.к. прошивки писали разные люди в разное время, поэтому приходится довольно много времени потратить на ручную унификацию наименований.

Начнём с магии динамических переменных, обработку запросов/ответов напишем позже.<br>
Нам нужно сделать функцию, которая бы по списку тэгов правильно сформировала таблицу переменных по формату Static Variables.

Создадим переменные config и password в модели kontarHelper<br>
В config загрузим конфигурацию ПЛК, а в password пароль ПЛК (обычно 12345678)

Добавим в Variable Defenition Expression вызов правила<br>
```callFunction(dc(), "makeVarsRule")```

Заполним Dynamic Variables следующими параметрами:

![Заполним Dynamic Variables](/assets/images/posts/drayver-plk-kontar-na-flexible/9.jpg)

{env/command} здесь это результат работы правила makeVarsRule
Такая странная обработка (decode) обусловлена тем, что результатом makeVarsRule должна получиться строка, поэтому таблицу приходится кодировать в строку, а потом декодировать опять в таблицу.

Теперь самое главное - создадим правило makeVarsRule

![Создадим правило makeVarsRule](/assets/images/posts/drayver-plk-kontar-na-flexible/10.jpg)
```
aggregate(
	tableFromCSV({.:config$value}, "none", "," , "<<name><S>><<device><S>><<type><S>><<address><S>>"),
		'union({env/previous}, ' +
		'  table("<<var><S>>", ' +
		'    encode(' +
		'     table("<<name><S>><<description><S><F=N>><<format><S>><<readable><B>><<writable><B>>' +
		       '<<help><S><F=N>><<group><S><F=N><A=remote>><<readRequestExpression><S>>' +
		       '<<readResultProcessingExpression><S>><<writeRequestExpression><S>><<writeResultProcessingExpression><S>>", ' +
		'      cell(callFunction(dc(), "translitRule", trim(cell(split({name}, "@"), 0, 0)))) + ' +
		'      "_" + replace({address}, "#", "_"), ' + //создаём имя переменной
		'      trim(cell(split({name}, "@"), 0, 0)), ' + //создаём описание переменной
		'      contains({type}, "FLOT") ? "<<value><E><F=N><D=Value>><M=1><X=1>" : ' +
		'      (contains({type}, "BOOL") ? "<<value><B><F=N><D=Value>><M=1><X=1>" : ' +
		'      "<<value><I><F=N><D=Value>><M=1><X=1>"), ' + //создаём формат переменной в зависимости от типа получаемых данных
		'      true, ' + //признак чтения
		'      (trim(cell(split({name}, "@"), 0, 1))=="Пульт" ? true : false), ' + //признак записи
		'      "", ' + //секция help
		'      "remote|" + trim(cell(split({name}, "@"), 0, 1)), ' + //создаём имя группы
		'      contains({type}, "FLOT") ? "cell(callFunction(dc(), \\"readFloat\\", " + cell(split({address}, "#"), 0, 0) + ' +
		'      ", " + integer(cell(split({address}, "#"), 0, 1), 16) + "))" : ' +
		'      (contains({type}, "BOOL") ? "cell(callFunction(dc(), \\"readBool\\", " + cell(split({address}, "#"), 0, 0) + ' +
		'      ", " + integer(cell(split({address}, "#"), 0, 1), 16) + "))" : ' +
		'      "cell(callFunction(dc(), \\"readInt\\", " + cell(split({address}, "#"), 0, 0) + ' +
		'      ", " + integer(cell(split({address}, "#"), 0, 1), 16) + "))"), ' +//создаём функцию чтения переменной в завис. от типа получаемых данных
		'      contains({type}, "FLOT") ? "callFunction(dc(), \\"parseFloatRule\\", {env/command})" : ' +
		'      (contains({type}, "BOOL") ? "callFunction(dc(), \\"parseBoolRule\\", {env/command})" : ' +
		'      "callFunction(dc(), \\"parseIntRule\\", {env/command})")' + //создаём функцию парсинга переменной в зависимости от типа получаемых данных
		'     , (trim(cell(split({name}, "@"), 0, 1))=="Пульт" && contains({type}, "BOOL")) ? ' +
		'      "cell(callFunction(dc(), \\"writeBool\\", " + cell(split({address}, "#"), 0, 0) + ' +
		'      ", " + integer(cell(split({address}, "#"), 0, 1), 16) + ", cell(dt())))":"")' +
		'))' +
		')'
	, table()
)
```

Правило получается довольно сложным на вид, давайте разберёмся.

Преобразовываем csv с конфигурацией в таблицу:<br>
```
tableFromCSV({.:config$value}, "none", "," , "<<name><S>><<device><S>><<type><S>><<address><S>>")
```

Формируем формат таблицы:<br>
```
table("<<name><S>><<description><S><F=N>><<format><S>><<readable><B>><<writable><B>><<help><S><F=N>><<group><S><F=N><A=remote>><<readRequestExpression><S>><<readResultProcessingExpression><S>><<writeRequestExpression><S>><<writeResultProcessingExpression><S>>")
```

и заполняем таблицу параметрами:

```
name

cell(callFunction(dc(), "translitRule", trim(cell(split({name}, "@"), 0, 0)))) + "_" + replace({address}, "#", "_")

преобразовывем имя вида "1_Заземление АЦ@Параметры" в "1_Zazemlenie_AC_1_0C1C"
```

```
description

trim(cell(split({name}, "@"), 0, 0))

преобразовывем имя вида "1_Заземление АЦ@Параметры" в описание "Параметры"
```

```
format

contains({type}, "FLOT") ? "<<value><E><F=N><D=Value>><M=1><X=1>" : (contains({type}, "BOOL") ? "<<value><B><F=N><D=Value>><M=1><X=1>" : "<<value><I><F=N><D=Value>><M=1><X=1>")

создаём формат переменной в зависимости от типа получаемых данных
```

```
readable

true - все переменные могут читаться
```

```
writable

(trim(cell(split({name}, "@"), 0, 1))=="Пульт" ? true : false)

если тэг из группы Пульт, то он доступен для записи
```

```
help

пусто, но можно заполнить своими данными
```

```
group

"remote|" + trim(cell(split({name}, "@"), 0, 1))

создаём имя группы, как параметр после @ в описании тэга
```

```
readRequestExpression

contains({type}, "FLOT") ? "cell(callFunction(dc(), \"readFloat\", " + cell(split({address}, "#"), 0, 0) + ", " + integer(cell(split({address}, "#"), 0, 1), 16) + "))" : (contains({type}, "BOOL") ? "cell(callFunction(dc(), \"readBool\", " + cell(split({address}, "#"), 0, 0) + ", " + integer(cell(split({address}, "#"), 0, 1), 16) + "))" : "cell(callFunction(dc(), \"readInt\", " + cell(split({address}, "#"), 0, 0) + ", " + integer(cell(split({address}, "#"), 0, 1), 16) + "))")

создаём функцию чтения переменной в завис. от типа получаемых данных
```

```
readResultProcessingExpression

contains({type}, "FLOT") ? "callFunction(dc(), \"parseFloatRule\", {env/command})" : (contains({type}, "BOOL") ? "callFunction(dc(), \"parseBoolRule\", {env/command})" : "callFunction(dc(), \"parseIntRule\", {env/command})")'

формируем функцию вызова обработки считанных данных в зависимости от типа данных
```

```
writeRequestExpression

(trim(cell(split({name}, "@"), 0, 1))=="Пульт" && contains({type}, "BOOL")) ? "cell(callFunction(dc(), \"writeBool\", " + cell(split({address}, "#"), 0, 0) + ", " + integer(cell(split({address}, "#"), 0, 1), 16) + ", cell(dt())))":"")

Если тэг из группы Пульт, то пишем функцию обработки
```

```
writeResultProcessingExpression

оставляем пустым
```

Если убрать функции encode и посмотреть на получающуюся таблицу, то мы должны увидеть примерно такое

![Пример таблицы](/assets/images/posts/drayver-plk-kontar-na-flexible/11.jpg)

Мы сделали динамические переменные с функциями вызова и обработки тэгов. Теперь нам нужно написать саму обработку.

Давайте посмотрим какие функции мы вызывем:

translitRule - функция преобразования русских букв в английские.

Давайте напишем её

![Функция translitRule](/assets/images/posts/drayver-plk-kontar-na-flexible/12.jpg)

Алгоритм будет простым - два массива с буквами, где одна позиция заменяет другую

readFloat<br>
```callFunction(dc(), "readXDATA67Rule", {netNum}, {memAddr}, 4)```

readBool<br>
```callFunction(dc(), "readXDATA67Rule", {netNum}, {memAddr}, 1)```

readInt<br>
```callFunction(dc(), "readXDATA67Rule", {netNum}, {memAddr}, 2)```

функции однотипные, поэтому сначала напишем общие вспомогательные функции:<br>
addHeaderRule - добавление заголовков к пакету данных

![addHeaderRule](/assets/images/posts/drayver-plk-kontar-na-flexible/13.jpg)

readXDATA67Rule - универсальная команда чтения (67h)

![readXDATA67Rule](/assets/images/posts/drayver-plk-kontar-na-flexible/14.jpg)


parseFloatRule<br>
![parseFloatRule](/assets/images/posts/drayver-plk-kontar-na-flexible/16.jpg)


parseBoolRule<br>
![parseBoolRule](/assets/images/posts/drayver-plk-kontar-na-flexible/17.jpg)


parseIntRule<br>
![parseIntRule](/assets/images/posts/drayver-plk-kontar-na-flexible/15.jpg)


writeBool - записывать в ПЛК будем только дискретные значения<br>
```callFunction(dc(), "writeXDATA54Rule", {netNum}, {memAddr}, 1, {data})```


writeXDATA54Rule - команда записи в контроллер (54h)<br>
![writeXDATA54Rule](/assets/images/posts/drayver-plk-kontar-na-flexible/18.jpg)

Обработка написана, но ничего не работает. Всё дело в функции шифрования/дешифрования.<br>
Давайте напишем её и встроим в обработку.

Меняем в драйвере Encoding Expression на
```
{env/command} != "\u0000" ?
cell(
  callFunction(dc(), "rc5Crypt"
    , {env/command}
    , {.:password$value}
    , false
    , false
  )
)
: {env/command}
```
Если команда "\u0000", то никакого шифрования не нужно, отправляем так, иначе шифруем пакет с использованием пароля.

На основе кода в документе Контар пишем процедуру шифрования/дешифрования rc5Crypt
```java
import com.tibbo.aggregate.common.context.*;
import com.tibbo.aggregate.common.datatable.*;
import com.tibbo.aggregate.common.server.*;

import com.tibbo.linkserver.*;
import com.tibbo.linkserver.context.*;
import java.util.Arrays;
import java.nio.charset.StandardCharsets;

public class %ScriptClassNamePattern% implements FunctionImplementation
{
  public DataTable execute(Context con, FunctionDefinition def, CallerController caller, RequestController request, DataTable parameters) throws ContextException
  {
    String result = "";    
    String keyString = parameters.rec().getString("key");
    byte[] key = keyString.getBytes();
    
    String dataString = parameters.rec().getString("data");
    byte[] dataBytes = paddingRight(dataString.getBytes(StandardCharsets.ISO_8859_1));

    int[] data = new int[dataBytes.length];
    
    for (int i = 0; i < dataBytes.length; i++){
        data[i] = dataBytes[i]&0xFF;
    }
    int[] outBuf = new int[data.length];
    boolean mode = parameters.rec().getBoolean("mode");
    boolean hex = parameters.rec().getBoolean("hex");
    
    RC5Cipher cipher = new RC5Cipher();
    cipher.keyExpansion(key);

    if (!mode) {
        cipher.encrypt(data, outBuf);
    } else {
        cipher.decrypt(data, outBuf);
    }  

    if (!hex) {
        for (int i = 0; i < outBuf.length; i++){
            result = result + Character.toString((char) (outBuf[i]));
        }
    } else {
        for (int i = 0; i < outBuf.length; i++){
            result = result + Integer.toHexString(outBuf[i]);
        }
    }
    return new DataRecord(def.getOutputFormat()).addString(result).wrap();
  }
  
      private byte[] paddingRight(byte[] memoryData) {
          int newLength = (memoryData.length + 7) / 8 * 8;
          byte[] padded = new byte[newLength];
          System.arraycopy(memoryData, 0, padded, 0, memoryData.length);
          return padded;
      }
      
  private static class RC5Cipher {
      private final int W = 32; // Размер слова в битах
      private final int R = 10; // Количество раундов
      private final int T = 2 * (R + 1); // Размер таблицы расширенных ключей
      private int[] S = new int[T]; // Таблица расширенных ключей
     
      private void keyExpansion(byte[] key) {
          int b = key.length;
          int c = (b + 3) / 4;
          int[] L = new int[c];

          for (int i = 0; i < b; i++) {
              L[i / 4] = (L[i / 4] << 8) + key[i];
          }
  
          System.out.println("L: " + Arrays.toString(L));
  
          S[0] = 0xB7E15163;
          for (int i = 1; i < T; i++) {
              S[i] = S[i - 1] + 0x9E3779B9;
          }
  
          int A = 0, B = 0, i = 0, j = 0;
          int n = 3 * Math.max(T, c);
          for (int k = 0; k < n; k++) {
              A = S[i] = Integer.rotateLeft(S[i] + A + B, 3);
              B = L[j] = Integer.rotateLeft(L[j] + A + B, A + B);
              i = (i + 1) % T;
              j = (j + 1) % c;
          }
          System.out.println(Arrays.toString(S));
      }
  
      public void encrypt(int[] data, int[] outBuf) {
          int rc;
          for (int n = 0; n < data.length; n += 8) {
              int A = BytesToUInt32(data, 0 + n);
              int B = BytesToUInt32(data, 4 + n);
  
              A = ((A + S[0]));
              B = ((B + S[1]));
  
              for (int i = 0; i < R * 2; i += 2) {
                  A ^= B;
                  rc = (B & 31);
                  A = Integer.rotateLeft(A, rc);
                  A = (A + S[i]);
                  B ^= A;
                  rc = (A & 31);
                  B = Integer.rotateLeft(B, rc);
                  B = (B + S[i + 1]);
              }
              UInt32ToBytes(A, outBuf, 0 + n);
              UInt32ToBytes(B, outBuf, 4 + n);
          }
      }
  
      public void decrypt(int[] data, int[] outBuf) {
          int rc;
          for (int n = 0; n < data.length; n += 8) {
              int A = BytesToUInt32(data, n);
              int B = BytesToUInt32(data, n + 4);
              System.out.println("A: " + A);
              System.out.println("B: " + B);
              for (int i = R * 2 - 2; i >= 0; i -= 2) {
                  B = (B - S[i + 1]);
                  rc = (A & 31);
                  B = Integer.rotateRight(B, rc);
                  B ^= A;
                  A = (A - S[i]);
                  rc = (B & 31);
                  A = Integer.rotateRight(A, rc);
                  A ^= B;
              }
              A = (A - S[0]);
              B = (B - S[1]);
  
              UInt32ToBytes(A, outBuf, 0 + n);
              UInt32ToBytes(B, outBuf, 4 + n);
          }
      }
  
      public int BytesToUInt32(int[] b, int p) 
      {
          int r = 0;
          for (int i = p + 3; i > p; i--) {
              r |= (b[i] & 0xff);
              r <<= 8;
          }
          r |= (b[p] & 0xff);
  
          return r;
      }

      public void UInt32ToBytes(int a, int[] b, int p)
      {
          int j = p;
          for (int i = 3; i >= 0; i--, j++) {
              b[j] = ((a >>> 8 * i) & 0xFF);
          }
      }
  }
}
```
На самом деле это была самая сложная часть, т.к. в коде в документе отсутствуют некоторые параметры, плюс нигде не указано, что для расшифровки требуется менять порядок байт. Пришлось повозиться.

Наконец мы настроили все параметры и собрали все функции.
В итоге получаем вот что:

![writeXDATA54Rule](/assets/images/posts/drayver-plk-kontar-na-flexible/final.jpg)

Теперь настроим периодическую синхронизацию параметров:

![writeXDATA54Rule](/assets/images/posts/drayver-plk-kontar-na-flexible/sync.jpg)

Поставим для аналоговых параметров синхронизацию 1 раз в 10 секунд, а для дискретных 1 раз в 3 секунды.<br>
В продакшен среде нужно внимательно относиться к этим параметрам и настраивать их в зависимости от важности получаемых данных.



## Итог

В ходе разработки драйвера для ПЛК Контар МС8 на базе flexible-драйвера была успешно решена задача интеграции контроллера с системой AggreGate. Основные результаты работы включают:

1. **Реализован полноценный обмен данными** по собственному протоколу Контар через TCP-соединение с использованием шифрования RC5 (ключ 64-bit), что обеспечивает защиту передаваемой информации.

2. **Создана гибкая система динамических переменных**, позволяющая автоматически генерировать набор тэгов на основе выгруженного из Контар-Консоль CSV-файла. Это решение значительно упрощает настройку и масштабирование системы при работе с десятками контроллеров.

3. **Разработаны функции чтения и записи** для основных типов данных (FLOAT, BOOL, INT), что позволяет полноценно управлять технологическими процессами как в режиме мониторинга, так и в режиме управления (для переменных из группы "Пульт").

4. **Реализована модульная структура обработки**, включающая транслитерацию имён переменных, парсинг ответов контроллера, шифрование и дешифрование данных.


Полученное решение успешно прошло проверку на объектах АЗС, где Контар используется в качестве системы противоаварийной защиты (ПАЗ).

В перспективе возможна доработка драйвера для поддержки автоматического обнаружения состава сети и полного чтения памяти контроллера, что позволит ещё больше автоматизировать процесс настройки.


## Файлы

[Скачать драйвер](/assets/files/kontar_driver.zip)
