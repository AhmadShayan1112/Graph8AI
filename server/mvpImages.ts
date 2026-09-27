// Photos an MVP may use, checked by hand and served from this app (public/images). MVP pages are served from
// the same origin at /<slug>, so these paths always load. Photos: Unsplash (free licence).

export interface LibraryImage { id: string; src: string; alt: string; kind: 'hero' | 'team' | 'place' | 'detail' | 'work' }

const I = (id: string, src: string, kind: LibraryImage['kind'], alt: string): LibraryImage => ({ id, src, kind, alt })

const LIBRARY: Record<string, LibraryImage[]> = {
  dental: [
    I('dental-dentist', '/images/mvp/dental-dentist.jpg', 'hero', 'Dentist showing a patient her X-ray on a screen'),
    I('doctor-man', '/images/mvp/doctor-man.jpg', 'team', 'Smiling doctor in a white coat with a stethoscope'),
    I('doctor-woman', '/images/mvp/doctor-woman.jpg', 'team', 'Doctor in a white coat, arms crossed'),
    I('dental-clinic', '/images/mvp/dental-clinic.jpg', 'place', 'Bright, modern dental treatment room'),
    I('dental-smile', '/images/mvp/dental-smile.jpg', 'detail', 'Close-up of a healthy, white smile'),
  ],
  medical: [
    I('doctor-man', '/images/mvp/doctor-man.jpg', 'hero', 'Smiling doctor in a white coat with a stethoscope'),
    I('doctor-woman', '/images/mvp/doctor-woman.jpg', 'team', 'Doctor in a white coat, arms crossed'),
    I('doctor-scrubs', '/images/mvp/doctor-scrubs.jpg', 'team', 'Friendly clinician in scrubs'),
    I('dental-clinic', '/images/mvp/dental-clinic.jpg', 'place', 'Bright, modern treatment room'),
  ],
  restaurant: [
    I('restaurant-interior', '/images/mvp/restaurant-interior.jpg', 'hero', 'Warm, softly lit restaurant dining room'),
    I('restaurant-dish', '/images/mvp/restaurant-dish.jpg', 'detail', 'Plated salmon with fresh salsa and a glass of red wine'),
    I('restaurant-order', '/images/solutions/ordering.jpg', 'work', 'Ordering from a restaurant menu on a phone'),
    I('restaurant-guest', '/images/solutions/assistant.jpg', 'place', 'Guest checking his phone at a restaurant table'),
  ],
  salon: [
    I('salon-stylist', '/images/mvp/salon-stylist.jpg', 'hero', 'Stylist blow-drying a client’s hair'),
    I('salon-interior', '/images/mvp/salon-interior.jpg', 'place', 'Modern salon with round mirrors and black chairs'),
    I('salon-booking', '/images/solutions/booking.jpg', 'work', 'Client booking a salon appointment on her phone'),
  ],
  fitness: [
    I('fitness-training', '/images/mvp/fitness-training.jpg', 'hero', 'Trainer coaching a client through a sled push'),
    I('fitness-trainer', '/images/mvp/fitness-trainer.jpg', 'team', 'Personal trainer in a gym, arms crossed'),
  ],
  trades: [
    I('trades-plumber', '/images/mvp/trades-plumber.jpg', 'hero', 'Plumber with his toolbox working in a bathroom'),
    I('trades-repair', '/images/mvp/trades-repair.jpg', 'work', 'Close-up of hands repairing pipes under a sink'),
    I('trades-electrician', '/images/solutions/quote.jpg', 'team', 'Electrician in a hard hat wiring a meter'),
  ],
  realestate: [
    I('home-modern', '/images/mvp/home-modern.jpg', 'hero', 'Modern house with a pool and lounge chairs'),
    I('home-street', '/images/mvp/home-street.jpg', 'place', 'Contemporary house on a leafy street'),
  ],
  auto: [
    I('auto-mechanic', '/images/mvp/auto-mechanic.jpg', 'hero', 'Mechanic working on a car engine'),
    I('auto-engine', '/images/mvp/auto-engine.jpg', 'work', 'Technician inspecting an engine bay'),
  ],
  professional: [
    I('office-laptop', '/images/solutions/landing.jpg', 'hero', 'Professional reviewing work on a laptop'),
    I('owner-phone', '/images/signin-owner.jpg', 'team', 'Small-business owner smiling at his phone'),
  ],
}

const MATCHERS: Array<[RegExp, string]> = [
  [/dent|orthodon|teeth|tooth|oral/i, 'dental'],
  [/clinic|medic|doctor|physio|therap|health|hospital|chiro|pharma|optic|derma|care/i, 'medical'],
  [/restaurant|food|cafe|café|coffee|bakery|pizza|grill|bar\b|diner|kitchen|catering|bistro|eatery/i, 'restaurant'],
  [/salon|hair|beauty|spa|nail|barber|lash|brow|cosmet|aesthetic/i, 'salon'],
  [/gym|fitness|yoga|pilates|trainer|sport|crossfit|martial/i, 'fitness'],
  [/plumb|hvac|heating|cooling|air ?condition|electric|roof|construct|contractor|handyman|repair|clean|pest|landscap|trade/i, 'trades'],
  [/real ?estate|property|realt|homes?\b|housing|mortgage|architect/i, 'realestate'],
  [/auto|car\b|cars\b|garage|mechanic|tyre|tire|motor|vehicle/i, 'auto'],
]

// The photo set for a business, chosen from its industry and description.
export function imagesFor(industry: string, description = '') {
  const text = `${industry} ${description}`
  const key = MATCHERS.find(([re]) => re.test(text))?.[1] ?? 'professional'
  return { industry: key, images: LIBRARY[key] }
}
