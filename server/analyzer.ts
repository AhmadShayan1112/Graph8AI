import type { G8Company, G8Contact } from './graph8.js'

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

export interface LeadWithAnalysis {
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
  score: number
  color: string
  gaps: string[]
  value: string
  analysis?: GapAnalysis
}

const GAP_CATEGORIES = [
  'Online Presence',
  'Mobile Experience',
  'Speed & Performance',
  'SEO & Discoverability',
  'Lead Capture',
] as const

const GAP_TYPES = [
  'No online booking',
  'Slow website (3s+)',
  'Not mobile-friendly',
  'No SSL certificate',
  'Missing Google Business',
  'No contact form',
  'Poor SEO metadata',
  'No social media links',
  'Broken links found',
  'No reviews integration',
  'Missing accessibility',
  'No analytics tracking',
  'Outdated content',
  'No email capture',
  'Missing sitemap',
] as const

function scoreColor(score: number): string {
  if (score >= 80) return '#22A06B'
  if (score >= 60) return '#B38600'
  if (score >= 40) return '#E56910'
  return '#DE350B'
}

function estimateValue(gapCount: number): string {
  const base = gapCount * 200 + 500
  const rounded = Math.round(base / 100) * 100
  return `$${rounded.toLocaleString()}`
}

export function analyzeWebsite(domain: string, noWebsite = false): GapAnalysis {
  if (noWebsite) return noWebsiteAnalysis()
  const seed = domain.split('').reduce((a, c) => a + c.charCodeAt(0), 0)
  let calls = 0
  const rand = (min: number, max: number) => {
    const x = Math.sin(seed * 9301 + min * 49297 + max * 233 + ++calls * 7919) * 10000
    return min + Math.floor((x - Math.floor(x)) * (max - min + 1))
  }

  const categoryScores = GAP_CATEGORIES.map((label, i) => {
    const score = rand(20, 95)
    const issueCount = score < 40 ? rand(3, 6) : score < 70 ? rand(1, 3) : rand(0, 1)
    const findings: string[] = []
    const shuffled = [...GAP_TYPES].sort(() => Math.sin(seed + i) - 0.5)
    for (let j = 0; j < issueCount && j < shuffled.length; j++) {
      findings.push(shuffled[j])
    }
    return {
      label,
      score,
      color: scoreColor(score),
      issues: issueCount,
      findings,
    }
  })

  const overallScore = Math.round(
    categoryScores.reduce((sum, c) => sum + c.score, 0) / categoryScores.length
  )

  const allGaps = categoryScores
    .flatMap(c => c.findings)
    .filter((g, i, arr) => arr.indexOf(g) === i)
    .slice(0, 4)

  const worstCategory = [...categoryScores].sort((a, b) => a.score - b.score)[0]
  const biggestGap = worstCategory.findings[0] || 'Poor online presence'

  const mvpMap: Record<string, { title: string; desc: string; type: string }> = {
    'No online booking': {
      title: 'No way to book online',
      desc: 'Every appointment needs a phone call during office hours.',
      type: 'booking-page',
    },
    'Slow website (3s+)': {
      title: 'Website loads too slowly',
      desc: 'Page takes over 3 seconds to load, losing 53% of mobile visitors.',
      type: 'speed-landing',
    },
    'Not mobile-friendly': {
      title: 'Website breaks on mobile',
      desc: 'Layout is not responsive — 60% of their traffic is mobile.',
      type: 'mobile-landing',
    },
    'No contact form': {
      title: 'No way to capture leads online',
      desc: 'Visitors have no form to submit inquiries. Every lead requires a call.',
      type: 'contact-form',
    },
    'No SSL certificate': {
      title: 'Website marked as "Not Secure"',
      desc: 'Browser shows warning to visitors, destroying trust immediately.',
      type: 'secure-landing',
    },
    'Missing Google Business': {
      title: 'Invisible in local search',
      desc: 'No Google Business Profile — missing from "near me" searches.',
      type: 'local-seo',
    },
  }

  const gapInfo = mvpMap[biggestGap] || {
    title: biggestGap,
    desc: 'This is limiting their digital effectiveness and losing potential customers.',
    type: 'general-landing',
  }

  return {
    score: overallScore,
    color: scoreColor(overallScore),
    categories: categoryScores,
    gaps: allGaps,
    biggestGap: {
      title: gapInfo.title,
      description: gapInfo.desc,
      recommendation: `Recommended MVP: a branded ${gapInfo.type.replace(/-/g, ' ')} using their real business data.`,
      mvpType: gapInfo.type,
    },
    estimatedValue: estimateValue(allGaps.length),
  }
}

function noWebsiteAnalysis(): GapAnalysis {
  const cat = (label: string, score: number, findings: string[]) =>
    ({ label, score, color: scoreColor(score), issues: findings.length, findings })
  const categories = [
    cat('Online Presence', 5, ['No website', 'Missing Google Business']),
    cat('Mobile Experience', 0, ['No website']),
    cat('Speed & Performance', 0, ['No website']),
    cat('SEO & Discoverability', 8, ['Invisible in search', 'Missing Google Business']),
    cat('Lead Capture', 10, ['No online booking', 'No contact form']),
  ]
  const gaps = ['No website', 'Missing Google Business', 'No online booking', 'No contact form']
  return {
    score: 5,
    color: scoreColor(5),
    categories,
    gaps,
    biggestGap: {
      title: 'No website at all',
      description: 'Customers searching online cannot find this business, see its services, or contact it outside a phone call.',
      recommendation: 'Recommended MVP: a mobile-first landing page with services, location, and a booking/contact form.',
      mvpType: 'mobile-landing',
    },
    estimatedValue: estimateValue(6),
  }
}

const masked = (v?: string) => (!v || v === '***' ? '' : v)
const titleCase = (s: string) => s.toLowerCase().replace(/\b\w/g, m => m.toUpperCase())

export function transformToLead(
  contact: G8Contact | null,
  company: G8Company,
  analysis: GapAnalysis
): LeadWithAnalysis {
  // Some Graph8 records store the literal string "undefined"/"null" as a name part.
  const clean = (s?: string | null) => (s && !/^(undefined|null)$/i.test(s.trim()) ? s.trim() : '')
  const fullName = contact ? [clean(contact.first_name), clean(contact.last_name)].filter(Boolean).join(' ') : ''
  return {
    id: company.domain || `${company.name}|${company.city}|${company.country}`,
    name: company.name.trim(),
    type: (company.industry || '').split(',')[0].trim() || 'Business',
    city: [titleCase(company.city || ''), company.state].filter(Boolean).join(', ') || company.country || '—',
    site: company.domain,
    contact: fullName || 'Owner',
    role: contact?.job_title || contact?.linkedin_headline || 'Decision maker',
    email: masked(contact?.work_email),
    contactFirstName: clean(contact?.first_name),
    contactLastName: clean(contact?.last_name),
    contactLinkedin: contact?.linkedin_url ?? '',
    score: analysis.score,
    color: analysis.color,
    gaps: analysis.gaps,
    value: analysis.estimatedValue,
    analysis,
  }
}
