import 'dotenv/config'
import { app } from './app.js'

// Local development server. On Vercel, api/index.ts serves the same app as a function.
const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`Gapwise API server running on http://localhost:${PORT}`)
})
