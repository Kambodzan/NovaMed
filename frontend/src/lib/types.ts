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
  price: number | null
}

export interface PaymentInfo {
  payment_id: number
  provider_ref: string
  amount: number
  payment_status: 'PENDING' | 'PAID' | 'FAILED'
}

export interface BookOut {
  appointment: AppointmentOut
  payment: PaymentInfo | null
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

export interface ProcedureOut {
  procedure_id: number
  procedure_datetime: string
  procedure_type: string
  procedure_status: 'PLANNED' | 'DONE' | 'CANCELLED'
  notes: string | null
  patient_id: number
  patient_name: string
  referral_code: string
  ordered_by: string
}

export interface ReportOut {
  month: string
  total_booked: number
  completed: number
  cancelled: number
  no_show: number
  online_share_pct: number
  per_doctor: Array<{ doctor_id: number; doctor_name: string; booked: number; completed: number }>
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
