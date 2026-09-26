export interface GapAnalysis {
  score: number
  color: string
  categories: Array<{
    label: string
    score: number
    color: string
    issues: number
    findings: string[]
  }>
  gaps: string[]
  biggestGap: {
    title: string
    description: string
    recommendation: string
    mvpType: string
  }
  estimatedValue: string
}

export interface Lead {
  id: string
  name: string
  type: string
  city: string
  site: string
  contact: string
  role: string
  email: string
  contactFirstName: string
  contactLastName: string
  contactLinkedin: string
  enrichment?: Enrichment
  score: number
  color: string
  gaps: string[]
  value: string
  analysis?: GapAnalysis
}

export interface Enrichment {
  found: { company: boolean; person: boolean }
  company: {
    phone: string
    address: string
    revenue: string
    employees: string
    description: string
    industry: string
    linkedin: string
    facebook: string
  } | null
  person: {
    name: string
    title: string
    seniority: string
    linkedin: string
    phone: string
    education: string
  } | null
  email: {
    address: string
    verified: boolean
    bestGuess: string
    checked: Array<{ email: string; status: string; valid: boolean }>
  }
}

export interface MvpData {
  title: string
  tag: string
  description: string
  fixes: string
  steps: string[]
  html: string
  draftId: string
}

export interface OutreachData {
  subject: string
  greeting: string
  body1: string
  signal: string
  body2: string
  liveUrl: string
  body3: string
  signature: string
  sequence: Array<{
    day: string
    channel: string
    title: string
    condition: string
  }>
}
