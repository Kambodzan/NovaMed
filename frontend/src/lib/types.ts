// Typy odpowiedzi backendu (FastAPI — patrz backend/app/api/*)

export interface Me {
  user_id: number
  email: string
  username: string
  role: string
  active_account: boolean
  first_name: string | null
  last_name: string | null
}

export interface AppointmentOut {
  appointment_id: number
  appointment_datetime: string
  appointment_status: string
  appointment_type: 'ONLINE' | 'STATIONARY'
  doctor_id: number
  doctor_name: string
  specialization: string | null
  clinic_id: number
  clinic_name: string
  patient_id: number | null
  patient_name: string | null
}

export interface DocumentOut {
  document_id: number
  document_type: 'PRESCRIPTION' | 'REFERRAL' | 'LAB_RESULT' | 'SICK_LEAVE' | 'NOTE'
  document_status: string
  issued_at: string
  patient_id: number
  patient_name: string
  doctor_name: string
  code: string | null
  details: string | null
  error_message: string | null
}

export interface PatientInfo {
  patient_id: number
  first_name: string
  last_name: string
  pesel: string
  birth_date: string
  insurance_status: boolean
  phone_number: string | null
}
