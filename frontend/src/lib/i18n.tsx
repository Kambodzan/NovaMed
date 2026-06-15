// Lekka warstwa PL/EN dla portalu pacjenta (rozszerzenie).
// Klucze słownika = oryginalne teksty polskie; brak tłumaczenia → fallback PL,
// więc nieprzetłumaczony tekst nigdy nie wybucha. Portale personelu zostają
// po polsku (decyzja projektowa — personel pracuje w PL).
import { createContext, useContext, useState } from 'react'
import { setDateLang } from './format'

export type Lang = 'pl' | 'en'

const EN: Record<string, string> = {
  // nawigacja / nagłówek
  'Start': 'Home',
  'Umów wizytę': 'Book a visit',
  'Moje wizyty': 'My visits',
  'Dokumentacja': 'Records',
  'Udostępnij': 'Share',
  'Rodzina': 'Family',
  'Recepty': 'Prescriptions',
  'Skierowania': 'Referrals',
  'Brak recept': 'No prescriptions',
  'E-recepty wystawione przez lekarza pojawią się tutaj z kodem do realizacji w aptece.':
    'E-prescriptions from your doctor will appear here with the pharmacy code.',
  'kod recepty': 'prescription code',
  'W aptece podaj kod i PESEL.': 'At the pharmacy, give the code and your PESEL.',
  'Brak skierowań': 'No referrals',
  'Skierowania od lekarza pojawią się tutaj — z każdego aktywnego umówisz termin jednym kliknięciem.':
    'Referrals from your doctor will appear here — book from any active one in a single click.',
  'Zabieg zaplanuje pielęgniarka — skierowanie czeka w jej kolejce.':
    'A nurse will schedule the procedure — the referral is waiting in her queue.',
  'Wyloguj': 'Log out',
  'Powiadomienia SMS': 'SMS notifications',
  'wł.': 'on',
  'wył.': 'off',
  'Nawigacja': 'Navigation',
  'Aktywny profil': 'Active profile',
  'Działasz w imieniu: {name}. Wizyty, dokumenty i rezerwacje dotyczą tego profilu.':
    'Acting on behalf of: {name}. Visits, records and bookings apply to this profile.',

  // Start
  'Dzień dobry': 'Hello',
  'Najbliższa wizyta': 'Next visit',
  'Szczegóły': 'Details',
  'Nie masz zaplanowanych wizyt': 'No upcoming visits',
  'Umów się do specjalisty — zajmie to mniej niż minutę.': 'Book a specialist — it takes less than a minute.',
  'Na skróty': 'Shortcuts',
  'Moja dokumentacja': 'My records',
  'Ostatnie dokumenty': 'Recent documents',
  'Wszystkie': 'All',
  'Brak dokumentów': 'No documents',
  'E-recepty, skierowania i wyniki badań pojawią się tu po wizytach.':
    'E-prescriptions, referrals and test results will appear here after your visits.',
  'teleporada': 'telehealth',

  // Umów wizytę
  'Specjalista': 'Specialist',
  'Termin': 'Slot',
  'Potwierdzenie': 'Confirmation',
  'Kogo potrzebujesz?': 'Who do you need?',
  'Brak wolnych terminów': 'No available slots',
  'Wróć później — placówki na bieżąco dodają nowe terminy.': 'Check back later — clinics add new slots regularly.',
  'najbliższy': 'earliest',
  'najbliższy:': 'earliest:',
  'termin': 'slot',
  'terminów': 'slots',
  'Nie ma specjalisty, którego szukasz?': "Can't find the specialist you need?",
  'Zapisz się na listę oczekujących': 'Join the waiting list',
  'Wolne terminy —': 'Available slots —',
  'Zmień': 'Change',
  'Wybierz': 'Select',
  'Płatność': 'Payment',
  'Potwierdzenie rezerwacji': 'Booking confirmation',
  'Zmień termin': 'Reschedule',
  'Rezerwujesz dla: {name} (podopieczny).': 'Booking for: {name} (dependent).',
  'Co Ci dolega? (opcjonalnie)': "What's bothering you? (optional)",
  'Lekarz zobaczy to przed wizytą — pomoże mu się przygotować.': 'Your doctor will see this before the visit — it helps them prepare.',
  'np. od tygodnia duszności przy wysiłku…': 'e.g. shortness of breath on exertion for a week…',
  'Powiadom mnie, jeśli u tego lekarza zwolni się wcześniejszy termin': 'Notify me if an earlier slot with this doctor frees up',
  'Po rezerwacji termin blokujemy na czas płatności. Wizyta zostanie potwierdzona po jej zaksięgowaniu.':
    'After booking, the slot is held while you pay. The visit is confirmed once payment clears.',
  'Wizyta w ramach NFZ — bezpłatna. Bezpłatne odwołanie do 24 godzin przed terminem.':
    'Visit covered by NFZ — free of charge. Free cancellation up to 24 hours before the visit.',
  'Rezerwowanie…': 'Booking…',
  'Rezerwuję i przechodzę do płatności': 'Book and proceed to payment',
  'Rezerwuję termin': 'Book this slot',
  'Termin zablokowany. Do zapłaty:': 'Slot held. Amount due:',
  'Operator płatności jest symulowany — wybierz wynik autoryzacji.': 'The payment provider is simulated — choose the authorization outcome.',
  'Zapłać kartą (symulacja)': 'Pay by card (simulated)',
  'Symuluj odmowę płatności': 'Simulate declined payment',
  'Wizyta potwierdzona': 'Visit confirmed',
  'Wizyta potwierdzona i opłacona': 'Visit confirmed and paid',
  'Szczegóły znajdziesz w zakładce „Moje wizyty”. Przypomnimy Ci o wizycie dzień wcześniej.':
    'See details under "My visits". We will remind you one day before.',
  'Płatność odrzucona': 'Payment declined',
  'Termin wrócił do puli wolnych terminów. Możesz spróbować ponownie lub wybrać inny termin.':
    'The slot returned to the pool. You can try again or pick another slot.',
  'Wróć do terminów': 'Back to slots',
  'Lista oczekujących': 'Waiting list',
  'Gdy pojawią się nowe terminy wybranej specjalizacji, dostaniesz powiadomienie, a wpis z listy zniknie automatycznie.':
    'When new slots for the chosen specialty appear, you will be notified and the entry will be removed automatically.',
  'Specjalizacja': 'Specialty',
  'np. Dermatolog': 'e.g. Dermatologist',
  'Zapisz': 'Sign up',
  'Usuń z listy': 'Remove from list',

  // Moje wizyty
  'Nadchodzące · bezpłatne odwołanie do 24 h przed terminem': 'Upcoming · free cancellation up to 24 h before the visit',
  'Brak nadchodzących wizyt': 'No upcoming visits',
  'Umów wizytę w zakładce „Umów wizytę”.': 'Book a visit under "Book a visit".',
  'Historia': 'History',
  'Rozpocznij': 'Start',
  'Dołącz do wizyty': 'Join the visit',
  'Do kalendarza': 'Add to calendar',
  'Dodaj do kalendarza (ICS)': 'Add to calendar (ICS)',
  'Dokończ płatność': 'Complete payment',
  'Płatność nie powiodła się.': 'Payment failed.',
  'Nie udało się pobrać pliku z wizytą — spróbuj ponownie.': 'Could not download the calendar file — try again.',
  'Nie udało się pobrać PDF — spróbuj ponownie.': 'Could not download the PDF — try again.',
  'Anuluj': 'Cancel',
  'Zwolnij rezerwację': 'Release the hold',
  'Oceń': 'Rate',
  'opinia wystawiona': 'review submitted',
  'Anulować wizytę?': 'Cancel this visit?',
  'Wróć': 'Back',
  'Anulowanie…': 'Cancelling…',
  'Tak, anuluj': 'Yes, cancel',
  'Termin wróci do puli wolnych terminów.': 'The slot will return to the pool.',
  'Wybierz nowy termin': 'Pick a new slot',
  'obecnie': 'currently',
  'Ten lekarz nie ma teraz wolnych terminów.': 'This doctor has no available slots right now.',
  'Opinia po wizycie (UC-P8)': 'Post-visit review (UC-P8)',
  'Wyślij opinię': 'Submit review',
  'Zapisywanie…': 'Saving…',
  'Oceń lekarza': 'Rate the doctor',
  'Oceń placówkę —': 'Rate the clinic —',
  'Komentarz (opcjonalnie)': 'Comment (optional)',
  'Możesz ocenić lekarza, placówkę lub oboje.': 'You can rate the doctor, the clinic, or both.',

  // Dokumentacja
  'E-recepta': 'E-prescription',
  'E-skierowanie': 'E-referral',
  'Wynik badania': 'Test result',
  'E-ZLA': 'E-ZLA (sick leave)',
  'Notatka z wizyty': 'Visit note',
  'E-recepty, skierowania i wyniki badań pojawią się tu po wizytach u lekarza.':
    'E-prescriptions, referrals and test results will appear here after doctor visits.',
  'kod:': 'code:',
  'Pobierz PDF': 'Download PDF',
  'Podgląd': 'Preview',
  'Podgląd dokumentu': 'Document preview',
  'Dokument': 'Document',
  'kod dokumentu': 'document code',
  'Pacjent': 'Patient',
  'Wystawił(a)': 'Issued by',
  'Data wystawienia': 'Issue date',
  'Status': 'Status',
  'Treść': 'Content',
  'Zamknij': 'Close',
  'Podsumowanie': 'Summary',
  'Podsumowanie wizyty': 'Visit summary',
  'Potwierdzam, że będę': "I'll be there",
  'Wybierz datę': 'Pick a date',
  'Wybierz…': 'Select…',
  'Szukaj…': 'Search…',
  'Brak wyników': 'No results',
  'Drukuj': 'Print',
  'Dziś': 'Today',
  'Poprzedni': 'Previous',
  'Następny': 'Next',
  'Obecność potwierdzona': 'Attendance confirmed',
  'Uzupełnienie': 'Addendum',
  'Zaświadczenie': 'Medical certificate',
  'Nie udało się skopiować — przepisz kod ręcznie.': 'Could not copy — type the code manually.',
  'Umawiasz badanie ze skierowania': 'Booking an exam from your referral',
  'Wybierz badanie i termin poniżej — skierowanie podepniemy automatycznie.': 'Pick the exam and a time below — the referral will be attached automatically.',
  'Edytuj opinię': 'Edit review',
  'Zapisz zmiany': 'Save changes',
  'Minął czas na edycję tej opinii (14 dni).': 'The time to edit this review has passed (14 days).',
  'Zgłoszony powód wizyty': 'Reported reason for the visit',
  'Notatki i zalecenia lekarza': "Doctor's notes and recommendations",
  'Lekarz nie zostawił notatki z tej wizyty.': 'The doctor left no notes for this visit.',
  'Dokumenty z tej wizyty': 'Documents from this visit',

  // Udostępnij
  'Udostępnij dokumentację': 'Share your records',
  'Lekarz lub pielęgniarka wpisze kod w swoim portalu i zobaczy wybrane dokumenty. Dostęp możesz odwołać w każdej chwili.':
    'A doctor or nurse enters the code in their portal to view the selected documents. You can revoke access at any time.',
  'Zakres udostępnienia': 'Sharing scope',
  'Cała dokumentacja': 'All records',
  'Tylko wyniki badań': 'Test results only',
  'Tylko e-recepty': 'E-prescriptions only',
  'Dokumenty z ostatnich 12 miesięcy': 'Documents from the last 12 months',
  'Ważność kodu': 'Code validity',
  '24 godziny': '24 hours',
  '7 dni': '7 days',
  '30 dni': '30 days',
  'Generowanie…': 'Generating…',
  'Wygeneruj kod': 'Generate code',
  'Przekaż ten kod lekarzowi lub pielęgniarce': 'Give this code to a doctor or nurse',
  'ważny do:': 'valid until:',
  'Skopiowano!': 'Copied!',
  'Kopiuj': 'Copy',
  'Wygeneruj kolejny': 'Generate another',
  'Aktywne udostępnienia': 'Active shares',
  'do': 'until',
  'Unieważnij': 'Revoke',
  'Nikt nie ma teraz dostępu': 'No one has access right now',
  'Wygenerowane kody pojawią się w tym miejscu — możesz je unieważnić w każdej chwili.':
    'Generated codes will appear here — you can revoke them at any time.',

  // statusy (StatusBadge w ui.tsx)
  'wolny termin': 'available slot',
  'blokada tymczasowa': 'payment pending',
  'potwierdzona': 'confirmed',
  'w trakcie': 'in progress',
  'zakończona': 'completed',
  'odwołana': 'cancelled',
  'nieodbyta': 'no-show',
  'przerwana': 'interrupted',
  'szkic': 'draft',
  'wysłana do P1': 'sent to P1',
  'zrealizowana': 'dispensed',
  'błąd wysyłki': 'submission error',
  'zlecone': 'ordered',
  'oczekuje na pacjenta': 'awaiting patient',
  'próbka pobrana': 'sample collected',
  'w analizie': 'in analysis',
  'wynik gotowy': 'result ready',
  'odebrany': 'received',
  'materiał niewłaściwy': 'invalid sample',
  'aktywne': 'active',
  'zatwierdzona': 'final',
  'wysłane do ZUS': 'sent to ZUS',
  'zaplanowany': 'planned',
  'wykonany': 'done',

  // listy terminów
  'Pokaż więcej terminów': 'Show more slots',
  'Szukaj lekarza lub specjalizacji…': 'Search for a doctor or specialty…',
  'Specjalizacje': 'Specialties',
  'Lekarze': 'Doctors',
  'Stacjonarne': 'In person',
  'Teleporady': 'Telehealth',
  'Brak terminów dla wybranych filtrów': 'No slots match the filters',
  'Zmień filtr lub wróć do wyboru specjalisty.': 'Change the filter or go back to specialist selection.',
  'Pokaż kolejne dni': 'Show more days',
  'Nic nie pasuje do wyszukiwania': 'Nothing matches your search',
  'Wszystkie placówki': 'All locations',
  'Szukaj lekarza, specjalizacji lub placówki…': 'Search for a doctor, specialty or location…',
  'Placówka': 'Location',
  'Placówki': 'Locations',
  'Lokalizacja': 'Location',
  'Lokalizacje': 'Locations',
  'Całe miasto': 'Whole city',
  'Wybierz lokalizację': 'Choose a location',
  'Wyczyść lokalizację': 'Clear location',
  'Wpisz miasto lub adres…': 'Type a city or address…',
  'Gotowe': 'Done',
  'Szukaj': 'Search',
  'Lekarz i termin': 'Doctor & time',
  'Wszyscy lekarze': 'All doctors',
  'Przeglądaj wszystkich lekarzy': 'Browse all doctors',
  'prywatnie od': 'private from',
  'Wizyta lekarska': 'Doctor visit',
  'Badanie diagnostyczne': 'Diagnostic test',
  'konsultacja u specjalisty': 'consultation with a specialist',
  'RTG, USG, spirometria… — do placówki': 'X-ray, ultrasound, spirometry… — at a location',
  'To badanie wymaga skierowania': 'This test requires a referral',
  'Skierowanie z NovaMed': 'NovaMed referral',
  'Oświadczam, że mam skierowanie zewnętrzne (okażę przed badaniem)': 'I declare I have an external referral (will present it before the test)',
  'wymaga skierowania': 'referral required',
  'Umów na podstawie skierowania': 'Book using this referral',
  'Szukaj badania (np. RTG, USG, spirometria)…': 'Search for a test (e.g. X-ray, ultrasound, spirometry)…',
  'Obszar': 'Area',
  'Wybierz placówkę': 'Choose this location',
  'Znajdź najbliżej mnie': 'Find nearest to me',
  'Lokalizowanie…': 'Locating…',
  'Najbliżej mnie': 'Near me',
  'Twoja przeglądarka nie udostępnia lokalizacji.': 'Your browser does not support geolocation.',
  'Nie udało się pobrać lokalizacji — sprawdź zgodę w przeglądarce.': 'Could not get your location — check the browser permission.',
  'Kliknij mapę, by zaznaczyć obszar — promień:': 'Click the map to select an area — radius:',
  'miasto': 'city',
  'Popularne specjalizacje': 'Popular specialties',
  'wszystkie': 'all',
  'specjalizacja': 'specialty',
  'Wcześniejsze dni': 'Earlier days',
  'Kolejne dni': 'Later days',
  'Wolę teleporadę (wideo) — bez przychodzenia do placówki': 'I prefer a video visit — no need to come in',
  'Spróbuj zmienić kryteria — albo daj znać, że czekasz:': 'Try different criteria — or let us know you are waiting:',

  // Rodzina
  'Konta rodzinne': 'Family accounts',
  'Profile podopiecznych — umawiaj wizyty i przeglądaj ich dokumentację w ich imieniu':
    'Dependent profiles — book visits and browse their records on their behalf',
  'Podopieczni': 'Dependents',
  'Brak podopiecznych': 'No dependents',
  'Dodaj profil dziecka lub osoby pod opieką formularzem poniżej.': 'Add a profile for a child or person in your care using the form below.',
  'Wróć na mój profil': 'Back to my profile',
  'Przełącz na ten profil': 'Switch to this profile',
  'Dodaj podopiecznego': 'Add a dependent',
  'Imię': 'First name',
  'Nazwisko': 'Last name',
  'Data urodzenia': 'Date of birth',
  'Dodaj': 'Add',
  'Podopieczny nie loguje się samodzielnie — wszystkie powiadomienia o jego wizytach i dokumentach trafiają do Ciebie.':
    'Dependents do not log in on their own — all notifications about their visits and documents go to you.',
  'ur.': 'born',
  'Odepnij': 'Unlink',
  'Potwierdź': 'Confirm',
  'Przygotowanie do wizyty': 'Before your visit',
  'Zgłoś się 10 minut wcześniej z dokumentem tożsamości i skierowaniem (jeśli wymagane). Badania laboratoryjne wykonuje się zwykle na czczo.':
    'Arrive 10 minutes early with an ID and a referral (if required). Lab tests are usually done while fasting.',
  'Zgłoś się 10 minut wcześniej z dokumentem tożsamości. Weź skierowanie (jeśli dotyczy) oraz listę przyjmowanych leków.':
    'Arrive 10 minutes early with an ID. Bring a referral (if applicable) and a list of your medications.',
  'Pełnoletni': 'Adult',
  'Pełnoletni podopieczny — dostęp opiekuna wygasł. Powinien założyć własne konto (tym samym PESEL-em odzyska dokumentację).':
    'Adult dependent — guardian access has expired. They should create their own account (the same PESEL recovers the records).',
  'Ważna do': 'Valid until',
  'Recepta wygasła': 'Prescription expired',
  'Wyniki': 'Results',
  'Parametr': 'Parameter',
  'Wynik': 'Result',
  'Norma': 'Reference',
  'Wartości poza normą oznaczono na czerwono (↑ powyżej, ↓ poniżej zakresu).':
    'Out-of-range values are marked in red (↑ above, ↓ below the reference range).',
  'Termin zarezerwowany jeszcze przez': 'Slot held for another',
  'Czas na płatność minął — termin mógł wrócić do puli. Zarezerwuj ponownie.':
    'Payment time expired — the slot may be released. Please book again.',
  'opłacona': 'paid',
  'zwrot środków': 'refunded',
  'Odbiorca zobaczy': 'The recipient will see',
  'dok.': 'docs',
  'notatek z wizyt': 'visit notes',
  'Ten zakres udostępnia też pełną treść notatek lekarskich z wizyt — nie tylko dokumenty.':
    "This scope also shares the full text of doctors' visit notes — not just documents.",
  'Odpiąć podopiecznego?': 'Unlink this dependent?',
  'Profil i dokumentacja zostają w placówce — znika tylko dostęp z Twojego konta.':
    'The profile and medical records stay with the clinic — only access from your account is removed.',
  'Nieprawidłowy PESEL (suma kontrolna).': 'Invalid PESEL number (checksum).',
}

interface I18nCtx {
  lang: Lang
  setLang: (l: Lang) => void
  /** tłumaczy tekst PL; {name} w szablonie podmienia na vars.name */
  t: (pl: string, vars?: Record<string, string>) => string
}

const Ctx = createContext<I18nCtx>({ lang: 'pl', setLang: () => {}, t: s => s })

const STORAGE_KEY = 'novamed-lang'

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const initial: Lang = localStorage.getItem(STORAGE_KEY) === 'en' ? 'en' : 'pl'
    setDateLang(initial)
    return initial
  })

  const setLang = (l: Lang) => {
    localStorage.setItem(STORAGE_KEY, l)
    setDateLang(l)
    setLangState(l)
  }

  const t = (pl: string, vars?: Record<string, string>) => {
    let out = lang === 'en' ? (EN[pl] ?? pl) : pl
    for (const [k, v] of Object.entries(vars ?? {})) out = out.replace(`{${k}}`, v)
    return out
  }

  return <Ctx.Provider value={{ lang, setLang, t }}>{children}</Ctx.Provider>
}

export const useI18n = () => useContext(Ctx)
