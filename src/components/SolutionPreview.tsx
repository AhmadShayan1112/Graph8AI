import { type FC } from 'react'

// Photos for the landing page's Solutions list, one per solution, with the result it delivers as a caption.
// All six load up front and cross-fade when the selection changes. Photos: Unsplash (free licence).
const PHOTOS: Array<{ name: string; src: string; alt: string; caption: string; position?: string }> = [
  { name: 'Booking page', src: '/images/solutions/booking.jpg', alt: 'A client booking a salon appointment on a phone', caption: 'Bookings come in around the clock, with SMS reminders' },
  { name: 'Fast landing page', src: '/images/solutions/landing.jpg', alt: 'Someone browsing business websites on a laptop', caption: 'Loads in under a second and ranks for local searches' },
  { name: 'Online menu & ordering', src: '/images/solutions/ordering.jpg', alt: 'A restaurant menu open on a phone above a table of food', caption: 'Pickup orders straight from the menu, no PDF', position: '50% 38%' },
  { name: 'Quote calculator', src: '/images/solutions/quote.jpg', alt: 'An electrician wiring a meter', caption: 'Instant estimates that turn visitors into jobs', position: '50% 35%' },
  { name: 'Reviews widget', src: '/images/solutions/reviews.jpg', alt: 'A customer holding a phone', caption: 'Verified Google reviews that build trust at a glance' },
  { name: 'FAQ assistant', src: '/images/solutions/assistant.jpg', alt: 'A man messaging on his phone in a restaurant', caption: 'Answers questions after hours and books the visit', position: '62% 30%' },
]

const SolutionPreview: FC<{ name: string }> = ({ name }) => {
  const active = PHOTOS.find(p => p.name === name) ?? PHOTOS[0]
  return (
    <figure className="sol-photo">
      {PHOTOS.map(p => (
        <img
          key={p.name}
          src={p.src}
          alt={p === active ? p.alt : ''}
          aria-hidden={p !== active}
          className={p === active ? 'on' : ''}
          style={p.position ? { objectPosition: p.position } : undefined}
          loading={p === PHOTOS[0] ? 'eager' : 'lazy'}
          decoding="async"
        />
      ))}
      <figcaption key={active.name} className="sol-caption">
        <span className="sol-check" aria-hidden>✓</span>{active.caption}
      </figcaption>
    </figure>
  )
}

export default SolutionPreview
