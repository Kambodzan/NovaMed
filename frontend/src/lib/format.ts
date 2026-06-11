const LOCALE = {
  pl: {
    days: ['niedz.', 'pon.', 'wt.', 'śr.', 'czw.', 'pt.', 'sob.'],
    months: ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'],
    monthsShort: ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'],
  },
  en: {
    days: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
    monthsShort: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  },
}

// Język dat ustawiany przez I18nProvider (portal pacjenta); portale personelu
// nigdy go nie przełączają — zostaje PL.
let dateLang: keyof typeof LOCALE = 'pl'
export const setDateLang = (lang: keyof typeof LOCALE) => { dateLang = lang }

export const formatDatePL = (iso: string) => {
  const d = new Date(iso)
  const L = LOCALE[dateLang]
  return `${L.days[d.getDay()]}, ${d.getDate()} ${L.months[d.getMonth()]} ${d.getFullYear()}`
}

export const formatTime = (iso: string) => {
  const d = new Date(iso)
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
}

export const dayNo = (iso: string) => String(new Date(iso).getDate())
export const monthShort = (iso: string) => LOCALE[dateLang].monthsShort[new Date(iso).getMonth()]
export const isFuture = (iso: string) => new Date(iso).getTime() > Date.now()
