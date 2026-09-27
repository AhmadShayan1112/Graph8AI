// The web solutions Gapwise builds, as shown to people. Keep in step with SOLUTION_TYPES in server/mvpAgents.ts.
export const OFFER_LABEL: Record<string, string> = {
  'booking-page': 'Online booking',
  'ordering-page': 'Online menu & ordering',
  'contact-form': 'Lead capture',
  'quote-calculator': 'Instant quote',
  'mobile-landing': 'Mobile-first landing page',
  'speed-landing': 'Fast landing page',
  'reviews-page': 'Reviews & trust page',
  'faq-assistant': 'FAQ & enquiry assistant',
  'web-app': 'Mobile-first web app',
}

export const offerLabel = (id: string) => OFFER_LABEL[id] ?? id.replace(/-/g, ' ')
