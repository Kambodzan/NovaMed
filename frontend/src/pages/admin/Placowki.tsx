// Panel Admina → Placówki: administrator zarządza ustawieniami i długościami wizyt
// DOWOLNEJ placówki w sieci (globalny override). Reużywa ten sam panel konfiguracji
// co Panel Poradni kierownika; backend dopuszcza admina i omija scoping.
import { PageHeader } from '../../ui'
import { ClinicSelect, useClinicSelection } from '../../components/ClinicPicker'
import { ClinicSettingsPanel } from '../../components/ClinicSettingsPanel'

export function AdminPlacowki() {
  const { clinics, clinic, setClinicId } = useClinicSelection()
  return (
    <div className="space-y-4">
      <PageHeader
        overline="Administracja sieci"
        title="Placówki"
        sub="Ustawienia i długości wizyt dowolnej placówki"
        action={<ClinicSelect clinics={clinics} value={clinic?.clinic_id} onChange={setClinicId} />}
      />
      {clinic && <ClinicSettingsPanel key={clinic.clinic_id} clinic={clinic} />}
    </div>
  )
}
