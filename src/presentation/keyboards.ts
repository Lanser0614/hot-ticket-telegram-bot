export function mainKeyboard(miniAppUrl: string | null = null): unknown {
  const miniAppRow = miniAppUrl === null
    ? []
    : [[{ text: '✈️ Открыть Hot Ticket', web_app: { url: miniAppUrl } }]];
  return {
    keyboard: [
      ...miniAppRow,
      [{ text: '🔥 Горящие билеты' }],
      [{ text: '🔔 Мои уведомления' }, { text: '➕ Создать уведомление' }],
      [{ text: '⚙️ Настройки' }, { text: '👤 Профиль' }]
    ],
    resize_keyboard: true
  };
}

export function ticketKeyboard(url: string): unknown {
  return { inline_keyboard: [[{ text: '🎫 Посмотреть билет', url }]] };
}

export function subscriptionKeyboard(subscriptionId: number): unknown {
  return {
    inline_keyboard: [[{
      text: '🔕 Отключить',
      callback_data: `subscription:disable:${subscriptionId}`
    }]]
  };
}

export {
  allDestinationsKeyboard,
  catalogCitiesKeyboard,
  catalogTabsKeyboard,
  ticketNavigationKeyboard
} from './ticket-pagination.js';
