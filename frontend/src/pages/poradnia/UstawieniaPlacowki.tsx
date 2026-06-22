// Panel Poradni → Ustawienia placówki (tylko kierownik): konfiguracja JEGO placówki —
// siatka/przypomnienia/wyprzedzenie + długość wizyty i gabinet per lekarz + usługi.
// Wyniesione z modala Kalendarza: konfiguracja to rzadka, osobna
// robota — nie miesza się z codzienną obsługą dnia.
import { PageHeader, Loading } from '../../ui'
import { ClinicSelect, useClinicSelection } from '../../components/ClinicPicker'
import { ClinicSettingsPanel } from '../../components/ClinicSettingsPanel'

export function UstawieniaPlacowki() {
  const { clinics, clinic, setClinicId } = useClinicSelection()
  return (
    <div className="space-y-4">
      <PageHeader
        overline={clinic?.clinic_name ?? '…'}
        title="Ustawienia placówki"
        sub="Siatka terminów, przypomnienia, długości wizyt i gabinety lekarzy, katalog usług"
        action={<ClinicSelect clinics={clinics} value={clinic?.clinic_id} onChange={setClinicId} />}
      />
      {clinic ? <ClinicSettingsPanel key={clinic.clinic_id} clinic={clinic} /> : <Loading />}
    </div>
  )
}
