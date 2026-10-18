/*
 * Интерфейс на трёх языках: русский, казахский, английский.
 * Выбор языка — единственная настройка, которая сохраняется в браузере
 * (localStorage, ключ "astana-lang"); данных пользователя там нет.
 * Тексты мест (названия, объяснения) приходят с сервера и не переводятся здесь.
 */
(function () {
  "use strict";

  const LANGS = ["ru", "kk", "en"];
  const STORAGE_KEY = "astana-lang";

  // Каждая строка: [ru, kk, en]. {name} — подстановки.
  const S = {
    // Общее и шапка
    skip: ["Перейти к содержанию", "Мазмұнға өту", "Skip to content"],
    logo_aria: ["ASTANA GO AI — на главную", "ASTANA GO AI — басты бетке", "ASTANA GO AI — home"],
    nav_aria: ["Основная навигация", "Негізгі навигация", "Main navigation"],
    nav_home: ["Главная", "Басты бет", "Home"],
    nav_map: ["Карта", "Карта", "Map"],
    nav_guide: ["AI-гид", "AI-гид", "AI guide"],
    tabbar_aria: ["Навигация", "Навигация", "Navigation"],
    lang_aria: ["Язык интерфейса", "Интерфейс тілі", "Interface language"],
    health_checking: ["Проверяем сервис…", "Сервисті тексеріп жатырмыз…", "Checking service…"],
    health_ok: ["Сервис работает", "Сервис жұмыс істеп тұр", "Service is up"],
    health_mock: ["Демо-режим (mock)", "Демо-режим (mock)", "Demo mode (mock)"],
    health_down: ["Сервис недоступен", "Сервис қолжетімсіз", "Service unavailable"],
    city: ["Астана", "Астана", "Astana"],
    new_tab: [" (откроется в новой вкладке)", " (жаңа қойындыда ашылады)", " (opens in a new tab)"],
    title_home: ["ASTANA GO AI — куда сходить рядом в Астане", "ASTANA GO AI — Астанада жақын маңда қайда бару керек", "ASTANA GO AI — where to go nearby in Astana"],
    title_guide: ["AI-гид — ASTANA GO AI", "AI-гид — ASTANA GO AI", "AI guide — ASTANA GO AI"],
    title_map: ["Карта — ASTANA GO AI", "Карта — ASTANA GO AI", "Map — ASTANA GO AI"],
    title_place: ["{name} — ASTANA GO AI", "{name} — ASTANA GO AI", "{name} — ASTANA GO AI"],

    // Главная
    hero_eyebrow: ["Твой город. Твои открытия.", "Сенің қалаң. Сенің ашылымдарың.", "Your city. Your discoveries."],
    hero_title: ["Куда отправимся сегодня?", "Бүгін қайда барамыз?", "Where shall we go today?"],
    hero_lead: [
      "Расскажи, что тебе хочется, а ИИ найдёт идеальное место рядом.",
      "Не қалайтыныңды айт — ЖИ жақын маңнан тамаша орын табады.",
      "Tell us what you feel like, and AI will find the perfect place nearby.",
    ],
    query_label: ["Что тебе хочется?", "Не қалайсың?", "What do you feel like?"],
    query_placeholder: ["Хочу погулять час и выпить кофе...", "Бір сағат серуендеп, кофе ішкім келеді...", "I want to walk for an hour and grab a coffee..."],
    find: ["Найти места", "Орындарды табу", "Find places"],
    finding: ["Подбираем места…", "Орындарды іздеп жатырмыз…", "Finding places…"],
    home_hint: ["Пара слов о настроении — и город станет ближе.", "Көңіл-күйің туралы бірер сөз — қала жақындай түседі.", "A few words about your mood — and the city gets closer."],
    ideas_title: ["Быстрые идеи — поиск в одно нажатие", "Жылдам идеялар — бір басумен іздеу", "Quick ideas — one-tap search"],
    scenario_sr: [" — запустить поиск: «{q}», {d}, {cats}", " — іздеуді бастау: «{q}», {d}, {cats}", " — search: “{q}”, {d}, {cats}"],
    photo_alt: [
      "Панорама левого берега Астаны с монументом Байтерек на закате",
      "Күн батқандағы Астананың сол жағалауы мен Бәйтерек монументінің панорамасы",
      "Panorama of Astana's left bank with the Baiterek monument at sunset",
    ],
    photo_caption: ["Астана · Открой знакомое по-новому", "Астана · Таныс қаланы жаңаша аш", "Astana · See the familiar in a new way"],
    explore_aria: ["Об Астане и о сервисе", "Астана және сервис туралы", "About Astana and the service"],
    explore_title: ["Исследуй Астану", "Астананы зертте", "Explore Astana"],
    open_map: ["Открыть карту", "Картаны ашу", "Open map"],
    pick_places: ["Подобрать места", "Орындарды таңдау", "Find places"],
    home_map_caption: [
      "Карта © Google. Места в рекомендациях — из OpenStreetMap.",
      "Карта © Google. Ұсыныстардағы орындар — OpenStreetMap деректерінен.",
      "Map © Google. Places in recommendations come from OpenStreetMap.",
    ],
    gmap_astana: ["Google Карта Астаны", "Астананың Google картасы", "Google map of Astana"],
    gmap_place: ["Google Карта: {name}", "Google картасы: {name}", "Google map: {name}"],
    steps_title: ["Три шага к открытию", "Ашылымға үш қадам", "Three steps to discovery"],
    step1_title: ["Выбери настроение", "Көңіл-күйді таңда", "Pick a mood"],
    step1_text: ["Кофе, природа или немного искусства — решать тебе.", "Кофе, табиғат немесе аздап өнер — өзің шеш.", "Coffee, nature or a bit of art — your call."],
    step2_title: ["Укажи время", "Уақытты көрсет", "Set your time"],
    step2_text: ["Полчаса или целый вечер? Найдём идею под твой ритм.", "Жарты сағат па, әлде бүкіл кеш пе? Ырғағыңа сай идея табамыз.", "Half an hour or a whole evening? We'll match your pace."],
    step3_title: ["Открой новые места", "Жаңа орындарды аш", "Discover new places"],
    step3_text: ["Смотри рекомендации и строй свой маршрут по Астане.", "Ұсыныстарды қарап, Астана бойынша өз бағытыңды құр.", "See recommendations and plan your route around Astana."],
    apps_title: ["Скоро в твоём телефоне", "Жақында телефоныңда", "Coming soon to your phone"],
    apps_lead: [
      "Мобильное приложение ASTANA GO AI готовится к выходу. Пока всё работает на сайте.",
      "ASTANA GO AI мобильді қосымшасы шығуға дайындалуда. Әзірге бәрі сайтта жұмыс істейді.",
      "The ASTANA GO AI mobile app is on its way. For now, everything works on the website.",
    ],
    app_ios_title: ["Приложение для iPhone", "iPhone-ға арналған қосымша", "iPhone app"],
    app_ios_text: [
      "Появится в App Store после тестирования. Те же подборки, только в кармане.",
      "Тестілеуден кейін App Store-да пайда болады. Сол ұсыныстар — қалтаңда.",
      "Coming to the App Store after testing. Same picks, right in your pocket.",
    ],
    app_android_title: ["Приложение для Android", "Android-қа арналған қосымша", "Android app"],
    app_android_text: [
      "Появится в Google Play после тестирования. Следи за новостями проекта.",
      "Тестілеуден кейін Google Play-де пайда болады. Жоба жаңалықтарын бақылап жүр.",
      "Coming to Google Play after testing. Stay tuned for project news.",
    ],
    soon: ["Скоро", "Жақында", "Soon"],

    // Погода
    weather_title: ["Погода в Астане", "Астанадағы ауа райы", "Weather in Astana"],
    weather_loading: ["Загружаем погоду…", "Ауа райын жүктеп жатырмыз…", "Loading weather…"],
    weather_error: ["Погода сейчас не загрузилась. Попробуй обновить страницу позже.", "Ауа райы жүктелмеді. Бетті кейінірек жаңартып көр.", "Weather didn't load. Try refreshing the page later."],
    w_clear: ["Ясно", "Ашық", "Clear"],
    w_mostly_clear: ["Преимущественно ясно", "Негізінен ашық", "Mostly clear"],
    w_partly: ["Переменная облачность", "Ауыспалы бұлтты", "Partly cloudy"],
    w_overcast: ["Пасмурно", "Бұлтты", "Overcast"],
    w_fog: ["Туман", "Тұман", "Fog"],
    w_drizzle: ["Морось", "Сіркіреме жаңбыр", "Drizzle"],
    w_freezing_drizzle: ["Ледяная морось", "Мұзды сіркіреме", "Freezing drizzle"],
    w_rain: ["Дождь", "Жаңбыр", "Rain"],
    w_freezing_rain: ["Ледяной дождь", "Мұзды жаңбыр", "Freezing rain"],
    w_snow: ["Снег", "Қар", "Snow"],
    w_showers: ["Ливень", "Нөсер", "Showers"],
    w_snow_showers: ["Снегопад", "Қар жауу", "Snow showers"],
    w_storm: ["Гроза", "Найзағай", "Thunderstorm"],
    w_unknown: ["Погода", "Ауа райы", "Weather"],
    w_feels: ["Ощущается как {t}", "{t} сияқты сезіледі", "Feels like {t}"],
    w_wind: ["Ветер {v} м/с", "Жел {v} м/с", "Wind {v} m/s"],
    w_humidity: ["Влажность {v}%", "Ылғалдылық {v}%", "Humidity {v}%"],
    w_today: ["Сегодня от {min} до {max}", "Бүгін {min}-тан {max}-қа дейін", "Today {min} to {max}"],
    tip_wet: ["Идут осадки — присмотрись к музеям и кафе.", "Жауын-шашын бар — мұражайлар мен кафелерге назар аудар.", "It's wet out — consider museums and cafés."],
    tip_snow: ["Снежно: выбирай короткие прогулки и тёплые места.", "Қарлы: қысқа серуен мен жылы орындарды таңда.", "Snowy: choose short walks and warm places."],
    tip_frost: ["Морозно: лучше короткая прогулка и тёплое кафе рядом.", "Аяз: қысқа серуен мен жақын жылы кафе жақсы.", "Freezing: a short walk and a warm café nearby is best."],
    tip_wind: ["Сильный ветер — одевайся теплее и держись ближе к зданиям.", "Қатты жел — жылы киін және ғимараттарға жақын жүр.", "Strong wind — dress warmly and stay near buildings."],
    tip_heat: ["Жарко: ищи тень в парках и возьми воду.", "Ыстық: саябақтардан көлеңке ізде және су ал.", "Hot: look for shade in parks and bring water."],
    tip_cool: ["Прохладно — накинь что-нибудь тёплое.", "Салқын — жылы бірдеңе киіп ал.", "Chilly — grab something warm."],
    tip_good: ["Хорошая погода для прогулки.", "Серуенге жақсы ауа райы.", "Good weather for a walk."],

    // Новости
    news_title: ["Новости Астаны", "Астана жаңалықтары", "Astana news"],
    news_all: ["Все новости", "Барлық жаңалықтар", "All news"],
    news_loading: ["Загружаем новости…", "Жаңалықтарды жүктеп жатырмыз…", "Loading news…"],
    news_source: ["Заголовки собраны сервисом GDELT из казахстанских СМИ.", "Тақырыптарды GDELT сервисі қазақстандық БАҚ-тан жинады.", "Headlines collected by GDELT from Kazakhstani media."],
    news_updating: ["Обновляем новости…", "Жаңалықтарды жаңартып жатырмыз…", "Updating news…"],
    news_stale: ["Источник не ответил — показаны новости, загруженные {ago}.", "Дереккөз жауап бермеді — {ago} жүктелген жаңалықтар көрсетілді.", "The source didn't respond — showing news loaded {ago}."],
    news_down: [
      "Источник новостей сейчас не отвечает. Свежие новости Астаны можно почитать здесь:",
      "Жаңалықтар көзі қазір жауап бермейді. Астананың соңғы жаңалықтарын мына жерден оқуға болады:",
      "The news source isn't responding. You can read fresh Astana news here:",
    ],
    news_fb_1: ["Kazinform — новости Казахстана", "Kazinform — Қазақстан жаңалықтары", "Kazinform — Kazakhstan news"],
    news_fb_2: ["Tengrinews — главные новости", "Tengrinews — басты жаңалықтар", "Tengrinews — top news"],
    news_fb_3: ["Astana TV — новости столицы", "Astana TV — елорда жаңалықтары", "Astana TV — capital news"],
    ago_min: ["{n} мин назад", "{n} мин бұрын", "{n} min ago"],
    ago_h: ["{n} ч назад", "{n} сағ бұрын", "{n} h ago"],
    ago_d: ["{n} дн. назад", "{n} күн бұрын", "{n} d ago"],

    // AI-гид: форма
    back: ["Назад", "Артқа", "Back"],
    guide_title: ["Твой AI-гид", "Сенің AI-гидің", "Your AI guide"],
    guide_lead: ["Маленький план для большого города.", "Үлкен қалаға шағын жоспар.", "A small plan for a big city."],
    search_params_aria: ["Параметры поиска", "Іздеу параметрлері", "Search options"],
    location_legend: ["Откуда начнём?", "Қайдан бастаймыз?", "Where do we start?"],
    loc_none_title: ["Точка не выбрана", "Нүкте таңдалмады", "No starting point yet"],
    loc_none_sub: ["Выбери один из вариантов ниже", "Төмендегі нұсқалардың бірін таңда", "Choose one of the options below"],
    geo_btn: ["Использовать моё местоположение", "Менің орналасқан жерімді қолдану", "Use my location"],
    pick_btn: ["Выбрать точку на карте", "Картадан нүкте таңдау", "Pick a point on the map"],
    center_btn: ["Центр Астаны", "Астана орталығы", "Astana city center"],
    manual_btn: ["Ввести координаты", "Координаталарды енгізу", "Enter coordinates"],
    lat_label: ["Широта (от −90 до 90)", "Ендік (−90-нан 90-ға дейін)", "Latitude (−90 to 90)"],
    lon_label: ["Долгота (от −180 до 180)", "Бойлық (−180-нен 180-ге дейін)", "Longitude (−180 to 180)"],
    manual_apply: ["Применить координаты", "Координаталарды қолдану", "Apply coordinates"],
    location_hint: [
      "Координаты нужны только для поиска мест рядом: они отправляются на наш сервер вместе с запросом, не сохраняются в браузере и не передаются в аналитику.",
      "Координаталар тек жақын орындарды іздеу үшін керек: олар сұраумен бірге біздің серверге жіберіледі, браузерде сақталмайды және аналитикаға берілмейді.",
      "Coordinates are only used to find places nearby: they're sent to our server with the request, never stored in the browser and never shared with analytics.",
    ],
    duration_legend: ["Сколько есть времени?", "Қанша уақытың бар?", "How much time do you have?"],
    category_legend: ["Что интересно", "Не қызық", "What interests you"],
    category_all: ["Все", "Барлығы", "All"],
    category_hint: ["Можно выбрать несколько. «Все» — без фильтра.", "Бірнешеуін таңдауға болады. «Барлығы» — сүзгісіз.", "You can pick several. “All” means no filter."],
    a11y_legend: ["Особые потребности", "Ерекше қажеттіліктер", "Accessibility needs"],
    a11y_wheelchair: ["Передвигаюсь на коляске", "Арбамен жүремін", "I use a wheelchair"],
    a11y_low_mobility: ["Трудно ходить далеко", "Алысқа жүру қиын", "Walking far is hard for me"],
    a11y_quiet: ["Нужны тихие места без толпы", "Адам аз тыныш орындар керек", "I need quiet, uncrowded places"],
    a11y_hint: [
      "Необязательно. Учитываем при подборе и честно показываем, если данных о доступности нет. Отметки нигде не сохраняются.",
      "Міндетті емес. Іздеу кезінде ескереміз және қолжетімділік туралы дерек болмаса, ашық айтамыз. Белгілер еш жерде сақталмайды.",
      "Optional. We use it when picking places and say honestly when accessibility data is missing. Your choices are never stored.",
    ],
    a11y_hint_unsupported: [
      "Сервер пока не учитывает эти пожелания при подборе. Доступность для коляски показываем только по тегу OSM, если он есть; уточняйте её перед визитом. Отметки нигде не сохраняются.",
      "Бұл тілектер сервердегі іздеу кезінде әзірге ескерілмейді. Арбаға қолжетімділікті тек OSM тегі бар болса көрсетеміз; барар алдында нақтылаңыз. Белгілер еш жерде сақталмайды.",
      "These preferences are not used in the server search yet. Wheelchair access is shown only from an available OSM tag; check before visiting. Your choices are never stored.",
    ],
    a11y_need_wheelchair: ["коляска", "арба", "wheelchair"],
    a11y_need_low_mobility: ["короткие расстояния", "қысқа қашықтық", "short distances"],
    a11y_need_quiet: ["тихие места", "тыныш орындар", "quiet places"],
    transport_label: ["Как доберёмся", "Қалай жетеміз", "How we get there"],
    transport_walk: ["Пешком", "Жаяу", "On foot"],
    health_warning: [
      "Сервер сейчас не отвечает. Форма работает, но поиск может не получиться — попробуй чуть позже.",
      "Сервер қазір жауап бермейді. Форма жұмыс істейді, бірақ іздеу сәтсіз болуы мүмкін — сәл кейінірек көр.",
      "The server isn't responding. The form works, but search may fail — try again a bit later.",
    ],
    search_hint: [
      "Пара слов о настроении — и город станет ближе. Текст запроса может передаваться внешнему AI-сервису для объяснений, поэтому не пиши в нём личные данные.",
      "Көңіл-күйің туралы бірер сөз — қала жақындай түседі. Сұрау мәтіні түсіндірме үшін сыртқы AI-сервиске берілуі мүмкін, сондықтан оған жеке деректерді жазба.",
      "A few words about your mood — and the city gets closer. Your request text may be sent to an external AI service for explanations, so don't include personal data.",
    ],

    // Местоположение (динамика)
    geo_locating: ["Определяем местоположение…", "Орналасқан жерді анықтап жатырмыз…", "Locating…"],
    geo_title: ["Моё местоположение", "Менің орналасқан жерім", "My location"],
    geo_sub: ["Определено по геолокации", "Геолокация бойынша анықталды", "Determined by geolocation"],
    geo_sub_acc: ["Определено по геолокации · точность ≈ {acc}", "Геолокация бойынша анықталды · дәлдігі ≈ {acc}", "Determined by geolocation · accuracy ≈ {acc}"],
    geo_unsupported_title: ["Браузер не умеет определять местоположение.", "Браузер орналасқан жерді анықтай алмайды.", "Your browser can't determine location."],
    geo_alt_text: [
      "Выбери точку на карте, начни от центра Астаны или введи координаты.",
      "Картадан нүкте таңда, Астана орталығынан баста немесе координаталарды енгіз.",
      "Pick a point on the map, start from Astana center or enter coordinates.",
    ],
    geo_denied_title: ["Укажи своё местоположение на карте.", "Орналасқан жеріңді картадан көрсет.", "Mark your location on the map."],
    geo_denied_text: [
      "Доступ к геолокации не дан — это нормально. Выбери точку вручную, начни от центра Астаны или введи координаты.",
      "Геолокацияға рұқсат берілмеді — бұл қалыпты жағдай. Нүктені қолмен таңда, Астана орталығынан баста немесе координаталарды енгіз.",
      "Location access wasn't granted — that's fine. Pick a point manually, start from Astana center or enter coordinates.",
    ],
    geo_timeout_title: ["Не удалось определить местоположение вовремя.", "Орналасқан жерді уақытында анықтау мүмкін болмады.", "Couldn't get your location in time."],
    geo_timeout_text: ["Попробуй ещё раз или выбери точку на карте вручную.", "Қайталап көр немесе картадан нүктені қолмен таңда.", "Try again or pick a point on the map."],
    geo_unavailable_title: ["Местоположение сейчас недоступно.", "Орналасқан жер қазір қолжетімсіз.", "Location is unavailable right now."],
    center_sub: ["Стандартная точка {coords} — не твоё местоположение", "Стандартты нүкте {coords} — сенің орналасқан жерің емес", "Default point {coords} — not your location"],
    manual_title: ["Координаты вручную", "Қолмен енгізілген координаталар", "Manual coordinates"],
    pick_loc_title: ["Точка на карте", "Картадағы нүкте", "Point on the map"],
    pick_loc_sub: ["Выбрана на карте · {coords}", "Картадан таңдалды · {coords}", "Chosen on the map · {coords}"],
    landmark_title: ["Рядом с: {name}", "Жанында: {name}", "Near: {name}"],
    landmark_sub: ["Ориентир · {coords}", "Бағдар · {coords}", "Landmark · {coords}"],
    err_lat: ["Широта — число от −90 до 90, например 51.1283.", "Ендік — −90-нан 90-ға дейінгі сан, мысалы 51.1283.", "Latitude must be a number from −90 to 90, e.g. 51.1283."],
    err_lon: ["Долгота — число от −180 до 180, например 71.4305.", "Бойлық — −180-нен 180-ге дейінгі сан, мысалы 71.4305.", "Longitude must be a number from −180 to 180, e.g. 71.4305."],

    // Диалог выбора точки
    pick_title: ["Выбери точку отправления", "Бастапқы нүктені таңда", "Choose a starting point"],
    pick_desc: [
      "Нажми на карту в нужном месте или выбери ориентир. Карту можно двигать и приближать.",
      "Картадағы керек жерді бас немесе бағдар таңда. Картаны жылжытып, үлкейтуге болады.",
      "Tap the map where you want or choose a landmark. You can pan and zoom the map.",
    ],
    close: ["Закрыть", "Жабу", "Close"],
    pick_landmarks_title: ["Или начни от ориентира", "Немесе бағдардан баста", "Or start from a landmark"],
    cancel: ["Отмена", "Болдырмау", "Cancel"],
    pick_confirm: ["Выбрать эту точку", "Осы нүктені таңдау", "Choose this point"],
    pick_status_landmark: ["Выбрано: {name}. Нажми «Выбрать эту точку».", "Таңдалды: {name}. «Осы нүктені таңдау» батырмасын бас.", "Selected: {name}. Press “Choose this point”."],
    pick_status_point: ["Точка {coords}. Нажми «Выбрать эту точку».", "Нүкте {coords}. «Осы нүктені таңдау» батырмасын бас.", "Point {coords}. Press “Choose this point”."],
    pick_map_error: [
      "Карта не загрузилась. Выбери ориентир ниже или введи координаты вручную.",
      "Карта жүктелмеді. Төмендегі бағдарды таңда немесе координаталарды қолмен енгіз.",
      "The map didn't load. Pick a landmark below or enter coordinates manually.",
    ],

    // Валидация
    err_query_empty: ["Напиши пару слов о том, чего хочется.", "Не қалайтыныңды бірер сөзбен жаз.", "Write a few words about what you'd like."],
    err_query_long: ["Слишком длинный запрос: максимум {max} символов.", "Сұрау тым ұзын: ең көбі {max} таңба.", "Request is too long: {max} characters max."],
    err_location: [
      "Укажи точку отправления: геолокация, точка на карте, центр Астаны или координаты.",
      "Бастапқы нүктені көрсет: геолокация, картадағы нүкте, Астана орталығы немесе координаталар.",
      "Choose a starting point: your location, a point on the map, Astana center or coordinates.",
    ],
    err_location_range: ["Координаты вне допустимого диапазона. Выбери точку заново.", "Координаталар рұқсат етілген ауқымнан тыс. Нүктені қайта таңда.", "Coordinates are out of range. Choose the point again."],
    err_duration: ["Выбери, сколько есть времени.", "Қанша уақытың бар екенін таңда.", "Choose how much time you have."],
    err_validation_suffix: ["Проверь текст запроса и параметры поиска.", "Сұрау мәтіні мен іздеу параметрлерін тексер.", "Check your request text and search options."],

    // Выдача
    your_pick: ["Твоя подборка", "Сенің таңдауың", "Your picks"],
    recommend: ["Рекомендуем", "Ұсынамыз", "Recommended"],
    results_map_title: ["Места на карте", "Картадағы орындар", "Places on the map"],
    results_map_switch_aria: ["Какое место показать на карте", "Картада қай орынды көрсету", "Which place to show on the map"],
    results_note: [
      "Расстояние указано по прямой, время — приблизительный бюджет на дорогу и посещение. Места, часы и описания — из OpenStreetMap; объяснения сформулированы ИИ или по шаблону. Уточняйте детали перед посещением. Данные © OpenStreetMap contributors.",
      "Қашықтық түзу сызықпен көрсетілген, уақыт — жол мен баруға шамамен кететін уақыт. Орындар, жұмыс уақыты мен сипаттамалар — OpenStreetMap деректерінен; түсіндірмелер ЖИ арқылы немесе үлгі бойынша жазылған. Барар алдында мәліметтерді нақтылаңыз. Деректер © OpenStreetMap contributors.",
      "Distance is straight-line; time is a rough budget for getting there and visiting. Places, hours and descriptions come from OpenStreetMap; explanations are written by AI or from a template. Check details before you go. Data © OpenStreetMap contributors.",
    ],
    edit_query: ["Изменить запрос", "Сұрауды өзгерту", "Edit request"],
    load_more: ["Показать ещё", "Тағы көрсету", "Load more"],
    loading_more: ["Ищем ещё места…", "Тағы орындар іздеп жатырмыз…", "Finding more places…"],
    retry_more: ["Попробовать ещё раз", "Қайта байқап көру", "Try again"],
    more_error: ["Не удалось загрузить ещё места. Уже найденные места сохранены — попробуй снова.", "Қосымша орындарды жүктеу мүмкін болмады. Табылған орындар сақталды — қайта байқап көр.", "Couldn't load more places. Your existing results are saved — try again."],
    more_exhausted: ["Все подходящие места показаны. Измени запрос или точку поиска, чтобы увидеть другие варианты.", "Барлық лайық орындар көрсетілді. Басқа нұсқалар үшін сұрауды немесе іздеу нүктесін өзгерт.", "All matching places are shown. Change your request or starting point for other options."],
    more_added: ["Добавлено мест: {n}.", "Қосылған орындар: {n}.", "Added {n} places."],
    place_name_unknown: ["Точное название уточняется", "Нақты атауы нақтылануда", "Exact name to be confirmed"],
    category_illustration: ["Иллюстрация категории: {category}", "Санат иллюстрациясы: {category}", "Category illustration: {category}"],
    category_illustration_caption: ["Иллюстрация категории", "Санат иллюстрациясы", "Category illustration"],
    retry: ["Повторить", "Қайталау", "Retry"],
    wait_s: ["Подождите {s} с", "{s} с күтіңіз", "Wait {s} s"],
    can_search_again: ["Можно снова искать места.", "Орындарды қайта іздеуге болады.", "You can search again."],
    intro_title: ["Расскажи, чего хочется", "Не қалайтыныңды айт", "Tell us what you'd like"],
    intro_text: [
      "Напиши запрос, выбери точку отправления и время — подберём до трёх реальных мест рядом.",
      "Сұрау жаз, бастапқы нүкте мен уақытты таңда — жақын маңнан үш нақты орынға дейін табамыз.",
      "Write a request, choose a starting point and time — we'll find up to three real places nearby.",
    ],
    loading_title: ["Подбираем интересные места для тебя...", "Саған қызықты орындарды іздеп жатырмыз...", "Finding interesting places for you..."],
    loading_text: ["Собираем идеи под твой запрос и время на прогулку.", "Сұрауың мен серуен уақытына сай идеялар жинап жатырмыз.", "Gathering ideas for your request and time."],
    nothing_found: ["Ничего не нашлось", "Ештеңе табылмады", "Nothing found"],
    search_all_cats: ["Искать во всех категориях", "Барлық санаттардан іздеу", "Search all categories"],
    empty_title: ["Пока не нашли подходящих мест. Попробуй изменить запрос.", "Әзірге лайық орын табылмады. Сұрауды өзгертіп көр.", "No suitable places yet. Try changing your request."],
    empty_text: [
      "Выбери другую категорию, добавь немного времени или начни из другой точки.",
      "Басқа санат таңда, уақыт қос немесе басқа нүктеден баста.",
      "Pick another category, add some time or start from another point.",
    ],
    empty_announce: ["Подходящих мест не найдено. Попробуй изменить запрос.", "Лайық орын табылмады. Сұрауды өзгертіп көр.", "No suitable places found. Try changing your request."],
    found_title: ["Нашёл для тебя {n} {places}", "Саған {n} {places} таптым", "Found {n} {places} for you"],
    found_sub: [
      "По запросу «{q}». Выбери одно место — это альтернативы, а не маршрут.",
      "«{q}» сұрауы бойынша. Бір орынды таңда — бұлар маршрут емес, балама нұсқалар.",
      "For “{q}”. Pick one — these are alternatives, not a route.",
    ],
    found_announce: ["Найдено {n} {places}.", "{n} {places} табылды.", "Found {n} {places}."],
    mock_notice: [
      "Демо-режим: это заготовленные места из района ЭКСПО, они не зависят от выбранной точки. Для подбора рядом с тобой открой сайт без ?mock=1 при запущенном бекенде.",
      "Демо-режим: бұл ЭКСПО ауданындағы дайын орындар, олар таңдалған нүктеге байланысты емес. Жаныңдағы орындарды табу үшін бекенд іске қосылғанда сайтты ?mock=1-сіз аш.",
      "Demo mode: these are pre-made places around EXPO and don't depend on your chosen point. To get places near you, open the site without ?mock=1 with the backend running.",
    ],
    degraded_notice: [
      "В этой подборке используются шаблонные пояснения. Их источник указан у каждого места.",
      "Бұл таңдауда үлгі бойынша жасалған түсіндірмелер бар. Әр орынның түсіндірме көзі көрсетілген.",
      "These results include template explanations. Each place shows the source of its explanation.",
    ],
    lang_mock_notice: [
      "Пояснения демо подготовлены на русском и не переводятся при смене языка. Для казахских пояснений откройте сайт с работающим API без mock-режима.",
      "Демо түсіндірмелері орыс тілінде дайындалған және тіл ауысқанда аударылмайды. Қазақша түсіндірме алу үшін сайтты жұмыс істейтін API-мен mock-режимсіз ашыңыз.",
      "Demo explanations are in Russian and do not change with the interface language. For Kazakh explanations, use the running API without mock mode.",
    ],
    lang_api_fallback: [
      "Для английского интерфейса пояснения приходят на русском: API поддерживает русский и казахский языки. Названия и факты OSM сохраняют исходный язык.",
      "Ағылшын интерфейсі үшін түсіндірмелер орыс тілінде беріледі: API орыс және қазақ тілдерін қолдайды. OSM атаулары мен деректері бастапқы тілінде қалады.",
      "Explanations are in Russian: the API supports Russian and Kazakh. Place names and OSM facts stay in their source language.",
    ],
    lang_results_notice: [
      "Язык загруженных пояснений: {language}. Выполните поиск заново, чтобы получить пояснения на выбранном языке. Названия и факты OSM сохраняют исходный язык.",
      "Жүктелген түсіндірмелердің тілі: {language}. Таңдалған тілде түсіндірме алу үшін қайта іздеңіз. OSM атаулары мен деректері бастапқы тілінде қалады.",
      "Loaded explanations are in {language}. Search again to use the current language setting (English uses Russian). Place names and OSM facts keep their source language.",
    ],
    lang_name_ru: ["русский", "орыс", "Russian"],
    lang_name_kk: ["казахский", "қазақ", "Kazakh"],
    a11y_notice: [
      "Учли особые потребности: {needs}. Данные о доступности берём из OpenStreetMap — их часто нет, и тогда мы честно пишем «нет данных».",
      "Ерекше қажеттіліктер ескерілді: {needs}. Қолжетімділік деректерін OpenStreetMap-тен аламыз — олар жиі болмайды, онда «дерек жоқ» деп ашық жазамыз.",
      "Accessibility needs considered: {needs}. Accessibility data comes from OpenStreetMap — it's often missing, and then we honestly say “no data”.",
    ],
    a11y_notice_unsupported: [
      "Сервер пока не учитывает особые потребности ({needs}) — доступность мест проверяйте на месте.",
      "Сервер ерекше қажеттіліктерді ({needs}) әзірге ескермейді — орындардың қолжетімділігін орнында тексеріңіз.",
      "The server doesn't consider accessibility needs ({needs}) yet — please check accessibility on site.",
    ],
    err_rate_title: ["Слишком много запросов, подождите минуту", "Сұраулар тым көп, бір минут күтіңіз", "Too many requests, please wait a minute"],
    err_rate_text: [
      "Кнопка поиска снова станет активной через минуту. Введённый запрос сохранён.",
      "Іздеу батырмасы бір минуттан кейін қайта белсенді болады. Енгізілген сұрау сақталды.",
      "The search button will be active again in a minute. Your request is saved.",
    ],
    err_internal_title: ["Что-то пошло не так, попробуйте позже", "Бірдеңе дұрыс болмады, кейінірек көріңіз", "Something went wrong, please try later"],
    err_internal_text: ["На сервере произошла ошибка. Запрос сохранён — можно повторить.", "Серверде қате болды. Сұрау сақталды — қайталауға болады.", "A server error occurred. Your request is saved — you can retry."],
    err_ai_title: ["Сервис временно недоступен", "Сервис уақытша қолжетімсіз", "Service temporarily unavailable"],
    err_ai_text: ["Попробуй повторить запрос чуть позже.", "Сұрауды сәл кейінірек қайталап көр.", "Try again a bit later."],
    err_network_title: ["Нет связи с сервером", "Сервермен байланыс жоқ", "No connection to the server"],
    err_network_text: [
      "Не удалось загрузить рекомендации. Проверь подключение к интернету и попробуй ещё раз.",
      "Ұсыныстарды жүктеу мүмкін болмады. Интернет байланысын тексеріп, қайталап көр.",
      "Couldn't load recommendations. Check your internet connection and try again.",
    ],
    err_timeout_text: ["Сервер не ответил за {s} секунд. Попробуй ещё раз.", "Сервер {s} секунд ішінде жауап бермеді. Қайталап көр.", "The server didn't respond within {s} seconds. Try again."],
    err_unknown_title: ["Не удалось получить рекомендации", "Ұсыныстарды алу мүмкін болмады", "Couldn't get recommendations"],
    err_unknown_text: ["Что-то пошло не так, попробуйте позже.", "Бірдеңе дұрыс болмады, кейінірек көріңіз.", "Something went wrong, please try later."],

    // Карточка места
    ai_tip: ["Совет AI", "AI кеңесі", "AI tip"],
    template_tip: ["По шаблону", "Үлгі бойынша", "Template"],
    generation_gemini: ["Пояснение создано Gemini", "Түсіндірмені Gemini жасады", "Explanation generated by Gemini"],
    generation_template: ["Пояснение составлено по шаблону", "Түсіндірме үлгі бойынша жасалды", "Explanation from a template"],
    generation_unknown: ["Источник пояснения не указан", "Түсіндірме көзі көрсетілмеген", "Explanation source not specified"],
    status_open: ["На момент поиска по расписанию OSM: открыто.", "Іздеу сәтінде OSM кестесі бойынша: ашық.", "Open per the OSM schedule at search time."],
    status_closed: ["На момент поиска по расписанию OSM: закрыто.", "Іздеу сәтінде OSM кестесі бойынша: жабық.", "Closed per the OSM schedule at search time."],
    status_check: ["Фактические часы работы уточните перед визитом.", "Барар алдында нақты жұмыс уақытын анықтаңыз.", "Confirm actual opening hours before visiting."],
    status_unknown: ["Статус работы неизвестен — уточните часы перед визитом.", "Жұмыс күйі белгісіз — барар алдында уақытын нақтылаңыз.", "Opening status unknown — check hours before visiting."],
    on_map: ["На карте", "Картада", "On map"],
    route: ["Маршрут", "Маршрут", "Route"],
    route_sr: [" до «{name}» в Google Картах (откроется в новой вкладке)", " «{name}» дейін Google Карталарда (жаңа қойындыда ашылады)", " to “{name}” in Google Maps (opens in a new tab)"],
    what_to_do: ["Что делать: ", "Не істеуге болады: ", "What to do: "],
    hours_osm: ["Часы работы (по данным OSM): ", "Жұмыс уақыты (OSM деректері бойынша): ", "Opening hours (per OSM): "],
    source: ["Источник: {s}", "Дереккөз: {s}", "Source: {s}"],
    meta_dist: ["≈ {d} по прямой", "түзу сызықпен ≈ {d}", "≈ {d} straight-line"],
    meta_time: ["{t} на дорогу и визит", "жол мен баруға {t}", "{t} to get there and visit"],
    min_approx: ["≈ {n} мин", "≈ {n} мин", "≈ {n} min"],
    unit_m: ["{n} м", "{n} м", "{n} m"],
    unit_km: ["{n} км", "{n} км", "{n} km"],
    dur_min: ["{n} мин", "{n} мин", "{n} min"],
    dur_hour: ["1 час", "1 сағат", "1 hour"],
    dur_hours: ["{n} часа", "{n} сағат", "{n} hours"],
    a11y_wc_yes: ["Доступно для коляски · по данным OSM", "Арбамен кіруге болады · OSM деректері бойынша", "Wheelchair accessible · per OSM"],
    a11y_wc_limited: ["Частично доступно для коляски · по данным OSM", "Арбамен ішінара кіруге болады · OSM деректері бойынша", "Partly wheelchair accessible · per OSM"],
    a11y_wc_no: ["Недоступно для коляски · по данным OSM", "Арбамен кіру мүмкін емес · OSM деректері бойынша", "Not wheelchair accessible · per OSM"],
    a11y_wc_unknown: ["Нет данных о доступности — уточните на месте", "Қолжетімділік туралы дерек жоқ — орнында нақтылаңыз", "No accessibility data — check on site"],

    // Экран «Карта»
    map_title: ["Твоя Астана — на карте", "Сенің Астанаң — картада", "Your Astana on the map"],
    map_lead: ["Выбирай место, смотри детали и планируй прогулку.", "Орынды таңда, мәліметтерді қара және серуенді жоспарла.", "Pick a place, see the details and plan your walk."],
    map_side_note: [
      "Расстояние по прямой и время приблизительные; уточняйте детали перед посещением.",
      "Түзу қашықтық пен уақыт шамамен алынған; барар алдында нақтылаңыз.",
      "Straight-line distance and time are approximate; check details before you go.",
    ],
    map_caption: [
      "Расстояния приблизительные. Карта © OpenStreetMap contributors; серые точки — ориентиры Астаны.",
      "Қашықтықтар шамамен алынған. Карта © OpenStreetMap contributors; сұр нүктелер — Астана бағдарлары.",
      "Distances are approximate. Map © OpenStreetMap contributors; grey dots are Astana landmarks.",
    ],
    map_empty_title: ["Пока здесь пусто", "Әзірге мұнда бос", "Nothing here yet"],
    map_empty_text: [
      "Расскажи AI-гиду, чего хочется, — до трёх рекомендаций появятся на карте.",
      "AI-гидке не қалайтыныңды айт — үш ұсынысқа дейін картада пайда болады.",
      "Tell the AI guide what you'd like — up to three recommendations will appear on the map.",
    ],
    map_badge: ["{i} из {n} · {name}", "{n} ішінен {i} · {name}", "{i} of {n} · {name}"],
    details: ["Подробнее", "Толығырақ", "Details"],
    map_mode_aria: ["Что показать на карте", "Картада не көрсету", "What to show on the map"],
    map_mode_city: ["Вся карта", "Бүкіл карта", "Whole city"],
    map_mode_around: ["Вокруг", "Айналада", "Nearby"],
    map_count_city: ["{n} {places} на карте · {src}", "Картада {n} {places} · {src}", "{n} {places} on the map · {src}"],
    map_count_around: ["{n} {places} в радиусе {r} от точки отправления", "Бастапқы нүктеден {r} радиуста {n} {places}", "{n} {places} within {r} of the starting point"],
    map_src_snapshot: ["снимок OpenStreetMap от {date}", "OpenStreetMap суреті, {date}", "OpenStreetMap snapshot, {date}"],
    map_src_api: ["данные сервера", "сервер деректері", "server data"],
    map_around_need_point: [
      "Чтобы показать места вокруг, выбери точку отправления в AI-гиде.",
      "Айналадағы орындарды көрсету үшін AI-гидте бастапқы нүктені таңда.",
      "To show places nearby, choose a starting point in the AI guide.",
    ],
    map_poi_error: ["Не удалось загрузить точки мест.", "Орын нүктелерін жүктеу мүмкін болмады.", "Couldn't load the places layer."],
    map_legend_aria: ["Легенда карты", "Карта шартты белгілері", "Map legend"],
    legend_pick: ["1–3 — твоя подборка", "1–3 — сенің таңдауың", "1–3 — your picks"],
    legend_landmark: ["ориентиры", "бағдарлар", "landmarks"],
    start_point: ["Точка отправления", "Бастапқы нүкте", "Starting point"],

    // Экран «Место»
    to_home: ["На главную", "Басты бетке", "Home"],
    place_not_found: ["Место не найдено", "Орын табылмады", "Place not found"],
    place_not_in_pick_title: ["Этого места нет в текущей подборке", "Бұл орын ағымдағы таңдауда жоқ", "This place isn't in your current picks"],
    place_not_in_pick_text: [
      "Детали доступны только для мест из последнего поиска. Найди места заново — это займёт пару секунд.",
      "Мәліметтер тек соңғы іздеудегі орындарға қолжетімді. Орындарды қайта ізде — бұл бірнеше секунд алады.",
      "Details are only available for places from your last search. Search again — it takes a few seconds.",
    ],
    to_search: ["К поиску", "Іздеуге", "To search"],
    back_to_pick: ["Назад к подборке", "Таңдауға оралу", "Back to picks"],
    place_badge: ["Место для твоей прогулки", "Серуеніңе арналған орын", "A place for your walk"],
    why_title: ["Почему тебе понравится", "Неге саған ұнайды", "Why you'll like it"],
    todo_title: ["Что здесь сделать", "Мұнда не істеуге болады", "What to do here"],
    info_title: ["Информация о месте", "Орын туралы ақпарат", "About this place"],
    info_category: ["Категория", "Санат", "Category"],
    info_coords: ["Координаты", "Координаталар", "Coordinates"],
    info_hours: ["Часы работы (по данным OSM)", "Жұмыс уақыты (OSM деректері бойынша)", "Opening hours (per OSM)"],
    info_hours_value: ["{h}. Уточняйте перед визитом.", "{h}. Барар алдында нақтылаңыз.", "{h}. Check before you go."],
    info_status: ["Статус по расписанию", "Кесте бойынша күйі", "Scheduled opening status"],
    info_budget: ["Бюджет времени", "Уақыт бюджеті", "Time budget"],
    info_generation: ["Источник пояснения", "Түсіндірме көзі", "Explanation source"],
    info_access: ["Доступность", "Қолжетімділік", "Accessibility"],
    info_source: ["Источник", "Дереккөз", "Source"],
    info_source_value: [
      "{s}. Уточняйте входы, правила посещения и другие детали перед прогулкой.",
      "{s}. Кіреберістерді, бару ережелерін және басқа мәліметтерді серуен алдында нақтылаңыз.",
      "{s}. Check entrances, visiting rules and other details before your walk.",
    ],
    place_caption: [
      "Расстояние по прямой и время приблизительные. Объяснение сформулировано ИИ или по шаблону; уточняйте детали перед посещением.",
      "Түзу қашықтық пен уақыт шамамен алынған. Түсіндірме ЖИ арқылы немесе үлгі бойынша жазылған; барар алдында нақтылаңыз.",
      "Straight-line distance and time are approximate. The explanation was written by AI or from a template; check details before you go.",
    ],
    how_to_get: ["Как добраться", "Қалай жетуге болады", "How to get there"],
    straight_note: ["Расстояние указано по прямой — пешком путь может быть длиннее.", "Қашықтық түзу сызықпен көрсетілген — жаяу жол ұзағырақ болуы мүмкін.", "Distance is straight-line — the walking route may be longer."],
    build_route: ["Построить маршрут", "Маршрут құру", "Get directions"],
    open_gmaps: ["Открыть в Google Картах", "Google Карталарда ашу", "Open in Google Maps"],
    open_gmaps_sr: [" место «{name}» (откроется в новой вкладке)", " «{name}» орнын (жаңа қойындыда ашылады)", " “{name}” (opens in a new tab)"],
    back_to_recs: ["Вернуться к рекомендациям", "Ұсыныстарға оралу", "Back to recommendations"],
    route_note: [
      "Маршрут строится в Google Картах: туда передаются только координаты места, точку старта Google определит сам или спросит.",
      "Маршрут Google Карталарда құрылады: оларға тек орынның координаталары беріледі, бастапқы нүктені Google өзі анықтайды немесе сұрайды.",
      "Directions open in Google Maps: only the place's coordinates are sent, and Google will detect or ask for your starting point.",
    ],

    // Подвал
    footer_data: ["Данные ©", "Деректер ©", "Data ©"],
    footer_components: ["Компоненты и состояния", "Компоненттер мен күйлер", "Components & states"],

    // Категории: подпись в карточке и в фильтре
    cat_cafe: ["Кафе", "Кафе", "Café"],
    cat_restaurant: ["Ресторан", "Мейрамхана", "Restaurant"],
    cat_park: ["Парк", "Саябақ", "Park"],
    cat_museum: ["Музей", "Мұражай", "Museum"],
    cat_attraction: ["Достопримечательность", "Көрікті жер", "Attraction"],
    cat_viewpoint: ["Смотровая площадка", "Көру алаңы", "Viewpoint"],
    cat_playground: ["Детская площадка", "Балалар алаңы", "Playground"],
    cat_other: ["Место", "Орын", "Place"],
    chip_cafe: ["Кофе", "Кофе", "Coffee"],
    chip_restaurant: ["Рестораны", "Мейрамханалар", "Restaurants"],
    chip_park: ["Парки", "Саябақтар", "Parks"],
    chip_museum: ["Музеи", "Мұражайлар", "Museums"],
    chip_attraction: ["Достопримечательности", "Көрікті жерлер", "Sights"],
    chip_viewpoint: ["Виды", "Көріністер", "Viewpoints"],
    chip_playground: ["Детские площадки", "Балалар алаңдары", "Playgrounds"],

    // Ориентиры
    lm_baiterek: ["Байтерек", "Бәйтерек", "Baiterek"],
    lm_khan_shatyr: ["Хан Шатыр", "Хан Шатыр", "Khan Shatyr"],
    lm_akorda: ["Ак Орда", "Ақорда", "Akorda"],
    lm_nurzhol: ["Бульвар Нуржол", "Нұржол бульвары", "Nurzhol Boulevard"],
    lm_botanical: ["Ботанический сад", "Ботаникалық бақ", "Botanical Garden"],
    lm_expo: ["ЭКСПО", "ЭКСПО", "EXPO"],
    lm_nu: ["Назарбаев Университет", "Назарбаев Университеті", "Nazarbayev University"],
    lm_mega: ["Mega Silk Way", "Mega Silk Way", "Mega Silk Way"],
    lm_airport: ["Аэропорт Астаны", "Астана әуежайы", "Astana Airport"],

    // Быстрые идеи: подпись и текст запроса
    sc_walk: ["Короткая прогулка", "Қысқа серуен", "Short walk"],
    sc_walk_q: ["Хочу короткую прогулку", "Қысқа серуендегім келеді", "I want a short walk"],
    sc_coffee: ["Кофе рядом", "Жақын жерде кофе", "Coffee nearby"],
    sc_coffee_q: ["Кофе рядом", "Жақын жерде кофе", "Coffee nearby"],
    sc_family: ["С семьёй", "Отбасымен", "With family"],
    sc_family_q: ["Куда сходить с семьёй", "Отбасымен қайда баруға болады", "Where to go with my family"],
    sc_culture: ["Культура", "Мәдениет", "Culture"],
    sc_culture_q: ["Хочу посмотреть что-нибудь интересное в городе", "Қаладағы қызықты бірдеңені көргім келеді", "I want to see something interesting in the city"],
    sc_views: ["Что-то необычное", "Ерекше бірдеңе", "Something unusual"],
    sc_views_q: ["Хочу красивые виды и что-то необычное", "Әдемі көріністер мен ерекше бірдеңе қалаймын", "I want beautiful views and something unusual"],
    sc_dinner: ["Поужинать", "Кешкі ас", "Dinner"],
    sc_dinner_q: ["Где вкусно поужинать рядом", "Жақын жерде қай жерде дәмді кешкі ас ішуге болады", "Where to have a good dinner nearby"],
    sc_kids: ["С детьми на площадку", "Балалармен алаңға", "Playground with kids"],
    sc_kids_q: ["Детская площадка рядом", "Жақын маңдағы балалар алаңы", "A playground nearby"],
    sc_evening: ["Вечерняя прогулка", "Кешкі серуен", "Evening walk"],
    sc_evening_q: ["Спокойная вечерняя прогулка с красивыми видами", "Әдемі көріністері бар тыныш кешкі серуен", "A calm evening walk with nice views"],
  };

  function detect() {
    // ?lang=kk — для демо и ссылок на нужный язык
    const fromUrl = new URLSearchParams(window.location.search).get("lang");
    if (LANGS.includes(fromUrl)) return fromUrl;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (LANGS.includes(saved)) return saved;
    } catch {
      /* хранилище недоступно */
    }
    const nav = (navigator.language || "ru").toLowerCase();
    if (nav.startsWith("kk")) return "kk";
    if (nav.startsWith("en")) return "en";
    return "ru";
  }

  let lang = detect();
  const listeners = [];

  function t(key, vars) {
    const row = S[key];
    let s = row ? row[LANGS.indexOf(lang)] : key;
    if (row && s === "" && lang !== "ru") s = row[0];
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m));
    return s;
  }

  // «место / места / мест» и аналоги
  function places(n) {
    if (lang === "kk") return "орын";
    if (lang === "en") return n === 1 ? "place" : "places";
    const m10 = n % 10;
    const m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return "место";
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return "места";
    return "мест";
  }

  // Десятичный разделитель: 1,2 км (ru, kk) / 1.2 km (en)
  function decimal(x, digits = 1) {
    const s = x.toFixed(digits);
    return lang === "en" ? s : s.replace(".", ",");
  }

  function apply(root = document) {
    document.documentElement.lang = lang;
    root.querySelectorAll("[data-i18n]").forEach((node) => (node.textContent = t(node.dataset.i18n)));
    for (const attr of ["placeholder", "aria-label", "alt", "title"]) {
      root.querySelectorAll(`[data-i18n-${attr}]`).forEach((node) => node.setAttribute(attr, t(node.getAttribute(`data-i18n-${attr}`))));
    }
    root.querySelectorAll("[data-lang]").forEach((btn) => btn.setAttribute("aria-pressed", String(btn.dataset.lang === lang)));
  }

  function set(next) {
    if (!LANGS.includes(next) || next === lang) return;
    lang = next;
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      /* не сохранилось — язык всё равно сменится до перезагрузки */
    }
    apply();
    listeners.forEach((fn) => fn(lang));
  }

  window.I18N = Object.freeze({
    LANGS,
    t,
    places,
    decimal,
    apply,
    set,
    get lang() {
      return lang;
    },
    onChange(fn) {
      listeners.push(fn);
    },
  });
})();
