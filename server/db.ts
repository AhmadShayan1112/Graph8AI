import { MongoClient, type Db } from 'mongodb'

// Serverless instances are reused between requests, so keep one client per instance.
const g = globalThis as typeof globalThis & { __gapwiseMongo?: Promise<MongoClient> }

export async function getDb(): Promise<Db> {
  const uri = process.env.MONGODB_URI
  if (!uri) throw new Error('MONGODB_URI is not set')
  g.__gapwiseMongo ??= new MongoClient(uri, { maxPoolSize: 5 }).connect().catch(err => {
    g.__gapwiseMongo = undefined
    throw err
  })
  return (await g.__gapwiseMongo).db(process.env.MONGODB_DB || 'gapwise')
}
