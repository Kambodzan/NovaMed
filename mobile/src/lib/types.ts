// Typy odzwierciedlające kontrakt REST backendu NovaMed (warstwa pacjenta).

export type Role =
  | 'pacjent' | 'lekarz' | 'pielegniarka' | 'rejestracja' | 'kierownik' | 'administrator'

export interface Me {
  user_id: string
  email: string
  username: string
  role: Role
  active_account: boolean
  first_name: string | null
  last_name: string | null
  notify_sms: boolean
}

export interface Profile {
  first_name: string | null
  last_name: string | null
  pesel: string | null
  birth_date: string | null
  phone_number: string | null
  email: string
  insurance_status: boolean
  notify_sms: boolean
}

export interface Clinic {
  clinic_id: string
  clinic_name: string
  address: string
  city: string | null
  lat: number | null
  lng: number | null
  photo_url: string | null
}

export interface Doctor {
  doctor_id: string
  name: string
  specializations: string[]
  academic_title: string | null
  room: string | null
}

export interface Service {
  service_id: string
  clinic_id: string
  name: string
  specialization: string | null
  duration_min: number
  price: number | null
  referral_required: boolean
  allow_online: boolean
  description: string | null
  active: boolean
  doctor_ids: string[]
}

export type AppointmentStatus =
  | 'FREE' | 'TEMP_LOCK' | 'CONFIRMED' | 'IN_PROGRESS' | 'COMPLETED'
  | 'CANCELLED' | 'NO_SHOW' | 'INTERRUPTED' | 'PAUSED' | 'BLOCKED'

export type PaymentStatus = 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED'

export interface Appointment {
  appointment_id: string
  appointment_datetime: string
  appointment_status: AppointmentStatus
  appointment_type: 'STATIONARY' | 'ONLINE'
  allow_online: boolean
  doctor_id: string | null
  doctor_name: string
  specializations: string[]
  clinic_id: string
  clinic_name: string
  clinic_address: string | null
  clinic_city: string | null
  patient_id: string | null
  patient_name: string | null
  price: number | null
  reviewed: boolean | null
  notes: string | null
  notify_earlier: boolean
  service_name: string | null
  service_id: string | null
  duration_min: number | null
  referral_required: boolean
  confirmation_requested: boolean
  patient_confirmed: boolean
  locked_until: string | null
  payment_status: PaymentStatus | null
  invoice_requested: boolean
  invoice_number: string | null
  checked_in_at: string | null
  room: string | null
}

export interface Hold {
  hold_token: string
  expires_at: string
}

export interface BookIn {
  reason?: string | null
  notify_earlier?: boolean
  online?: boolean
  referral_document_id?: string | null
  p1_referral_code?: string | null
  external_referral?: boolean
  pay_on_site?: boolean
  hold_token?: string | null
}

export interface PaymentInfo {
  payment_id: string
  provider_ref: string
  amount: number
  payment_status: PaymentStatus
}

export interface BookOut {
  appointment: Appointment
  payment: PaymentInfo | null
}

export interface LabValue {
  name: string
  value: number
  unit: string | null
  ref_low: number | null
  ref_high: number | null
}

export interface AppNotification {
  notification_id: string
  sent_at: string
  notification_title: string
  notification_content: string
  is_read: boolean
}

export interface Dependent {
  patient_id: string
  first_name: string
  last_name: string
  pesel: string
  birth_date: string
  is_adult: boolean
}

export interface Share {
  share_id: string
  access_code: string
  scope: string
  scope_label: string
  expires_at: string
  revoked: boolean
  recipient_name: string | null
  redeemed_at: string | null
}

export interface WaitlistEntry {
  entry_id: string
  specialization: string
  created_at: string
}

export interface DoctorRating {
  average: number | null
  count: number
  items?: { rating: number; comment: string | null; created_at: string }[]
}

export interface MyReview {
  doctor_rating: number | null
  doctor_comment: string | null
  clinic_rating: number | null
  editable: boolean
}

export interface Addendum {
  content: string
  created_at: string
  author_name?: string | null
}

export interface ClinicalNote {
  note_id: string | null
  appointment_id: string
  status: string // DRAFT / SIGNED / EMPTY
  content: string
  author_name: string | null
  signed_at: string | null
  addenda: Addendum[]
}

export interface MedicalDocument {
  document_id: string
  document_type: 'PRESCRIPTION' | 'REFERRAL' | 'LAB_RESULT' | 'SICK_LEAVE' | 'CERTIFICATE' | 'NOTE'
  document_status: string
  issued_at: string
  patient_id: string
  patient_name: string
  doctor_name: string
  code: string | null
  details: string | null
  error_message: string | null
  referral_type: string | null
  appointment_id: string | null
  lab_values: LabValue[] | null
  valid_until: string | null
  seen: boolean
}
