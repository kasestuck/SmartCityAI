/* Витрина компонентов: карточки и состояния строятся тем же кодом, что и на сайте. */
(function () {
  "use strict";

  document.addEventListener("DOMContentLoaded", () => {
    const R = window.Render;
    const { el } = R;
    const places = window.MOCK.RESPONSES.coffee.recommendations;

    document.getElementById("sg-card").append(R.placeCard(places[1], { index: 1 }));
    document.getElementById("sg-mini").append(
      ...places.map((p, i) => R.placeMini(p, { index: i + 1, onSelect: () => {} }))
    );
    window.SchematicMap.create(document.getElementById("sg-map"), {
      size: "compact",
      places: places.map((p) => ({
        id: p.id,
        name: p.name,
        lat: p.latitude,
        lon: p.longitude,
        category: p.category,
        label: R.categoryInfo(p.category).label,
      })),
      user: { lat: 51.09, lon: 71.42 },
      selectedId: places[0].id,
      ariaLabel: "Пример схематичной карты",
    });

    const btn = (cls, text, iconName) =>
      el("button", { class: `btn ${cls} btn--block`, attrs: { type: "button" } }, iconName ? R.icon(iconName, 18) : null, text);

    const samples = [
      ["AI-гид · Загрузка", R.stateCard({
        kind: "loading",
        iconName: "loader-circle.svg",
        title: "Подбираем интересные места для тебя...",
        text: "Собираем идеи под твой запрос и время на прогулку.",
        extra: R.dots(),
        actions: [btn("btn--secondary", "Изменить запрос")],
      })],
      ["Поиск · Нет результатов", R.stateCard({
        iconName: "search-x.svg",
        title: "Пока не нашли подходящих мест. Попробуй изменить запрос.",
        text: "Выбери другую категорию, добавь немного времени или начни из другой точки.",
        actions: [btn("btn--secondary", "Изменить запрос")],
      })],
      ["Геолокация · Доступ запрещён", R.stateCard({
        iconName: "map-pin-off.svg",
        title: "Укажи своё местоположение на карте.",
        text: "Можно выбрать точку вручную — доступ к геолокации не обязателен.",
        actions: [btn("btn--primary", "Выбрать точку на карте")],
      })],
      ["Сеть · Ошибка загрузки", R.stateCard({
        kind: "error",
        iconName: "wifi-off.svg",
        title: "Нет связи с сервером",
        text: "Не удалось загрузить рекомендации. Проверь подключение к интернету и попробуй ещё раз.",
        actions: [btn("btn--primary", "Повторить", "rotate-cw-white.svg")],
      })],
      ["429 · Слишком много запросов", R.stateCard({
        kind: "error",
        iconName: "clock-3.svg",
        title: "Слишком много запросов, подождите минуту",
        text: "Кнопка поиска снова станет активной через минуту. Введённый запрос сохранён.",
      })],
      ["500 · Ошибка сервера", R.stateCard({
        kind: "error",
        iconName: "wifi-off.svg",
        title: "Что-то пошло не так, попробуйте позже",
        text: "На сервере произошла ошибка. Запрос сохранён — можно повторить.",
        actions: [btn("btn--primary", "Повторить", "rotate-cw-white.svg")],
      })],
      ["503 · Без данных", R.stateCard({
        kind: "error",
        iconName: "wifi-off.svg",
        title: "Сервис временно недоступен",
        text: "Попробуй повторить запрос чуть позже.",
        actions: [btn("btn--primary", "Повторить", "rotate-cw-white.svg")],
      })],
      ["503 · С местами (шаблонные объяснения)", el(
        "p",
        { class: "notice" },
        R.icon("sparkles-16.svg", 18),
        "AI-объяснения сейчас недоступны — пояснения к местам составлены по шаблону."
      )],
      ["Загрузка · Скелетон", R.skeleton()],
    ];

    document.getElementById("sg-state-grid").append(
      ...samples.map(([label, node]) => el("div", { class: "sg-sample" }, el("p", { class: "t-label", text: label }), node))
    );
  });
})();
