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
  doctor_id: number | null  // NULL = badanie diagnostyczne (pracownia placówki)
  doctor_name: string
  service_name: string | null
  referral_required: boolean
  specialization: string | null
  clinic_id: number
  clinic_name: string
  patient_id: number | null
  patient_name: string | null
  price: number | null
  reviewed?: boolean | null
  notes: string | null
  notify_earlier: boolean
}

export interface NotificationOut {
  notification_id: number
  sent_at: string
  notification_title: string
  notification_content: string
  is_read: boolean
}

export interface WaitlistEntry {
  entry_id: number
  specialization: string
  created_at: string
}

export interface ShareOut {
  share_id: number
  access_code: string
  scope: string
  scope_label: string
  expires_at: string
  revoked: boolean
}

export interface SharedDocsOut {
  patient_id: number
  patient_name: string
  pesel: string
  scope_label: string
  expires_at: string
  documents: DocumentOut[]
}

export interface AdminUser {
  user_id: number
  username: string
  email: string
  role: string
  active_account: boolean
  created_at: string
}

export interface IntegrationStatus {
  id: string
  name: string
  url: string
  status: 'OK' | 'DOWN'
  latency_ms: number | null
  env: string
}

export interface AdminStats {
  users_by_role: Record<string, number>
  appointments_total: number
  appointments_completed: number
  documents_total: number
  procedures_total: number
  payments_paid_total: number
  database: string
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
  guardian_name: string | null
  guardian_phone: string | null
}
