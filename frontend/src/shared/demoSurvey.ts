import type { SurveySchema } from "./surveyTypes";

export const demoSurvey: SurveySchema = {
  id: "demo",
  title: "Анкета гостя",
  description:
    "Демо-версия: позже поля будут приходить с бэка и настраиваться руководителем.",
  fields: [
    {
      id: "place",
      type: "single_select",
      label: "Где вы сейчас?",
      required: true,
      options: [
        { value: "restaurant", label: "Ресторан" },
        { value: "hotel", label: "Отель" },
        { value: "conference", label: "Конференц-зал" },
      ],
    },
    { id: "score", type: "rating_1_10", label: "Оцените ваш опыт (1–10)", required: true },
    {
      id: "reasons",
      type: "multi_select",
      label: "Что повлияло на впечатление?",
      options: [
        { value: "service", label: "Обслуживание" },
        { value: "food", label: "Еда / напитки" },
        { value: "clean", label: "Чистота" },
        { value: "speed", label: "Скорость" },
        { value: "price", label: "Цена/качество" },
        { value: "other", label: "Другое" },
      ],
    },
    {
      id: "visit_date",
      type: "date",
      label: "Дата визита",
      required: true,
    },
    {
      id: "wait_time",
      type: "range",
      label: "Ожидание (минут)",
      min: 0,
      max: 60,
    },
    {
      id: "comment",
      type: "textarea",
      label: "Комментарий",
      placeholder: "Что понравилось? Что улучшить?",
    },
  ],
};

