export type AppLanguage = 'ru' | 'uz';

export function languageFromCode(code: string | null | undefined): AppLanguage {
  return code?.toLocaleLowerCase('en-US').startsWith('uz') === true ? 'uz' : 'ru';
}

export function localeForLanguage(language: AppLanguage): string {
  return language === 'uz' ? 'uz-UZ' : 'ru-RU';
}

const RU_MESSAGES = {
  mainMenu: 'Главное меню',
  menuDeals: '🔥 Горящие билеты',
  menuSubscriptions: '🔔 Мои уведомления',
  menuNewSubscription: '➕ Создать уведомление',
  menuSettings: '⚙️ Настройки',
  menuProfile: '👤 Профиль',
  viewTicket: '🎫 Посмотреть билет',
  disable: '🔕 Отключить',
  localFlights: '🇺🇿 Локальные рейсы',
  internationalFlights: '🌍 Международные',
  allDestinations: '🌍 Все направления',
  back: '⬅️ Назад',
  moreCities: '➡️ Ещё города',
  categories: '🔙 К категориям',
  showMore: '➡️ Показать ещё'
} as const;

export type MessageKey = keyof typeof RU_MESSAGES;

const UZ_MESSAGES: Record<MessageKey, string> = {
  mainMenu: 'Asosiy menyu',
  menuDeals: '🔥 Qaynoq chiptalar',
  menuSubscriptions: '🔔 Mening kuzatuvlarim',
  menuNewSubscription: '➕ Kuzatuv yaratish',
  menuSettings: '⚙️ Sozlamalar',
  menuProfile: '👤 Profil',
  viewTicket: '🎫 Chiptani ko‘rish',
  disable: '🔕 O‘chirish',
  localFlights: '🇺🇿 Mahalliy reyslar',
  internationalFlights: '🌍 Xalqaro reyslar',
  allDestinations: '🌍 Barcha yo‘nalishlar',
  back: '⬅️ Orqaga',
  moreCities: '➡️ Yana shaharlar',
  categories: '🔙 Toifalarga',
  showMore: '➡️ Yana ko‘rsatish'
};

export function message(language: AppLanguage, key: MessageKey): string {
  return language === 'uz' ? UZ_MESSAGES[key] : RU_MESSAGES[key];
}
