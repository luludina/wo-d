import fp from 'fastify-plugin'
import { MongoClient, type Db } from 'mongodb'
import { ensureIndexes } from '../db/indexes.js'

declare module 'fastify' {
  interface FastifyInstance {
    mongo: {
      client: MongoClient
      db: Db
    }
  }
}

export interface MongoPluginOptions {
  uri: string
  dbName: string
}

export const mongodbPlugin = fp<MongoPluginOptions>(
  async (app, options) => {
    const client = new MongoClient(options.uri)
    await client.connect()
    const db = client.db(options.dbName)
    await ensureIndexes(db)

    app.decorate('mongo', {
      client,
      db,
    })

    app.addHook('onClose', async () => {
      await client.close()
    })
  },
  { name: 'mongodb' },
)
