// Typy odpowiedzi backendu (FastAPI — patrz backend/app/api/*)

export interface Me {
  user_id: string
  email: string
  username: string
  role: string
  active_account: boolean
  first_name: string | null
  last_name: string | null
  notify_sms: boolean
}

export interface AppointmentOut {
  appointment_id: string
  appointment_datetime: string
  appointment_status: string
  appointment_type: 'ONLINE' | 'STATIONARY'
  doctor_id: string | null  // NULL = badanie diagnostyczne (pracownia placówki)
  doctor_name: string
  service_name: string | null
  referral_required: boolean
  specialization: string | null
  clinic_id: string
  clinic_name: string
  patient_id: string | null
  patient_name: string | null
  price: number | null
  reviewed?: boolean | null
  notes: string | null
  notify_earlier: boolean
  confirmation_requested: boolean
  patient_confirmed: boolean
  locked_until?: string | null
  payment_status?: string | null
}

export interface NotificationOut {
  notification_id: string
  sent_at: string
  notification_title: string
  notification_content: string
  is_read: boolean
}

export interface WaitlistEntry {
  entry_id: string
  specialization: string
  created_at: string
}

export interface ShareOut {
  share_id: string
  access_code: string
  scope: string
  scope_label: string
  expires_at: string
  revoked: boolean
}

export interface SharedNote {
  appointment_id: string
  date: string
  doctor_name: string
  content: string
  addenda: string[]
}

export interface SharedDocsOut {
  patient_id: string
  patient_name: string
  pesel: string
  scope_label: string
  expires_at: string
  documents: DocumentOut[]
  notes: SharedNote[]
}

export interface AuditEntry {
  created_at: string
  actor_name: string | null
  actor_role: string
  action: string
  patient_name: string | null
  detail: string | null
}

export interface AdminUser {
  user_id: string
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
  payment_id: string
  provider_ref: string
  amount: number
  payment_status: 'PENDING' | 'PAID' | 'FAILED'
}

export interface BookOut {
  appointment: AppointmentOut
  payment: PaymentInfo | null
}

export interface DocumentOut {
  document_id: string
  document_type: 'PRESCRIPTION' | 'REFERRAL' | 'LAB_RESULT' | 'SICK_LEAVE' | 'NOTE' | 'CERTIFICATE'
  document_status: string
  issued_at: string
  patient_id: string
  patient_name: string
  doctor_name: string
  code: string | null
  details: string | null
  error_message: string | null
  referral_type: 'NURSING' | 'LAB' | 'SPECIALIST' | null
  appointment_id: string | null
}

export interface HistoryDoc { label: string; code: string | null; details: string | null }
export interface HistoryEntry {
  appointment_id: string
  date: string
  doctor_name: string
  appointment_type: 'ONLINE' | 'STATIONARY'
  note: string | null
  addenda: string[]
  documents: HistoryDoc[]
}

export interface NoteAddendum { author_name: string; content: string; created_at: string }
export interface NoteEvent { actor_name: string; action: string; created_at: string }
export interface ClinicalNote {
  note_id: string | null
  appointment_id: string
  status: 'EMPTY' | 'DRAFT' | 'SIGNED'
  content: string
  author_name: string | null
  created_at: string | null
  updated_at: string | null
  signed_at: string | null
  signed_by_name: string | null
  addenda: NoteAddendum[]
  events: NoteEvent[]
}

export interface ReviewOut {
  review_id: string
  rating: number
  comment: string | null
  created_at: string
  target: 'doctor' | 'clinic'
}

export interface DoctorReviewsOut {
  doctor_id: string
  average: number | null
  count: number
  items: ReviewOut[]
}

export interface ProcedureOut {
  procedure_id: string
  procedure_datetime: string
  procedure_type: string
  procedure_status: 'PLANNED' | 'DONE' | 'CANCELLED'
  notes: string | null
  patient_id: string
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
  per_doctor: Array<{ doctor_id: string; doctor_name: string; booked: number; completed: number }>
}

export interface PatientInfo {
  patient_id: string
  first_name: string
  last_name: string
  pesel: string
  birth_date: string
  insurance_status: boolean
  phone_number: string | null
  allergies: string | null
  chronic_diseases: string | null
  chronic_medications: string | null
  guardian_name: string | null
  guardian_phone: string | null
}
